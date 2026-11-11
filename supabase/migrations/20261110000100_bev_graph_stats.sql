-- A-16 (4) (20261110000100): graph signals per Bev -- centrality, community and
-- bridge score -- stored in Postgres and served in the prediction snapshot.
--
-- WHAT THIS IS. Since #174 the nightly `graph-sync` job mirrors the Bev graph
-- into Neo4j. From this migration's PR on, the same job reads the similarity
-- graph back out of Neo4j inside its one transaction, computes three things per
-- Bev with @bevi/ranking (packages/ranking/src/network.ts, paper section 10.9),
-- stores them on the graph's nodes, and -- after the graph commits -- writes
-- them here:
--
--   pagerank    weighted PageRank over SIMILAR_TO: how central the Bev is.
--               Sums to 1 over the Bevs of one run.
--   community   the Louvain community the Bev falls in, as an OPAQUE id.
--   bridge      the participation coefficient in [0, 1): 0 when all of the
--               Bev's similarity weight stays inside its own community, higher
--               the more it is spread across several.
--   (and `strength`, `degree`: the weighted and unweighted SIMILAR_TO degree,
--   kept for diagnostics; `community_size`, so "how big is this Bev's
--   community" needs no aggregate.)
--
-- WHY A TABLE. docs/graph.md's two rules: Postgres is the system of record and
-- nothing lives only in the graph; and Neo4j is never on a request path. A
-- signal that existed only as a node property could not be read by the app at
-- all, and would be lost with the Aura Free instance. So the graph is where
-- the numbers are COMPUTED, and this table is where they LIVE and are READ.
--
-- This migration creates:
--   1. `public.bev_graph_stats`, with RLS and its one select policy;
--   2. `public.replace_bev_graph_stats(p_rows jsonb, p_version text)`, the
--      service-role-only whole-table writer the sync calls;
--   3. one revision of `public.get_prediction_snapshot()` with ONE added key,
--      `bevGraph`.
-- It creates no other reader and changes no other function.
--
-- NOTHING IN HERE REIMPLEMENTS A FORMULA. PageRank, Louvain and the
-- participation coefficient live in @bevi/ranking and run in the sync job; SQL
-- stores the numbers, checks that a payload is internally consistent, and
-- rounds two of them on the way out.
--
-- THE COMMUNITY ID IS OPAQUE, AND THE CHECK ON ITS SHAPE IS PART OF THAT.
-- A community is named after its hub Bev, which keeps the name stable from
-- night to night. But a hub can be an ALCOHOLIC Bev, `community_id` reaches
-- every client in the snapshot, and a catalog Bev's id is derivable by anyone
-- (uuid v5 of a public slug under a public namespace). So the id is
-- `c_` + 16 hex characters of an HMAC of the hub's id, keyed with a secret
-- that exists only in the sync job's environment (scripts/graph/sync.ts,
-- `communityIdentifier`). An under-21 client cannot tell which Bev a community
-- is named after, even by hashing the whole catalog. The CHECK below
-- (`^c_[0-9a-f]{16}$`) means a uuid can never be stored in that column by
-- mistake: a hub's own id does not fit. Clients compare the ids for EQUALITY
-- ONLY. Which Bev is the hub is NOT stored in Postgres at all.
--
-- WHAT THE COMMUNITIES ARE COMMUNITIES OF is the sync's input, not this
-- table's business: today Louvain runs on the SIMILAR_TO graph itself, and it
-- is about to run on the flavour projection instead (Bevs joined through
-- shared flavour bases and notes). Nothing here depends on which, so that
-- change needs no migration.
--
-- THE CONTRACT of the new snapshot key, fixed on the package side by #172
-- (`PredictionSnapshot.bevGraph` and `BevGraphStats` in
-- packages/ranking/src/types.ts), so nothing below is a choice made here:
--
--   bevGraph   [[bev_id, community_id, pagerank, bridge], ...]
--              One tuple per row of `bev_graph_stats` whose Bev is in
--              `visible` -- this function's own gate: status 'active', and
--              alcoholic Bevs only for a 21+ viewer. So a hidden Bev's row
--              never appears, and for an under-21 viewer neither does an
--              alcoholic Bev's. Ordered by bev_id, so the payload is
--              deterministic. `[]`, never null: an empty table (before the
--              first sync writes it) is "provided, and there are none".
--
-- packages/api/src/snapshot.ts maps it onto `snapshot.bevGraph =
-- { [bevId]: { community, pagerank, bridge } }`, only when the key is present.
-- NOTHING READS THAT FIELD YET: @bevi/ranking 1.7.0 declares it and leaves it
-- unread, and the package PR that reads it does so behind an option that is
-- off by default. So this migration changes no prediction and no
-- recommendation.
--
-- WHY THE TWO NUMBERS ARE ROUNDED ON THE WAY OUT. The snapshot carries one
-- tuple per visible Bev (about 385 today) on every fetch. A float8 prints up
-- to 17 significant digits; PageRank at 8 decimals and the bridge score at 4
-- keep every digit a consumer can use (PageRank values are of the order of
-- 1/385, so 8 decimals is five or six significant figures) in at most 10 and
-- 6 characters, where the unrounded doubles take up to about 20 each. The
-- table keeps the full doubles. The rounded values
-- are cast back to float8 so they render as plain JSON numbers without
-- trailing zeros. A consequence a consumer must not trip over: the ROUNDED
-- PageRanks of one payload need not sum to exactly 1, and an under-21 viewer's
-- never do (the alcoholic Bevs' share is missing).
--
-- WHY `double precision` AND NOT `numeric`. A `numeric` can reach a client as
-- a JSON string, and every reader then has to convert it back (the scripts
-- guard every `numeric` column for it, and `ranking_z_inputs` casts `score`
-- to float8 for exactly this reason). These are derived floats, not money:
-- they were doubles when @bevi/ranking produced them, and storing them as
-- doubles keeps them bit-for-bit.
--
-- WHY NO `version` FILTER IN THE SNAPSHOT. `version` is the RANKING_VERSION of
-- the run that wrote the row. As for `bev_edges` and `user_neighbors`
-- (20261101000100), filtering on it would empty the key after every version
-- bump until the next nightly run, for no change in the numbers. It stays a
-- staleness diagnostic: `select distinct version, max(computed_at) from
-- bev_graph_stats`.
--
-- THE ONE FAILURE MODE WORTH KNOWING. The graph and Postgres cannot commit
-- together. The sync commits the graph first and calls
-- `replace_bev_graph_stats` second; if that call fails, the job exits 1 saying
-- so, this table keeps the PREVIOUS night's rows (complete and
-- self-consistent, one generation behind the graph), and the next run repairs
-- it. A Bev created since then simply has no row, which `bevGraph` renders as
-- "no tuple" and the package treats as "no signal".
--
-- WHAT DOES NOT CHANGE. Every existing key of the snapshot, its shape and its
-- semantics, reproduced byte-for-byte from 20261101000100; the signature; the
-- grants. `bev_edges`, `bev_embeddings`, `user_neighbors` and their functions.
-- The contract in shared/ (`BeviApi` gains nothing). `graph-edges` and
-- `graph-neighbours`: they do not read or write this table.
--
-- ORDER OF OPERATIONS ON PROD. This migration must be pushed BEFORE the PR
-- that carries it merges: the nightly sync on `main` calls
-- `replace_bev_graph_stats` after every commit, and on a database without it
-- that call is a 404 and every night is red (the graph itself still commits).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. bev_graph_stats
-- ---------------------------------------------------------------------------
-- One row per Bev the last sync saw: the active ones. A Bev hidden since then
-- keeps its row until the next run (the policy and the snapshot both withhold
-- it meanwhile), and a hard-deleted Bev's row goes with it.
--
-- The CHECKs are the ranges the formulas guarantee, so a row that violates one
-- was not produced by them:
--   pagerank in [0, 1]   a probability; exactly 1 only in a one-Bev catalog
--   strength >= 0        a sum of weights in (0, 1]
--   degree >= 0          a count of edges
--   bridge in [0, 1)     1 - sum of squared shares; never reaches 1
--   community_size >= 1  the Bev itself is a member
-- `community_size` is denormalised on purpose (it equals the number of rows
-- carrying the same `community_id`); `replace_bev_graph_stats` refuses a
-- payload in which it does not, and it is the only writer.

