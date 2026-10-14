-- A-01 (20261014000100): a save is not a feed event, and neither is a follow.
begin;
select plan(9);

-- Two throwaway users. handle_new_user creates each profile, user_stats and
-- streaks row; seed.sql holds the local invite code.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000b1', 'pgtapfeed1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000b2', 'pgtapfeed2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- Two distinct non-alcoholic seed Bevs, picked deterministically.
create temporary table t_bevs (n int primary key, id uuid) on commit drop;
insert into t_bevs (n, id)
select row_number() over (order by b.name, b.id), b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id
 limit 2;

-- ---------------------------------------------------------------------------
-- The narrowed domain.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.feed_events (actor_id, kind, bev_id)
     values ('00000000-0000-4000-8000-0000000000b1', 'want_to_try', null) $$,
  '23514',
  null,
  'feed_events rejects kind = want_to_try'
);
select throws_ok(
  $$ insert into public.feed_events (actor_id, kind, target_user_id)
     values ('00000000-0000-4000-8000-0000000000b1', 'followed',
             '00000000-0000-4000-8000-0000000000b2') $$,
  '23514',
  null,
  'feed_events rejects kind = followed'
);

-- ---------------------------------------------------------------------------
-- As user b1.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';

-- A ranking still posts, so the feed has something to be compared against.
select lives_ok(
  $$ select public.submit_ranking((select id from t_bevs where n = 1), 3::smallint, 0, 0) $$,
  'submit_ranking succeeds'
);
select is(
  (select count(*)::int from public.get_feed(20, null)),
  1,
  'the ranking is in the feed'
);

-- Saving the other Bev adds nothing.
select lives_ok(
  $$ select public.add_want_to_try((select id from t_bevs where n = 2)) $$,
  'add_want_to_try succeeds'
);
select is(
  (select count(*)::int from public.get_feed(20, null)),
  1,
  'saving a Bev adds no feed item'
);
select is(
  (select want_count from public.user_stats where user_id = '00000000-0000-4000-8000-0000000000b1'),
  1,
  'but it still counts towards want_count'
);

-- Following adds nothing either, and still moves both users' counts.
select lives_ok(
  $$ select public.follow_user('00000000-0000-4000-8000-0000000000b2') $$,
  'follow_user succeeds'
);
select ok(
  (select count(*)::int from public.get_feed(20, null)) = 1
    and (select following_count from public.user_stats
          where user_id = '00000000-0000-4000-8000-0000000000b1') = 1
    and (select follower_count from public.user_stats
          where user_id = '00000000-0000-4000-8000-0000000000b2') = 1,
  'following adds no feed item but still updates both counts'
);

reset role;
select * from finish();
rollback;
