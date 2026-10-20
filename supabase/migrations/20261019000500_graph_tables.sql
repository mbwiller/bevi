-- A-16 (1) + S-14 part 2 (20261019000500): the Postgres half of the Bev graph.
--
-- This migration creates the two tables the graph writes back into Postgres
-- and the three read RPCs the app reads them through. It creates NO writer:
-- the sync job, the `embed` Edge Function, the database webhook and
-- `graph-sync.yml` are the second half of A-16 (1) and land in their own PR.
-- Until then both tables are EMPTY and every RPC below correctly returns zero
-- rows. That is the whole point of `docs/graph.md`'s one rule -- Neo4j is
-- never on a request path -- so an empty mirror has to degrade to "no
-- similarity data", never to an error.
--
-- Decisions this encodes:
--   decision 28 (TASKS.md): the graph holds the relationships, Postgres keeps
--     the record. `bev_edges` is the graph's output, mirrored here.
--   decision 30: five similarity terms, weighted by `edgeWeight()` in
--     @bevi/ranking (M-24). `components` stores the terms it was given and
--     `version` the RANKING_VERSION that produced them, so a formula change
--     is detectable in SQL without re-deriving anything.
--   D-15's lesson from #113: an RPC that returns Bev rows filters
--     `status = 'active'`. get_explore shipped without it and leaked
--     'pending_photo' Bevs; get_similar_bevs does not repeat that.
--
-- Nothing in here reimplements a formula. `edgeWeight`, `topEdges`,
-- `EDGE_WEIGHTS`, `EDGE_TOP_K` and `EDGE_MIN_WEIGHT` live in
-- packages/ranking/src/edges.ts and run in the sync job; SQL only stores and
-- orders the numbers they produce.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. pgvector
-- ---------------------------------------------------------------------------
-- 20261009000100 enables its four extensions bare (`create extension if not
-- exists pg_trgm;`), which puts them wherever the session's search_path points
-- -- `public` locally, `extensions` on the hosted project, where Supabase
-- pre-installs them. That is harmless for pg_trgm: every caller reaches
-- `similarity()` through `set search_path = public, extensions`, so either
-- home works.
--
-- `vector` is different, because it contributes a TYPE and an operator class
-- that appear in DDL (the column below, the HNSW index below) rather than only
-- in function bodies. A type whose schema depends on which machine ran the
-- migration is a trap, so this one pins it: `extensions` is where Supabase
-- puts extensions, and every reference below is schema-qualified to match.
-- The RPCs' search_path includes `extensions` for the same reason.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. bev_embeddings
-- ---------------------------------------------------------------------------
-- 384 dimensions because `gte-small` is the model that ships inside Supabase
-- Edge Functions (`Supabase.ai.Session('gte-small')`), which is what makes the
-- embedding term free (decision 30). The dimension is fixed in the column
-- type, so a later model change is a new column or a new table, not a silent
-- mix of widths -- `embeddingSimilarity` in @bevi/ranking throws when two
-- vectors disagree on length, and this keeps that from ever being reachable.
--
-- No `on conflict` helper and no writer: the sync job upserts these as the
-- service role. `computed_at` is what the job's "new or changed Bevs" filter
-- compares against `bevs.updated_at`.

create table public.bev_embeddings (
  bev_id       uuid primary key references public.bevs(id) on delete cascade,
  embedding    extensions.vector(384) not null,
  model        text not null default 'gte-small',
  computed_at  timestamptz not null default now()
);

comment on table public.bev_embeddings is
  'A-16: gte-small (384-d) embedding of "brand name flavour category" per Bev. Written by the nightly sync as the service role; empty until that job lands.';

-- Cosine, because that is the metric §10.1 and `embeddingSimilarity` use (the
-- vectors are unit-norm, so cosine and inner product agree, but cosine is the
-- one the formula is written in). HNSW rather than IVFFlat: an IVFFlat index
-- built on an empty table has useless centroids and has to be rebuilt after
-- the first load, whereas HNSW is incremental and valid from empty -- which is
-- exactly the state this migration leaves the table in.
create index bev_embeddings_embedding_idx
  on public.bev_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 3. bev_edges
