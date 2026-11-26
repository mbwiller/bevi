-- BEV-22 follow-ups (20261123000100): a merge keeps the user's place, and
-- adding the same Google place twice is not an error.
--
-- In order: (1) both re-created functions are still what they were -- the
-- delete trigger still bound and deferred, both definer, owned by postgres,
-- with a pinned search_path, and the grants unchanged; (2) `merge_bev` with
-- four users who ranked SRC, DST or both, with places on one, the other or
-- both; (3) the delete trigger's other callers -- a plain removal, a re-rank,
-- an account deletion; (4) `upsert_google_venue` called twice, and the path
-- the loser of a race takes.
--
-- Fixture uuid prefix: ...0000000b23NN (people 01-07, venues 11-12, Bevs
-- 21-23). b22NN is 43_bev_locations.test.sql's; checked against every other
-- file in supabase/tests/, b23NN collides with none.
--
-- The people, each with one job: a ranked SRC and DST with a place on SRC
-- only; b ranked both with a place on each; c ranked both with a place on DST
-- only; d ranked SRC only with a place on it; e removes a ranking; f re-ranks;
-- g deletes their account.
--
-- A deferred constraint trigger fires at COMMIT, and a pgTAP file never
-- commits. `set constraints all immediate` fires what is pending, which is
-- how this file sees what a real transaction's end would do (as 43 does).
begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000b23' || v.nn)::uuid
  from (values ('a', '01'), ('b', '02'), ('c', '03'), ('d', '04'), ('e', '05'), ('f', '06'), ('g', '07')) v(label, nn);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapb23' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users);
set local bevi.rpc_bypass = 'false';

-- Bevs of this file's own, so the merge touches nothing the seed holds.
-- `source = 'seed'` lets a Bev be active without a photo and keeps the embed
-- trigger quiet (22_duplicates.test.sql does the same).
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id) values
  ('src',   '00000000-0000-4000-8000-0000000b2321'),
  ('dst',   '00000000-0000-4000-8000-0000000b2322'),
  ('plain', '00000000-0000-4000-8000-0000000b2323');

insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-0000000b2321', 'pgTAP Location Merge Source', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000b2322', 'pgTAP Location Merge Survivor', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000b2323', 'pgTAP Location Plain', 'pgTAP', 'water', 1, 'active', 'seed');

-- In Dublin, as 43's are: no imported or seeded venue is anywhere near.
create temporary table t_venues (label text primary key, id uuid not null) on commit drop;
insert into t_venues (label, id) values
  ('A', '00000000-0000-4000-8000-0000000b2311'),
  ('B', '00000000-0000-4000-8000-0000000b2312');

insert into public.venues (id, name, kind, lat, lng, address, source, status)
values ('00000000-0000-4000-8000-0000000b2311', 'Zq Followup Cafe', 'craft', 53.3300, -6.2500, null, 'manual', 'active'),
       ('00000000-0000-4000-8000-0000000b2312', 'Zq Followup Bar', 'craft', 53.3310, -6.2500, null, 'manual', 'active');

insert into public.rankings (user_id, bev_id, bucket, position, score)
select u.id, b.id, 3::smallint, v.pos, v.score
  from (values
    ('a', 'src',   0, 9.00), ('a', 'dst', 1, 8.50),
    ('b', 'src',   0, 9.00), ('b', 'dst', 1, 8.50),
    ('c', 'src',   0, 9.00), ('c', 'dst', 1, 8.50),
    ('d', 'src',   0, 9.00),
    ('e', 'plain', 0, 9.00),
    ('f', 'plain', 0, 9.00),
    ('g', 'plain', 0, 9.00)
  ) v(who, bev, pos, score)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev;

insert into public.bev_locations (user_id, bev_id, venue_id)
select u.id, b.id, vn.id
  from (values
    ('a', 'src', 'A'),
    ('b', 'src', 'A'), ('b', 'dst', 'B'),
    ('c', 'dst', 'B'),
    ('d', 'src', 'A'),
    ('e', 'plain', 'A'),
    ('f', 'plain', 'B'),
    ('g', 'plain', 'A')
  ) v(who, bev, venue)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev
  join t_venues vn on vn.label = v.venue;

