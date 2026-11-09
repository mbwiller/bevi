-- =====================================================================
-- 20261109000200 · venues, the data pipeline (A-08)
-- =====================================================================
-- What makes the map have pins. After 20261102000300 (the tables) and
-- 20261102000400 (the reads), three things were still missing:
--
--   1. NOTHING WROTE `venue_bevs`, and `venues_in_view` returns only venues
--      with at least one visible Bev there (D-13). So a fully imported city
--      had zero pins.
--   2. A branch did not know WHICH chain it was. The import set
--      `kind = 'chain'` on a brand match and threw the match away, so no
--      preset could be expanded onto the right shops.
--   3. The presets and the craft menus had no writer.
--
-- This migration adds `venues.chain_id`, re-creates `import_venues` to write
-- it, and adds four service-role-only functions that `scripts/venues/
-- import-osm.ts` (`npm run venues:sync`) calls in this order:
--
--   upsert_chains(jsonb)          data/venues/chains.json -> chains
--   import_venues(jsonb)          Overpass -> venues (now with chain_id)
--   apply_venue_menus(jsonb)      data/venues/menus.csv -> venue_bevs, source 'menu'
--   expand_chain_assortments()    chains -> venue_bevs, source 'chain'
--   venue_sync_report()           the counts the run prints
--
-- Chains go FIRST so that a branch imported in the same run already finds
-- its chain (chain_id is a foreign key). Menus go BEFORE the expansion so
-- that a menu line removed from the CSV, for a Bev the venue's chain also
-- carries, comes straight back as a chain row in the same run rather than
-- being missing until the next one.
--
-- THE ONE RULE THE EXPANSION KEEPS: a `source = 'menu'` row is a human's
-- claim and is never touched by it -- not deleted, not downgraded. A chain row
-- that a menu also lists is UPGRADED to 'menu' by `apply_venue_menus` (the
-- primary key is (venue_id, bev_id), so one row carries one source), and from
-- then on the expansion leaves it alone.
--
-- Lane rules (supabase/CLAUDE.md, .claude/agents/integrator.md): every
-- function is `security definer`, owned by postgres, with `search_path` set,
-- EXECUTE revoked from public/anon/authenticated and granted to service_role
-- only. RLS stays on the three tables with no policy. Every DELETE has a WHERE
-- clause (pg_safeupdate).
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. venues.chain_id
-- ---------------------------------------------------------------------------
-- `on delete set null`: a chain removed from chains.json is deleted by
-- `upsert_chains`, its branches lose the link, and the next expansion removes
-- their chain rows. The branch itself stays (it is still a shop in OSM).
alter table public.venues
  add column chain_id text references public.chains(id) on delete set null;

create index venues_chain_idx on public.venues (chain_id) where chain_id is not null;

-- A branch of a chain is a chain venue. Not the converse: `kind = 'chain'`
-- with no chain_id is what a branch looks like between its chain being
-- deleted and the next import re-deriving `kind`, and 20261102000300's own
-- fixtures insert chain venues with no chain_id. Every existing row has
-- chain_id null (the column is new), so this cannot fail on existing data.
alter table public.venues
  add constraint venues_chain_is_chain_kind check (chain_id is null or kind = 'chain');

comment on column public.venues.chain_id is
  'The chains preset this venue is a branch of (A-08, decision 33), set by import_venues from the OSM brand. expand_chain_assortments() turns it into venue_bevs rows with source = chain.';

