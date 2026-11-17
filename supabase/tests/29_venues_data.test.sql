-- A-08, the data pipeline (20261109000200): venues.chain_id, import_venues
-- writing it, and the four service-role writers/readers the sync calls --
-- upsert_chains, apply_venue_menus, expand_chain_assortments and
-- venue_sync_report.
--
-- In order: (1) shape and grants; (2) upsert_chains; (3) import_venues and
-- chain_id; (4) the expansion: unknown / hidden / merged ids ignored, and
-- idempotent; (5) menus upgrade a chain row and the expansion leaves it alone;
-- (6) a Bev removed from a preset leaves its branches, but never a menu row;
-- (7) a chain removed from the file unlinks its branches; (8) menus replace
-- per venue; (9) the report.
--
-- Fixture uuid prefix: ...000000a08cNN ("a08c": A-08, the third file).
-- Checked against every other file in supabase/tests/: a08NN (26), a08bNN
-- (27) and the rest of 27's list. a08cNN collides with none. Fixture osm ids
-- are node/8800NN, which no other file uses.
begin;
select plan(42);

-- ---------------------------------------------------------------------------
-- 1. Shape and grants
-- ---------------------------------------------------------------------------

select ok(
  (select is_nullable = 'YES' and data_type = 'text'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'venues' and column_name = 'chain_id'),
  'venues.chain_id exists, is text and is nullable: most venues are not a branch'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.venues'::regclass
       and contype = 'f'
       and confrelid = 'public.chains'::regclass
       and confdeltype = 'n'
  ),
  'chain_id is a foreign key to chains, on delete set null'
);

select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.venues'::regclass and conname = 'venues_chain_is_chain_kind' and contype = 'c'),
  'venues_chain_is_chain_kind exists'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('venues', 'chains', 'venue_bevs')),
  0,
  'still no policy on the three tables: the pipeline writes through definer functions only'
);

select ok(
  (select bool_and(p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
                   and p.proconfig is not null
                   and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
     from pg_proc p
    where p.oid in ('public.import_venues(jsonb)'::regprocedure,
                    'public.upsert_chains(jsonb)'::regprocedure,
                    'public.apply_venue_menus(jsonb)'::regprocedure,
                    'public.expand_chain_assortments()'::regprocedure,
                    'public.venue_sync_report()'::regprocedure)),
  'all five are security definer, owned by postgres, with search_path set'
);

select ok(
  not has_function_privilege('authenticated', 'public.import_venues(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.upsert_chains(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_venue_menus(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.expand_chain_assortments()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.venue_sync_report()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.import_venues(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.upsert_chains(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_venue_menus(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.expand_chain_assortments()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.venue_sync_report()', 'EXECUTE'),
  'no client role can call any of them'
);

select ok(
  has_function_privilege('service_role', 'public.import_venues(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.upsert_chains(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_venue_menus(jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.expand_chain_assortments()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.venue_sync_report()', 'EXECUTE'),
  'the service role can call all five: it is the sync'
);

-- ---------------------------------------------------------------------------
-- Fixture: Bevs
-- ---------------------------------------------------------------------------
-- Four active seeded sodas and one active alcoholic Bev, as in 27, plus one
-- hidden and one merged Bev and an id that is no Bev at all -- the three
-- kinds of preset id the expansion must ignore.
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select 's' || rn, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'soda' and b.source = 'seed' and b.status = 'active') s
 where rn <= 4;
insert into t_bevs (label, id)
select 'alc', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where c.is_alcoholic and b.status = 'active'
 order by b.name collate "C", b.id
 limit 1;

insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-000000a08c21', 'pgTAP Data Hidden Soda', 'pgTAP', 'soda', 1, 'hidden', 'seed');
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
select '00000000-0000-4000-8000-000000a08c22', 'pgTAP Data Merged Soda', 'pgTAP', 'soda', 1, 'merged', id, 'seed'
  from t_bevs where label = 's2';
insert into t_bevs (label, id) values
  ('hidden', '00000000-0000-4000-8000-000000a08c21'),
  ('merged', '00000000-0000-4000-8000-000000a08c22'),
  ('ghost',  '00000000-0000-4000-8000-000000a08cff');

select is((select count(*)::int from t_bevs), 8, 'fixture: four sodas, one alcoholic Bev, hidden, merged, and a ghost id');

