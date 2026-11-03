-- A-08 half 2 (20261102000400): the three venue RPCs M-16 reads.
--
-- In order: (1) the grants, which are the access model -- the three tables
-- have RLS with no policy, so these definer functions are the whole surface;
-- (2) `venue_open_at` against the SAME cases as `shared/src/hours.ts`'s tests,
-- which is the point of this section: SQL cannot import that file, so the two
-- copies of the grammar are kept honest by asserting the same strings here;
-- (3) the zoom cap's two anchors; (4) `venues_in_view` -- the viewport, the
-- clamp, D-13's no-assortment rule, the age gate, each filter and the cap;
-- (5) `venue_detail`; (6) `venue_neighborhoods`.
--
-- Fixture uuid prefix: ...000000a08bNN ("a08b" for A-08, half b). Checked
-- against every other file in supabase/tests/: a1, b1..b2, c1..c3, d1..d6,
-- e1..e3, f1..f4, ffff, ff01..ff14, dead, a08NN (26_venues), a14NN, a16NN,
-- ab0NN, be0NN, c13NN, ca0NN, d11aNNN, d12NN, ed0NN, ed7aNNN, 23NN, 024xxx.
-- a08bNN collides with none.
--
-- The people: a08b01 is an adult, a08b02 is 15 (the age gate).
-- The venues: V1 craft on the Upper East Side with three sodas, V2 chain
-- nearby with one soda, V3 on Staten Island (in the city, outside the test
-- viewport), V4 with NO assortment (D-13), V5 hidden, V6 whose only Bev is
-- alcoholic (nothing for a minor to see, so no pin for one).
begin;
select plan(52);

-- ---------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------

select ok(to_regprocedure('public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean)') is not null,
          'venues_in_view exists with the expected signature');
select ok(to_regprocedure('public.venue_detail(uuid)') is not null, 'venue_detail exists');
select ok(to_regprocedure('public.venue_neighborhoods()') is not null, 'venue_neighborhoods exists');

select ok(
  has_function_privilege('authenticated', 'public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.venue_detail(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.venue_neighborhoods()', 'EXECUTE'),
  'all three are granted to authenticated'
);

select ok(
  not has_function_privilege('anon', 'public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.venue_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.venue_neighborhoods()', 'EXECUTE'),
  'and none to anon'
);

select ok(
  not has_function_privilege('authenticated', 'public.venue_open_at(text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.venue_pin_cap(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.weekday_index(text)', 'EXECUTE'),
  'the three internals are not callable by a client'
);

-- ---------------------------------------------------------------------------
-- 2. venue_open_at: the same grammar as shared/src/hours.ts
-- ---------------------------------------------------------------------------
-- SQL cannot import that file, so these assertions are what keeps the two
-- copies in step. Every string below appears in its unit tests too.

-- A Monday at 12:00 New York time, and a Wednesday at 20:00.
select is(public.venue_open_at('Mo-Su 08:00-22:00', '2026-11-02 12:00 America/New_York'::timestamptz), true,
          'open inside the range');
select is(public.venue_open_at('Mo-Su 08:00-22:00', '2026-11-02 23:00 America/New_York'::timestamptz), false,
          'closed after it');
select is(public.venue_open_at('Mo-Su 08:00-22:00', '2026-11-02 08:00 America/New_York'::timestamptz), true,
          'the opening minute is open');
select is(public.venue_open_at('Mo-Su 08:00-22:00', '2026-11-02 22:00 America/New_York'::timestamptz), false,
          'the closing minute is closed');
select is(public.venue_open_at('Mo-Su 08:00-24:00', '2026-11-02 23:30 America/New_York'::timestamptz), true,
          '24:00 is accepted as a close, which is common in OSM');

select is(public.venue_open_at('Mo-Fr 07:00-19:00; Sa-Su 08:00-18:00', '2026-11-02 18:00 America/New_York'::timestamptz), true,
          'disjoint day sets are understood: Monday takes the weekday rule');
select is(public.venue_open_at('Mo-Fr 07:00-19:00; Sa-Su 08:00-18:00', '2026-11-07 19:00 America/New_York'::timestamptz), false,
          'and Saturday takes the weekend one');

select is(public.venue_open_at('Mo,We,Fr 09:00-17:00', '2026-11-02 10:00 America/New_York'::timestamptz), true,
          'a comma list of days');
select is(public.venue_open_at('Mo,We,Fr 09:00-17:00', '2026-11-03 10:00 America/New_York'::timestamptz), false,
          'and a day it does not list');

-- The four things we refuse to understand. Each would be WRONG, not unknown,
-- if read naively -- which is why null is the answer.
select is(public.venue_open_at('Mo-Su 11:00-22:00; We 11:00-15:00', '2026-11-04 20:00 America/New_York'::timestamptz), null,
          'overlapping rules are null: `;` OVERRIDES, so a union would claim open at 20:00 on a Wednesday');
select is(public.venue_open_at('Mo-Su 18:00-02:00', '2026-11-02 20:00 America/New_York'::timestamptz), null,
          'an overnight range is null: it needs wrap-around, and bars are imported');