create table public.bev_graph_stats (
  bev_id         uuid primary key references public.bevs(id) on delete cascade,
  community_id   text not null check (community_id ~ '^c_[0-9a-f]{16}$'),
  community_size integer not null check (community_size >= 1),
  pagerank       double precision not null check (pagerank >= 0 and pagerank <= 1),
  strength       double precision not null check (strength >= 0),
  degree         integer not null check (degree >= 0),
  bridge         double precision not null check (bridge >= 0 and bridge < 1),
  -- RANKING_VERSION at compute time: which network.ts produced the row.
  version        text not null,
  computed_at    timestamptz not null default now()
);

comment on table public.bev_graph_stats is
  'A-16 (4): per-Bev graph signals (weighted PageRank, Louvain community as an opaque id, participation coefficient), computed nightly by graph-sync from the Neo4j graph with @bevi/ranking and written by replace_bev_graph_stats as the service role. Empty until the first sync after this migration.';
comment on column public.bev_graph_stats.community_id is
  'Opaque: c_ + 16 hex of a keyed HMAC of the community''s hub Bev id. Never a Bev id. Compare for equality only.';

-- "The other Bevs of this Bev's community" and "how many communities are
-- there" are the two reads this table invites beyond the primary key.
create index bev_graph_stats_community_idx on public.bev_graph_stats (community_id);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
-- Derived catalog data, like `bev_embeddings`: a `select` policy for
-- `authenticated` and NO insert/update/delete policy, because the only writer
-- is the service role (through the function below), which bypasses RLS. That
-- is the supabase/CLAUDE.md rule for content tables.
--
-- The predicate is `bev_embeddings_select`'s (20261019000500), for the same
-- reasons, which that file argues at length:
--   * BOTH halves of `bevs_select`. A row here says "this Bev exists, is this
--     central, and belongs with those". For a Bev moderation has hidden, or an
--     alcoholic one in front of an under-21 viewer, that is exactly what the
--     gate withholds; a hidden Bev's row survives in this table until the next
--     nightly run, so without the status half a plain
--     `GET /rest/v1/bev_graph_stats` would keep serving it.
--   * A POSITIVE `exists`. A policy's own table references are subject to
--     those tables' RLS, so a negative `not exists` over `bevs` is fail-OPEN:
--     `bevs_select` has already hidden the alcoholic Bev from the under-21
--     caller, the inner select finds nothing, and the row is served. A
--     positive `exists` is fail-closed under either reading: an invisible
--     `bevs` row simply yields false.
--   * Only 'active', not `bevs_select`'s `pending_photo` branch.
-- The app does not read this table directly -- `get_prediction_snapshot`
-- below is the path, and it applies the same gate through `visible` -- so the
-- policy is what stands behind that, not a hot path.