-- The chain presets as the script would send them.
create temporary table t_payload (k text primary key, v jsonb not null) on commit drop;
insert into t_payload (k, v)
select 'two_chains', jsonb_build_array(
  jsonb_build_object(
    'id', 'pgtap-pharm', 'name', 'pgTAP Pharm',
    'osm_brands', jsonb_build_array('PGTAP Pharm', ' pgtap pharm ', ''),
    'bev_ids', (select jsonb_agg(id) from t_bevs where label in ('s1', 's2', 'hidden', 'merged', 'ghost'))),
  jsonb_build_object(
    'id', 'pgtap-cafe', 'name', 'pgTAP Cafe',
    'osm_brands', jsonb_build_array('pgTAP Cafe'),
    'bev_ids', (select jsonb_agg(id) from t_bevs where label = 's3')));

-- ---------------------------------------------------------------------------
-- 2. upsert_chains
-- ---------------------------------------------------------------------------

select is(public.upsert_chains((select v from t_payload where k = 'two_chains')), 2,
          'upsert_chains writes both chains');

select is((select osm_brands from public.chains where id = 'pgtap-pharm'), array['pgtap pharm'],
          'brands are trimmed, lowercased and de-duplicated, and a blank one is dropped');

select is((select cardinality(assortment_bev_ids) from public.chains where id = 'pgtap-pharm'), 5,
          'bev_ids are stored as given, ghost and all: the expansion is where they are resolved');

select throws_ok(
  $$ select public.upsert_chains('[]'::jsonb) $$,
  '22023', 'BEVI_VALIDATION',
  'an empty payload is refused rather than read as "delete every chain"'
);

select throws_ok(
  $$ select public.upsert_chains(jsonb_build_array(
       jsonb_build_object('id', 'pgtap-dup', 'name', 'A', 'osm_brands', '[]'::jsonb, 'bev_ids', '[]'::jsonb),
       jsonb_build_object('id', 'pgtap-dup', 'name', 'B', 'osm_brands', '[]'::jsonb, 'bev_ids', '[]'::jsonb))) $$,
  '22023', 'BEVI_VALIDATION',
  'a duplicate chain id is refused (on conflict cannot touch a row twice)'
);

select throws_ok(
  $$ select public.upsert_chains(jsonb_build_array(jsonb_build_object('id', 'pgtap-x', 'name', 'X'))) $$,
  '22023', 'BEVI_VALIDATION',
  'a chain without osm_brands and bev_ids is refused'
);

-- ---------------------------------------------------------------------------
-- 3. import_venues writes chain_id, and kind follows it
-- ---------------------------------------------------------------------------

select is(
  public.import_venues(jsonb_build_array(
    jsonb_build_object('osm_id', 'node/880001', 'name', 'pgTAP Pharm 1', 'kind', 'craft', 'chain_id', 'pgtap-pharm',
                       'lat', 40.7700, 'lng', -73.9550, 'neighborhood', 'Lenox Hill', 'borough', 'Manhattan'),
    jsonb_build_object('osm_id', 'node/880002', 'name', 'pgTAP Pharm 2', 'kind', 'chain', 'chain_id', 'pgtap-pharm',
                       'lat', 40.7790, 'lng', -73.9500, 'neighborhood', 'Yorkville', 'borough', 'Manhattan'),
    jsonb_build_object('osm_id', 'node/880003', 'name', 'pgTAP Craft', 'kind', 'craft', 'chain_id', null,
                       'lat', 40.7621, 'lng', -73.9497, 'neighborhood', 'Roosevelt Island', 'borough', 'Manhattan'),
    jsonb_build_object('osm_id', 'node/880004', 'name', 'pgTAP Stale Chain', 'kind', 'craft', 'chain_id', 'no-such-chain',
                       'lat', 40.7750, 'lng', -73.9560))),
  4,
  'four venues imported'
);

select is(
  (select array_agg(osm_id || ' ' || kind || ' ' || coalesce(chain_id, '-') order by osm_id)
     from public.venues where osm_id like 'node/8800%'),
  array['node/880001 chain pgtap-pharm', 'node/880002 chain pgtap-pharm', 'node/880003 craft -', 'node/880004 craft -'],
  'a chain_id makes the venue a chain whatever the payload kind said, and an unknown chain id becomes null rather than failing the batch'
);

select throws_ok(
  $$ insert into public.venues (name, kind, chain_id, lat, lng, source)
     values ('pgTAP Craft Branch', 'craft', 'pgtap-cafe', 40.77, -73.95, 'manual') $$,
  '23514', null,
  'a branch of a chain must be kind = chain (venues_chain_is_chain_kind)'
);

