-- A-08 half 1 (20261102000300): the venues schema -- the NYC bounds, the
-- generated point and its GiST index, the upsert key, and RLS with no policy.
--
-- In order: (1) shape, indexes and RLS, which is the access model -- no client
-- role may read a venue, because half 2 reads through a definer RPC; (2) the
-- NYC bounding box, on all four edges plus a point inside; (3) the other
-- constraints that keep the import honest (the osm_id format and its pairing
-- with `source`, `hours_known` needing a string, the three vocabularies);
-- (4) the viewport predicate half 2 will use, run against real rows, because
-- an index that exists and a predicate that selects the right venues are two
-- different claims.
--
-- Half 2's DoD (the zoom cap, `explain analyze` under 150 ms) is NOT here:
-- there is no RPC yet to cap or to measure.
--
-- Fixture uuid prefix: ...0000000a08NN ("a08" for the task). Checked against
-- every other file in supabase/tests/: a1, b1..b2, c1..c3, d1..d6, e1..e3,
-- f1..f4, ffff, ff01..ff14, dead, a14NN, a16NN, ab0NN, be0NN, c13NN, ca0NN,
-- d11aNNN, d12NN, ed0NN, ed7aNNN, 23NN, 024xxx. a08NN collides with none.
--
-- The venues: a0801 is on the Upper East Side (inside the box and inside the
-- test viewport), a0802 is on Staten Island (inside the box, outside the
-- viewport), a0803 is a chain branch with an assortment, a0804 is hidden.
begin;
select plan(47);

-- ---------------------------------------------------------------------------
-- 1. Shape, indexes and RLS
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.venues') is not null, 'venues exists');
select ok(to_regclass('public.chains') is not null, 'chains exists');
select ok(to_regclass('public.venue_bevs') is not null, 'venue_bevs exists');

select ok((select relrowsecurity from pg_class where oid = 'public.venues'::regclass),
          'RLS is enabled on venues');
select ok((select relrowsecurity from pg_class where oid = 'public.chains'::regclass),
          'RLS is enabled on chains');
select ok((select relrowsecurity from pg_class where oid = 'public.venue_bevs'::regclass),
          'RLS is enabled on venue_bevs');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('venues', 'chains', 'venue_bevs')),
  0,
  'none of the three has a policy: no client role reads or writes a venue directly (half 2 uses a definer RPC)'
);

-- The generated column and the index that makes the viewport query cheap.
select ok(
  (select is_generated = 'ALWAYS' from information_schema.columns
    where table_schema = 'public' and table_name = 'venues' and column_name = 'geo'),
  'venues.geo is a generated column, so it cannot drift from lat/lng'
);

select ok(
  exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_am am on am.oid = (select relam from pg_class where oid = i.indexrelid)
     where i.indrelid = 'public.venues'::regclass
       and am.amname = 'gist'
       and c.relname = 'venues_geo_gist'
  ),
  'venues_geo_gist is a GiST index'
);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into public.venues (id, name, kind, lat, lng, neighborhood, borough, source)
values ('00000000-0000-4000-8000-0000000a0801', 'pgTAP UES Coffee', 'craft',
        40.7736, -73.9566, 'Upper East Side', 'Manhattan', 'manual'),
       ('00000000-0000-4000-8000-0000000a0802', 'pgTAP Staten Deli', 'craft',
        40.5795, -74.1502, 'St. George', 'Staten Island', 'manual');

insert into public.venues (id, name, kind, osm_id, lat, lng, neighborhood, borough, source,
                           hours_osm, hours_known)
values ('00000000-0000-4000-8000-0000000a0803', 'pgTAP Duane Reade', 'chain', 'node/1234567',
        40.7700, -73.9600, 'Upper East Side', 'Manhattan', 'osm', 'Mo-Su 08:00-22:00', true);

insert into public.venues (id, name, kind, lat, lng, source, status)
values ('00000000-0000-4000-8000-0000000a0804', 'pgTAP Hidden Bar', 'craft',
        40.7710, -73.9590, 'manual', 'hidden');

select is((select count(*)::int from public.venues where name like 'pgTAP %'), 4,
          'fixture: four venues');

