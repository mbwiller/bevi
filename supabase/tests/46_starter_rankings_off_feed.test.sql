-- DELIVERABLE-44 (20261126000100): a ranking made before onboarding ends is
-- not a post.
--
-- In order: (1) submit_ranking keeps its shape, owner and grants; (2) a user
-- who has not onboarded ranks through submit_ranking and through
-- submit_ranking_with_location: the rankings, the ranking_events rows, the
-- place and the streak are all there, and no feed_events row is; (3) a
-- follower's get_feed, get_user_feed and get_explore, and the user's own
-- profile feed, show nothing of it, while the rankings themselves stay
-- readable; (4) once the user sets `onboarded` (as updateMe does, an own-row
-- update) the next submit_ranking posts, and the follower sees that one post
-- and still none of the earlier ones.
--
-- Fixture uuid suffix b461..b462 (people) and b471 (venue); checked against
-- the other files in supabase/tests/, none uses them. `new` is the account in
-- onboarding; `fan` follows it. handle_new_user makes each profile with
-- onboarded = false, which is the state under test, so `new` is left as made.
begin;
select plan(27);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-00000000b461', 'pgtapstarter1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-00000000b462', 'pgtapstarter2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- Both adults, so the alcohol gate is never what hides a row here.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-00000000b461', '00000000-0000-4000-8000-00000000b462');
set local bevi.rpc_bypass = 'false';

-- The follower is onboarded, as any real follower is; it never ranks.
update public.profiles set onboarded = true where id = '00000000-0000-4000-8000-00000000b462';

insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-00000000b462', '00000000-0000-4000-8000-00000000b461');

-- A manual venue, so submit_ranking_with_location saves a real place.
insert into public.venues (id, name, kind, lat, lng, address, source, status)
values ('00000000-0000-4000-8000-00000000b471', 'Zq Starter Cafe', 'craft', 53.3400, -6.2600, null, 'manual', 'active');

-- Made as the owner before the role switch; `authenticated` needs the grant.
create temporary table t_bevs (n int primary key, id uuid not null) on commit drop;
insert into t_bevs (n, id)
select row_number() over (order by b.name, b.id), b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id
 limit 3;
grant select on t_bevs to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The re-created function keeps its shape, owner and grants
-- ---------------------------------------------------------------------------

select ok(
  (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
          and p.proconfig @> array['search_path=public']
     from pg_proc p
    where p.oid = 'public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text)'::regprocedure),
  'submit_ranking is still security definer, owned by postgres, with search_path=public'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text)', 'EXECUTE'),
  'submit_ranking: authenticated may execute it, anon may not'
);
select is(
  (select onboarded from public.profiles where id = '00000000-0000-4000-8000-00000000b461'),
  false,
  'a new account starts not onboarded'
);

-- ---------------------------------------------------------------------------
-- 2. Ranking before onboarding ends: everything but the post
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b461", "role": "authenticated"}';

select lives_ok(
  $$ select public.submit_ranking((select id from t_bevs where n = 1), 3::smallint, 0, 0) $$,
  'submit_ranking succeeds for a user who has not onboarded'
);

reset role;

