-- BEV-22 (20261119193000 + 20261119193100): venues as the place lookup, and
-- where a Bev was had.
--
-- In order: (1) the widened venue constraints and the grants; (2)
-- `venues_search` -- nearest, the three match tiers, accents, the hidden
-- venue, validation; (3) the writes -- `set_bev_location`, the two
-- `*_with_location` wrappers and that a failed place fails the ranking; (4)
-- the two triggers that keep a place in step with its ranking -- a re-rank
-- keeps it, a removal drops it, a merge moves it, an account deletion takes
-- it; (5) the reads and who may see what -- the block, the age gate, the
-- follow scope of the map; (6) `upsert_google_venue`; (7) the Places
-- fallback's rate limit and the list of google venues due a refresh.
--
-- Fixture uuid prefix: ...0000000b22NN (people 01-06, venues 11-16).
-- Checked against the list in 27_venues_read.test.sql's header and the files
-- added since (31NN, 41NN, 42NN): b22NN collides with none.
--
-- The venues are named "Zq ..." so that two of them share almost no trigrams
-- beyond the words under test, and they are in DUBLIN on purpose. That is the first thing this file
-- proves (a venue may be outside New York), and it makes "the nearest" exact:
-- no imported or seeded venue is within five thousand kilometres.
--
-- The people: me (adult), ana (adult, me follows her), ben (adult, nobody
-- follows him), kid (15, follows ana), blk (adult, me follows him AND has
-- blocked him), gone (adult, deleted in section 4).
--
-- A deferred constraint trigger fires at COMMIT, and a pgTAP file never
-- commits. `set constraints all immediate` fires what is pending, which is
-- how section 4 sees what a real transaction's end would do.
begin;
select plan(97);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000b22' || v.nn)::uuid
  from (values ('me', '01'), ('ana', '02'), ('ben', '03'), ('kid', '04'), ('blk', '05'), ('gone', '06')) v(label, nn);
grant select on t_users to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapb22' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users where label <> 'kid');
update public.profiles set birth_date = (current_date - interval '15 years')::date
 where id = (select id from t_users where label = 'kid');
set local bevi.rpc_bypass = 'false';

insert into public.follows (follower_id, followee_id)
select a.id, b.id
  from (values ('me', 'ana'), ('me', 'blk'), ('kid', 'ana')) v(follower, followee)
  join t_users a on a.label = v.follower
  join t_users b on b.label = v.followee;

insert into public.user_blocks (blocker_id, blocked_id)
select a.id, b.id from t_users a, t_users b where a.label = 'me' and b.label = 'blk';

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select l, (select b.id from public.bevs b
             join public.categories c on c.id = b.category_id
            where b.source = 'seed' and b.status = 'active' and c.is_alcoholic = alc
            order by b.name collate "C", b.id offset off limit 1)
  from (values ('soda', false, 0), ('tea', false, 1), ('juice', false, 2), ('spare', false, 3), ('booze', true, 0)) v(l, alc, off);
grant select on t_bevs to authenticated;

create temporary table t_venues (label text primary key, id uuid not null) on commit drop;
insert into t_venues (label, id)
select v.label, ('00000000-0000-4000-8000-0000000b22' || v.nn)::uuid
  from (values ('cafe', '11'), ('duane', '12'), ('bar', '13'), ('hidden', '14'), ('far', '15')) v(label, nn);
grant select on t_venues to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The widened constraints, and the grants
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into public.venues (id, name, kind, lat, lng, address, source, status)
  values ('00000000-0000-4000-8000-0000000b2211', 'Zq Café Duane', 'craft', 53.3400, -6.2600, '1 Dame Street', 'manual', 'active'),
         ('00000000-0000-4000-8000-0000000b2212', 'Zq Duane Reade', 'craft', 53.3410, -6.2600, '425 Main Street', 'manual', 'active'),
         ('00000000-0000-4000-8000-0000000b2213', 'Zq Corner Bar', 'craft', 53.3500, -6.2600, null, 'manual', 'active'),
         ('00000000-0000-4000-8000-0000000b2214', 'Zq Hidden Duane', 'craft', 53.3401, -6.2600, null, 'manual', 'hidden'),
         ('00000000-0000-4000-8000-0000000b2215', 'Zq Far Kiosk', 'craft', 53.4000, -6.2600, null, 'manual', 'active')