-- geo is (lng, lat), the order box() and every mapping API expect.
select is(
  (select geo from public.venues where id = '00000000-0000-4000-8000-0000000a0801'),
  point(-73.9566, 40.7736),
  'geo is point(lng, lat), not point(lat, lng)'
);

-- ---------------------------------------------------------------------------
-- 2. The NYC bounding box (decision 36), on all four edges
-- ---------------------------------------------------------------------------
-- The same six figures are in shared/NYC_BOUNDS (half 2) and in the Overpass
-- clip. If this section is edited, those move too.

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Too South', 'craft', 40.476, -73.95, 'manual') $$,
  '23514',
  null,
  'a latitude below 40.477 is rejected (south of the city)'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Too North', 'craft', 40.919, -73.95, 'manual') $$,
  '23514',
  null,
  'and above 40.918 (north of it)'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Too West', 'craft', 40.75, -74.261, 'manual') $$,
  '23514',
  null,
  'a longitude below -74.260 is rejected (west, into New Jersey)'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Too East', 'craft', 40.75, -73.699, 'manual') $$,
  '23514',
  null,
  'and above -73.700 (east, into Nassau)'
);

select lives_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP On The Corner', 'craft', 40.477, -74.260, 'manual') $$,
  'the corner of the box itself is inside it: the CHECK is inclusive'
);

-- A venue cannot be moved out of the city either, not just inserted outside.
select throws_ok(
  $$ update public.venues set lat = 41.0
      where id = '00000000-0000-4000-8000-0000000a0801' $$,
  '23514',
  null,
  'the bounds hold on UPDATE too, so a venue cannot be dragged out of the city'
);

-- ---------------------------------------------------------------------------
-- 3. The constraints that keep the import honest
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.venues (name, kind, osm_id, lat, lng, source)
     values ('pgTAP Bad OSM Id', 'craft', '1234567', 40.75, -73.95, 'osm') $$,
  '23514',
  null,
  'an osm_id without its element type is rejected: ids are only unique within node/way/relation'
);

select throws_ok(
  $$ insert into public.venues (name, kind, osm_id, lat, lng, source)
     values ('pgTAP Manual With OSM Id', 'craft', 'node/999', 40.75, -73.95, 'manual') $$,
  '23514',
  null,
  'a manual venue cannot carry an osm_id, so "never overwrite a manual row" stays decidable from the row'
);

select throws_ok(
  $$ insert into public.venues (id, name, kind, osm_id, lat, lng, source)
     values ('00000000-0000-4000-8000-0000000a0899', 'pgTAP Duplicate OSM', 'chain',
             'node/1234567', 40.75, -73.95, 'osm') $$,
  '23505',
  null,
  'osm_id is unique, which is what lets the import upsert by it'
);

select lives_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP No OSM Id A', 'craft', 40.5800, -74.1500, 'manual'),
            ('pgTAP No OSM Id B', 'craft', 40.5900, -74.1400, 'manual') $$,
  'but the unique index is partial, so many venues may have no osm_id'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source, hours_known)
     values ('pgTAP Hours Lie', 'craft', 40.75, -73.95, 'manual', true) $$,
  '23514',
  null,
  'hours_known cannot be true with no hours string: "Hours unknown" is one column to read'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Bad Kind', 'pub', 40.75, -73.95, 'manual') $$,
  '23514',
  null,
  'kind is chain or craft'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source)
     values ('pgTAP Bad Source', 'craft', 40.75, -73.95, 'google') $$,
  '23514',
  null,
  'source is osm or manual: Google Places was rejected for the map (decision 35)'
);

select throws_ok(
  $$ insert into public.venues (name, kind, lat, lng, source, borough)
     values ('pgTAP Bad Borough', 'craft', 40.75, -73.95, 'manual', 'Jersey City') $$,
  '23514',
  null,
  'borough is one of the five'
);

select throws_ok(
  $$ insert into public.chains (id, name) values ('Duane Reade', 'Duane Reade') $$,
  '23514',
  null,
  'a chain id is a slug, so it can be written into a preset by hand without quoting surprises'
);

-- ---------------------------------------------------------------------------
-- 4. venue_bevs, and what a chain preset expands into
-- ---------------------------------------------------------------------------

