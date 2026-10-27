-- A-16 (2) (20261026000300): the taste graph -- Stage 3 of
-- docs/graph_db_implementation.md.
--
-- M-28 (#131) landed the formulas in packages/ranking/src/graph.ts. This
-- migration adds the one table they write into, plus the nightly job's writer.
-- The job is scripts/graph/build-neighbours.ts; nothing here computes a
-- similarity, exactly as 20261019000500 computes no edge weight.
--
-- POSTGRES ONLY, following A-16 (1)'s precedent. The doc's Stage 3 describes
-- `RANKED` edges in Neo4j with HMAC pseudonyms and a Cypher aggregation; none
-- of it is needed, for the same reason the Bev graph did not need it: every
-- float formula is pure TypeScript in @bevi/ranking, and at 3 users and 27
-- rankings the pairwise computation is a few milliseconds in Node. So the
-- `RANKED` mirror stays with A-16's deferred steps 6, 8 and 9, and no
-- NEO4J_* variable is read by anything this migration enables. A paused Aura
-- instance cannot stop taste neighbours from being rebuilt.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: Stage 4, the engine integration. That is
-- a new revision of `get_prediction_snapshot` emitting `(alias, sim, common)`
-- and `layer2()` reading `snapshot.userNeighbors`. `layer2.ts` is Matt's lane
-- and the doc says Stage 4 "crosses both and needs the contract agreed first",
-- so it is a separate PR. Until then these rows are written and read by
-- nobody, and that is the designed state: the doc's "3 or more rankings, not
-- yet synced" tier is `layer2()` falling back to its in-snapshot computation,
-- which is exactly what an unread table produces.
--
-- WHY THERE IS NO PER-RANKING WEBHOOK. TASKS.md's A-16 (2) row says `RANKED`
-- edges update "on every ranking (async webhook) plus the nightly re-check",
-- which is right for the Bev graph's edges (a Bev's edges depend only on the
-- catalog, so one new Bev changes a bounded, knowable set of rows). A taste
-- neighbourhood is not local in that way: one new ranking changes u's z-scores
-- against the global mean, therefore u's taste vector, therefore u's
-- similarity to EVERY other user -- and, through the global stats, every other
-- pair by a little. There is no incremental update smaller than the full
-- rebuild, so the honest schedule is the nightly one, and a user's first-day
-- predictions fall back to the in-snapshot path rather than reading a
-- half-updated neighbourhood. This is recorded here because the board row
-- promises a webhook and this migration deliberately does not deliver one.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. user_neighbors
-- ---------------------------------------------------------------------------
-- The doc's DDL (section 3), with the column types it specifies.
--
-- BOTH DIRECTIONS ARE STORED, which is the opposite of `bev_edges`' one row
-- per unordered pair, and the difference is not an inconsistency:
--   * `sim` is symmetric, as `blendUserSimilarity` is exactly symmetric in
--     (u, v). So far this is the same situation as an edge weight.
--   * But the SELECTION is not. `topUserNeighbours` keeps each user's own top
--     TASTE_NEIGHBOUR_K = 25 above the floor, so "v is one of u's 25 nearest"
--     does not imply "u is one of v's 25 nearest" -- a prolific rater can be
--     everybody's neighbour while having 25 closer ones of their own.
--   * And the READ is per user: Layer 2 asks "who are MY neighbours", which
--     with one stored orientation would be a two-sided OR over a table whose
--     RLS predicate is `user_id = auth.uid()`. Owner-only RLS and a canonical
--     orientation do not compose: the row (v, u) is v's row, and u may not
--     read it.
-- So the row is the directed fact "v is one of u's neighbours, at this
-- similarity", `user_id` owns it, and the job writes both directions when both
-- are selected.
--
-- `numeric(5,4)`: the doc's type. sim is in [-1, 1] and the job applies the
-- TASTE_SIM_FLOOR of 0.1 before rounding, so four decimals is lossless for
-- everything stored. The CHECK is the full [-1, 1] rather than [floor, 1]
-- because the floor is the job's policy -- lowering it should not need a
-- migration, the same call 20261019000500 made for EDGE_MIN_WEIGHT.