$$, 'a venue we add by hand may be outside New York');

select throws_ok($$
  insert into public.venues (name, kind, lat, lng, source, osm_id)
  values ('Zq OSM abroad', 'craft', 53.34, -6.26, 'osm', 'node/9922001')
$$, '23514', null, 'an imported venue is still held to the five boroughs');

select throws_ok($$
  insert into public.venues (name, kind, lat, lng, source) values ('Zq nowhere', 'craft', 91, 0, 'manual')
$$, '23514', null, 'and no venue is off the planet');

select throws_ok($$
  insert into public.venues (name, kind, lat, lng, source) values ('Zq google no id', 'craft', 53.34, -6.26, 'google')
$$, '23514', null, 'a google venue needs its place id');

select throws_ok($$
  insert into public.venues (name, kind, lat, lng, source, google_place_id)
  values ('Zq manual with id', 'craft', 53.34, -6.26, 'manual', 'ChIJpgtap')
$$, '23514', null, 'and only a google venue has one');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_locations'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bev_locations'),
  'bev_locations has RLS on and no policy'
);

select ok(
  not has_table_privilege('authenticated', 'public.bev_locations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.bev_locations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.bev_locations', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.bev_locations', 'SELECT'),
  'and no client role holds a privilege on it'
);

select ok(
  has_function_privilege('authenticated', 'public.venues_search(text, double precision, double precision, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_bev_location(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.submit_ranking_with_location(uuid, smallint, integer, integer, jsonb, text, uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rerank_bev_with_location(uuid, smallint, integer, integer, jsonb, text, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_bev_locations(uuid[], uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_user_bev_locations(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.bevd_map(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.bevd_at_venue(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.bev_location_summary()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.recent_bev_venues(integer)', 'EXECUTE'),
  'the ten client functions are granted to authenticated'
);

select ok(
  not has_function_privilege('anon', 'public.venues_search(text, double precision, double precision, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_bev_location(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.bevd_map(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_bev_locations(uuid[], uuid[])', 'EXECUTE'),
  'and none to anon'
);

select ok(
  not has_function_privilege('authenticated', 'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.put_bev_location(uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.venue_json(public.venues)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'private.visible_bev_locations', 'SELECT'),
  'the Google write is service_role only, and the internals are not a client''s'
);

-- ---------------------------------------------------------------------------
-- 2. venues_search
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2201", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.venues_search('', null, null, 20)),
  0, 'no query and no position: nothing'
);

select results_eq(
  $$ select venue ->> 'name' from public.venues_search('', 53.3401, -6.2600, 3) $$,
  $$ values ('Zq Café Duane'), ('Zq Duane Reade'), ('Zq Corner Bar') $$,
  'no query, a position: the nearest first, the hidden one left out, capped at the limit'
);

select ok(
  (select distance_m between 8 and 14 from public.venues_search('', 53.3401, -6.2600, 1)),
  'the distance is in metres (0.0001 degrees of latitude is about 11 m)'
);

select results_eq(
  $$ select venue ->> 'name' from public.venues_search('zq duane', 53.3400, -6.2600, 20) $$,
  $$ values ('Zq Duane Reade'), ('Zq Café Duane') $$,
  'the query starting the name outranks a nearer venue that merely contains its words'
);

select results_eq(
  $$ select venue ->> 'name' from public.venues_search('ZQ  CAFE', null, null, 20) $$,
  $$ values ('Zq Café Duane') $$,
  'accents, case and doubled spaces are folded; no position is needed for a query'
);

select is(
  (select distance_m from public.venues_search('zq cafe', null, null, 20)),
  null, 'and with no position there is no distance'
);

select results_eq(
  $$ select venue ->> 'name' from public.venues_search('zq main', 53.3400, -6.2600, 20) $$,
  $$ values ('Zq Duane Reade') $$,
  'a word of the address counts'
);

select results_eq(
  $$ select venue ->> 'name' from public.venues_search('zq duane reede', 53.3400, -6.2600, 1) $$,
  $$ values ('Zq Duane Reade') $$,
  'a typo still finds the venue'
);

select is(
  (select count(*)::integer from public.venues_search('zq hidden', 53.3400, -6.2600, 20)
    where venue ->> 'name' = 'Zq Hidden Duane'),
  0, 'a hidden venue is never a result'
);

select ok(
  (select venue ?& array['id', 'name', 'kind', 'lat', 'lng', 'address', 'neighborhood', 'borough', 'hours_osm', 'hours_known', 'website']
     from public.venues_search('zq cafe', null, null, 1)),
  'a venue carries the eleven keys packages/api maps'
);

select throws_ok($$ select * from public.venues_search('x', 53.34, null, 20) $$,
  '22023', 'BEVI_VALIDATION', 'half a position is a validation error');
select throws_ok($$ select * from public.venues_search('x', 91, 0, 20) $$,
  '22023', 'BEVI_VALIDATION', 'so is one that is not on the Earth');
select throws_ok($$ select * from public.venues_search(repeat('a', 81), null, null, 20) $$,
  '22023', 'BEVI_VALIDATION', 'and a query over 80 characters');

set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok($$ select * from public.venues_search('duane', null, null, 20) $$,
  '42501', 'BEVI_UNAUTHORIZED', 'signed out: unauthorized');

-- ---------------------------------------------------------------------------
-- 3. The writes
-- ---------------------------------------------------------------------------
reset role;

-- me: soda and tea in bucket 3. Bucket 1 is left empty for the submit below.
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, v.bucket::smallint, v.pos, v.score, now() - v.age
  from (values
    ('me',   'soda',  3, 0, 9.00, interval '50 minutes'),
    ('me',   'tea',   3, 1, 8.50, interval '40 minutes'),
    ('ana',  'soda',  3, 0, 9.20, interval '30 minutes'),
    ('ana',  'booze', 3, 1, 8.80, interval '20 minutes'),
    ('ben',  'soda',  3, 0, 9.10, interval '15 minutes'),
    ('blk',  'soda',  3, 0, 9.30, interval '10 minutes'),
    ('gone', 'soda',  3, 0, 9.40, interval '5 minutes')
  ) v(who, bev, bucket, pos, score, age)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2201", "role": "authenticated"}';

select is(
  (select public.set_bev_location((select id from t_bevs where label = 'soda'), '00000000-0000-4000-8000-0000000b2211') ->> 'name'),
  'Zq Café Duane', 'set_bev_location returns the venue'
);

select is(
  (select public.set_bev_location((select id from t_bevs where label = 'soda'), '00000000-0000-4000-8000-0000000b2212') ->> 'name'),
  'Zq Duane Reade', 'setting it again replaces it'
);

reset role;
select is(
  (select array_agg(l.venue_id::text) from public.bev_locations l
    where l.user_id = '00000000-0000-4000-8000-0000000b2201'),
  array['00000000-0000-4000-8000-0000000b2212'], 'and leaves one row, the new venue'
);
set local role authenticated;

select throws_ok(
  $$ select public.set_bev_location((select id from t_bevs where label = 'juice'), '00000000-0000-4000-8000-0000000b2211') $$,
  'P0002', 'BEVI_NOT_FOUND', 'a Bev the caller has not ranked: not found'
);
select throws_ok(
  $$ select public.set_bev_location((select id from t_bevs where label = 'soda'), '00000000-0000-4000-8000-0000000b2214') $$,
  'P0002', 'BEVI_NOT_FOUND', 'a hidden venue: not found'
);
select throws_ok(
  $$ select public.set_bev_location((select id from t_bevs where label = 'soda'), '00000000-0000-4000-8000-0000000b22ff') $$,
  'P0002', 'BEVI_NOT_FOUND', 'an unknown venue: not found'
);

select is(
  (select public.set_bev_location((select id from t_bevs where label = 'tea'), null)),
  null, 'clearing a Bev that has no place is not an error'
);

-- The wrappers. Bucket 1 is empty, so index 0 of 0 with no comparisons is a
-- valid placement.
select throws_ok(
  $$ select * from public.submit_ranking_with_location(
       (select id from t_bevs where label = 'juice'), 1::smallint, 0, 0, '[]'::jsonb, 'bad place',
       '00000000-0000-4000-8000-0000000b2214') $$,
  'P0002', 'BEVI_NOT_FOUND', 'a submit with a venue that cannot be used fails'
);

reset role;
select is(
  (select count(*)::integer from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000b2201'
      and r.bev_id = (select id from t_bevs where label = 'juice')),
  0, 'and takes the ranking with it'
);
set local role authenticated;

select is(
  (select (s.ranking).note from public.submit_ranking_with_location(
     (select id from t_bevs where label = 'juice'), 1::smallint, 0, 0, '[]'::jsonb, 'at the bar',
     '00000000-0000-4000-8000-0000000b2213') s),
  'at the bar', 'submit_ranking_with_location returns the ranking submit_ranking made'
);

select is(
  (select venue ->> 'name' from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2201')
    where bev_id = (select id from t_bevs where label = 'juice')),
  'Zq Corner Bar', 'and the place is saved with it'
);

select is(
  (select s.bucket_size from public.submit_ranking_with_location(
     (select id from t_bevs where label = 'spare'), 1::smallint, 1, 1, '[]'::jsonb, null, null) s),
  2, 'with no venue it is plain submit_ranking'
);

-- ---------------------------------------------------------------------------
-- 4. A place follows its ranking
-- ---------------------------------------------------------------------------
-- A re-rank deletes the ranking row and inserts another. The place is keyed by
-- (user, Bev), so nothing has to carry it.
select lives_ok(
  $$ select * from public.rerank_bev((select id from t_bevs where label = 'juice'), 1::smallint, 0, 1, '[]'::jsonb, null) $$,
  'a plain re-rank runs'
);
set constraints all immediate;
set constraints all deferred;

select is(
  (select venue ->> 'name' from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2201')
    where bev_id = (select id from t_bevs where label = 'juice')),
  'Zq Corner Bar', 'and the place is still there at commit'
);

select lives_ok(
  $$ select * from public.rerank_bev_with_location(
       (select id from t_bevs where label = 'juice'), 1::smallint, 0, 1, '[]'::jsonb, null,
       '00000000-0000-4000-8000-0000000b2215') $$,
  'rerank_bev_with_location runs'
);
set constraints all immediate;
set constraints all deferred;

select is(
  (select venue ->> 'name' from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2201')
    where bev_id = (select id from t_bevs where label = 'juice')),
  'Zq Far Kiosk', 'and replaces the place'
);

select lives_ok(
  $$ select * from public.rerank_bev_with_location(
       (select id from t_bevs where label = 'juice'), 1::smallint, 0, 1, '[]'::jsonb, null, null) $$,
  'rerank_bev_with_location with no venue runs'
);
set constraints all immediate;
set constraints all deferred;

select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2201')
    where bev_id = (select id from t_bevs where label = 'juice')),
  0, 'and clears it'
);