-- One person's places, as 'bev@venue' labels in label order; '{}' for none.
create function pg_temp.places(p_who text) returns text[]
language sql stable as $fn$
  select coalesce(array_agg(b.label || '@' || vn.label order by b.label, vn.label), '{}')
    from public.bev_locations l
    join t_users u on u.id = l.user_id
    join t_bevs b on b.id = l.bev_id
    join t_venues vn on vn.id = l.venue_id
   where u.label = p_who
$fn$;

-- ---------------------------------------------------------------------------
-- 1. The two functions are still what they were
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_trigger t
           where t.tgrelid = 'public.rankings'::regclass
             and t.tgname = 'bev_locations_follow_ranking_delete'
             and t.tgfoid = 'public.bev_locations_follow_ranking_delete()'::regprocedure
             and t.tgdeferrable and t.tginitdeferred),
  'the delete trigger is still bound to the function, deferrable and initially deferred'
);

select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in ('public.bev_locations_follow_ranking_delete()'::regprocedure,
                    'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)'::regprocedure)
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) c(setting) where c.setting like 'search_path=%')),
  2,
  'both are security definer, owned by postgres, with a pinned search_path'
);

select ok(
  not has_function_privilege('authenticated', 'public.bev_locations_follow_ranking_delete()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.bev_locations_follow_ranking_delete()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.upsert_google_venue(text, text, double precision, double precision, text, text, text)', 'EXECUTE'),
  'no client role may call either; the Google write is still the service role''s'
);

select alike(
  pg_get_functiondef('public.upsert_google_venue(text, text, double precision, double precision, text, text, text)'::regprocedure),
  '%on conflict (google_place_id) do update%',
  'the Google insert yields to a row inserted since its update looked'
);

-- ---------------------------------------------------------------------------
-- 2. A merge, and the place each user keeps
-- ---------------------------------------------------------------------------
create temporary table t_merge on commit drop as
select public.merge_bev((select id from t_bevs where label = 'src'),
                        (select id from t_bevs where label = 'dst')) as summary;

select is(
  (select array[(summary ->> 'rankingsDropped')::int, (summary ->> 'rankingsMoved')::int] from t_merge),
  array[3, 1],
  'fixture: the merge dropped the SRC rankings of a, b and c, and re-pointed d''s'
);

select is(
  pg_temp.places('a'), array['src@A'],
  'before commit the deferred trigger has not run: a''s place is still on SRC'
);

set constraints all immediate;
set constraints all deferred;

select is(
  pg_temp.places('a'), array['dst@A'],
  'ranked both, a place on SRC only: at commit the place moves to the survivor'
);

select is(
  pg_temp.places('b'), array['dst@B'],
  'ranked both, a place on each: the survivor keeps its own, and SRC''s is gone'
);

select is(
  pg_temp.places('c'), array['dst@B'],
  'ranked both, a place on DST only: unchanged'
);

-- 43 asserts this path with a bare UPDATE of `rankings.bev_id`; this is the
-- same trigger reached through merge_bev itself, alongside the new path.
select is(
  pg_temp.places('d'), array['dst@A'],
  'ranked SRC only: the re-pointed ranking still takes its place with it'
);

select is(
  (select count(*)::int from public.bev_locations
    where bev_id = (select id from t_bevs where label = 'src')),
  0,
  'no place is left on the merged Bev'
);

-- ---------------------------------------------------------------------------
-- 3. The delete trigger's other callers behave as before
-- ---------------------------------------------------------------------------
-- A plain removal: the Bev is not merged, so there is no survivor.
delete from public.rankings
 where user_id = (select id from t_users where label = 'e')
   and bev_id = (select id from t_bevs where label = 'plain');
set constraints all immediate;
set constraints all deferred;

