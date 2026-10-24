-- A-16 (1) (20261023000300): the two service-role RPCs `scripts/graph/build-edges.ts`
-- needs to fill `public.bev_edges`.
--
-- WHY THIS FILE EXISTS, since 20261019000500 deliberately created no writer.
-- The builder follows the scripts/ convention (Node 22, `--experimental-strip-types`,
-- no dependencies, same as scripts/catalog/* and scripts/graph/apply-schema.ts),
-- so it talks to PostgREST with `fetch` rather than opening a libpq connection.
-- Two of its steps cannot be expressed that way:
--
--   step 3  "the 50 nearest by embedding cosine" needs pgvector's `<=>` and the
--           HNSW index of 20261019000500. PostgREST has no operator for it.
--   step 7  "write back ... in ONE TRANSACTION (truncate-and-insert is fine at
--           this size)". A sequence of REST calls is a sequence of
--           transactions; one RPC call is one transaction.
--
-- So each is a `security definer` function, callable by the service role only.
-- That keeps the dependency-free script honest about its atomicity instead of
-- approximating it with a delete call followed by an insert call and a prayer.
--
-- Nothing here computes a weight. `edgeWeight`, `topEdges`, `EDGE_WEIGHTS`,
-- `EDGE_TOP_K` and `EDGE_MIN_WEIGHT` live in packages/ranking/src/edges.ts and
-- run in the job; this file stores the numbers they produce and hands back the
-- candidate list they are computed over. Same division as 20261019000500.
--
-- NO NEO4J. `bev_edges` is complete and correct without it; A-16 steps 6, 8 and
-- 9 (the Cypher MERGE, the RANKED mirror, the (:Meta) keep-alive) are a later
-- PR, and the graph only ever mirrors this table (docs/graph.md, "the one rule").

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. nearest_bev_embeddings(p_limit) -> (bev_id, neighbour_id, distance)
-- ---------------------------------------------------------------------------
-- A-16 step 3's third candidate arm, for every active Bev at once: one call
-- instead of 378 round trips.
--
-- `distance` is cosine DISTANCE (`<=>` under `vector_cosine_ops`), not
-- similarity, and the job does not convert it: it uses these rows only to
-- decide which pairs to CONSIDER, then recomputes the `emb` term with
-- `embeddingSimilarity` from the vectors themselves. So an approximate index
-- can change which pairs are weighed but never what a pair weighs -- which is
-- the property that makes using an ANN index here safe at all.
--
-- `hnsw.ef_search` defaults to 40, and an HNSW scan asked for the 50 nearest
-- with a 40-wide search list silently returns at most 40 rows per Bev. So it is
-- raised to at least 2x the limit for the duration of the call. The `true`
-- argument to `set_config` makes it transaction-local, so it does not leak into
-- the next statement on a pooled connection -- which is also why this function
-- is marked `volatile` rather than `stable` despite only reading tables: it
-- changes a setting, and claiming otherwise would let PostgREST serve it over
-- GET and let the planner fold calls together.
--
-- The `status = 'active'` filters mean the planner may well choose an exact
-- sequential scan over the index-ordered one -- at 378 Bevs either plan is
-- fast, and the sequential one is exactly correct, so there is nothing to
-- tune. The ef_search setting matters only when the index plan wins, and it is
-- set unconditionally because which plan wins is not this function's business.
--
-- Both ends are filtered to active Bevs: `bev_embeddings` rows outlive a Bev's
-- status change until the next run, and an edge to a hidden Bev is the
-- moderation bypass 20261019000500's RLS section is about.

create or replace function public.nearest_bev_embeddings(p_limit int default 50)
returns table (
  bev_id       uuid,
  neighbour_id uuid,
  distance     double precision
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  -- A bound on the work one call can ask for. 200 is far above EDGE_TOP_K and
  -- above the 50 the job asks for; past it the quadratic candidate arms
  -- dominate anyway.
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform set_config('hnsw.ef_search', greatest(v_limit * 2, 40)::text, true);

  return query
    with anchors as (
      select e.bev_id as id, e.embedding
        from public.bev_embeddings e
        join public.bevs b on b.id = e.bev_id
       where b.status = 'active'
    )
    select a.id, n.id, n.distance
      from anchors a
      cross join lateral (
        select c.bev_id as id, (c.embedding <=> a.embedding)::double precision as distance
          from public.bev_embeddings c
          join public.bevs b2 on b2.id = c.bev_id
         where b2.status = 'active'
           and c.bev_id <> a.id
         order by c.embedding <=> a.embedding
         limit v_limit
      ) n
     -- A TOTAL order, and not decoration: supabase/config.toml sets
     -- `max_rows = 1000`, which applies to a stored procedure too, so the
     -- caller reads this in `limit`/`offset` pages. Paging an unordered result
     -- may repeat or skip rows, which here would mean losing candidate pairs
     -- at random and silently.
     order by a.id, n.distance, n.id;
end;
$$;

comment on function public.nearest_bev_embeddings(int) is
  'A-16 step 3: for each active Bev with an embedding, its p_limit nearest active neighbours by pgvector cosine distance. Candidate selection only -- the edge weight''s emb term is recomputed by embeddingSimilarity in @bevi/ranking. Service role only.';

-- ---------------------------------------------------------------------------
-- 2. replace_bev_edges(p_rows, p_version) -> int
-- ---------------------------------------------------------------------------
-- A-16 step 7. The whole of `bev_edges` is replaced by `p_rows` inside this
-- one function call, which is one transaction. Returns the number of rows
-- inserted, which the job compares against what it sent.
--
-- Shape of p_rows, matching `edgeRows()` in scripts/graph/edges-core.ts:
--   [{"src_bev_id": uuid, "dst_bev_id": uuid, "weight": number,
--     "components": {"tree":…, "content":…, "emb":…, "profile":…, "cop":…}}, …]
--
-- DELETE, not TRUNCATE, although TASKS.md sanctions truncate-and-insert at this
-- size. The difference is the lock. `truncate` takes ACCESS EXCLUSIVE, which
-- blocks every reader -- including `get_similar_bevs` on a user's Bev detail
-- screen -- for as long as the transaction runs. `delete` takes ROW EXCLUSIVE
-- and readers keep seeing the old rows under MVCC until the commit, at which
-- point they see the new ones; the table is never observably empty and nothing
-- on a request path ever waits. At a few thousand rows the extra cost is
-- irrelevant, and "the hot path does not block on the nightly rebuild" is
-- exactly the promise docs/graph.md makes.
--
-- Validation is explicit rather than left to the table's CHECKs, because a
-- constraint violation from inside a definer surfaces to the job as an opaque
-- 23514 on an unnamed row. These raise BEVI_VALIDATION with the offending
-- detail, and they run BEFORE the delete, so a bad payload leaves yesterday's
-- edges in place.
--
-- Orientation: rows must ALREADY be canonical (`src_bev_id < dst_bev_id`). This
-- function does not reorient them. The job's `orientPair` is the single place
-- that decides orientation, and silently fixing a mis-oriented row here would
-- hide a bug in the only code that can produce one -- and `components` is not
-- symmetric to reorder blindly if a future term stops being symmetric.

create or replace function public.replace_bev_edges(p_rows jsonb, p_version text)
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
  v_order     boolean;
  v_range     boolean;
  v_shape     boolean;
begin
  if p_version is null or btrim(p_version) = '' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'version';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows';
  end if;

  -- An empty array would wipe the mirror, which is a plausible symptom of a
  -- broken run (no embeddings, a failed read) and never a legitimate result for
  -- a catalog with 378 Bevs. Refusing it keeps yesterday's edges, which is the
  -- behaviour docs/graph.md promises on failure.
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: empty';
  end if;

  -- One pass over the payload for the four row-local checks plus the duplicate
  -- count. No temporary table: a `create temporary table ... on commit drop`
  -- would fail the second time this function is called in the same transaction,
  -- which is exactly what a pgTAP file does, and re-parsing a few thousand rows
  -- of jsonb twice is cheaper than that surprise.
  select count(*)::int,
         count(distinct (r.src_bev_id, r.dst_bev_id))::int,
         coalesce(bool_or(r.src_bev_id is null or r.dst_bev_id is null
                          or r.weight is null or r.components is null), false),
         coalesce(bool_or(r.src_bev_id >= r.dst_bev_id), false),
         coalesce(bool_or(r.weight < 0 or r.weight > 1), false),
         coalesce(bool_or(jsonb_typeof(r.components) <> 'object'), false)
    into v_total, v_distinct, v_null, v_order, v_range, v_shape
    from jsonb_to_recordset(p_rows) as r(
           src_bev_id uuid, dst_bev_id uuid, weight numeric, components jsonb
         );

  if v_null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: a column is null';
  end if;
  if v_order then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'rows: not in canonical orientation (src_bev_id < dst_bev_id)';
  end if;
  if v_range then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: weight outside [0, 1]';
  end if;
  if v_shape then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: components is not an object';
  end if;
  -- A duplicated pair would hit the primary key mid-insert. Caught here so the
  -- message names the problem rather than the index.
  if v_distinct <> v_total then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: duplicate pair';
  end if;
  -- Both ends must be a Bev that exists. The FK would catch this too, but only
  -- after the delete, and its message names an index rather than the payload.
  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as r(src_bev_id uuid, dst_bev_id uuid)
     where not exists (select 1 from public.bevs b where b.id = r.src_bev_id)
        or not exists (select 1 from public.bevs b where b.id = r.dst_bev_id)
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'rows: unknown bev id';
  end if;

  delete from public.bev_edges;

  insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version, computed_at)
  select r.src_bev_id, r.dst_bev_id, r.weight, r.components, p_version, now()
    from jsonb_to_recordset(p_rows) as r(
           src_bev_id uuid, dst_bev_id uuid, weight numeric, components jsonb
         );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.replace_bev_edges(jsonb, text) is
  'A-16 step 7: replaces public.bev_edges with p_rows in one transaction, stamping p_version (RANKING_VERSION). Rows must be canonically oriented (src_bev_id < dst_bev_id). Returns the row count. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
-- Same reasoning as 20261019000500 section 8 and 20261023000200 section 4:
-- Supabase's default privileges grant EXECUTE directly to anon, authenticated
-- and service_role on every new function in `public`, and revoking from PUBLIC
-- does not remove those. Both of these are pipeline functions -- one of them
-- can replace the entire similarity mirror -- so only the service role keeps
-- EXECUTE. `authenticated` reads edges through the three RPCs of
-- 20261019000500 and has no business calling either of these.

alter function public.nearest_bev_embeddings(int)        owner to postgres;
alter function public.replace_bev_edges(jsonb, text)     owner to postgres;

revoke execute on function
  public.nearest_bev_embeddings(int),
  public.replace_bev_edges(jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.nearest_bev_embeddings(int),
  public.replace_bev_edges(jsonb, text)
to service_role;