insert into public.chains (id, name, osm_brands, assortment_bev_ids)
select 'pgtap-duane-reade', 'pgTAP Duane Reade', array['duane reade'],
       array(select b.id from public.bevs b
              where b.category_id = 'soda' and b.status = 'active'
              order by b.name collate "C", b.id limit 3);

select is((select array_length(assortment_bev_ids, 1) from public.chains where id = 'pgtap-duane-reade'),
          3,
          'a chain preset holds its assortment as a uuid[] (no FK into an array -- see the migration header)');

insert into public.venue_bevs (venue_id, bev_id, source)
select '00000000-0000-4000-8000-0000000a0803', unnest(assortment_bev_ids), 'chain'
  from public.chains where id = 'pgtap-duane-reade';

insert into public.venue_bevs (venue_id, bev_id, source, verified_at)
select '00000000-0000-4000-8000-0000000a0801', b.id, 'menu', now()
  from public.bevs b
 where b.category_id = 'coffee' and b.status = 'active'
 order by b.name collate "C", b.id
 limit 2;

select is((select count(*)::int from public.venue_bevs
            where venue_id = '00000000-0000-4000-8000-0000000a0803'),
          3,
          'the preset expands onto the branch as source = chain');

select throws_ok(
  $$ insert into public.venue_bevs (venue_id, bev_id, source)
     select '00000000-0000-4000-8000-0000000a0803', bev_id, 'menu'
       from public.venue_bevs
      where venue_id = '00000000-0000-4000-8000-0000000a0803' limit 1 $$,
  '23505',
  null,
  'a venue carries a Bev at most once'
);

select throws_ok(
  $$ insert into public.venue_bevs (venue_id, bev_id, source)
     values ('00000000-0000-4000-8000-0000000a0801',
             '00000000-0000-4000-8000-00000000dead', 'menu') $$,
  '23503',
  null,
  'bev_id is a real foreign key, unlike the chain preset array'
);

-- D-13: existing without an assortment is normal; it is the pin that needs one.
-- Scoped to the four fixture venues on purpose: sections 2 and 3 add throwaway
-- rows that also have no assortment, and this assertion is about a0802 and
-- a0804, not about how many rows happen to be lying around.
select is(
  (select count(*)::int from public.venues v
    where v.id in ('00000000-0000-4000-8000-0000000a0801',
                   '00000000-0000-4000-8000-0000000a0802',
                   '00000000-0000-4000-8000-0000000a0803',
                   '00000000-0000-4000-8000-0000000a0804')
      and not exists (select 1 from public.venue_bevs vb where vb.venue_id = v.id)),
  2,
  'a venue with no assortment still exists (D-13: it just gets no pin)'
);

select lives_ok(
  $$ delete from public.venues where id = '00000000-0000-4000-8000-0000000a0803' $$,
  'deleting a venue cascades to its assortment'
);

select is((select count(*)::int from public.venue_bevs
            where venue_id = '00000000-0000-4000-8000-0000000a0803'),
          0,
          'and the rows are gone');

-- ---------------------------------------------------------------------------
-- 5. The viewport predicate half 2 will use
-- ---------------------------------------------------------------------------
-- An index that exists and a predicate that selects the right venues are two
-- different claims. This is the second one, on the Upper East Side box D-13
-- starts with.

-- Scoped to the fixture ids, like the D-13 count above. Without the scope this
-- assertion only passes because section 4's cascade test happens to have
-- deleted a0803, which is also inside this box and also active -- so moving or
-- reordering that test would have broken it silently.
select is(
  (select array_agg(v.name order by v.name)
     from public.venues v
    where v.status = 'active'
      and v.id in ('00000000-0000-4000-8000-0000000a0801',
                   '00000000-0000-4000-8000-0000000a0802',
                   '00000000-0000-4000-8000-0000000a0804')
      and v.geo <@ box(point(-73.9800, 40.7600), point(-73.9400, 40.7900))),
  array['pgTAP UES Coffee'],
  'the viewport selects the Upper East Side venue, not the Staten Island one, and not the hidden one inside the box'
);