select is(
  (select count(*)::int from public.rankings
    where user_id = '00000000-0000-4000-8000-00000000b461'
      and bev_id = (select id from t_bevs where n = 1)),
  1,
  'the ranking is saved'
);
select is(
  (select count(*)::int from public.ranking_events
    where user_id = '00000000-0000-4000-8000-00000000b461'
      and bev_id = (select id from t_bevs where n = 1) and kind = 'submit'),
  1,
  'its ranking_events row is written'
);
select is(
  (select current_days from public.streaks where user_id = '00000000-0000-4000-8000-00000000b461'),
  1,
  'and it starts the streak'
);
select is(
  (select count(*)::int from public.feed_events where actor_id = '00000000-0000-4000-8000-00000000b461'),
  0,
  'but no feed event is written'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b461", "role": "authenticated"}';

select lives_ok(
  $$ select * from public.submit_ranking_with_location(
       (select id from t_bevs where n = 2), 2::smallint, 0, 0, '[]'::jsonb, null,
       '00000000-0000-4000-8000-00000000b471') $$,
  'submit_ranking_with_location succeeds for a user who has not onboarded'
);

reset role;

select is(
  (select count(*)::int from public.rankings
    where user_id = '00000000-0000-4000-8000-00000000b461'
      and bev_id = (select id from t_bevs where n = 2)),
  1,
  'the ranking with a place is saved'
);
select is(
  (select venue_id from public.bev_locations
    where user_id = '00000000-0000-4000-8000-00000000b461'
      and bev_id = (select id from t_bevs where n = 2)),
  '00000000-0000-4000-8000-00000000b471'::uuid,
  'and so is its place'
);
select is(
  (select count(*)::int from public.ranking_events
    where user_id = '00000000-0000-4000-8000-00000000b461'
      and bev_id = (select id from t_bevs where n = 2) and kind = 'submit'),
  1,
  'its ranking_events row is written'
);
select is(
  (select count(*)::int from public.feed_events where actor_id = '00000000-0000-4000-8000-00000000b461'),
  0,
  'and still no feed event: the wrapper inherits the rule'
);

-- ---------------------------------------------------------------------------
-- 3. What the follower, Explore and the user's own profile show
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b462", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_feed(50, null) f
    where f.actor_id = '00000000-0000-4000-8000-00000000b461'),
  0,
  'a follower''s get_feed has no post from the starter rankings'
);
select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-00000000b461', 50, null)),
  0,
  'nor does the user''s profile feed, as the follower sees it'
);
select is(
  (select count(*)::int from public.get_explore(50) x
    where x.actor_id = '00000000-0000-4000-8000-00000000b461'),
  0,
  'nor does Explore'
);
select is(
  (select count(*)::int from public.rankings where user_id = '00000000-0000-4000-8000-00000000b461'),
  2,
  'the follower can still read both rankings (the Bev''d list)'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b461", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-00000000b461', 50, null)),
  0,
  'the user''s own profile feed is empty too'
);

-- ---------------------------------------------------------------------------
-- 4. After onboarding, a ranking posts
-- ---------------------------------------------------------------------------

-- What updateMe({ onboarded: true }) sends: an own-row update of profiles.
select lives_ok(
  $$ update public.profiles set onboarded = true where id = auth.uid() $$,
  'the user marks themselves onboarded with an own-row update'
);
select lives_ok(
  $$ select public.submit_ranking((select id from t_bevs where n = 3), 1::smallint, 0, 0) $$,
  'submit_ranking succeeds after onboarding'
);

reset role;

select is(
  (select onboarded from public.profiles where id = '00000000-0000-4000-8000-00000000b461'),
  true,
  'the profile is onboarded'
);
select is(
  (select count(*)::int from public.feed_events
    where actor_id = '00000000-0000-4000-8000-00000000b461' and kind = 'ranked'),
  1,
  'exactly one ranked feed event: the ranking made after onboarding'
);
select is(
  (select bev_id from public.feed_events
    where actor_id = '00000000-0000-4000-8000-00000000b461' and kind = 'ranked'),
  (select id from t_bevs where n = 3),
  'and it is for that Bev'
);
select is(
  (select count(*)::int from public.ranking_events where user_id = '00000000-0000-4000-8000-00000000b461'),
  3,
  'every ranking, before and after, has its ranking_events row'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b462", "role": "authenticated"}';

select is(
  (select array_agg(f.bev_id) from public.get_feed(50, null) f
    where f.actor_id = '00000000-0000-4000-8000-00000000b461'),
  array[(select id from t_bevs where n = 3)],
  'the follower''s get_feed now has that one post, and none of the starter rankings'
);
select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-00000000b461', 50, null)),
  1,
  'and so does the user''s profile feed'
);
select ok(
  exists (select 1 from public.get_feed(50, null) f
           where f.actor_id = '00000000-0000-4000-8000-00000000b461'
             and f.ranking_id = (select r.id from public.rankings r
                                  where r.user_id = '00000000-0000-4000-8000-00000000b461'
                                    and r.bev_id = (select id from t_bevs where n = 3))),
  'the post points at the new ranking'
);

reset role;
select * from finish();
rollback;