select is(
  pg_temp.places('e'), '{}'::text[],
  'removing a ranking of a Bev that was not merged still removes its place'
);

-- A re-rank, written out as rerank_bev does it: the row is deleted and its
-- replacement inserted in one transaction. 43 runs rerank_bev itself.
delete from public.rankings
 where user_id = (select id from t_users where label = 'f')
   and bev_id = (select id from t_bevs where label = 'plain');
insert into public.rankings (user_id, bev_id, bucket, position, score)
select (select id from t_users where label = 'f'), (select id from t_bevs where label = 'plain'), 3::smallint, 0, 9.00;
set constraints all immediate;
set constraints all deferred;

select is(
  pg_temp.places('f'), array['plain@B'],
  'a re-rank keeps the place'
);

-- An account deletion: by commit the cascade has taken the rankings and the
-- places, and the trigger must find nothing to do rather than fail.
delete from auth.users where id = (select id from t_users where label = 'g');
set constraints all immediate;
set constraints all deferred;

select is(
  (select count(*)::int from public.bev_locations l
    where l.user_id = (select id from t_users where label = 'g')),
  0,
  'a deleted account leaves no place, and its commit does not fail'
);

-- ---------------------------------------------------------------------------
-- 4. upsert_google_venue: the same place id twice
-- ---------------------------------------------------------------------------
create temporary table t_google on commit drop as
select public.upsert_google_venue('ChIJ-pgtap-b23-1', 'Zq Followup Racer', 53.4200, -6.2500, '1 Track', null, 'cafe') as venue;

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-b23-1', 'Zq Followup Racer', 53.4200, -6.2500, '1 Track', null, 'cafe') ->> 'id'),
  (select venue ->> 'id' from t_google),
  'the same place id twice is the same venue'
);

select is(
  (select count(*)::int from public.venues where google_place_id = 'ChIJ-pgtap-b23-1'),
  1, 'and one row'
);

-- The loser of a race. Its UPDATE runs before the winner's row is visible to
-- it, finds nothing, and its INSERT then meets the winner's row in the unique
-- index. One session cannot hold two transactions, so this stages that state:
-- a BEFORE UPDATE trigger (created here, dropped below, and rolled back with
-- the file in any case) swallows the next UPDATE of `venues` once, which is
-- exactly an UPDATE that saw no row. The call uses
-- a new name (Google renamed the place), so outcome 2's same-name lookup
-- misses too, and the INSERT is reached with the place id already taken.
-- Before 20261123000100 this raised 23505.
create function public.pgtap_b23_skip_one_update() returns trigger
language plpgsql as $fn$
begin
  if current_setting('test.skip_update', true) = 'on' then
    perform set_config('test.skip_update', 'off', true);
    return null;
  end if;
  return new;
end;
$fn$;

create trigger pgtap_b23_skip_one_update
  before update on public.venues
  for each row execute function public.pgtap_b23_skip_one_update();

set local test.skip_update = 'on';

select is(
  (select public.upsert_google_venue('ChIJ-pgtap-b23-1', 'Zq Followup Racer Renamed', 53.4200, -6.2500, null, null) ->> 'id'),
  (select venue ->> 'id' from t_google),
  'the loser of a race gets the winner''s venue instead of a unique violation'
);

select is(
  current_setting('test.skip_update', true), 'off',
  'and its first UPDATE really did see no row (the staged trigger fired)'
);

drop trigger pgtap_b23_skip_one_update on public.venues;
drop function public.pgtap_b23_skip_one_update();

select results_eq(
  $$ select name, address, place_type, (select count(*)::int from public.venues where google_place_id = 'ChIJ-pgtap-b23-1')
       from public.venues where google_place_id = 'ChIJ-pgtap-b23-1' $$,
  $$ values ('Zq Followup Racer Renamed', '1 Track', 'cafe', 1) $$,
  'the winner''s row is refreshed as the UPDATE branch would: renamed, the address and type on file kept, one row'
);

select * from finish();
rollback;