-- Removing the ranking removes the place.
select lives_ok(
  $$ select public.set_bev_location((select id from t_bevs where label = 'spare'), '00000000-0000-4000-8000-0000000b2215') $$,
  'spare gets a place'
);
select lives_ok(
  $$ select public.remove_ranking((select id from t_bevs where label = 'spare')) $$,
  'and its ranking is removed'
);
set constraints all immediate;
set constraints all deferred;

reset role;
select is(
  (select count(*)::integer from public.bev_locations l
    where l.user_id = '00000000-0000-4000-8000-0000000b2201'
      and l.bev_id = (select id from t_bevs where label = 'spare')),
  0, 'the place goes with the ranking'
);

-- A merge re-points a ranking at the surviving Bev: tea (no place) takes
-- nothing; then juice -> spare carries juice's place across.
insert into public.bev_locations (user_id, bev_id, venue_id)
values ('00000000-0000-4000-8000-0000000b2201', (select id from t_bevs where label = 'juice'), '00000000-0000-4000-8000-0000000b2213');

update public.rankings set bev_id = (select id from t_bevs where label = 'spare')
 where user_id = '00000000-0000-4000-8000-0000000b2201' and bev_id = (select id from t_bevs where label = 'juice');

select is(
  (select l.venue_id::text from public.bev_locations l
    where l.user_id = '00000000-0000-4000-8000-0000000b2201'
      and l.bev_id = (select id from t_bevs where label = 'spare')),
  '00000000-0000-4000-8000-0000000b2213', 'a ranking re-pointed by a merge takes its place with it'
);