create table public.user_neighbors (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  neighbor_id  uuid not null references public.profiles(id) on delete cascade,
  sim          numeric(5,4) not null check (sim >= -1 and sim <= 1),
  -- |common(u, v)|: how many Bevs both ranked. Drives the α gate, so it is
  -- stored rather than recomputed -- it is the evidence behind `sim`.
  common       smallint not null check (common >= 0),
  -- Bridging brand/flavour attributes reached through DISTINCT Bevs
  -- (`sharedAttributeCount`). 0 is normal for a pair with direct overlap.
  shared_attrs smallint not null check (shared_attrs >= 0),
  -- Which terms produced `sim`: 'pearson' (α = 1), 'attr' (α = 0) or 'blend'.
  -- Matches NeighbourMethod in @bevi/ranking; a CHECK rather than an enum,
  -- because the formula owns the vocabulary and an enum needs a migration to
  -- extend.
  method       text not null check (method in ('pearson', 'attr', 'blend')),
  -- RANKING_VERSION at compute time, as in bev_edges: `select distinct version
  -- from user_neighbors` answers "is this generation stale?" without
  -- recomputing anything.
  version      text not null,
  computed_at  timestamptz not null default now(),
  primary key (user_id, neighbor_id),
  -- Nobody is their own neighbour. `pearsonSimilarity` returns 0 for u = v and
  -- `topUserNeighbours` would drop it under the floor anyway, so this is
  -- belt-and-braces against a job bug writing a self-row that Layer 2 would
  -- then weight by the user's own z.
  check (user_id <> neighbor_id)
);

comment on table public.user_neighbors is
  'A-16 (2): taste neighbours per user, from blendUserSimilarity/topUserNeighbours in @bevi/ranking (M-28). BOTH directions stored, because top-K selection is per user and RLS is owner-only. Written by the nightly job as the service role; empty until it runs.';

-- "My neighbours, most similar first" is the only read, and Layer 2 takes the
-- top CF_K of them. The primary key already leads with user_id, but adding
-- `sim desc` as the second key turns that read into one bounded index scan
-- with no sort. `neighbor_id` is included so the tie-break
-- (`topUserNeighbours` breaks ties on the smaller userId) is served from the
-- index too.
create index user_neighbors_user_sim_idx
  on public.user_neighbors (user_id, sim desc, neighbor_id);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
-- Owner-only select, no write policy -- the doc's rule (section 3) and
-- supabase/CLAUDE.md's rule for content tables. The sync writes as the service
-- role, which bypasses RLS.
--
-- This is user data, not catalog data, so unlike `bev_edges` there is no
-- argument for `select to authenticated`: a row names another user and says
-- how similar their taste is. `neighbor_id` is a profile id, and the doc is
-- explicit that it "never reaches the client" -- Stage 4 will join these rows
-- to the alias CTE `get_prediction_snapshot` already builds and emit `u<n>`
-- instead. The owner-only policy exists so that a direct
-- `GET /rest/v1/user_neighbors` cannot shortcut that: with it, the caller sees
-- only rows they own, and a row they own still names a neighbour's uuid, which
-- is why Stage 4 must not serve these rows through PostgREST at all.
--
-- `auth.uid()`, not a subquery over profiles: the owner is the row's own
-- user_id, so there is nothing to join and nothing that can fail open.

alter table public.user_neighbors enable row level security;