alter table public.bev_graph_stats enable row level security;

create policy bev_graph_stats_select on public.bev_graph_stats
  for select to authenticated using (
    exists (
      select 1
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where b.id = bev_graph_stats.bev_id
         and b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. replace_bev_graph_stats(p_rows, p_version) -> int
-- ---------------------------------------------------------------------------
-- The whole table, replaced inside one call, which is one transaction. The
-- shape is `replace_bev_edges`' (20261025000100): validate the ENTIRE payload
-- before deleting anything, so a bad payload leaves last night's rows; `delete`
-- + `insert` rather than `truncate`, so readers keep seeing the previous
-- generation under MVCC until the commit and nothing waits on an ACCESS
-- EXCLUSIVE lock; return the row count so the job can compare it with what it
-- sent.
--
-- `delete ... where true`: hosted Supabase loads pg_safeupdate on the roles
-- PostgREST connects as, and it refuses an unqualified DELETE even inside a
-- security definer function (20261025000100 found that on the first real run
-- of `graph:edges`). The local stack has no pg_safeupdate, so pgTAP cannot see
-- the difference.
--
-- What is refused, each as BEVI_VALIDATION (22023) with a `detail` that names
-- the problem:
--   version                          p_version null or blank
--   rows                             p_rows null or not a JSON array
--   rows: empty                      like replace_bev_edges: an empty result is
--                                    a broken run (the catalog has Bevs), and
--                                    accepting it would wipe the table
--   rows: a column is null           any of the seven columns missing
--   rows: a value is out of range    the table's CHECKs, plus a degree or
--                                    community_size that is not a whole number
--   rows: community_id is not c_ + 16 hex
--   rows: duplicate bev_id
--   rows: unknown bev id
--   rows: community_size disagrees with the rows of that community
--   rows: pagerank does not sum to 1  beyond 1e-6: a partial payload, or two
--                                     runs mixed together
-- The last two are what make a payload a GENERATION rather than a set of
-- rows: they can only hold for the complete output of one run.
--
-- `degree` and `community_size` are read as numeric and cast on insert, so
-- 2.5 is refused by name here rather than by a cast error in the recordset. A
-- value that is not a uuid at all still fails in the cast (22P02), before the
-- delete like everything else.

create or replace function public.replace_bev_graph_stats(p_rows jsonb, p_version text)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_count     int;
  v_total     int;
  v_distinct  int;
  v_null      boolean;
  v_range     boolean;
  v_shape     boolean;
  v_sum       double precision;
begin
  if p_version is null or btrim(p_version) = '' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'version';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: empty';
  end if;

  -- One pass over the payload for the row-local checks, the duplicate count
  -- and the PageRank total. No temporary table, for the reason
  -- replace_bev_edges gives: `on commit drop` would fail the second call in
  -- one transaction, which is exactly what a pgTAP file makes.
  select count(*)::int,
         count(distinct r.bev_id)::int,
         coalesce(bool_or(r.bev_id is null or r.community_id is null or r.community_size is null
                          or r.pagerank is null or r.strength is null or r.degree is null
                          or r.bridge is null), false),
         coalesce(bool_or(r.pagerank < 0 or r.pagerank > 1
                          or r.strength < 0
                          or r.degree < 0 or r.degree <> trunc(r.degree)
                          or r.bridge < 0 or r.bridge >= 1
                          or r.community_size < 1 or r.community_size <> trunc(r.community_size)), false),
         coalesce(bool_or(r.community_id !~ '^c_[0-9a-f]{16}$'), false),
         sum(r.pagerank)
    into v_total, v_distinct, v_null, v_range, v_shape, v_sum
    from jsonb_to_recordset(p_rows) as r(
           bev_id uuid, community_id text, community_size numeric,
           pagerank double precision, strength double precision,
           degree numeric, bridge double precision
         );

  if v_null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a column is null';
  end if;
  if v_range then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a value is out of range';
  end if;
  if v_shape then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: community_id is not c_ + 16 hex';
  end if;
  -- A duplicated Bev would hit the primary key mid-insert. Caught here so the
  -- message names the problem rather than the index.
  if v_distinct <> v_total then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: duplicate bev_id';
  end if;
  -- The FK would catch this too, but only after the delete, and its message
  -- names a constraint rather than the payload.
  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as r(bev_id uuid)
     where not exists (select 1 from public.bevs b where b.id = r.bev_id)
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: unknown bev id';
  end if;
  -- Every row of a community must state the number of rows that community has
  -- in THIS payload.
  if exists (
    select 1
      from (
        select r.community_size, count(*) over (partition by r.community_id) as members
          from jsonb_to_recordset(p_rows) as r(community_id text, community_size numeric)
      ) x
     where x.community_size <> x.members
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'rows: community_size disagrees with the rows of that community';
  end if;
  -- PageRank is a probability distribution over the Bevs of one run.
  if abs(v_sum - 1) > 1e-6 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: pagerank does not sum to 1';
  end if;

  delete from public.bev_graph_stats where true;  -- `where true`: pg_safeupdate, see above

  insert into public.bev_graph_stats
         (bev_id, community_id, community_size, pagerank, strength, degree, bridge, version, computed_at)
  select r.bev_id, r.community_id, r.community_size::int, r.pagerank, r.strength, r.degree::int, r.bridge,
         p_version, now()
    from jsonb_to_recordset(p_rows) as r(
           bev_id uuid, community_id text, community_size numeric,
           pagerank double precision, strength double precision,
           degree numeric, bridge double precision
         );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.replace_bev_graph_stats(jsonb, text) is
  'A-16 (4): replaces bev_graph_stats with one complete generation of per-Bev graph signals, in one transaction, validating the whole payload before deleting anything. Service role only: the nightly graph-sync job.';

-- `from public` strips Postgres's implicit grant to PUBLIC; anon and
-- authenticated are named because Supabase's default privileges grant EXECUTE
-- on every new function in this schema to them directly (20261019000400).
alter function public.replace_bev_graph_stats(jsonb, text) owner to postgres;
revoke execute on function public.replace_bev_graph_stats(jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_bev_graph_stats(jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. get_prediction_snapshot(): one added key, `bevGraph`
-- ---------------------------------------------------------------------------
-- The definition of 20261101000100, reproduced byte-for-byte (a migration is
-- append-only), with `bevGraph` appended after `userNeighbors`. Same
-- signature, same `stable security definer`, same search_path, same grants.
--
-- The `exists (... from visible ...)` is the spelling `rankings` and `edges`
-- already use for "a Bev this caller may see", so the new key cannot drift
-- from the rest of the payload: a Bev has a tuple here only if it is in `bevs`.

create or replace function public.get_prediction_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_adult boolean;
  v_tz    text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  select timezone into v_tz from public.profiles where id = v_uid;
  v_adult := public.viewer_is_adult();

  return (
    with ranked as (
      select r.user_id, r.bev_id, r.score::float8 as score, b.category_id, c.is_alcoholic
        from public.rankings r
        join public.bevs b on b.id = r.bev_id
        join public.categories c on c.id = b.category_id
    ),
    raters as (
      select distinct user_id from ranked
      union
      select v_uid
    ),
    aliases as (
      select user_id,
             case when user_id = v_uid then user_id::text
                  else 'u' || row_number() over (order by user_id) end as alias
        from raters
    ),
    visible as (
      select b.id, b.name, b.brand, b.flavor, b.category_id, b.price_tier, b.price_estimated,
             coalesce(b.thumb_path, b.photo_path) as photo_path, c.is_alcoholic,
             coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score
        from public.bevs b
        join public.categories c on c.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
       where b.status = 'active'
         and (v_adult or not c.is_alcoholic)
    )
    select jsonb_build_object(
      'generatedAt', now(),
      'viewer', jsonb_build_object(
        'id', v_uid,
        'timezone', v_tz,
        'canSeeAlcohol', v_adult,
        'rankingCount', (select count(*) from ranked where user_id = v_uid)
      ),
      'global', jsonb_build_object(
        'n', (select count(*) from ranked),
        'mean', (select avg(score) from ranked),
        'stddev', (select stddev_pop(score) from ranked),
        'byCategoryMean', coalesce((
          select jsonb_object_agg(category_id, m)
            from (select category_id, avg(score) as m from ranked
                   where v_adult or not is_alcoholic group by category_id) x
        ), '{}'::jsonb)
      ),
      'users', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.n, x.mean, x.sd))
          from (select user_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked group by user_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'categoryStats', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.category_id, x.n, x.mean, x.sd))
          from (select user_id, category_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked where v_adult or not is_alcoholic group by user_id, category_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'bevs', coalesce((
        select jsonb_agg(jsonb_build_array(
                 id, name, brand, flavor, category_id, price_tier, price_estimated, photo_path,
                 is_alcoholic, rating_count, avg_score, score_stddev, bayes_score))
          from visible
      ), '[]'::jsonb),
      'rankings', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, r.bev_id, r.score))
          from ranked r
          join aliases a on a.user_id = r.user_id
         where exists (select 1 from visible v where v.id = r.bev_id)
      ), '[]'::jsonb),
      -- S-21: every stored edge touching a Bev the caller ranked, both ends
      -- visible, all rows, in a fixed order.
      'edges', coalesce((
        select jsonb_agg(jsonb_build_array(e.src_bev_id, e.dst_bev_id, e.weight)
                         order by e.src_bev_id, e.dst_bev_id)
          from public.bev_edges e
         where (e.src_bev_id in (select bev_id from ranked where user_id = v_uid)
                or e.dst_bev_id in (select bev_id from ranked where user_id = v_uid))
           and exists (select 1 from visible v where v.id = e.src_bev_id)
           and exists (select 1 from visible v where v.id = e.dst_bev_id)
      ), '[]'::jsonb),
      -- Stage 4: the viewer's stored taste neighbours, aliased exactly as in
      -- `users` and `rankings`; no version filter (see the header).
      'userNeighbors', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, n.sim, n.common)
                         order by n.sim desc, n.neighbor_id)
          from public.user_neighbors n
          join aliases a on a.user_id = n.neighbor_id
         where n.user_id = v_uid
      ), '[]'::jsonb),
      -- A-16 (4): each visible Bev's graph signals as
      -- [bev_id, community_id, pagerank, bridge], in bev_id order; rounded to
      -- keep the payload small, no version filter (see the header).
      'bevGraph', coalesce((
        select jsonb_agg(jsonb_build_array(g.bev_id, g.community_id,
                                           round(g.pagerank::numeric, 8)::float8,
                                           round(g.bridge::numeric, 4)::float8)
                         order by g.bev_id)
          from public.bev_graph_stats g
         where exists (select 1 from visible v where v.id = g.bev_id)
      ), '[]'::jsonb)
    )
  );
end;
$$;

alter function public.get_prediction_snapshot() owner to postgres;
revoke execute on function public.get_prediction_snapshot() from public, anon;
grant execute on function public.get_prediction_snapshot() to authenticated;
