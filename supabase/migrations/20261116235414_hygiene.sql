-- A hygiene sweep: findings from the reviews of #115, #117 and #118, plus one
-- new diagnostic. Two of the findings are SQL and live here, with the
-- diagnostic's RPC; the rest of the sweep is pgTAP and one script.
--
-- Nothing here changes a happy path. Taken in order:
--
--   1. `refresh_bev_stats` tests emptiness with `array_length(arr, 1) is null`.
--      That is CORRECT (see the long comment on it) but it is the same idiom
--      that WAS a real hole in `get_bev_similarities`, so it is rewritten with
--      `cardinality()` to stop the next reader having to re-derive why one is
--      safe and the other was not. The body reproduced here is
--      20261101000300's, `bayes_score` and all -- see the note on the
--      function.
--   2. Supabase's default privileges (`alter default privileges in schema
--      public grant all on tables to anon, authenticated, service_role`) leave
--      `anon` and `authenticated` holding INSERT/UPDATE/DELETE/TRUNCATE on
--      every table in `public`. RLS denies the DML -- there is no permissive
--      write policy on a content table -- but **TRUNCATE IS NOT SUBJECT TO
--      RLS**. `truncate public.bevs` from a signed-in user's publishable key is
--      a privilege check and nothing else, and it passes today. This migration
--      is the revoke that should have accompanied 20261011000100.
--   3. `public.graph_pipeline_status()`, a service-role-only diagnostic that
--      `npm run graph:verify` (scripts/graph/verify-pipeline.ts) reads. It
--      exists because three separate silent failures in this project were
--      success-shaped, and the facts needed to tell "configured" from
--      "assumed" -- Vault secret presence, trigger state -- are not reachable
--      over PostgREST at all.
--
-- NOT HERE, AND DELIBERATELY. The sixth finding was that `list_bucket_bevs`
-- bounds nothing, and the first draft of this migration capped it at 500. A
-- `limit` on that function is not a safe fix, because the LENGTH OF THAT LIST
-- IS THE CLIENT'S `expectedBucketSize`: the app reads the bucket through
-- `rankings.listBucketBevs` (app/src/api/placementList.ts), counts the rows,
-- and sends the count to `submit_ranking`, which compares it with `count(*)`
-- over the real bucket and raises BEVI_STALE_BUCKET on a mismatch
-- (20261102000100). Truncating at 500 therefore breaks every submission from
-- a 501-Bev bucket, permanently and with no way out for the user -- and since
-- the `rankings.listBucket` fallback reads the table directly and is itself
-- unbounded, the cap would have made the primary path fail where the degraded
-- one still worked. A bound needs the true count returned alongside the rows,
-- which is a contract change and its own ticket. Section 9 of
-- 11_graph_tables.test.sql now asserts the opposite of a cap: 505 rows in the
-- bucket, 505 rows out.
--
-- 20261011000200 and 20261101000300 (refresh_bev_stats) are on `main` and
-- therefore frozen; the function is reproduced in full here because a
-- migration is append-only.

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
-- WHICH BODY IS REPRODUCED, AND WHY IT IS NOT 20261011000200'S. This file was
-- first written on 2026-10-24 against 20261011000200, whose upsert has no
-- `bayes_score` column. 20261101000300 (stats_parity 3.2) then taught
-- `refresh_bev_stats` to write `bayes_score` itself, so that a ranking leaves
-- the column where the next `refresh_global_stats` tick would put it. This
-- migration sorts ABOVE that one, so a `create or replace` carrying the older
-- body would silently take the Bayesian write back out of every submission --
-- not a conflict, not an error, just a column that stops being maintained.
-- What follows is therefore 20261101000300's body verbatim, including the
-- `v_m` prior and the `::numeric(4,2)` cast whose exactness is argued there,
-- with the guard as the single changed line.
--
-- (The same trap applies to anyone else retiming a `create or replace`: diff
-- against the LATEST definition on `main`, not the one the finding was written
-- against.)
create or replace function public.refresh_bev_stats(p_bev_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m numeric;
begin
  -- cardinality() counts ELEMENTS; array_length(arr, 1) counts the first
  -- dimension. They agree on this test, but only this test -- see the header.
  if p_bev_ids is null or cardinality(p_bev_ids) = 0 then
    return;
  end if;

  -- Once per call, not per row: bayes_prior is stable, not immutable.
  v_m := public.bayes_prior(null);

  insert into public.bev_stats (bev_id, rating_count, sum_score, avg_score, score_stddev, bayes_score, last_ranked_at, updated_at)
  select
    ids.bev_id,
    coalesce(agg.rating_count, 0),
    coalesce(agg.sum_score, 0),
    agg.avg_score,
    agg.score_stddev,
    case
      when coalesce(agg.rating_count, 0) = 0 then null
      else public.bayes_score(agg.sum_score, agg.rating_count::integer, v_m, 3)::numeric(4,2)
    end,
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
    bayes_score    = excluded.bayes_score,
    last_ranked_at = excluded.last_ranked_at,
    updated_at     = excluded.updated_at;
end;
$$;

-- `create or replace function` preserves the existing ACL, so the revokes this
-- function has collected still stand. Restated here, all three roles, for the
-- same reason 20261025000100 restates its grants: an append-only migration that
-- replaces a function should leave its final privileges readable in one place.
-- `authenticated` is in the list because 20261102000100 revoked it -- the
-- October draft of this file argued that the direct EXECUTE grant Supabase's
-- default privileges lay down was a separate audit, and that audit has since
-- happened for this function. Restating what IS true keeps this a no-op.
alter function public.refresh_bev_stats(uuid[]) owner to postgres;
revoke execute on function public.refresh_bev_stats(uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- 2. Table privileges: revoke the DML Supabase's default privileges granted
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
--
-- THAT NOTE IS NOT HYPOTHETICAL. This file was written on 2026-10-24 and is
-- being merged three weeks later, and `public` gained nine tables in between.
-- Seven of them -- `bev_graph_stats`, `bug_reports`, `category_stats`,
-- `chains`, `user_neighbors`, `venue_bevs`, `venues` -- arrived holding
-- INSERT/UPDATE/DELETE/**TRUNCATE** for `anon` and `authenticated`, exactly as
-- predicted, and are included below: `bug_reports` in 2a, where its
-- reporter-or-admin SELECT policy puts it, and the other six in 2c, which
-- explains why they lose less than 2b's tables do. Membership was checked
-- against a `supabase db reset` -- `information_schema.role_table_grants` and
-- `pg_policies`, table by table -- and not read off the migration text. The
-- two exceptions:
--
--   * `bev_icons` (20261112000200:139-141) did the right thing on its own --
--     `revoke all ... from public, anon, authenticated` then `grant select to
--     authenticated` -- and is left alone because it is already correct, as is
--     `bev_nutrition` (#223, merged while this rebase was in flight), which
--     copied it. That is the pattern a new table should follow.
--   * `ranking_events` (20261101000200:178-179) revoked
--     insert/update/delete/truncate/references/trigger and deliberately kept
--     SELECT for both roles. The TRUNCATE hole is already closed there, and
--     taking its remaining SELECT away is that migration author's call, not a
--     drive-by in this one. RLS with no policy means both roles read zero rows
--     today either way.

-- 2a. Content tables with NO write policy for `authenticated` at all. Writes
--     go through a definer RPC (or the service role), reads through a `select`
--     policy, and `anon` has no business in either. `bug_reports` joined this
--     group on 2026-11-09 (20261109000300): a reporter-or-admin SELECT policy,
--     and every write through `submit_bug_report`.
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
  public.bev_edges,
  public.bug_reports
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
  public.bev_edges,
  public.bug_reports
from anon;

-- 2b. RLS on, and NO POLICY AT ALL -- so neither role may read a row either,
--     and the privilege should say so. `app_secrets` holds the invite code and
--     is read only by `check_invite_code()`; `recommendation_jobs` and
--     `user_actions` are machinery (`assert_rate()` writes the latter). All
--     three are reached exclusively from definers owned by `postgres`, and no
--     test in supabase/tests/ exercises a client read or write of any of them.
revoke all on
  public.app_secrets,
  public.recommendation_jobs,
  public.user_actions
from anon, authenticated;

-- 2c. The other six tables with RLS on and no policy, added between this
--     file being written (2026-10-24) and merged: `category_stats` and
--     `bev_graph_stats` are aggregates the cron and
--     `replace_bev_graph_stats()` maintain, `user_neighbors` is the taste
--     graph's neighbour cache, and `venues`, `venue_bevs` and `chains` are
--     read through `venues_in_view()` and written by `import_venues()`. No
--     client code touches any of them directly -- every `.from('<table>')` in
--     packages/api/src and app/src names only bevs, categories, rankings,
--     profiles, profiles_view, follows, want_to_try, user_stats and
--     bev_flavor_profiles.
--
--     THEY GET LESS THAN 2b DOES, ON PURPOSE. `anon` loses everything, as in
--     2b. From `authenticated` only TRUNCATE is taken, because TRUNCATE is
--     the only one of the four verbs that RLS does not already deny, and the
--     other three are ASSERTED AS RLS BEHAVIOUR by tests written after this
--     file was: 16_taste_graph, 19_stats_parity, 26_venues and
--     30_bev_graph_stats assert that a signed-in client reads zero rows, that
--     an INSERT raises 42501, and -- with `lives_ok` -- that an UPDATE or a
--     DELETE of every row RAISES NOTHING because it matches nothing. Revoking
--     the privilege turns those two no-ops into errors, which is a behaviour
--     change those files would have to be rewritten for, and rewriting them
--     would cost the thing they are actually testing: a privilege error no
--     longer proves the table has no policy.
--
--     So the hole is closed and the defence-in-depth is not taken here. It is
--     worth a ticket of its own -- revoke INSERT/UPDATE/DELETE from
--     `authenticated` on these six AND update those four files to assert the
--     privilege error alongside an owner-side check that the policy set is
--     still empty -- and it is not worth doing inside a sweep, in another
--     author's tests, three weeks after the sweep was reviewed.
revoke all on
  public.category_stats,
  public.bev_graph_stats,
  public.user_neighbors,
  public.venues,
  public.venue_bevs,
  public.chains
from anon;

revoke truncate on
  public.category_stats,
  public.bev_graph_stats,
  public.user_neighbors,
  public.venues,
  public.venue_bevs,
  public.chains
from authenticated;

-- 2d. The four tables that DO have a permissive write policy for
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
-- 3. graph_pipeline_status(): the facts `npm run graph:verify` asserts
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

  -- `state` is `pg_trigger.tgenabled` as it stands, reported and not judged:
  -- 'O' fires in the default session_replication_role ('origin'), 'A' fires
  -- always, 'R' fires ONLY when the session is in 'replica' mode, and 'D' never
  -- fires. An app write arrives in 'origin', so 'O' and 'A' reach the trigger
  -- and 'R' and 'D' do not.
  --
  -- The first draft of this function returned a boolean `enabled` computed as
  -- `tgenabled <> 'D'`, which calls a replica-only trigger enabled and hands
  -- `graph:verify` a PASS for a pipeline that never fires on an insert -- the
  -- exact "configured was assumed" failure this diagnostic exists to catch,
  -- rebuilt inside the diagnostic. The verdict now lives in
  -- `evaluateStatus()` (scripts/graph/verify-pipeline.ts), with every other
  -- verdict and its unit tests, and this function reports the fact. That is
  -- also why the Vault branch returns a length rather than a boolean.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name',    want.name,
           'present', t.tgname is not null,
           'state',   t.tgenabled
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
  'A-16: read-only diagnostic for npm run graph:verify. Reports Vault secret presence (name and length only, never a value), bev_embeddings coverage of active Bevs, bev_edges count/orientation/versions, and pg_trigger.tgenabled for the two bevs_embed_after_* triggers. Reports facts; verify-pipeline.ts decides PASS/FAIL. Service role only.';

-- Service role only. This is an operator's tool and it reports on the embed
-- webhook's configuration, so `anon` and `authenticated` have no business
-- calling it -- `from public, anon, authenticated` because Supabase's default
-- privileges lay down a direct EXECUTE grant that a revoke from PUBLIC alone
-- does not touch (20261019000400 learned this the hard way).
alter function public.graph_pipeline_status() owner to postgres;
revoke execute on function public.graph_pipeline_status() from public, anon, authenticated;
grant execute on function public.graph_pipeline_status() to service_role;