select is(
  (select count(*)::integer from public.bev_locations l
    where l.user_id = '00000000-0000-4000-8000-0000000b2201'
      and l.bev_id = (select id from t_bevs where label = 'juice')),
  0, 'and leaves none behind on the merged Bev'
);

-- The survivor already has a place: it keeps its own. First clear the board
-- (me is left with soda and tea), then re-point tea at juice.
delete from public.rankings
 where user_id = '00000000-0000-4000-8000-0000000b2201' and bev_id = (select id from t_bevs where label = 'spare');
set constraints all immediate;
set constraints all deferred;

insert into public.bev_locations (user_id, bev_id, venue_id)
values ('00000000-0000-4000-8000-0000000b2201', (select id from t_bevs where label = 'tea'), '00000000-0000-4000-8000-0000000b2215');
-- A place on the destination before the ranking arrives, as merge_bev's
-- "ranked both" case leaves it for the length of its transaction.
insert into public.bev_locations (user_id, bev_id, venue_id)
values ('00000000-0000-4000-8000-0000000b2201', (select id from t_bevs where label = 'juice'), '00000000-0000-4000-8000-0000000b2211');

update public.rankings set bev_id = (select id from t_bevs where label = 'juice')
 where user_id = '00000000-0000-4000-8000-0000000b2201' and bev_id = (select id from t_bevs where label = 'tea');