-- ---------------------------------------------------------------------------
-- 2. import_venues(p_rows jsonb) -> integer, now writing chain_id
-- ---------------------------------------------------------------------------
-- Identical to 20261102000300's, plus `chain_id`. Read that header for the
-- rules (OSM may improve a value, never erase one; status, id, created_at and
-- venue_bevs are never touched). The additions:
--
--   * `chain_id` is OSM-derived, like `kind`, so it is OSM's outright: a shop
--     that stops carrying the brand stops being a branch. An id that names no
--     chain becomes null rather than failing the batch on the foreign key --
--     the script upserts the chains first, so that only happens when chains
--     and venues are written by different hands.
--   * `kind` follows `chain_id`: 'chain' whenever there is one, otherwise the
--     payload's kind (default 'craft'), so the CHECK above holds by
--     construction and an old caller that sends no chain_id behaves as before.
create or replace function public.import_venues(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'p_rows must be a jsonb array';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where coalesce(r ->> 'osm_id', '') = ''
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'every row needs an osm_id';
  end if;

  with incoming as (
    select
      r ->> 'osm_id'                        as osm_id,
      r ->> 'name'                          as name,
      r ->> 'kind'                          as kind,
      (select c.id from public.chains c where c.id = r ->> 'chain_id') as chain_id,
      (r ->> 'lat')::double precision       as lat,
      (r ->> 'lng')::double precision       as lng,
      r ->> 'address'                       as address,
      r ->> 'neighborhood'                  as neighborhood,
      r ->> 'borough'                       as borough,
      r ->> 'hours_osm'                     as hours_osm,
      coalesce((r ->> 'hours_known')::boolean, false) as hours_known,
      r ->> 'website'                       as website
    from jsonb_array_elements(p_rows) r
  ),
  upserted as (
    insert into public.venues as v
      (osm_id, name, kind, chain_id, lat, lng, address, neighborhood, borough,
       hours_osm, hours_known, website, source)
    select i.osm_id, i.name,
           case when i.chain_id is not null then 'chain' else coalesce(nullif(i.kind, ''), 'craft') end,
           i.chain_id,
           i.lat, i.lng, i.address, i.neighborhood, i.borough,
           i.hours_osm, i.hours_known, i.website, 'osm'
      from incoming i
    on conflict (osm_id) do update set
      name         = excluded.name,
      kind         = excluded.kind,
      chain_id     = excluded.chain_id,
      lat          = excluded.lat,
      lng          = excluded.lng,
      -- OSM may improve a value, never erase one.
      address      = coalesce(excluded.address, v.address),
      neighborhood = coalesce(excluded.neighborhood, v.neighborhood),
      borough      = coalesce(excluded.borough, v.borough),
      website      = coalesce(excluded.website, v.website),
      hours_osm    = coalesce(excluded.hours_osm, v.hours_osm),
      hours_known  = case
                       when excluded.hours_osm is not null then excluded.hours_known
                       else v.hours_known
                     end,
      updated_at   = now()
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. upsert_chains(p_chains jsonb) -> integer
-- ---------------------------------------------------------------------------
-- p_chains: [{ "id", "name", "osm_brands": [text], "bev_ids": [uuid] }, ...]
--
-- THE FILE IS THE WHOLE TRUTH: every chain in the payload is upserted and
-- every chain NOT in it is deleted (its branches' chain_id goes null via the
-- foreign key, and the expansion then removes their chain rows). So removing
-- a chain from chains.json removes its pins on the next sync, which is what a
-- reviewer deleting a line expects.
--
-- An EMPTY payload is refused rather than read as "delete every chain": an
-- empty array is far more likely to be a broken file than a decision.
--
-- `bev_ids` are stored as given. They are NOT checked against `bevs` here: a
-- preset is an input to curation (20261102000300 section 2), and
-- `expand_chain_assortments` is where an id that is unknown, merged or hidden
-- is ignored -- one place, so a Bev merged after the preset was written stops
-- appearing without anybody editing the preset.
create or replace function public.upsert_chains(p_chains jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   text[];
  v_count integer;
begin
  if p_chains is null or jsonb_typeof(p_chains) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'p_chains must be a jsonb array';
  end if;
  if jsonb_array_length(p_chains) = 0 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'p_chains is empty; refusing to delete every chain';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_chains) c
     where jsonb_typeof(c) <> 'object'
        or coalesce(c ->> 'id', '') = ''
        or coalesce(c ->> 'name', '') = ''
        or jsonb_typeof(c -> 'osm_brands') is distinct from 'array'
        or jsonb_typeof(c -> 'bev_ids') is distinct from 'array'
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'every chain needs id, name, osm_brands[] and bev_ids[]';
  end if;

  select array_agg(c ->> 'id') into v_ids from jsonb_array_elements(p_chains) c;
  -- `on conflict do update` cannot touch one row twice in a statement.
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'duplicate chain id';
  end if;

  with upserted as (
    insert into public.chains as ch (id, name, osm_brands, assortment_bev_ids)
    select c ->> 'id',
           c ->> 'name',
           array(select distinct lower(btrim(b))
                   from jsonb_array_elements_text(c -> 'osm_brands') b
                  where btrim(b) <> ''
                  order by 1),
           array(select distinct x::uuid
                   from jsonb_array_elements_text(c -> 'bev_ids') x
                  order by 1)
      from jsonb_array_elements(p_chains) c
    on conflict (id) do update set
      name               = excluded.name,
      osm_brands         = excluded.osm_brands,
      assortment_bev_ids = excluded.assortment_bev_ids,
      updated_at         = now()
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  delete from public.chains where id <> all(v_ids);

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. apply_venue_menus(p_rows jsonb) -> jsonb
-- ---------------------------------------------------------------------------
-- p_rows: [{ "osm_id", "bev_id", "verified_at" (nullable) }, ...]
--
-- REPLACE PER VENUE: for every venue the payload names (and can resolve),
-- its menu rows become exactly the payload's rows -- so deleting a line from
-- menus.csv removes that Bev from that venue. A venue the payload does not
-- name is not touched at all, so a menu entered some other way survives, and
-- an empty CSV changes nothing.
--
-- Unknown venues and unknown (or non-active) Bevs are REPORTED AND SKIPPED,
-- never fatal: one typo in a shared CSV should not hold back every other
-- line. The script prints the returned lists.
--
-- A Bev the venue already has as a CHAIN row is upgraded to 'menu' (with the
-- menu's verified_at): a human confirmed it, which is a stronger claim.
create or replace function public.apply_venue_menus(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unknown_venues text[];
  v_unknown_bevs   text[];
  v_upserted       integer := 0;
  v_deleted        integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'p_rows must be a jsonb array';
  end if;

  select coalesce(array_agg(distinct r ->> 'osm_id' order by r ->> 'osm_id'), '{}')
    into v_unknown_venues
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from public.venues v where v.osm_id = r ->> 'osm_id');

  select coalesce(array_agg(distinct r ->> 'bev_id' order by r ->> 'bev_id'), '{}')
    into v_unknown_bevs
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from public.bevs b where b.id = (r ->> 'bev_id')::uuid and b.status = 'active');

  -- One statement, so the delete and the upsert see the same snapshot. Their
  -- key sets are disjoint by construction (the delete takes only rows NOT in
  -- `menu`, the upsert only rows in it), so neither can see the other's work.
  with incoming as (
    select r ->> 'osm_id'                     as osm_id,
           (r ->> 'bev_id')::uuid             as bev_id,
           (r ->> 'verified_at')::timestamptz as verified_at
      from jsonb_array_elements(p_rows) r
  ),
  menu as (
    -- A repeated line is one row (`on conflict` cannot touch a row twice).
    select distinct on (v.id, i.bev_id)
           v.id as venue_id, i.bev_id, i.verified_at
      from incoming i
      join public.venues v on v.osm_id = i.osm_id
      join public.bevs b on b.id = i.bev_id and b.status = 'active'
     order by v.id, i.bev_id, i.verified_at desc nulls last
  ),
  deleted as (
    delete from public.venue_bevs vb
     where vb.source = 'menu'
       and vb.venue_id in (select m.venue_id from menu m)
       and not exists (select 1 from menu m where m.venue_id = vb.venue_id and m.bev_id = vb.bev_id)
    returning 1
  ),
  upserted as (
    insert into public.venue_bevs as vb (venue_id, bev_id, source, verified_at)
    select m.venue_id, m.bev_id, 'menu', m.verified_at from menu m
    on conflict (venue_id, bev_id) do update set
      source      = 'menu',
      verified_at = excluded.verified_at
    returning 1
  )
  select (select count(*)::integer from upserted), (select count(*)::integer from deleted)
    into v_upserted, v_deleted;

  return jsonb_build_object(
    'upserted', v_upserted,
    'deleted', v_deleted,
    'unknown_venues', to_jsonb(v_unknown_venues),
    'unknown_bevs', to_jsonb(v_unknown_bevs)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. expand_chain_assortments() -> jsonb
-- ---------------------------------------------------------------------------
-- For every ACTIVE venue with a chain_id, its `source = 'chain'` rows become
-- exactly the chain's `assortment_bev_ids` that are active Bevs. Everywhere
-- else -- a venue with no chain (any more), or a hidden one -- the chain rows
-- go. Idempotent: a second run changes nothing.
--
-- NEVER TOUCHES A `source = 'menu'` ROW: the delete names `source = 'chain'`,
-- and the insert is `on conflict do nothing`, so a Bev a venue already has
-- from a menu stays a menu row.
--
-- An id in a preset that is not an active Bev -- unknown, merged or hidden --
-- is ignored, not an error. That is the choice 20261102000300 set up when it
-- made the preset a uuid[] with no foreign key: the preset is input, and this
-- is the one place it is resolved. A merged Bev therefore drops off every
-- branch on the next sync, without the preset being edited.
create or replace function public.expand_chain_assortments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted  integer := 0;
  v_inserted integer := 0;
begin
  -- One statement, as in apply_venue_menus: the delete takes chain rows NOT
  -- desired and the insert only desired ones, so the two never meet.
  with desired as (
    select distinct v.id as venue_id, b.id as bev_id
      from public.venues v
      join public.chains c on c.id = v.chain_id
      cross join lateral unnest(c.assortment_bev_ids) as a(bev_id)
      join public.bevs b on b.id = a.bev_id and b.status = 'active'
      -- No alcohol in a chain preset, enforced here as well as in the script
      -- (curation-core.ts): a preset Bev later moved to an alcoholic category,
      -- or a direct call, must not put it on every branch. A hand-entered
      -- menu (source = 'menu') may still list one; the read RPCs' age gate
      -- covers that.
      join public.categories cat on cat.id = b.category_id and not cat.is_alcoholic
     where v.status = 'active'
  ),
  deleted as (
    delete from public.venue_bevs vb
     where vb.source = 'chain'
       and not exists (select 1 from desired d where d.venue_id = vb.venue_id and d.bev_id = vb.bev_id)
    returning 1
  ),
  inserted as (
    insert into public.venue_bevs (venue_id, bev_id, source)
    select d.venue_id, d.bev_id, 'chain' from desired d
    on conflict (venue_id, bev_id) do nothing
    returning 1
  )
  select (select count(*)::integer from inserted), (select count(*)::integer from deleted)
    into v_inserted, v_deleted;

  return jsonb_build_object('inserted', v_inserted, 'deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. venue_sync_report() -> jsonb
-- ---------------------------------------------------------------------------
-- What the sync prints after writing: the table as it now is, not as the run
-- believes it to be. `pinned` uses the read RPCs' own rule (an active venue
-- with at least one active Bev in venue_bevs, D-13) as an adult sees it;
-- `pinned_for_minors` drops alcoholic Bevs the way `venues_in_view` does.
-- Counts only: no names, no ids, so the Actions log on this public repo shows
-- nothing a venue table does not already publish.
create or replace function public.venue_sync_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'venues_active',     (select count(*) from public.venues where status = 'active'),
    'with_neighborhood', (select count(*) from public.venues where status = 'active' and neighborhood is not null),
    'with_borough',      (select count(*) from public.venues where status = 'active' and borough is not null),
    'chain_branches',    coalesce((select jsonb_object_agg(chain_id, n order by chain_id)
                                     from (select chain_id, count(*) as n from public.venues
                                            where status = 'active' and chain_id is not null
                                            group by chain_id) s), '{}'::jsonb),
    'rows_by_source',    coalesce((select jsonb_object_agg(source, n order by source)
                                     from (select source, count(*) as n from public.venue_bevs group by source) s),
                                  '{}'::jsonb),
    'pinned',            (select count(*) from public.venues v
                           where v.status = 'active'
                             and exists (select 1 from public.venue_bevs vb
                                           join public.bevs b on b.id = vb.bev_id and b.status = 'active'
                                          where vb.venue_id = v.id)),
    'pinned_for_minors', (select count(*) from public.venues v
                           where v.status = 'active'
                             and exists (select 1 from public.venue_bevs vb
                                           join public.bevs b on b.id = vb.bev_id and b.status = 'active'
                                           join public.categories c on c.id = b.category_id
                                          where vb.venue_id = v.id and not c.is_alcoholic))
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: the service role only
-- ---------------------------------------------------------------------------
-- As 20261023000300 section 3: Supabase's default privileges grant EXECUTE to
-- anon, authenticated and service_role on every new function in `public`, and
-- revoking from PUBLIC does not remove those, so each role is named.
alter function public.import_venues(jsonb)            owner to postgres;
alter function public.upsert_chains(jsonb)            owner to postgres;
alter function public.apply_venue_menus(jsonb)        owner to postgres;
alter function public.expand_chain_assortments()      owner to postgres;
alter function public.venue_sync_report()             owner to postgres;

revoke execute on function
  public.import_venues(jsonb),
  public.upsert_chains(jsonb),
  public.apply_venue_menus(jsonb),
  public.expand_chain_assortments(),
  public.venue_sync_report()
from public, anon, authenticated;

grant execute on function
  public.import_venues(jsonb),
  public.upsert_chains(jsonb),
  public.apply_venue_menus(jsonb),
  public.expand_chain_assortments(),
  public.venue_sync_report()
to service_role;