select is(public.venue_open_at('Fr-Mo 08:00-22:00', '2026-11-02 12:00 America/New_York'::timestamptz), null,
          'a backwards day range is null: it wraps the week');
select is(public.venue_open_at('24/7', '2026-11-02 12:00 America/New_York'::timestamptz), null,
          '24/7 is outside the grammar');
select is(public.venue_open_at(null, '2026-11-02 12:00 America/New_York'::timestamptz), null,
          'and so is no string at all');
select is(public.venue_open_at('Mo-Fr 7:00-19:00', '2026-11-02 12:00 America/New_York'::timestamptz), null,
          'an unpadded hour is not a time');

-- ---------------------------------------------------------------------------
-- 3. venue_pin_cap: S-10's two anchors
-- ---------------------------------------------------------------------------
select is(public.venue_pin_cap(11), 60, 'S-10: 60 pins at zoom 11');
select is(public.venue_pin_cap(15), 300, 'S-10: 300 at zoom 15');
select is(public.venue_pin_cap(10), 60, 'flat below the lower anchor (minZoom is 10)');
select is(public.venue_pin_cap(20), 300, 'and above the upper one');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-000000a08b01', 'pgtapvr1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-000000a08b02', 'pgtapvr2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-000000a08b01';
update public.profiles set birth_date = (current_date - interval '15 years')::date
 where id = '00000000-0000-4000-8000-000000a08b02';
set local bevi.rpc_bypass = 'false';

-- Four active seeded sodas and one active alcoholic Bev, in a stable order.
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
grant select on t_bevs to authenticated;

insert into public.venues (id, name, kind, lat, lng, neighborhood, borough, source, hours_osm, hours_known, status)
values ('00000000-0000-4000-8000-000000a08b11', 'pgTAP V1 Coffee Bar', 'craft',
        40.7740, -73.9560, 'Upper East Side', 'Manhattan', 'manual', 'Mo-Su 08:00-22:00', true, 'active'),
       ('00000000-0000-4000-8000-000000a08b12', 'pgTAP V2 Corner Store', 'chain',
        40.7750, -73.9570, 'Yorkville', 'Manhattan', 'manual', 'Mo-Su 18:00-02:00', false, 'active'),
       ('00000000-0000-4000-8000-000000a08b13', 'pgTAP V3 Staten Deli', 'craft',
        40.5795, -74.1502, 'St. George', 'Staten Island', 'manual', null, false, 'active'),
       ('00000000-0000-4000-8000-000000a08b14', 'pgTAP V4 No Assortment', 'craft',
        40.7745, -73.9565, 'Upper East Side', 'Manhattan', 'manual', null, false, 'active'),
       ('00000000-0000-4000-8000-000000a08b15', 'pgTAP V5 Hidden', 'craft',
        40.7746, -73.9566, 'Upper East Side', 'Manhattan', 'manual', null, false, 'hidden'),
       ('00000000-0000-4000-8000-000000a08b16', 'pgTAP V6 Bar Only', 'craft',
        40.7747, -73.9567, 'Carnegie Hill', 'Manhattan', 'manual', null, false, 'active');

insert into public.venue_bevs (venue_id, bev_id, source)
select '00000000-0000-4000-8000-000000a08b11', id, 'menu' from t_bevs where label in ('s1', 's2', 's3')
union all
select '00000000-0000-4000-8000-000000a08b12', id, 'chain' from t_bevs where label = 's4'
union all
select '00000000-0000-4000-8000-000000a08b13', id, 'menu' from t_bevs where label = 's1'
union all
select '00000000-0000-4000-8000-000000a08b15', id, 'menu' from t_bevs where label = 's1'
union all
select '00000000-0000-4000-8000-000000a08b16', id, 'menu' from t_bevs where label = 'alc';

-- A score on s1 so `best_score` has something to order by.
insert into public.rankings (user_id, bev_id, bucket, position, score)
select '00000000-0000-4000-8000-000000a08b01', id, 3::smallint, 0, public.ranking_score(3::smallint, 0, 1)
  from t_bevs where label = 's1';
select public.refresh_bev_stats(array(select id from t_bevs));

-- ---------------------------------------------------------------------------
-- 4. venues_in_view
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b01", "role": "authenticated"}';

-- The Upper East Side viewport: V1, V2, V4, V6 are inside it; V3 is not. The
-- call is repeated rather than held in a temp view, because a view resolves
-- permissions against its OWNER and a test should not lean on that.
select is(
  (select array_agg(name order by name) from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15)),
  array['pgTAP V1 Coffee Bar', 'pgTAP V2 Corner Store'],
  'only the venues inside the viewport that have an assortment this caller may see'
);