select is(
  (select array_agg(l.venue_id::text order by l.bev_id) from public.bev_locations l
    where l.user_id = '00000000-0000-4000-8000-0000000b2201'
      and l.bev_id in ((select id from t_bevs where label = 'tea'), (select id from t_bevs where label = 'juice'))),
  array['00000000-0000-4000-8000-0000000b2211'],
  'when the surviving Bev already has a place it keeps it, and the moved one is dropped'
);

-- An account deletion.
insert into public.bev_locations (user_id, bev_id, venue_id)
values ('00000000-0000-4000-8000-0000000b2206', (select id from t_bevs where label = 'soda'), '00000000-0000-4000-8000-0000000b2211');
delete from auth.users where id = '00000000-0000-4000-8000-0000000b2206';
set constraints all immediate;
set constraints all deferred;

select is(
  (select count(*)::integer from public.bev_locations l where l.user_id = '00000000-0000-4000-8000-0000000b2206'),
  0, 'a deleted account leaves no place'
);

-- ---------------------------------------------------------------------------
-- 5. The reads, and who may see what
-- ---------------------------------------------------------------------------
-- me:  soda @ duane, juice @ cafe (from section 4).
-- ana: soda @ cafe, booze @ bar.   ben: soda @ duane.   blk: soda @ cafe.
insert into public.bev_locations (user_id, bev_id, venue_id)
select u.id, b.id, vn.id
  from (values ('ana', 'soda', 'cafe'), ('ana', 'booze', 'bar'), ('ben', 'soda', 'duane'), ('blk', 'soda', 'cafe')) v(who, bev, venue)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev
  join t_venues vn on vn.label = v.venue;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2201", "role": "authenticated"}';