-- ---------------------------------------------------------------------------
-- 4. expand_chain_assortments: ignores what is not an active Bev; idempotent
-- ---------------------------------------------------------------------------

select is(public.expand_chain_assortments(), '{"inserted": 4, "deleted": 0}'::jsonb,
          'two branches x the two ACTIVE Bevs of the preset: the hidden, merged and ghost ids are ignored');

select is(
  (select array_agg(vb.bev_id order by vb.bev_id) from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001' and vb.source = 'chain'),
  (select array_agg(id order by id) from t_bevs where label in ('s1', 's2')),
  'the branch carries exactly the preset''s active Bevs, as source = chain'
);

select is(
  (select count(*)::int from public.venue_bevs
    where bev_id in (select id from t_bevs where label in ('hidden', 'merged'))),
  0,
  'no venue carries the hidden or the merged Bev'
);

select is(public.expand_chain_assortments(), '{"inserted": 0, "deleted": 0}'::jsonb,
          'a second run changes nothing: the expansion is idempotent');

-- ---------------------------------------------------------------------------
-- 5. Menus upgrade a chain row; the expansion then leaves it alone
-- ---------------------------------------------------------------------------

select is(
  public.apply_venue_menus(jsonb_build_array(
    jsonb_build_object('osm_id', 'node/880003', 'bev_id', (select id from t_bevs where label = 's3'), 'verified_at', '2026-11-01'),
    jsonb_build_object('osm_id', 'node/880001', 'bev_id', (select id from t_bevs where label = 's1'), 'verified_at', '2026-11-02'),
    jsonb_build_object('osm_id', 'node/880001', 'bev_id', (select id from t_bevs where label = 'alc'), 'verified_at', null),
    jsonb_build_object('osm_id', 'node/880001', 'bev_id', (select id from t_bevs where label = 'alc'), 'verified_at', null),
    jsonb_build_object('osm_id', 'node/999999', 'bev_id', (select id from t_bevs where label = 's1'), 'verified_at', null),
    jsonb_build_object('osm_id', 'node/880003', 'bev_id', '00000000-0000-4000-8000-000000a08cff', 'verified_at', null))),
  '{"upserted": 3, "deleted": 0, "unknown_venues": ["node/999999"], "unknown_bevs": ["00000000-0000-4000-8000-000000a08cff"]}'::jsonb,
  'three menu rows (a repeated line is one); the unknown venue and the unknown Bev are reported and skipped, not fatal'
);

select is(
  (select vb.source || ' ' || vb.verified_at::date::text from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001' and vb.bev_id = (select id from t_bevs where label = 's1')),
  'menu 2026-11-02',
  'a Bev the branch had from its chain is upgraded to a menu row, with the menu''s verified_at'
);

select is(
  (select count(*)::int from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001' and vb.bev_id = (select id from t_bevs where label = 'alc') and vb.source = 'menu'),
  1,
  'a menu may list an alcoholic Bev (the read RPCs'' age gate hides it from a minor)'
);

select is(public.expand_chain_assortments(), '{"inserted": 0, "deleted": 0}'::jsonb,
          'the expansion neither re-inserts nor deletes the upgraded row');

select is(
  (select vb.source from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001' and vb.bev_id = (select id from t_bevs where label = 's1')),
  'menu',
  'and it is still a menu row'
);

-- ---------------------------------------------------------------------------
-- 6. A Bev removed from the preset leaves the branches -- but not a menu row
-- ---------------------------------------------------------------------------

select is(
  public.upsert_chains(jsonb_build_array(
    jsonb_build_object('id', 'pgtap-pharm', 'name', 'pgTAP Pharm', 'osm_brands', jsonb_build_array('pgtap pharm'),
                       'bev_ids', (select jsonb_agg(id) from t_bevs where label in ('s2', 's4'))),
    jsonb_build_object('id', 'pgtap-cafe', 'name', 'pgTAP Cafe', 'osm_brands', jsonb_build_array('pgtap cafe'),
                       'bev_ids', (select jsonb_agg(id) from t_bevs where label = 's3')))),
  2,
  'the preset is edited: s1 out, s4 in'
);

-- node/880002 loses its chain s1 and gains s4; node/880001 gains s4, and its
-- s1 is a menu row, which the expansion does not delete.
select is(public.expand_chain_assortments(), '{"inserted": 2, "deleted": 1}'::jsonb,
          's4 is added to both branches and s1 removed from the one that had it as a chain row');

select is(
  (select array_agg(vb.bev_id order by vb.bev_id) from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880002'),
  (select array_agg(id order by id) from t_bevs where label in ('s2', 's4')),
  'the plain branch now carries exactly the new preset'
);

select is(
  (select vb.source from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001' and vb.bev_id = (select id from t_bevs where label = 's1')),
  'menu',
  'the menu row for s1 survives its removal from the preset'
);

-- ---------------------------------------------------------------------------
-- 7. A chain removed from the file unlinks its branches
-- ---------------------------------------------------------------------------

select is(
  public.upsert_chains(jsonb_build_array(
    jsonb_build_object('id', 'pgtap-cafe', 'name', 'pgTAP Cafe', 'osm_brands', jsonb_build_array('pgtap cafe'),
                       'bev_ids', (select jsonb_agg(id) from t_bevs where label = 's3')))),
  1,
  'the file now holds one chain'
);

select is((select count(*)::int from public.chains where id = 'pgtap-pharm'), 0,
          'the chain missing from the payload is deleted: the file is the whole truth');

select is(
  (select count(*)::int from public.venues where osm_id in ('node/880001', 'node/880002') and chain_id is null),
  2,
  'its branches'' chain_id went null through the foreign key'
);

select is(public.expand_chain_assortments(), '{"inserted": 0, "deleted": 4}'::jsonb,
          'and the expansion removes their four chain rows');

select is(
  (select array_agg(vb.source order by vb.source) from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880001'),
  array['menu', 'menu'],
  'what is left on the former branch is exactly its two menu rows'
);

-- ---------------------------------------------------------------------------
-- 8. Menus replace per venue, and only for the venues they name
-- ---------------------------------------------------------------------------

select is(
  public.apply_venue_menus(jsonb_build_array(
    jsonb_build_object('osm_id', 'node/880001', 'bev_id', (select id from t_bevs where label = 'alc'), 'verified_at', null))),
  '{"upserted": 1, "deleted": 1, "unknown_venues": [], "unknown_bevs": []}'::jsonb,
  'a line deleted from the CSV deletes that menu row for that venue'
);

select is(
  (select count(*)::int from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880003' and vb.source = 'menu'),
  1,
  'a venue the payload does not name keeps its menu'
);

select is(public.apply_venue_menus('[]'::jsonb),
          '{"upserted": 0, "deleted": 0, "unknown_venues": [], "unknown_bevs": []}'::jsonb,
          'an empty menus.csv changes nothing');

select throws_ok(
  $$ select public.apply_venue_menus('{"osm_id": "node/880001"}'::jsonb) $$,
  '22023', 'BEVI_VALIDATION',
  'a jsonb object is not an array of rows'
);

-- ---------------------------------------------------------------------------
-- 9. The report
-- ---------------------------------------------------------------------------

select ok(
  public.venue_sync_report() ?& array['venues_active', 'with_neighborhood', 'with_borough', 'chain_branches',
                                       'rows_by_source', 'pinned', 'pinned_for_minors'],
  'venue_sync_report carries every count the sync prints'
);

-- node/880001's only Bev is now the alcoholic one: a pin for an adult, none for a minor.
select ok(
  (public.venue_sync_report() ->> 'pinned')::int - (public.venue_sync_report() ->> 'pinned_for_minors')::int >= 1,
  'pinned_for_minors leaves out a venue whose whole assortment is alcoholic, as venues_in_view does'
);

-- ---------------------------------------------------------------------------
-- 10. A chain preset never expands an alcoholic Bev, even if one gets in
-- ---------------------------------------------------------------------------

select public.upsert_chains(jsonb_build_array(
  jsonb_build_object('id', 'pgtap-alc', 'name', 'pgTAP Alc', 'osm_brands', jsonb_build_array('pgTAP Alc'),
                     'bev_ids', (select jsonb_agg(id) from t_bevs where label in ('alc', 's4')))));
update public.venues set chain_id = 'pgtap-alc', kind = 'chain' where osm_id = 'node/880003';
select public.expand_chain_assortments();

select is(
  (select array_agg(vb.bev_id order by vb.bev_id) from public.venue_bevs vb
     join public.venues v on v.id = vb.venue_id
    where v.osm_id = 'node/880003' and vb.source = 'chain'),
  (select array_agg(id) from t_bevs where label = 's4'),
  'the expansion skips an alcoholic Bev in a preset and keeps the rest'
);

select * from finish();
rollback;
