-- A-16 (1): replace_bev_edges needs `where true` on its delete.
--
-- 20261023000300 wrote `delete from public.bev_edges;`. That is refused on this
-- project with
--
--   SQLSTATE 21000: DELETE requires a WHERE clause
--
-- because Supabase loads pg_safeupdate on the roles PostgREST connects as, and
-- it rejects an unqualified DELETE or UPDATE regardless of who issues it --
-- including inside a security definer function. The first real run of
-- `npm run graph:edges` hit it after computing all 4669 edges, so the job did
-- its work and then failed at the write.
--
-- pgTAP could not have caught this: the local stack in CI has no pg_safeupdate,
-- so `14_graph_edge_writer.test.sql` passes its 16 assertions there either way.
-- The guard is a property of the hosted project, not of the schema, which is
-- worth remembering before trusting a green `db` job about anything PostgREST
-- actually does at runtime.
--
-- `where true` is semantically identical to no clause and satisfies the guard.
-- Everything else about the function -- the nine validations that all run
-- BEFORE the delete, the grants, the ownership -- is unchanged from
-- 20261023000300, reproduced here because a migration is append-only.

set search_path = public, extensions;

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

  delete from public.bev_edges where true;  -- `where true`: see the header

  insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version, computed_at)
  select r.src_bev_id, r.dst_bev_id, r.weight, r.components, p_version, now()
    from jsonb_to_recordset(p_rows) as r(
           src_bev_id uuid, dst_bev_id uuid, weight numeric, components jsonb
         );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.replace_bev_edges(jsonb, text) owner to postgres;
revoke execute on function public.replace_bev_edges(jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_bev_edges(jsonb, text) to service_role;