select is(
  (select count(*)::int from public.venues v
    where v.geo <@ box(point(-74.2600, 40.4770), point(-73.7000, 40.9180))),
  (select count(*)::int from public.venues),
  'the whole-city box contains every venue, which is what the CHECK guarantees'
);

-- ---------------------------------------------------------------------------
-- 6. import_venues: the write path the script actually uses
-- ---------------------------------------------------------------------------
-- This section exists because review found that the first draft's PostgREST
-- upsert could not have executed at all (a partial unique index cannot be
-- inferred as an `on conflict` arbiter -- 42P10) and that nothing here would
-- have caught it. The arbiter and the curation rule are both pinned now.

select ok(to_regprocedure('public.import_venues(jsonb)') is not null,
          'import_venues(jsonb) exists');
select ok(
  not has_function_privilege('authenticated', 'public.import_venues(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.import_venues(jsonb)', 'EXECUTE'),
  'import_venues is not callable by anon or authenticated: the import runs as the service role'
);

select is(
  public.import_venues(jsonb_build_array(jsonb_build_object(
    'osm_id', 'node/777001', 'name', 'pgTAP Imported', 'kind', 'craft',
    'lat', 40.7750, 'lng', -73.9550, 'address', '1 First Avenue',
    'neighborhood', null, 'borough', 'Manhattan',
    'hours_osm', 'Mo-Su 08:00-20:00', 'hours_known', true, 'website', null))),
  1,
  'a new OSM venue is inserted, and the on conflict arbiter resolves (this is the 42P10 case)'
);

-- Curation lands on the row between imports.
update public.venues
   set neighborhood = 'Yorkville', status = 'hidden'
 where osm_id = 'node/777001';

-- The next monthly run: OSM still has no neighbourhood, and a changed name.
select is(
  public.import_venues(jsonb_build_array(jsonb_build_object(
    'osm_id', 'node/777001', 'name', 'pgTAP Imported Renamed', 'kind', 'craft',
    'lat', 40.7751, 'lng', -73.9551, 'address', null,
    'neighborhood', null, 'borough', null,
    'hours_osm', null, 'hours_known', false, 'website', null))),
  1,
  're-importing the same osm_id updates the row rather than inserting a second'
);

select is(
  (select array[name, neighborhood, borough, address, status, hours_osm]
     from public.venues where osm_id = 'node/777001'),
  array['pgTAP Imported Renamed', 'Yorkville', 'Manhattan', '1 First Avenue', 'hidden', 'Mo-Su 08:00-20:00'],
  'OSM improves what it knows (name) and erases nothing it has lost: the curated neighborhood, the borough, the address, the hours and the hand-set status all survive'
);

select is(
  (select lat from public.venues where osm_id = 'node/777001'),
  40.7751,
  'a venue that moved in OSM moves here: lat/lng are OSM''s outright'
);

select throws_ok(
  $$ select public.import_venues(jsonb_build_array(jsonb_build_object(
       'name', 'pgTAP No Id', 'kind', 'craft', 'lat', 40.775, 'lng', -73.955))) $$,
  '22023',
  'BEVI_VALIDATION',
  'a row with no osm_id is refused: the upsert would silently become an insert nothing could find again'
);

select is(public.import_venues('[]'::jsonb), 0,
          'an empty import is 0, not an error: a small bbox with no venues is normal');

select throws_ok(
  $$ select public.import_venues('{"osm_id": "node/1"}'::jsonb) $$,
  '22023',
  'BEVI_VALIDATION',
  'a jsonb object is not an array of rows'
);

-- ---------------------------------------------------------------------------
-- 7. No client role sees a venue
-- ---------------------------------------------------------------------------

set local role authenticated;
-- No policy reads auth.uid() (there are no policies), so the subject only has
-- to be a well-formed uuid that is not one of the fixture venues.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a08f1", "role": "authenticated"}';

select is((select count(*)::int from public.venues), 0,
          'a signed-in client reads no venue at all: RLS is on and there is no policy');
select is((select count(*)::int from public.venue_bevs), 0,
          'nor any assortment');
select is((select count(*)::int from public.chains), 0,
          'nor any chain preset');

reset role;

select * from finish();
rollback;