select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2202')),
  2, 'an adult sees both of ana''s places'
);
select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2203')),
  1, 'a stranger''s place is visible, as their ranking is'
);
select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2205')),
  0, 'a blocked person''s is not'
);

select results_eq(
  $$ select (select label from t_users where id = l.user_id), l.venue ->> 'name'
       from public.get_bev_locations(
         array['00000000-0000-4000-8000-0000000b2202', '00000000-0000-4000-8000-0000000b2203',
               '00000000-0000-4000-8000-0000000b2205', '00000000-0000-4000-8000-0000000b2201',
               '00000000-0000-4000-8000-0000000b2202']::uuid[],
         array[(select id from t_bevs where label = 'soda'), (select id from t_bevs where label = 'soda'),
               (select id from t_bevs where label = 'soda'), (select id from t_bevs where label = 'tea'),
               (select id from t_bevs where label = 'soda')]
       ) l
      order by 1 $$,
  $$ values ('ana', 'Zq Café Duane'), ('ben', 'Zq Duane Reade') $$,
  'get_bev_locations answers the pairs that have a visible place, each once'
);

select throws_ok(
  $$ select * from public.get_bev_locations(array['00000000-0000-4000-8000-0000000b2202']::uuid[], array[]::uuid[]) $$,
  '22023', 'BEVI_VALIDATION', 'arrays of different lengths: validation'
);

select results_eq(
  $$ select venue ->> 'name', bev_count, mine_count from public.bevd_map('mine') order by 1 $$,
  $$ values ('Zq Café Duane', 1, 1), ('Zq Duane Reade', 1, 1) $$,
  'bevd_map(mine): the caller''s two places'
);

select results_eq(
  $$ select venue ->> 'name', bev_count, mine_count from public.bevd_map('friends') order by 1 $$,
  $$ values ('Zq Café Duane', 1, 0), ('Zq Corner Bar', 1, 0) $$,
  'bevd_map(friends): the followed, not the stranger and not the blocked'
);

select results_eq(
  $$ select venue ->> 'name', bev_count, mine_count from public.bevd_map() order by 1 $$,
  $$ values ('Zq Café Duane', 2, 1), ('Zq Corner Bar', 1, 0), ('Zq Duane Reade', 1, 1) $$,
  'bevd_map(): both, one pin per venue, the caller''s share counted'
);

select throws_ok($$ select * from public.bevd_map('everyone') $$,
  '22023', 'BEVI_VALIDATION', 'an unknown scope: validation');

select results_eq(
  $$ select (select label from t_users where id = a.user_id) from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2211') a $$,
  $$ values ('ana'), ('me') $$,
  'bevd_at_venue: who had something there, the most recent ranking first'
);

