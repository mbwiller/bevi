-- A-02 (20261014000200): post_likes, like_post/unlike_post, and the two new
-- get_feed columns.
begin;
select plan(18);

-- u1 posts (adult, so it can rank an alcoholic Bev); u2 follows u1 and is 16;
-- u3 follows nobody.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000c1', 'pgtaplike1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000c2', 'pgtaplike2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000c3', 'pgtaplike3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000000c1';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000c2';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000000c3';

insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1');

-- ---------------------------------------------------------------------------
-- Table shape and policies.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_likes'::regclass),
  'post_likes has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'post_likes'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on post_likes'
);

-- ---------------------------------------------------------------------------
-- Two posts by u1: one ordinary, one alcoholic.
-- ---------------------------------------------------------------------------

-- Made as the owner before the role switch; `authenticated` needs explicit
-- grants or every later call dies with 42501 instead of testing anything.
-- INSERT too, because the event ids are captured after the switch.
create temporary table t_events (label text primary key, id bigint) on commit drop;
grant select, insert on t_events to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated"}';

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
    order by b.name, b.id limit 1),
  3::smallint, 0, 0);
insert into t_events values ('plain', (select max(id) from public.feed_events));

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
    order by b.name, b.id limit 1),
  2::smallint, 0, 0);
insert into t_events values ('booze', (select max(id) from public.feed_events));

-- ---------------------------------------------------------------------------
-- As u2 (follows u1, under 21).
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';

select lives_ok(
  $$ select public.like_post((select id from t_events where label = 'plain')) $$,
  'like_post on a followee''s post succeeds'
);
select lives_ok(
  $$ select public.like_post((select id from t_events where label = 'plain')) $$,
  'liking twice does not raise'
);
select is(
  (select count(*)::int from public.post_likes
    where feed_event_id = (select id from t_events where label = 'plain')),
  1,
  'and leaves exactly one row'
);

select is(
  (select like_count from public.get_feed(20, null)
    where id = (select id from t_events where label = 'plain')),
  1,
  'get_feed reports like_count'
);
select ok(
  (select liked_by_me from public.get_feed(20, null)
    where id = (select id from t_events where label = 'plain')),
  'and liked_by_me for the liker'
);

select throws_ok(
  $$ select public.like_post((select id from t_events where label = 'booze')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'an under-21 viewer cannot like an alcoholic Bev''s post'
);

select lives_ok(
  $$ select public.unlike_post((select id from t_events where label = 'plain')) $$,
  'unlike_post succeeds'
);
select lives_ok(
  $$ select public.unlike_post((select id from t_events where label = 'plain')) $$,
  'unliking twice does not raise'
);
select is(
  (select count(*)::int from public.post_likes
    where feed_event_id = (select id from t_events where label = 'plain')),
  0,
  'and the row is gone'
);

-- Liked again, so u3 below has a like it must not be able to read.
select lives_ok(
  $$ select public.like_post((select id from t_events where label = 'plain')) $$,
  'like after unlike succeeds'
);

-- ---------------------------------------------------------------------------
-- As u3 (follows nobody).
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c3", "role": "authenticated"}';

select throws_ok(
  $$ select public.like_post((select id from t_events where label = 'plain')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a stranger cannot like a post that is not in their feed'
);
select throws_ok(
  $$ select public.unlike_post((select id from t_events where label = 'plain')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'nor unlike it'
);
select is(
  (select count(*)::int from public.post_likes
    where feed_event_id = (select id from t_events where label = 'plain')),
  0,
  'a stranger cannot read the likes on a post they cannot see'
);

-- ---------------------------------------------------------------------------
-- u2 unfollows u1: the post leaves u2's feed, but u2's like can still go.
-- ---------------------------------------------------------------------------

reset role;
delete from public.follows
 where follower_id = '00000000-0000-4000-8000-0000000000c2'
   and followee_id = '00000000-0000-4000-8000-0000000000c1';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c2", "role": "authenticated"}';

select lives_ok(
  $$ select public.unlike_post((select id from t_events where label = 'plain')) $$,
  'unlike_post removes your own like from a post you can no longer see'
);
select is(
  (select count(*)::int from public.post_likes
    where user_id = '00000000-0000-4000-8000-0000000000c2'),
  0,
  'and the like is gone'
);

-- ---------------------------------------------------------------------------
-- Cascade.
-- ---------------------------------------------------------------------------

reset role;
insert into public.post_likes (user_id, feed_event_id)
values ('00000000-0000-4000-8000-0000000000c2', (select id from t_events where label = 'plain'));
delete from public.feed_events where id = (select id from t_events where label = 'plain');
select is(
  (select count(*)::int from public.post_likes
    where feed_event_id = (select id from t_events where label = 'plain')),
  0,
  'deleting a feed event takes its likes with it'
);

select * from finish();
rollback;