-- ---------------------------------------------------------------------------
-- The mirror of `(:Bev)-[:SIMILAR_TO]-(:Bev)`.
--
-- ONE ROW PER UNORDERED PAIR, ORIENTED src_bev_id < dst_bev_id.
--
-- Why one direction and not both:
--   * It is the orientation the graph already uses. `docs/graph.md` and
--     TASKS.md A-16 step 7 both say the sync only ever writes the direction
--     where `src.id < dst.id`, because Neo4j cannot express "at most one
--     SIMILAR_TO per unordered pair" and that convention is how it is
--     enforced. Mirroring the same convention makes `bev_edges` row-for-row
--     the graph's edge set, so "does Postgres agree with Neo4j?" is a count
--     and a diff rather than a transformation.
--   * The weight is symmetric by construction: `edgeWeight()` sums five terms
--     that are each symmetric in their two Bevs. Storing both directions would
--     store the same number twice and introduce a state -- one direction
--     updated, the other not -- that cannot be wrong today.
--   * The cost is paid once, in the two indexes below, and not at all by
--     get_bev_similarities: because the orientation is canonical,
--     `(least(a,b), greatest(a,b))` is a single primary-key probe per pair
--     rather than a two-sided OR.
-- The CHECK makes the convention a constraint rather than a comment, and
-- incidentally forbids a self-edge.

create table public.bev_edges (
  src_bev_id   uuid not null references public.bevs(id) on delete cascade,
  dst_bev_id   uuid not null references public.bevs(id) on delete cascade,
  -- edgeWeight() clamps to [0, 1]; the sync only keeps pairs at or above
  -- EDGE_MIN_WEIGHT (0.3), but that threshold is the job's policy and is
  -- deliberately not a constraint here -- lowering it should not need a
  -- migration.
  weight       numeric not null check (weight >= 0 and weight <= 1),
  -- `EdgeComponents` from @bevi/ranking: {tree, content, emb, profile, cop}.
  -- Kept as jsonb rather than five columns because the term list is the
  -- formula's, not the schema's: `cop` is weighted 0 until there is volume,
  -- and §10.1 may add a sixth.
  components   jsonb not null check (jsonb_typeof(components) = 'object'),
  -- RANKING_VERSION at compute time. A formula or constant change bumps it
  -- (packages/ranking/CLAUDE.md), so `select distinct version from bev_edges`
  -- answers "is this generation stale?" without recomputing anything.
  version      text not null,
  computed_at  timestamptz not null default now(),
  primary key (src_bev_id, dst_bev_id),
  check (src_bev_id < dst_bev_id)
);

comment on table public.bev_edges is
  'A-16: the Bev-similarity mirror of (:Bev)-[:SIMILAR_TO]-(:Bev). One row per unordered pair, oriented src_bev_id < dst_bev_id. Written by the nightly sync as the service role; empty until that job lands.';