select is(
  (select count(*)::integer from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2211', 'mine')),
  1, 'narrowed by scope'
);

select ok(
  (select bool_and(a.ranking_id = r.id) from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2211') a
     join public.rankings r on r.user_id = a.user_id and r.bev_id = a.bev_id),
  'each row names the ranking behind it'
);

select is(
  (select count(*)::integer from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2212', 'friends')),
  0, 'a venue with nothing in scope returns no rows'
);

select throws_ok($$ select * from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2214') $$,
  'P0002', 'BEVI_NOT_FOUND', 'a hidden venue: not found');

select results_eq(
  $$ select ranked_count, located_count from public.bev_location_summary() $$,
  $$ values (2, 2) $$,
  'bev_location_summary counts the caller''s rankings and how many have a place'
);

-- recent_bev_venues: by when the place was set. Every row here was written in this one
-- transaction, so `now()` gave them all the same instant; move one forward to order them.
reset role;
update public.bev_locations set updated_at = now() + interval '1 minute'
 where user_id = '00000000-0000-4000-8000-0000000b2201'
   and venue_id = '00000000-0000-4000-8000-0000000b2212';
set local role authenticated;

select results_eq(
  $$ select venue ->> 'name' from public.recent_bev_venues() $$,
  $$ values ('Zq Duane Reade'), ('Zq Café Duane') $$,
  'recent_bev_venues: the caller''s own places, the one set last first, and nobody else''s'
);
select is(
  (select count(*)::integer from public.recent_bev_venues(1)), 1,
  'and no more than asked for'
);
select ok(
  not has_function_privilege('anon', 'public.recent_bev_venues(integer)', 'EXECUTE'),
  'recent_bev_venues is not granted to anon'
);

-- The age gate: kid follows ana, whose bar Bev is alcoholic.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2204", "role": "authenticated"}';

select results_eq(
  $$ select venue ->> 'name' from public.bevd_map('friends') $$,
  $$ values ('Zq Café Duane') $$,
  'a minor''s map has no pin for a place where only alcohol was had'
);
select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2202')),
  1, 'nor does a minor read that place off a profile'
);
select is(
  (select count(*)::integer from public.bevd_at_venue('00000000-0000-4000-8000-0000000b2213')),
  0, 'or off the venue'
);

-- The block, from the other side: blk follows nobody, but may not read me.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2205", "role": "authenticated"}';
select is(
  (select count(*)::integer from public.get_user_bev_locations('00000000-0000-4000-8000-0000000b2201')),
  0, 'a block hides places in both directions'
);

-- A hidden venue takes its tags off every read.
reset role;
update public.venues set status = 'hidden' where id = '00000000-0000-4000-8000-0000000b2212';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2201", "role": "authenticated"}';

select results_eq(
  $$ select venue ->> 'name' from public.bevd_map('mine') $$,
  $$ values ('Zq Café Duane') $$,
  'hiding a venue removes its pin'
);

set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok($$ select * from public.bevd_map() $$, '42501', 'BEVI_UNAUTHORIZED', 'signed out: unauthorized');
select throws_ok(
  $$ select public.set_bev_location('00000000-0000-4000-8000-0000000b22ff', null) $$,
  '42501', 'BEVI_UNAUTHORIZED', 'for the write too'
);

-- ---------------------------------------------------------------------------
-- 6. upsert_google_venue
-- ---------------------------------------------------------------------------
reset role;
insert into public.chains (id, name) values ('pgtap-bev22-chain', 'Zq Chain');

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-1', 'Zq Pub', 53.3600, -6.2600, '9 Quay', 'https://example.com') ->> 'name'),
  'Zq Pub', 'a new place becomes a venue'
);

select results_eq(
  $$ select source, kind, address, google_refreshed_at is not null from public.venues where google_place_id = 'ChIJ-pgtap-bev22-1' $$,
  $$ values ('google', 'craft', '9 Quay', true) $$,
  'a google venue, dated'
);

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-1', 'Zq Pub & Kitchen', 53.3601, -6.2600, null, null) ->> 'id'),
  (select id::text from public.venues where google_place_id = 'ChIJ-pgtap-bev22-1'),
  'the same place id again is the same venue'
);

select results_eq(
  $$ select name, address, (select count(*)::integer from public.venues where name like 'Zq Pub%')
       from public.venues where google_place_id = 'ChIJ-pgtap-bev22-1' $$,
  $$ values ('Zq Pub & Kitchen', '9 Quay', 1) $$,
  'renamed in place, and a missing address does not erase the one on file'
);

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-2', 'ZQ Cafe Duane', 53.3401, -6.2601, null, null) ->> 'id'),
  '00000000-0000-4000-8000-0000000b2211',
  'a place we already have under another source, by name within 75 m, is that venue'
);

select is(
  (select count(*)::integer from public.venues where google_place_id = 'ChIJ-pgtap-bev22-2'),
  0, 'and nothing is inserted for it'
);

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-3', 'Zq Chain', 53.3700, -6.2600, null, null) ->> 'kind'),
  'chain', 'a place named exactly as a chain is a chain venue'
);

