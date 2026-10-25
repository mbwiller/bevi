-- A hygiene sweep: six findings from the reviews of #115, #117 and #118, plus
-- one new diagnostic. Three of the six are SQL and live here.
--
-- Nothing here changes a happy path. Taken in order:
--
--   1. `refresh_bev_stats` tests emptiness with `array_length(arr, 1) is null`.
--      That is CORRECT (see the long comment on it) but it is the same idiom
--      that WAS a real hole in `get_bev_similarities`, so it is rewritten with
--      `cardinality()` to stop the next reader having to re-derive why one is
--      safe and the other was not.
--   2. `list_bucket_bevs` gains a server-side row cap. The row set is the
--      caller's own rankings, so an unbounded result only ever hurts the
--      caller -- but it grows forever and every other list in this schema is
--      bounded.
--   3. Supabase's default privileges (`alter default privileges in schema
--      public grant all on tables to anon, authenticated, service_role`) leave
--      `anon` and `authenticated` holding INSERT/UPDATE/DELETE/TRUNCATE on
--      every table in `public`. RLS denies the DML -- there is no permissive
--      write policy on a content table -- but **TRUNCATE IS NOT SUBJECT TO
--      RLS**. `truncate public.bevs` from a signed-in user's publishable key is
--      a privilege check and nothing else, and it passes today. This migration
--      is the revoke that should have accompanied 20261011000100.
--   4. `public.graph_pipeline_status()`, a service-role-only diagnostic that
--      `npm run graph:verify` (scripts/graph/verify-pipeline.ts) reads. It
--      exists because three separate silent failures in this project were
--      success-shaped, and the facts needed to tell "configured" from
--      "assumed" -- Vault secret presence, trigger state -- are not reachable
--      over PostgREST at all.
--
-- 20261019000500 (list_bucket_bevs) and 20261011000200 (refresh_bev_stats) are
-- on `main` and therefore frozen; both functions are reproduced in full here
-- because a migration is append-only.

set search_path = public, extensions;

-- ===========================================================================
-- 1. refresh_bev_stats: cardinality(), not array_length(arr, 1)
-- ===========================================================================
-- THIS WAS NOT EXPLOITABLE, and the distinction matters enough to write down
-- so that a future reader does not "fix" a non-bug somewhere else by analogy.
--
-- `array_length(arr, 1)` is the length of the FIRST DIMENSION. In
-- `get_bev_similarities` (20261019000500) the idiom guarded a CAP --
-- `array_length(p_other_ids, 1) > 500` -- and a nested array walks straight
-- past a cap written that way: PostgREST turns a nested JSON array into a
-- multidimensional Postgres array, so `[[a,b,c,d,e,f], ...]` with 100 outer
-- elements is 600 ids with `array_length(.., 1) = 100`. The bound became the
-- request body size. That one was real and was fixed with `cardinality()`.
--
-- Here the test is `is null`, and `array_length(arr, 1) is null` is TRUE for
-- exactly the arrays `cardinality(arr) = 0` is TRUE for: an array with no
-- dimensions. A 2-D `uuid[]` gives a non-null first dimension, so the guard
-- falls through -- and that is the right answer, because everything after it
-- (`unnest`, `= any`) flattens all dimensions and computes the correct stats
-- for every element. There is no input that makes this guard wrong.
--
-- So this is a readability trap, not a defect: two spellings of "is it empty?"
-- in one schema, one of which has a CVE-shaped history. One spelling from here
-- on, and the reason is in the code rather than in a PR thread.
--
-- Body otherwise byte-for-byte 20261011000200:114-155.
create or replace function public.refresh_bev_stats(p_bev_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- cardinality() counts ELEMENTS; array_length(arr, 1) counts the first
  -- dimension. They agree on this test, but only this test -- see the header.
  if p_bev_ids is null or cardinality(p_bev_ids) = 0 then
    return;
  end if;

  insert into public.bev_stats (bev_id, rating_count, sum_score, avg_score, score_stddev, last_ranked_at, updated_at)
  select
    ids.bev_id,
    coalesce(agg.rating_count, 0),
    coalesce(agg.sum_score, 0),
    agg.avg_score,
    agg.score_stddev,
    agg.last_ranked_at,
    now()
  from (select distinct bev_id from unnest(p_bev_ids) as u(bev_id)) as ids
  left join (
    select
      bev_id,
      count(*)          as rating_count,
      sum(score)        as sum_score,
      avg(score)        as avg_score,
      stddev_pop(score) as score_stddev,
      max(ranked_at)    as last_ranked_at
    from public.rankings
    where bev_id = any(p_bev_ids)
    group by bev_id
  ) agg on agg.bev_id = ids.bev_id
  on conflict (bev_id) do update set
    rating_count   = excluded.rating_count,
    sum_score      = excluded.sum_score,
    avg_score      = excluded.avg_score,
    score_stddev   = excluded.score_stddev,
    last_ranked_at = excluded.last_ranked_at,
    updated_at     = excluded.updated_at;
end;
$$;

-- `create or replace function` preserves the existing ACL, so the revoke from
-- 20261011000200:401-409 still stands. Restated verbatim -- `from public, anon`
-- and NOT `authenticated` -- for the same reason 20261025000100 restates its
-- grants: an append-only migration that replaces a function should leave its
-- final privileges readable in one place, and restating them as they ARE rather
-- than as they arguably should be keeps this a no-op.
--
-- (Noted while writing this and deliberately NOT changed here: 20261011000200
-- never granted `refresh_bev_stats` to `authenticated`, but it never revoked it
-- either, and Supabase's default privileges lay down a direct EXECUTE grant to
-- `anon`, `authenticated` and `service_role` on every new function in this
-- schema -- so `authenticated` can still call it. It is a definer that only
-- recomputes `bev_stats` from `rankings`, so it cannot corrupt anything, but a
-- caller can hand it an arbitrarily long `uuid[]`. That is a function-grant
-- audit across all 90 definers in this schema, not a line in a sweep about
-- table privileges, and it deserves its own PR and its own pgTAP.)
alter function public.refresh_bev_stats(uuid[]) owner to postgres;
revoke execute on function public.refresh_bev_stats(uuid[]) from public, anon;

-- ===========================================================================
-- 2. list_bucket_bevs: a server-side row cap
-- ===========================================================================
-- Every other list the contract exposes is bounded: `rankings.listRanked`,
-- `feed.list`, `comments.list` and the rest clamp through `clampLimit`
-- (MAX_LIMIT = 50, packages/api/src/paging.ts), `get_similar_bevs` clamps
-- p_limit to 50, and `get_bev_similarities` rejects more than 500 ids. This
-- function bounded nothing.
--
-- It is the mildest instance of the family: the rows are the CALLER'S OWN
-- rankings in one bucket, so the only person a huge answer costs is the person
-- who ranked that many Bevs, and `max_rows = 1000` in supabase/config.toml
-- already truncates the REST response (it applies to a stored procedure as
-- well as a table). But the set grows without limit, it is read on the
-- comparison path (M-21 anchors a comparison from it), and relying on a
-- PostgREST setting means the bound disappears the moment anything calls this
-- from SQL. 500 is the cap, matching `get_bev_similarities`: a bucket is a few
-- hundred Bevs at most.
--
-- A TRUNCATING `limit`, not a `raise`. `get_bev_similarities` rejects an
-- oversized argument because the caller chose it and a bad value is a caller
-- bug. Here nobody chose anything -- the size is however many Bevs the user
-- has ranked -- so erroring would break the comparison flow for a heavy user
-- and leave them no way out. Truncating keeps the 500 MOST RELEVANT rows,
-- because the order is `position` (best first) and always has been.
--
-- The age gate, the `status = 'active'` filter and the `brand_key` expression
-- are reproduced unchanged from 20261019000500:468-506, comments included:
-- they are each load-bearing (the parity with `rankings.listBucket` is
-- asserted in 11_graph_tables.test.sql) and this migration is not the place to
-- revisit any of them.
create or replace function public.list_bucket_bevs(p_bucket smallint)
returns table (
  id          uuid,
  category_id text,
  brand_key   text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- Same number as get_bev_similarities' cap, for the same reason: a bucket is
  -- a few hundred Bevs at most. See the header for why this truncates.
  v_max constant int := 500;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    select b.id,
           b.category_id,
           -- Collapse BEFORE trimming. btrim(text) strips spaces only, while
           -- normaliseBrand()'s JS .trim() strips all whitespace, so
           -- `lower(btrim(E'\tDr Pepper'))` keeps the tab, the collapse turns
           -- it into a leading space, and SQL reads ' dr pepper' where
           -- TypeScript reads 'dr pepper'. Collapsing first also means a
           -- whitespace-only brand reaches btrim as ' ' and nullif catches it.
           nullif(btrim(regexp_replace(lower(b.brand), '\s+', ' ', 'g')), '') as brand_key
      from public.rankings r
      join public.bevs b on b.id = r.bev_id
      join public.categories c on c.id = b.category_id
     where r.user_id = v_uid
       and r.bucket = p_bucket
       and b.status = 'active'
       and (not c.is_alcoholic or public.viewer_is_adult())
     order by r.position
     limit v_max;
end;
$$;

comment on function public.list_bucket_bevs(smallint) is
  'S-14: the caller''s own ranked Bevs in one bucket as (id, category_id, brand_key), best first, at most 500 rows. Same row set as rankings.listBucket; brand_key matches normaliseBrand() in @bevi/ranking.';

-- Verbatim from 20261019000500:521-535, for the reason given on
-- refresh_bev_stats above: restated as they are, so this stays a no-op.
alter function public.list_bucket_bevs(smallint) owner to postgres;
revoke execute on function public.list_bucket_bevs(smallint) from public, anon;
grant execute on function public.list_bucket_bevs(smallint) to authenticated;

-- ===========================================================================
-- 3. Table privileges: revoke the DML Supabase's default privileges granted
-- ===========================================================================
-- THE HOLE. Supabase ships
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so every table created by every migration in this folder arrived with
-- INSERT, UPDATE, DELETE and TRUNCATE granted to `anon` and `authenticated` at
-- the PRIVILEGE layer. RLS is what has been denying the DML: supabase/CLAUDE.md
-- forbids an INSERT/UPDATE/DELETE policy for `authenticated` on a content
-- table, so there is no permissive write policy to match and every such
-- statement is "0 rows" or a 42501.
--
-- TRUNCATE IS NOT SUBJECT TO RLS. There is no such thing as a TRUNCATE policy;
-- Postgres checks the table privilege and nothing else. So
--
--   truncate public.bevs cascade;
--
-- issued with the publishable key and any signed-in session is, today, a
-- privilege check that PASSES -- the whole catalog, every ranking, every
-- comparison and every edge, from one request. The same is true of
-- `public.rankings`, `public.profiles` and the rest. That is the finding, and
-- it is why this section exists rather than being left to RLS.
--
-- (INSERT/UPDATE/DELETE are revoked alongside it as defence in depth. They are
-- already denied by RLS; removing the grant means a future migration that adds
-- a table-level policy by mistake cannot silently open a write path, and it
-- makes "writes go through a definer RPC" true at both layers instead of one.)
--
-- WHY THE `security definer` RPCs ARE UNAFFECTED. A `security definer`
-- function executes with the privileges of its OWNER, not its caller, and
-- every function in this schema is owned by `postgres` -- `grep -h 'owner to'
-- supabase/migrations/*.sql` yields `owner to postgres` and nothing else, and
-- a function created by a migration is owned by the role that ran the
-- migration, which is `postgres`. Revoking from `anon` and `authenticated`
-- therefore cannot touch what a definer may do: `submit_ranking`,
-- `create_bev`, `report_bev`, `set_handle`, `refresh_bev_stats`,
-- `replace_bev_edges`, `enqueue_bev_embedding` and the rest keep writing
-- exactly as before, because `postgres` keeps its own privileges and is also
-- RLS-exempt as the table owner. What changes is only the DIRECT path a
-- PostgREST request can take, which is the path that was never meant to exist.
--
-- WHY THE SERVICE ROLE IS UNAFFECTED. `service_role` is not named in a single
-- revoke below. It keeps `grant all` from the same default privileges, and it
-- has BYPASSRLS. So the nightly sync, `npm run graph:edges` (which writes
-- `bev_edges` through `replace_bev_edges`) and the `embed` Edge Function
-- (which upserts `bev_embeddings` directly over PostgREST) are untouched.
--
-- WHY `anon` LOSES SELECT TOO. No table in `public` has a select policy for
-- `anon` -- every policy in this schema is `to authenticated` -- so `anon`
-- already reads zero rows everywhere and this revoke changes no behaviour. It
-- is written down so the intent is a privilege rather than an absence, which
-- is the same reasoning 20261012000400 used for `profiles`. `anon`'s only
-- legitimate reads are through `check_invite_code()` and `check_handle()`,
-- both `security definer` owned by `postgres`, both unaffected per above.
--
-- A NOTE FOR THE NEXT MIGRATION THAT CREATES A TABLE: the default privileges
-- are still in place, so a new table arrives with the same grants. Revoke them
-- in the migration that creates it.

-- 3a. Content tables with NO write policy for `authenticated` at all. Writes
--     go through a definer RPC (or the service role), reads through a `select`
--     policy, and `anon` has no business in either.
revoke insert, update, delete, truncate on
  public.categories,
  public.bevs,
  public.bev_aliases,
  public.bev_stats,
  public.rankings,
  public.comparisons,
  public.user_stats,
  public.user_category_stats,
  public.streaks,
  public.feed_events,
  public.bev_reports,
  public.user_bev_predictions,
  public.global_stats,
  public.bev_flavor_profiles,
  public.post_likes,
  public.post_comments,
  public.bev_embeddings,
  public.bev_edges
from anon, authenticated;

revoke select on
  public.categories,
  public.bevs,
  public.bev_aliases,
  public.bev_stats,
  public.rankings,
  public.comparisons,
  public.user_stats,
  public.user_category_stats,
  public.streaks,
  public.feed_events,
  public.bev_reports,
  public.user_bev_predictions,
  public.global_stats,
  public.bev_flavor_profiles,
  public.post_likes,
  public.post_comments,
  public.bev_embeddings,
  public.bev_edges
from anon;

-- 3b. RLS on, and NO POLICY AT ALL -- so neither role may read a row either,
--     and the privilege should say so. `app_secrets` holds the invite code and
--     is read only by `check_invite_code()`; `recommendation_jobs` and
--     `user_actions` are machinery (`assert_rate()` writes the latter). All
--     three are reached exclusively from definers owned by `postgres`.
revoke all on
  public.app_secrets,
  public.recommendation_jobs,
  public.user_actions
from anon, authenticated;

-- 3c. The four tables that DO have a permissive write policy for
--     `authenticated`. Revoking the privilege a policy depends on would turn
--     that policy into dead code and break a working path, so each of these
--     keeps exactly the verbs a policy backs and loses the rest. TRUNCATE is
--     lost by all four, because no policy can ever back it.
--
--     `profiles`  -- profiles_update (own row). packages/api/src/profile.ts:79
--                    updates display_name/timezone/onboarded directly through
--                    it, so UPDATE stays for `authenticated`.
--                    NOT `revoke all`: 20261012000400 revoked SELECT and
--                    re-granted it per column, and `revoke all` would strip
--                    those column grants and blind the app to its own profile.
--     `follows`,
--     `want_to_try` -- own-row insert/delete policies, which supabase/CLAUDE.md
--                    explicitly sanctions for a user's own small tables. The
--                    app happens to use the `follow_user`/`add_want_to_try`
--                    RPCs today, but the policies are a supported path and are
--                    left working.
--     `featured_bevs` -- insert/update/delete policies gated on `is_admin()`,
--                    which is how an admin curates the carousel from Studio or
--                    a signed-in admin session.
revoke insert, delete, truncate on public.profiles from anon, authenticated;
revoke update                   on public.profiles from anon;

revoke update, truncate         on public.follows, public.want_to_try from anon, authenticated;
revoke insert, delete, select   on public.follows, public.want_to_try from anon;

revoke truncate                 on public.featured_bevs from anon, authenticated;
revoke insert, update, delete, select
                                on public.featured_bevs from anon;

-- ===========================================================================
-- 4. graph_pipeline_status(): the facts `npm run graph:verify` asserts
-- ===========================================================================
-- Every silent failure in this project so far has been SUCCESS-SHAPED:
--
--   * `graph-keepalive.yml` exited 0 every day from 2026-10-15 while skipping,
--     because `NEO4J_URI` was never set and the script warned instead of
--     failing.
--   * `14_graph_edge_writer.test.sql` was green in CI while `replace_bev_edges`
--     could not write on prod at all, because `pg_safeupdate` is a property of
--     the hosted project and not of the schema (20261025000100).
--   * `bevs_embed_after_insert` was a no-op from the day it shipped, because
--     the GUC its documented setup step set cannot be set on Supabase
--     (20261025000200). Nothing failed. No new Bev was embedded.
--
-- The pattern is that "configured" was ASSUMED where it could have been
-- ASSERTED. This function returns the facts that make it assertable, and
-- `scripts/graph/verify-pipeline.ts` decides PASS/FAIL from them and exits
-- non-zero. It is split that way because the version check compares against
-- `RANKING_VERSION` imported from `@bevi/ranking`, which is a TypeScript
-- constant and has no business being duplicated in SQL.
--
-- It is an RPC rather than four REST reads because two of the four facts are
-- not reachable over PostgREST at any privilege level: `vault.decrypted_secrets`
-- is readable by its owner only (which is why `enqueue_bev_embedding` is a
-- definer), and `pg_trigger` is not in an exposed schema. A definer owned by
-- `postgres` is the pattern this schema already uses for exactly that.
--
-- SECRET VALUES NEVER LEAVE THE DATABASE. The Vault branch returns the secret's
-- NAME and the CHARACTER LENGTH of its decrypted value, and `length(...) > 0`
-- is the whole test. A length is enough to tell "set" from "unset" and from
-- "set to the empty string", which is the failure mode 20261025000200's
-- `nullif(s.decrypted_secret, '')` exists to tolerate; it is not enough to
-- learn anything about the token.
create or replace function public.graph_pipeline_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_vault_available boolean := to_regclass('vault.decrypted_secrets') is not null;
  v_vault           jsonb   := '[]'::jsonb;
  v_active          int;
  v_embedded        int;
  v_edges           int;
  v_misoriented     int;
  v_versions        jsonb;
  v_triggers        jsonb;
begin
  -- Guarded rather than assumed: `supabase_vault` is installed on the hosted
  -- project, but plpgsql plans a statement only when it reaches it, so this
  -- branch keeps the function callable on a stack that has no vault instead of
  -- raising 42P01 at the first line. A missing vault is reported as a fact and
  -- the script fails on it, which is the honest answer.
  if v_vault_available then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name',   want.name,
             'present', s.name is not null,
             'length',  coalesce(length(s.decrypted_secret), 0)
           ) order by want.name), '[]'::jsonb)
      into v_vault
      from (values ('embed_function_url'), ('embed_webhook_token')) as want(name)
      left join vault.decrypted_secrets s on s.name = want.name;
  end if;

  -- "Has no row in bev_embeddings" is the dirty flag the backfill uses
  -- (docs/graph.md), so this is the same question asked for reporting.
  select count(*)::int,
         count(e.bev_id)::int
    into v_active, v_embedded
    from public.bevs b
    left join public.bev_embeddings e on e.bev_id = b.id
   where b.status = 'active';

  select count(*)::int,
         (count(*) filter (where not (x.src_bev_id < x.dst_bev_id)))::int,
         coalesce(jsonb_agg(distinct x.version), '[]'::jsonb)
    into v_edges, v_misoriented, v_versions
    from public.bev_edges x;

  -- tgenabled: 'O' origin (the normal enabled state), 'D' disabled, 'R'/'A'
  -- replica-only. Anything other than 'D' fires on a local write, which is
  -- what "enabled" means here.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name',    want.name,
           'present', t.tgname is not null,
           'enabled', coalesce(t.tgenabled, 'D') <> 'D'
         ) order by want.name), '[]'::jsonb)
    into v_triggers
    from (values ('bevs_embed_after_insert'), ('bevs_embed_after_update')) as want(name)
    left join pg_trigger t
           on t.tgrelid = 'public.bevs'::regclass
          and t.tgname = want.name
          and not t.tgisinternal;

  return jsonb_build_object(
    'vault_available', v_vault_available,
    'vault',           v_vault,
    'embeddings',      jsonb_build_object('active_bevs', v_active,
                                          'embedded',    v_embedded,
                                          'missing',     v_active - v_embedded),
    'edges',           jsonb_build_object('total',       v_edges,
                                          'misoriented', v_misoriented,
                                          'versions',    v_versions),
    'triggers',        v_triggers
  );
end;
$$;

comment on function public.graph_pipeline_status() is
  'A-16: read-only diagnostic for npm run graph:verify. Reports Vault secret presence (name and length only, never a value), bev_embeddings coverage of active Bevs, bev_edges count/orientation/versions, and the state of the two bevs_embed_after_* triggers. Service role only.';

-- Service role only. This is an operator's tool and it reports on the embed
-- webhook's configuration, so `anon` and `authenticated` have no business
-- calling it -- `from public, anon, authenticated` because Supabase's default
-- privileges lay down a direct EXECUTE grant that a revoke from PUBLIC alone
-- does not touch (20261019000400 learned this the hard way).
alter function public.graph_pipeline_status() owner to postgres;
revoke execute on function public.graph_pipeline_status() from public, anon, authenticated;
grant execute on function public.graph_pipeline_status() to service_role;