-- "Top N neighbours of this Bev by weight" is the hot query (get_similar_bevs
-- and Matt's M-21/M-27), and with a single stored orientation a Bev's
-- neighbours are split across both columns. So: one index per side, each with
-- `weight desc` as the second key, which turns the query into two bounded
-- index scans merged rather than a scan of every incident row plus a sort.
-- The primary key already covers `(src_bev_id, dst_bev_id)` equality, which is
-- what get_bev_similarities probes, so it needs nothing extra.
create index bev_edges_src_weight_idx on public.bev_edges (src_bev_id, weight desc, dst_bev_id);
create index bev_edges_dst_weight_idx on public.bev_edges (dst_bev_id, weight desc, src_bev_id);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Both tables are derived catalog data, not user data: no user_id, nothing a
-- person wrote. So they follow `bev_stats` (20261011000100): a `select` policy
-- for `authenticated` and NO insert/update/delete policy at all, because the
-- sync job writes them as the service role, which bypasses RLS. That is the
-- supabase/CLAUDE.md rule for content tables, and here there is not even an
-- RPC write path to make an exception for.
--
-- THE AGE GATE. `bev_stats` gets away with `using (true)`; these two do not,
-- and the difference is worth writing down because it was the one real
-- judgement call in this migration.
--
-- The app never reads either table directly -- the three RPCs below are the
-- only path, they are `security definer` owned by postgres (so RLS does not
-- apply inside them), and each one age-gates its own rows exactly as
-- `search_bevs`/`get_featured` do. By that argument `using (true)` would be
-- sufficient, and the policies below would be dead weight.
--
-- They are still written with the predicate, for two reasons:
--   * An edge is a statement about TWO Bevs. `bevs_select` hides an alcoholic
--     Bev's row from an under-21 viewer; a readable `bev_edges` row would tell
--     that viewer that the hidden Bev exists, which non-alcoholic Bevs it
--     resembles and how strongly. The ids alone render nothing, but "a Bev you
--     may not see is 0.91 similar to this cider" is precisely the shape of
--     fact the gate exists to withhold, and `rankings_select` already sets the
--     precedent that a table joined to an alcoholic Bev carries the Bev's own
--     alcohol predicate rather than relying on its callers.
--   * An embedding is a lossy encoding of the Bev's own text, so it should be
--     no more readable than the Bev row it was computed from.
-- The predicate costs nothing on any request path: the RPCs bypass it, and the
-- only other readers are the sync job (service role) and Studio (postgres).
-- `viewer_is_adult()` is tested first so the adult case is one stable function
-- call and never the subquery.

alter table public.bev_embeddings enable row level security;
alter table public.bev_edges      enable row level security;

-- bevs_select is a conjunction of TWO halves -- the status half and the
-- alcohol half -- and derived data has to mirror both. Mirroring only the
-- alcohol half is the same mistake one layer down: substitute "a Bev whose
-- status hides it" for "an alcoholic Bev" in the argument above and it reads
-- identically. Concretely, moderation sets status='hidden' and bevs_select
-- stops serving the row, but the edge and the embedding survive until the next
-- nightly sync -- so a plain `GET /rest/v1/bev_edges?weight=gt.0.9` would hand
-- any signed-in user the hidden Bev's id, its weight to a visible Bev and the
-- per-term `components`, and the embeddings table would hand over its 384-d
-- gte-small vector. That vector encodes "brand name flavour category" from a
-- public model, so candidate strings can be embedded and compared to recover
-- roughly the free text that was just taken down.
--
-- Only 'active' is allowed through, not bevs_select's `pending_photo and
-- created_by = auth.uid()` branch: a draft's creator can see the Bev row
-- itself, and there is no reason its edges need to follow.
create policy bev_embeddings_select on public.bev_embeddings
  for select to authenticated using (
    exists (
      select 1 from public.bevs b
       where b.id = bev_embeddings.bev_id and b.status = 'active'
    )
    and (
      public.viewer_is_adult()
      or not exists (
        select 1
          from public.bevs b
          join public.categories c on c.id = b.category_id
         where b.id = bev_embeddings.bev_id
           and c.is_alcoholic
      )
    )
  );

-- Both ends must be active, for the reason above: an edge is a statement about
-- two Bevs, so either end being withheld withholds the row.
create policy bev_edges_select on public.bev_edges
  for select to authenticated using (
    exists (
      select 1 from public.bevs b
       where b.id = bev_edges.src_bev_id and b.status = 'active'
    )
    and exists (
      select 1 from public.bevs b
       where b.id = bev_edges.dst_bev_id and b.status = 'active'
    )
    and (
      public.viewer_is_adult()
      or not exists (
        select 1
          from public.bevs b
          join public.categories c on c.id = b.category_id
         where b.id in (bev_edges.src_bev_id, bev_edges.dst_bev_id)
           and c.is_alcoholic
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. get_bev_similarities(p_bev_id, p_other_ids) -> (bev_id, weight)
-- ---------------------------------------------------------------------------
-- `BevsApi.similarities(bevId, otherIds)`: the weights between one Bev and a
-- caller-supplied set, for Matt's M-21 (compare a new mocha with mochas
-- first). Only pairs that have an edge come back, so the result is usually
-- shorter than `p_other_ids` and is empty whenever the mirror is.
--
-- The lookup is a single primary-key probe per pair, keyed on
-- `(least, greatest)`, which is the canonical orientation section 3 stores. No
-- `or` over both columns and no union: the orientation is a constraint, so
-- there is exactly one row that can match.
--
-- Age gate and status: both ends must be an active Bev the caller may see,
-- spelled exactly as `search_bevs`/`get_featured` spell it. A Bev the caller
-- cannot see contributes no row rather than an error -- this is a bulk helper
-- feeding a placement heuristic, and failing the whole call because one id in
-- a list of thirty is age-gated would be worse behaviour, not safer.

create or replace function public.get_bev_similarities(
  p_bev_id    uuid,
  p_other_ids uuid[]
)
returns table (
  bev_id uuid,
  weight numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- A bucket is a few hundred Bevs at most. The cap is a bound on the work a
  -- single call can ask for, not a selection rule, so going over it is the
  -- caller's bug and is reported as one.
  v_max constant int := 500;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  -- cardinality(), not array_length(arr, 1): the latter is the length of the
  -- FIRST DIMENSION only, so a nested array walks straight past the cap --
  -- PostgREST builds a multidimensional array from a nested JSON array, and
  -- `[[a,b],[c,d], ...]` with 500 outer elements unnests to 1000+ ids. The
  -- bound would then be set by the request body size, not by v_max.
  if coalesce(cardinality(p_other_ids), 0) > v_max then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'otherIds';
  end if;

  return query
    with anchor as (
      select b.id
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where b.id = p_bev_id
         and b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    ),
    others as (
      select distinct b.id
        from unnest(coalesce(p_other_ids, '{}'::uuid[])) as want(id)
        join public.bevs b on b.id = want.id
        join public.categories c on c.id = b.category_id
       where b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    )
    select o.id, e.weight
      from anchor a
      join others o on o.id <> a.id
      join public.bev_edges e
        on e.src_bev_id = least(a.id, o.id)
       and e.dst_bev_id = greatest(a.id, o.id);
end;
$$;

comment on function public.get_bev_similarities(uuid, uuid[]) is
  'S-14: edge weights between p_bev_id and each of p_other_ids, from the bev_edges mirror (A-16). Pairs with no edge are absent; empty until the sync job lands.';

-- ---------------------------------------------------------------------------
-- 6. get_similar_bevs(p_bev_id, p_limit) -> BevSummary rows
-- ---------------------------------------------------------------------------
-- `BevsApi.similar(bevId, n)`: the "Bevs like this" row (Matt's M-27).
--
-- The column list is `search_bevs`'s (20261012000700), in the same order, so
-- packages/api reuses `mapSearchRow` verbatim and every BevSummary field is
-- real data rather than a placeholder. `weight` is deliberately NOT a column:
-- the contract returns `BevSummary[]`, and an edge weight is an internal
-- number with no rendering.
--
-- Order: weight desc, then `b.id`. That matches `topEdges`, which breaks ties
-- on `bevId` in code-unit order -- for a canonical lowercase-hex uuid, byte
-- order and code-unit order of the text form are the same, so the SQL and the
-- TypeScript agree without a cast or a collation. The order is total, so the
-- row set is stable across calls.
--
-- status = 'active' on the neighbour: #113 shipped get_explore without the
-- status half of `bevs_select` and a 'pending_photo' Bev (visible to its
-- creator alone) reached strangers. A "Bevs like this" row is exactly the same
-- exposure, so it is filtered here, and `merged`/`hidden` Bevs are dropped
-- with it.

create or replace function public.get_similar_bevs(
  p_bev_id uuid,
  p_limit  int default 10
)
returns table (
  id              uuid,
  name            text,
  brand           text,
  flavor          text,
  category_id     text,
  photo_path      text,
  thumb_path      text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  avg_score       numeric(4,2),
  bayes_score     numeric(4,2)
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- Clamped like get_explore's. 50 rather than EDGE_TOP_K (20): the sync keeps
  -- each Bev's top 20, but an unordered pair survives if EITHER end wants it,
  -- so a popular Bev legitimately has more than 20 incident edges and capping
  -- at 20 would silently truncate real rows.
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    with anchor as (
      select b.id
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where b.id = p_bev_id
         and b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    ),
    -- Both stored orientations, flattened to (neighbour, weight). Each branch
    -- is a bounded scan of one of section 3's two indexes.
    neighbours as (
      select e.dst_bev_id as bev_id, e.weight
        from anchor a
        join public.bev_edges e on e.src_bev_id = a.id
      union all
      select e.src_bev_id as bev_id, e.weight
        from anchor a
        join public.bev_edges e on e.dst_bev_id = a.id
    )
    select b.id, b.name, b.brand, b.flavor, b.category_id,
           b.photo_path, b.thumb_path, b.price_tier, b.price_estimated,
           coalesce(s.rating_count, 0) as rating_count,
           s.avg_score,
           s.bayes_score
      from neighbours n
      join public.bevs b on b.id = n.bev_id
      join public.categories c on c.id = b.category_id
      left join public.bev_stats s on s.bev_id = b.id
     where b.status = 'active'
       and (not c.is_alcoholic or public.viewer_is_adult())
     order by n.weight desc, b.id
     limit v_limit;
end;
$$;

comment on function public.get_similar_bevs(uuid, int) is
  'S-14: the heaviest bev_edges neighbours of p_bev_id (A-16) as search_bevs'' BevSummary columns, active and age-filtered. Empty until the sync job lands.';

-- ---------------------------------------------------------------------------
-- 7. list_bucket_bevs(p_bucket) -> (id, category_id, brand_key)
-- ---------------------------------------------------------------------------
-- `RankingsApi.listBucketBevs(bucket)`: the caller's own ranked Bevs in one
-- bucket, with just enough catalog detail for M-21 to anchor a comparison when
-- `bev_edges` has no edge for a pair (`treeSimilarity` needs the category,
-- `contentSimilarity` the brand key).
--
-- Deliberately the SAME ROW SET as `rankings.listBucket`, which reads
-- `rankings` directly under `rankings_select`:
--   * age-gated through the Bev's category, which is what `rankings_select`
--     does, so an under-21 caller whose birth date arrived after the ranking
--     sees neither here;
--   * NOT filtered on `bevs.status`, which `rankings_select` also does not
--     filter on. The two lists index into each other during placement
--     (`listBucket`'s length is `expectedBucketSize`), so a Bev that appears
--     in one and not the other is a bug source. This is the one place in this
--     migration where "match the existing read" beats "filter like #113",
--     because these ids are never rendered as a card -- they are compared
--     against, and the Bev's own RPCs still refuse to return it.
--   * ordered by `position`, best first, as `listBucket` is.
--
-- brand_key matches `normaliseBrand()` in @bevi/ranking (lowercase, trim,
-- collapse inner whitespace, null when empty) rather than the schema's own
-- `lower(brand)` (`bevs_natural_uq`, 20261009000300), because the value is
-- consumed by `contentSimilarity`, whose `brandKey` equality is defined by
-- that function. The only divergence is the exact character class of `\s`,
-- which differs between JS and Postgres for exotic Unicode spaces; a brand
-- containing one would compare equal in SQL and unequal in TypeScript, which
-- is a cosmetic mismatch on data `bevs.brand`'s CHECK does not exclude but no
-- seeded row contains.
--
-- An out-of-range p_bucket is zero rows, not an error: `bucketToDb` in
-- packages/api only ever produces 1, 2 or 3, so a bad value is unreachable
-- from the contract and does not deserve its own error code.

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
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    select b.id,
           b.category_id,
           nullif(regexp_replace(lower(btrim(b.brand)), '\s+', ' ', 'g'), '') as brand_key
      from public.rankings r
      join public.bevs b on b.id = r.bev_id
      join public.categories c on c.id = b.category_id
     where r.user_id = v_uid
       and r.bucket = p_bucket
       and (not c.is_alcoholic or public.viewer_is_adult())
     order by r.position;
end;
$$;

comment on function public.list_bucket_bevs(smallint) is
  'S-14: the caller''s own ranked Bevs in one bucket as (id, category_id, brand_key), best first. Same row set as rankings.listBucket; brand_key matches normaliseBrand() in @bevi/ranking.';

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
-- `from public` strips Postgres's implicit grant to PUBLIC; `anon` is named
-- separately because Supabase's default privileges lay down a direct EXECUTE
-- grant to anon, authenticated and service_role on every new function in this
-- schema, which a revoke from PUBLIC does not touch (20261019000400 learned
-- this the hard way). service_role keeps EXECUTE: the sync job reads through
-- it.

alter function public.get_bev_similarities(uuid, uuid[]) owner to postgres;
alter function public.get_similar_bevs(uuid, int)        owner to postgres;
alter function public.list_bucket_bevs(smallint)         owner to postgres;

revoke execute on function
  public.get_bev_similarities(uuid, uuid[]),
  public.get_similar_bevs(uuid, int),
  public.list_bucket_bevs(smallint)
from public, anon;

grant execute on function
  public.get_bev_similarities(uuid, uuid[]),
  public.get_similar_bevs(uuid, int),
  public.list_bucket_bevs(smallint)
to authenticated;