-- A statement of its own: the row was inserted by the call above, which a
-- subquery in that same statement would not see.
select is(
  (select chain_id from public.venues where google_place_id = 'ChIJ-pgtap-bev22-3'),
  'pgtap-bev22-chain', 'and a branch of that chain'
);

select throws_ok(
  $$ select public.upsert_google_venue('ChIJ-pgtap-bev22-4', 'Zq Hidden Duane', 53.3401, -6.2600, null, null) $$,
  'P0002', 'BEVI_NOT_FOUND', 'a venue hidden by hand is not brought back'
);

select throws_ok(
  $$ select public.upsert_google_venue('', 'x', 53.34, -6.26, null, null) $$,
  '22023', 'BEVI_VALIDATION', 'an empty place id: validation'
);

-- place_type: what kind of place it is, for the glyph on a pin.
select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-5', 'Zq Wine Bar', 53.3800, -6.2600, null, null, 'bar') ->> 'place_type'),
  'bar', 'a new place keeps the type it is given'
);
select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-5', 'Zq Wine Bar', 53.3800, -6.2600, null, null) ->> 'place_type'),
  'bar', 'and a later call that names none leaves it'
);
select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-6', 'Zq Spaceport', 53.3900, -6.2600, null, null, 'spaceport') ->> 'place_type'),
  'other', 'a type this table does not know is other'
);
select is(
  (select public.upsert_google_venue('ChIJ-pgtap-bev22-2', 'ZQ Cafe Duane', 53.3401, -6.2601, null, null, 'cafe') ->> 'place_type'),
  'cafe', 'a venue we already had with no type gains one'
);

-- The import: OSM may say what a place is, and never takes a type away.
select is(
  public.import_venues('[{"osm_id": "node/990000220001", "name": "Zq Wines", "lat": 40.75, "lng": -73.96, "place_type": "liquor"}]'::jsonb),
  1, 'import_venues takes a row with a place type'
);
select is(
  (select place_type from public.venues where osm_id = 'node/990000220001'),
  'liquor', 'and stores it'
);
select is(
  public.import_venues('[{"osm_id": "node/990000220001", "name": "Zq Wines", "lat": 40.75, "lng": -73.96}]'::jsonb),
  1, 'a caller that sends no type still imports'
);
select is(
  (select place_type from public.venues where osm_id = 'node/990000220001'),
  'liquor', 'and leaves the type on file'
);

-- ---------------------------------------------------------------------------
-- 7. The Places fallback's meter, and the refresh list
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.assert_places_rate()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assert_places_rate()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.google_venues_due(interval, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.google_venues_due(interval, integer)', 'EXECUTE'),
  'a signed-in user may be metered; only the service role reads the refresh list'
);

update public.venues set google_refreshed_at = now() - interval '40 days' where google_place_id = 'ChIJ-pgtap-bev22-3';

select results_eq(
  $$ select google_place_id from public.google_venues_due() where google_place_id like 'ChIJ-pgtap-bev22-%' $$,
  $$ values ('ChIJ-pgtap-bev22-3') $$,
  'google_venues_due lists the google venues whose copy is older than 25 days, and no other'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2201", "role": "authenticated"}';
select lives_ok($$ select public.assert_places_rate() $$, 'a signed-in user passes the meter');

reset role;
insert into public.user_actions (user_id, action)
select '00000000-0000-4000-8000-0000000b2201', 'places' from generate_series(1, 59);
set local role authenticated;

select throws_ok($$ select public.assert_places_rate() $$,
  'P0001', 'BEVI_RATE_LIMITED', 'the sixty-first call in an hour is rate limited');

set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok($$ select public.assert_places_rate() $$,
  '42501', 'BEVI_UNAUTHORIZED', 'and a JWT with no user is refused before it is metered');

select * from finish();
rollback;