create policy user_neighbors_select on public.user_neighbors
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. replace_user_neighbors(p_rows, p_version) -> int
-- ---------------------------------------------------------------------------
-- The job's single write step, modelled on `replace_bev_edges`
-- (20261023000300) down to the validation order, because the failure modes are
-- the same ones and the doc requires the publication to be atomic: "a failed
-- sync must leave the previous generation intact and readable. Never truncate
-- before the replacement is computed."
--
-- One RPC call is one transaction. A sequence of PostgREST calls is not, which
-- is why this exists rather than a DELETE + POST from the job.
--
-- THE ONE DIFFERENCE FROM replace_bev_edges: an empty payload is ACCEPTED
-- here, and refused there. For `bev_edges`, empty is never a legitimate result
-- -- a 378-Bev catalog always has similar pairs, so empty means a broken run
-- and keeping yesterday's edges is the safer failure. For `user_neighbors`,
-- empty is the EXPECTED result today: with 3 users, 27 rankings and a median
-- of 1 co-rater per rated pair (#122's export), the gate and the coverage rule
-- leave very few pairs, and #131's PR says so outright. Refusing empty would
-- mean the first real run fails and a later run that legitimately finds nobody
-- silently keeps a stale generation. So empty wipes the table, and the job
-- prints the count it wrote.

create or replace function public.replace_user_neighbors(p_rows jsonb, p_version text)
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
  v_self      boolean;
  v_range     boolean;
  v_counts    boolean;
  v_method    boolean;
begin
  if p_version is null or btrim(p_version) = '' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'version';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows';
  end if;

  -- One pass for every row-local check plus the duplicate count. No temporary
  -- table, for the reason replace_bev_edges gives: `create temporary table ...
  -- on commit drop` fails the second time the function runs in one
  -- transaction, which is exactly what a pgTAP file does.
  select count(*)::int,
         count(distinct (r.user_id, r.neighbor_id))::int,
         coalesce(bool_or(r.user_id is null or r.neighbor_id is null or r.sim is null
                          or r.common is null or r.shared_attrs is null or r.method is null), false),
         coalesce(bool_or(r.user_id = r.neighbor_id), false),
         coalesce(bool_or(r.sim < -1 or r.sim > 1), false),
         coalesce(bool_or(r.common < 0 or r.shared_attrs < 0), false),
         coalesce(bool_or(r.method not in ('pearson', 'attr', 'blend')), false)
    into v_total, v_distinct, v_null, v_self, v_range, v_counts, v_method
    from jsonb_to_recordset(p_rows) as r(
           user_id uuid, neighbor_id uuid, sim numeric,
           common smallint, shared_attrs smallint, method text
         );

  if v_null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a column is null';
  end if;
  if v_self then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a user is their own neighbour';
  end if;
  if v_range then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: sim outside [-1, 1]';
  end if;
  if v_counts then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a negative count';
  end if;
  if v_method then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'rows: method is not pearson, attr or blend';
  end if;
  -- A duplicated pair would hit the primary key mid-insert. Caught here so the
  -- message names the problem rather than the index.
  if v_distinct <> v_total then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: duplicate pair';
  end if;
  -- Both ends must be a profile that exists. The FKs would catch this too, but
  -- only after the delete, and their message names an index rather than the
  -- payload.
  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as r(user_id uuid, neighbor_id uuid)
     where not exists (select 1 from public.profiles p where p.id = r.user_id)
        or not exists (select 1 from public.profiles p where p.id = r.neighbor_id)
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: unknown user id';
  end if;

  delete from public.user_neighbors;

  insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version, computed_at)
  select r.user_id, r.neighbor_id, r.sim, r.common, r.shared_attrs, r.method, p_version, now()
    from jsonb_to_recordset(p_rows) as r(
           user_id uuid, neighbor_id uuid, sim numeric,
           common smallint, shared_attrs smallint, method text
         );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.replace_user_neighbors(jsonb, text) is
  'A-16 (2): replaces public.user_neighbors with p_rows in one transaction, stamping p_version (RANKING_VERSION). Both directions of a pair are separate rows. An EMPTY payload is accepted and wipes the table, unlike replace_bev_edges: no neighbours is the expected result at current data volume. Returns the row count. Service role only.';

-- ---------------------------------------------------------------------------
-- 4. ranking_z_inputs() -> every ranking the job needs
-- ---------------------------------------------------------------------------
-- `zScoresFromRankings` needs EVERY ranking row -- its own doc comment says
-- "Pass all of them: global stats come from the whole set" -- and
-- `tasteCatalog` needs the whole active catalog. The catalog half is a plain
-- PostgREST read (`/bevs?status=eq.active`), but the rankings half is not:
-- `rankings_select` is owner-and-followees only, so even the service role
-- reading `/rankings` would be relying on RLS not applying to it, and a
-- 10,000-row PostgREST page would need cursor paging the job does not have.
--
-- So this is one function that returns exactly the two shapes the formulas
-- take, as the service role, with the age gate applied to the CATALOG half
-- only -- which is the subtle part and the reason this is not a view:
--
--   * A ranking is included whatever the Bev's category. An under-21 user
--     cannot have ranked an alcoholic Bev in the first place (`submit_ranking`
--     gates it), and filtering rankings by the JOB's viewer would be
--     meaningless: the job is the service role and has no age.
--   * The CATALOG is not age-filtered either, for the same reason, and that is
--     correct for `tasteCatalog`: coverage counts catalog Bevs, and an
--     attribute's coverage must not depend on who is asking. The age gate
--     belongs where the neighbours are CONSUMED (Stage 4's snapshot RPC, which
--     already filters on `viewer_is_adult()`), not where they are computed.
--
-- `score` is returned as a double, not the stored numeric: `zScoresFromRankings`
-- throws on a non-finite score and PostgREST renders numeric as a JSON STRING,
-- which would arrive as NaN. Casting here means the job never has to remember.