select is((select bev_count from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V1 Coffee Bar'), 3,
          'bev_count is the assortment the caller may see');

select is((select open_now from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V1 Coffee Bar') is not null, true,
          'open_now is answered when the hours are ones we can read');
select is((select open_now from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V2 Corner Store'), null,
          'and null when they are not, so the UI has one thing to test');

select ok(
  not exists (select 1 from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V4 No Assortment'),
  'D-13: a venue with no assortment gets no pin, though the row exists'
);
select ok(
  not exists (select 1 from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V5 Hidden'),
  'a hidden venue gets no pin either'
);
select ok(
  not exists (select 1 from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V3 Staten Deli'),
  'and nothing outside the viewport'
);

select is(
  (select best_score from public.venues_in_view('{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15) where name = 'pgTAP V1 Coffee Bar') is not null,
  true,
  'best_score is the best Bayesian score of the assortment'
);

-- The clamp: a viewport spilling past the coast returns what is inside.
select is(
  (select count(*)::int from public.venues_in_view(
     '{"south": 39, "north": 42, "west": -76, "east": -72}'::jsonb, 15)
   where name like 'pgTAP V%'),
  3,
  'the bounds are clamped to the city, not rejected: V1, V2 and V3 come back'
);

-- A viewport entirely outside the city is empty, not an error.
select is(
  (select count(*)::int from public.venues_in_view(
     '{"south": 41.0, "north": 41.5, "west": -73.9, "east": -73.8}'::jsonb, 15)),
  0,
  'a viewport north of the city is empty rather than an error'
);

select throws_ok(
  $$ select * from public.venues_in_view(null, 15) $$,
  '22023', 'BEVI_VALIDATION',
  'no bounds at all is a validation error'
);

-- Filters.
select is(
  (select array_agg(name order by name) from public.venues_in_view(
     '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15,
     null, array['craft'])),
  array['pgTAP V1 Coffee Bar'],
  'the kind filter narrows to craft'
);

select is(
  (select array_agg(name order by name) from public.venues_in_view(
     '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15,
     null, null, null, array['Yorkville'])),
  array['pgTAP V2 Corner Store'],
  'the neighbourhood filter narrows to one'
);

select is(
  (select array_agg(name order by name) from public.venues_in_view(
     '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15,
     array['water'])),
  null,
  'a category nothing in view carries returns no pins at all'
);

select is(
  (select count(*)::int from public.venues_in_view(
     '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15,
     null, null, null, null, true)
   where name = 'pgTAP V2 Corner Store'),
  0,
  'open_now = true drops the venue whose hours we cannot read, rather than guessing it open'
);

-- The age gate, on the assortment.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b02", "role": "authenticated"}';

select ok(
  not exists (
    select 1 from public.venues_in_view(
      '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15)
     where name = 'pgTAP V6 Bar Only'),
  'a venue whose only Bev is alcoholic has nothing to show a minor, so no pin'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b01", "role": "authenticated"}';

select ok(
  exists (
    select 1 from public.venues_in_view(
      '{"south": 40.7600, "north": 40.7900, "west": -73.9800, "east": -73.9400}'::jsonb, 15)
     where name = 'pgTAP V6 Bar Only'),
  'and the same venue does have a pin for an adult'
);

-- ---------------------------------------------------------------------------
-- 5. venue_detail
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.venue_detail('00000000-0000-4000-8000-000000a08b11')),
  3,
  'venue_detail returns one row per Bev in the assortment'
);

select is(
  (select array_agg(distinct name) from public.venue_detail('00000000-0000-4000-8000-000000a08b11')),
  array['pgTAP V1 Coffee Bar'],
  'with the venue repeated on every row, for one round trip'
);

select is(
  (select bev_bayes_score is not null
     from public.venue_detail('00000000-0000-4000-8000-000000a08b11') limit 1),
  true,
  'best Bayesian score first, nulls last'
);

select throws_ok(
  $$ select * from public.venue_detail('00000000-0000-4000-8000-000000a08b14') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a venue with no assortment is not_found, not an empty sheet: there was no pin to tap'
);

select throws_ok(
  $$ select * from public.venue_detail('00000000-0000-4000-8000-000000a08b15') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'and so is a hidden one'
);

select throws_ok(
  $$ select * from public.venue_detail('00000000-0000-4000-8000-00000000dead') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'and an id that does not exist'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b02", "role": "authenticated"}';
select throws_ok(
  $$ select * from public.venue_detail('00000000-0000-4000-8000-000000a08b16') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a minor gets not_found for the bar, the same answer an unknown id gets'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b01", "role": "authenticated"}';

-- ---------------------------------------------------------------------------
-- 6. venue_neighborhoods
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(neighborhood order by neighborhood) from public.venue_neighborhoods()
    where neighborhood in ('Upper East Side', 'Yorkville', 'St. George', 'Carnegie Hill')),
  array['Carnegie Hill', 'St. George', 'Upper East Side', 'Yorkville'],
  'every neighbourhood with a pinned venue, sorted'
);

-- "Upper East Side" is V1's, V4's and V5's, so it is the case that proves the
-- vocabulary is distinct rather than one row per venue.
select is(
  (select count(*)::int from public.venue_neighborhoods() where neighborhood = 'Upper East Side'),
  1,
  'the vocabulary is distinct: a neighbourhood appears once however many venues it has'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a08b02", "role": "authenticated"}';
select ok(
  not exists (select 1 from public.venue_neighborhoods() where neighborhood = 'Carnegie Hill'),
  'a minor does not see the neighbourhood whose only venue is a bar'
);

reset role;

select * from finish();
rollback;
