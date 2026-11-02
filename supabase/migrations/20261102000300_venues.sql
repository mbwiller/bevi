-- =====================================================================
-- 20261102000300 · venues (A-08, half 1: the data)
-- =====================================================================
-- Venues, chain assortment presets, and the venue -> Bev join. Half 1 of
-- S-10 + A-08: tables, constraints, indexes and RLS only. NOTHING READS THIS
-- YET -- the contract (`VenuesApi`, `Venue`, `VenuePin`, `NYC_BOUNDS` in
-- `shared/`) and the read RPCs (`venues_in_view`, `venue_detail`,
-- `neighborhoods`) are half 2, which is also where `packages/api` and the
-- FakeApi gain anything. Splitting it follows A-16 (1)'s precedent: the rows
-- exist and have been looked at before a single client path depends on them.
--
-- SCOPE, after the 2026-10-19 removals (TASKS.md A-08): no `rankings.venue_id`
-- and no S-16, so a venue never carries "where you had it". `venues_in_view`
-- in half 2 drops the viewer's-best-score and friends filters, and
-- `venues_search(q, lat, lng)` is not needed at all, because the ranking step
-- that would have called it was removed. That last removal is why this
-- migration needs no distance search -- see the next paragraph.
--
-- NO POSTGIS, DELIBERATELY. PostGIS 3.3.7 is available on the project but is
-- not installed, and installing it adds a large catalog of types, operators
-- and functions to `public`'s neighbourhood for one thing we would use: a
-- spatial index. What the map actually asks is a BOUNDING-BOX question -- "the
-- venues inside the rectangle currently on screen" -- which core Postgres
-- answers with the built-in `point` type and a GiST index, via the `<@`
-- (point contained in box) operator of `point_ops`. Distance ranking is the
-- case that would want geography, and the trimmed scope has no caller for it.
-- If a later feature needs real distance (nearest venue, "within 500 m"),
-- that is the moment to add PostGIS and migrate `geo` to
-- `geography(Point, 4326)`; this header is the note to its author.
--
-- STRICTLY NEW YORK CITY (decision 36). The CHECK below is the five-borough
-- bounding box: lat 40.477 .. 40.918, lng -74.260 .. -73.700. Those six
-- figures appear in three places on purpose, and all three must agree:
--   * this CHECK, which is what the database will not let anyone violate;
--   * `NYC_BOUNDS` in `shared/`, arriving in half 2, which is what the app's
--     Google Maps `restriction` uses -- so the map cannot pan to a region
--     where a venue could not legally exist;
--   * the Overpass import's clip, `area(3600175905)` (the New York City
--     relation), in `scripts/venues/import-osm.ts`.
-- The box is the whole city even though D-13 starts curation with the Upper
-- East Side and Roosevelt Island: the starting area is a property of which
-- rows we choose to insert, not of what the schema permits, so growing the
-- coverage later needs no migration.
--
-- NO CLIENT POLICY ON ANY OF THE THREE TABLES, which is the same decision
-- `user_neighbors` took in 20261026000300 and for the same reason: half 2
-- reads through a `security definer` RPC that returns pins, so a direct
-- `select` policy would hand every signed-in client the entire venue table
-- (including venues with no assortment, which get no pin) and buy nothing.
-- RLS is enabled with no policy, so `anon` and `authenticated` see nothing;
-- the import script writes as the service role.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. venues
-- ---------------------------------------------------------------------------
create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  -- 'chain' gets its assortment from a `chains` preset; 'craft' is curated by
  -- hand (a coffee bar's menu). The map filters on it (`p_kinds`).
  kind          text not null check (kind in ('chain', 'craft')),
  -- OpenStreetMap's element id, as "node/1234" or "way/1234" -- the type
  -- prefix matters, because ids are only unique within a type. Null for a
  -- venue we added ourselves. Unique where present, so the import can upsert.
  osm_id        text check (osm_id ~ '^(node|way|relation)/[0-9]+$'),
  lat           double precision not null,
  lng           double precision not null,
  -- (lng, lat), i.e. (x, y): the order every mapping API uses, and the order
  -- `box(point, point)` expects, so half 2's viewport predicate reads
  -- naturally. Generated, so it cannot drift from lat/lng.
  geo           point generated always as (point(lng, lat)) stored,
  address       text check (char_length(address) <= 200),
  -- OSM's `addr:suburb` / our own curation. Half 2's `neighborhoods()` reads
  -- the distinct non-null values, so the filter's vocabulary is whatever the
  -- data actually holds rather than a list to maintain.
  neighborhood  text check (char_length(neighborhood) <= 80),
  borough       text check (borough in ('Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island')),
  -- OSM's `opening_hours` verbatim, unparsed. `hours_known` is NOT
  -- `hours_osm is not null`: it also goes false when the string is present but
  -- we could not evaluate it, so "Hours unknown" in the UI is one column to
  -- read rather than a parse attempt per pin. Decision: Open now is
  -- best-effort (A-08), because OSM hours in NYC are patchy.
  hours_osm     text check (char_length(hours_osm) <= 200),
  hours_known   boolean not null default false,
  website       text check (char_length(website) <= 300),
  source        text not null check (source in ('osm', 'manual')),
  status        text not null default 'active' check (status in ('active', 'hidden')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- The five-borough box (decision 36). See the header: the same six figures
  -- live in `shared/NYC_BOUNDS` (half 2) and in the Overpass clip.
  constraint venues_nyc_bounds check (
    lat between 40.477 and 40.918 and lng between -74.260 and -73.700
  ),
  -- An OSM row is only ever rewritten by the import; a manual row is never
  -- overwritten by it (A-08). That rule lives in the script, but pairing it
  -- with the id here makes the intent legible from the schema.
  constraint venues_osm_id_requires_osm_source check (osm_id is null or source = 'osm'),
  -- `hours_known` promises the string is evaluable, so it cannot be true
  -- without one.
  constraint venues_hours_known_needs_hours check (not hours_known or hours_osm is not null)
);

-- The viewport index: `geo <@ box(point(west, south), point(east, north))`.
create index venues_geo_gist on public.venues using gist (geo) where status = 'active';
-- TOTAL, not partial. A plain unique btree already treats NULLs as distinct,
-- so many venues may still have no osm_id -- and a PARTIAL unique index cannot
-- be inferred as an `on conflict (osm_id)` arbiter unless the statement repeats
-- its predicate, which is error 42P10. `import_venues` below conflicts on this
-- column, so the index has to be inferrable. (Found by review before the
-- import was ever run against the schema.)
create unique index venues_osm_id_uq on public.venues (osm_id);
create index venues_neighborhood_idx on public.venues (neighborhood)
  where status = 'active' and neighborhood is not null;

comment on table public.venues is
  'A-08: NYC venues, imported from OpenStreetMap (ODbL, "(c) OpenStreetMap contributors") plus our own curation. Kept separable from the assortments and scores in venue_bevs so the share-alike obligation, if ever invoked, covers this table only. RLS on with no policy: half 2 reads through a definer RPC.';

comment on column public.venues.geo is
  '(lng, lat) as a core `point`, for the GiST viewport index. Not PostGIS: the question is bounding-box containment, not distance -- see the migration header.';

-- ---------------------------------------------------------------------------
-- 2. chains
-- ---------------------------------------------------------------------------
-- Duane Reade / CVS / Target / 7-Eleven / Whole Foods carry a fixed subset, so
-- the assortment is a property of the brand, not of the shop (decision 33).
-- A new branch therefore has pins the moment it is imported, with nobody
-- typing a menu.
--
-- `assortment_bev_ids` is a denormalised uuid[] rather than a join table,
-- which is the one place this schema trades referential integrity for fit:
-- Postgres cannot FK into an array, so a Bev deleted outright would leave a
-- dangling id. That is acceptable here because a Bev is never hard-deleted --
-- `merge_bev` sets `status = 'merged'` and keeps the row (20261101000500) --
-- and because `venue_bevs` is the resolved truth that half 2's RPCs read. A
-- chain preset is an input to curation, not a read path.
create table public.chains (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name        text not null check (char_length(name) between 1 and 80),
  -- The OSM `brand` values that identify a branch of this chain, lowercased.
  -- The import matches on these to set `kind = 'chain'`.
  osm_brands  text[] not null default '{}'::text[],
  assortment_bev_ids uuid[] not null default '{}'::uuid[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.chains is
  'A-08: chain assortment presets (decision 33). assortment_bev_ids is a uuid[] on purpose -- see the migration header for why no FK, and why venue_bevs rather than this table is what the read RPCs use.';

-- ---------------------------------------------------------------------------
-- 3. venue_bevs
-- ---------------------------------------------------------------------------
-- What a venue actually carries, resolved: a craft spot's menu row by row, or
-- a chain preset expanded onto a branch. `source` records which, so a later
-- preset change can re-expand the chain rows without touching a hand-entered
-- menu.
--
-- D-13: a venue with no row here gets NO PIN, even though it exists. That is
-- the rule half 2's `venues_in_view` enforces, and it is why the import can
-- bring in every cafe in the city without the map filling with blanks.
create table public.venue_bevs (
  venue_id    uuid not null references public.venues(id) on delete cascade,
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  source      text not null check (source in ('menu', 'chain')),
  -- When a human last confirmed it, which is what makes an assortment
  -- trustworthy enough to show a score against. Null = never confirmed.
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  primary key (venue_id, bev_id)
);

create index venue_bevs_bev_idx on public.venue_bevs (bev_id);

comment on table public.venue_bevs is
  'A-08: the Bevs a venue carries. D-13: a venue with no row here gets no pin. source distinguishes a hand-entered menu from an expanded chain preset.';

-- ---------------------------------------------------------------------------
-- 4. RLS: on, with no policy at all
-- ---------------------------------------------------------------------------
-- As `user_neighbors` (20261026000300) and `ranking_events`
-- (20261101000200): enabled, no policy, so no client role reads or writes a
-- row directly. The import runs as the service role; half 2's RPCs are
-- `security definer`.
alter table public.venues     enable row level security;
alter table public.chains     enable row level security;
alter table public.venue_bevs enable row level security;

-- ---------------------------------------------------------------------------
-- 5. import_venues(p_rows jsonb) -> integer
-- ---------------------------------------------------------------------------
-- The import's single write step. Modelled on `replace_bev_edges`
-- (20261023000300): the script does the network and the parsing, and the one
-- thing PostgREST cannot express goes in a definer function.
--
-- WHY NOT A POSTGREST UPSERT, which is what the first draft did:
--
-- 1. IT COULD NOT RUN. PostgREST emits `on conflict (osm_id) do update` with
--    no index predicate, and Postgres refuses to infer a PARTIAL unique index
--    as an arbiter unless the statement repeats the predicate -- error 42P10.
--    The index above is total now, so that specific trap is gone either way.
--
-- 2. IT WOULD HAVE ERASED CURATION. `resolution=merge-duplicates` assigns
--    every column in the payload from EXCLUDED, and the payload carries
--    explicit nulls. OSM has no `addr:suburb` for any venue in the starting
--    area (0 of 410 on the first real run), so the plan is to fill
--    `neighborhood` and `borough` from NYC Open Data's Neighborhood
--    Tabulation Areas -- and the next monthly re-import would have set both
--    back to null. The thing half 2 is told to build is the thing the import
--    would have undone.
--
-- THE RULE HERE: OSM may improve a value, never erase one. Every nullable
-- column OSM supplies is `coalesce(new, existing)`, so a better OSM value
-- wins and a disappearing one leaves curation standing. `name`, `kind`, `lat`
-- and `lng` are OSM's outright -- they are never null in a parsed row, and a
-- venue that moved or was renamed should move and be renamed.
--
-- NOT TOUCHED AT ALL, so curation and moderation survive every run: `id`,
-- `status` (a venue hidden by hand stays hidden), `created_at`, and every row
-- of `venue_bevs`. A manual venue is unreachable from here: it has
-- `osm_id is null` (the CHECK above pairs that with `source`), and the
-- conflict is on `osm_id`.
--
-- `hours_known` moves with `hours_osm` as a pair. Taking one from OSM and
-- keeping the other would let the flag describe a string that is no longer
-- there, which is the one way this table can lie to the UI.
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

  -- Every row must carry the conflict key, or the upsert silently becomes an
  -- insert of a row no later run can find again.
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
      (osm_id, name, kind, lat, lng, address, neighborhood, borough,
       hours_osm, hours_known, website, source)
    select i.osm_id, i.name, i.kind, i.lat, i.lng, i.address, i.neighborhood, i.borough,
           i.hours_osm, i.hours_known, i.website, 'osm'
      from incoming i
    on conflict (osm_id) do update set
      name         = excluded.name,
      kind         = excluded.kind,
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

alter function public.import_venues(jsonb) owner to postgres;
revoke execute on function public.import_venues(jsonb) from public, anon, authenticated;