create or replace function public.ranking_z_inputs()
returns table (
  user_id uuid,
  bev_id  uuid,
  score   float8
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Only rankings of a Bev that still exists and is active: a hidden or merged
  -- Bev is not in `tasteCatalog`, so `tasteVector` would skip it anyway, and
  -- including it here would shift the GLOBAL mean that every z-score is
  -- measured against. Ordered so a run is reproducible and a diff of two runs
  -- is readable.
  select r.user_id, r.bev_id, r.score::float8
    from public.rankings r
    join public.bevs b on b.id = r.bev_id
   where b.status = 'active'
   order by r.user_id, r.bev_id;
$$;

comment on function public.ranking_z_inputs() is
  'A-16 (2): every ranking of an active Bev as (user_id, bev_id, score::float8), for zScoresFromRankings in the nightly taste-graph job. Not age-filtered: the job is the service role and coverage must not depend on a viewer. Service role only.';

-- ---------------------------------------------------------------------------
-- 5. bev_co_rater_counts(int) -> which Bevs the cop term can speak about
-- ---------------------------------------------------------------------------
-- The co-preference term of eq. (18): `sim_cop(b, b')` is the cosine of the two
-- Bevs' vectors of z-scores over their COMMON RATERS, 0 while fewer than 3
-- users have ranked both (LaTeX section 10.1). `EDGE_WEIGHTS.cop` is still 0,
-- so switching it on is Matt's constant change and version bump; this
-- migration and `build-edges.ts` only start COMPUTING and STORING the term, so
-- that when he turns gamma on the number is already there and already
-- measured.
--
-- Returning raw (bev_id, user_id, z) rather than a pairwise cosine, because
-- the formula belongs in TypeScript: that is the standing rule for this
-- pipeline (`@bevi/ranking` owns every float, SQL stores and orders). The job
-- already holds every ranking from section 4, so this exists only to say which
-- Bevs are worth pairing at all -- the Bevs with at least MIN co-raters.
--
-- It is a separate function from section 4 so the job can skip it entirely
-- while the catalog has no co-rated pairs, which is today.

create or replace function public.bev_co_rater_counts(p_min_raters int default 3)
returns table (
  bev_id      uuid,
  rater_count int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select r.bev_id, count(*)::int
    from public.rankings r
    join public.bevs b on b.id = r.bev_id
   where b.status = 'active'
   group by r.bev_id
  having count(*) >= greatest(coalesce(p_min_raters, 3), 1)
   order by r.bev_id;
$$;

comment on function public.bev_co_rater_counts(int) is
  'A-16 (2): active Bevs with at least p_min_raters rankings, for the cop term of eq. (18). The cosine itself is computed in TypeScript from ranking_z_inputs(). Service role only.';

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
-- Same reasoning as 20261023000300 section 3: Supabase's default privileges
-- grant EXECUTE directly to anon, authenticated and service_role on every new
-- function in `public`, and revoking from PUBLIC does not remove those.
--
-- All three are pipeline functions and two of them are far more sensitive than
-- an edge writer: `ranking_z_inputs` returns EVERY user's every ranking, which
-- `rankings_select` deliberately limits to the caller and the people they
-- follow. Leaving the default grant in place would hand any signed-in user the
-- whole ranking table through one RPC call. So only the service role keeps
-- EXECUTE on each, and `authenticated` reaches none of them.

alter function public.replace_user_neighbors(jsonb, text) owner to postgres;
alter function public.ranking_z_inputs()                  owner to postgres;
alter function public.bev_co_rater_counts(int)            owner to postgres;

revoke execute on function
  public.replace_user_neighbors(jsonb, text),
  public.ranking_z_inputs(),
  public.bev_co_rater_counts(int)
from public, anon, authenticated;

grant execute on function
  public.replace_user_neighbors(jsonb, text),
  public.ranking_z_inputs(),
  public.bev_co_rater_counts(int)
to service_role;
