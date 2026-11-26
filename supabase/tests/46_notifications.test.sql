-- T-31 (20261126000100): the notifications inbox.
--
-- What this file is for: the three triggers write exactly one row per thing
-- that happened and never one about yourself; the read-time rules
-- (visible_notifications) hide a row the moment it stops being true -- an
-- unlike, an unfollow, a deleted comment, a block made by EITHER side, the age
-- gate -- and show it again, the same row, when it is true again; likes on one
-- post are one displayed row; the list, the badge and mark-read agree; a post
-- that is gone takes its notifications with it; and nobody reads or marks
-- anybody else's. get_post is here because the inbox is what opens it.
--
-- THE PEOPLE (uuid band ...0000000046NN; nothing else in supabase/tests/ uses
-- it, and seed.sql creates no users):
--
--   label  NN  role
--   a      01  the poster: every notification below is a's
--   b      02  follows a, likes and comments
--   c      03  follows a, likes; later blocked by a, and later blocks a
--   d      04  a stranger: follows nobody, nobody follows d
--
-- Everyone is 30 unless a test says otherwise. All of it happens in one
-- transaction, so now() -- every created_at and read_at -- is one instant;
-- the order that matters is the id order, which is the order of the calls.
begin;
select plan(68);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000046' || v.nn)::uuid
  from (values ('a', '01'), ('b', '02'), ('c', '03'), ('d', '04')) v(label, nn);
grant select on t_users to authenticated;

-- handle_new_user makes each profile; the handle is the email's local part.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapnotif' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users);
set local bevi.rpc_bypass = 'false';

create temporary table t_bevs (label text primary key, id uuid) on commit drop;
insert into t_bevs (label, id)
select 'soft', b.id
  from public.bevs b join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id
 limit 1;
insert into t_bevs (label, id)
select 'alc', b.id
  from public.bevs b join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
 order by b.name, b.id
 limit 1;
grant select on t_bevs to authenticated;

create temporary table t_posts (label text primary key, id bigint not null) on commit drop;
create temporary table t_cmts  (label text primary key, id bigint not null) on commit drop;
grant select, insert on t_posts, t_cmts to authenticated;

select is(
  (select count(*)::int from t_bevs where id is not null),
  2,
  'fixture: the seeded catalog has a non-alcoholic and an alcoholic Bev to post'
);

-- ---------------------------------------------------------------------------
-- 1. Schema and privileges
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'notifications has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notifications'),
  0,
  'notifications has no policy at all: every read and write is a definer function'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  and not has_table_privilege('authenticated', 'public.notifications', 'TRUNCATE'),
  'authenticated holds no privilege on notifications'
);
select ok(
  not has_table_privilege('anon', 'public.notifications', 'SELECT')
  and not has_table_privilege('anon', 'public.notifications', 'INSERT')
  and not has_table_privilege('anon', 'public.notifications', 'UPDATE')
  and not has_table_privilege('anon', 'public.notifications', 'DELETE')
  and not has_table_privilege('anon', 'public.notifications', 'TRUNCATE'),
  'anon holds no privilege on notifications'
);
select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in ('public.get_notifications(int, bigint)'::regprocedure,
                    'public.get_unread_notification_count()'::regprocedure,
                    'public.mark_notifications_read(bigint)'::regprocedure,
                    'public.get_post(bigint)'::regprocedure)
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) c(setting) where c.setting like 'search_path=%')),
  4,
  'the four RPCs are security definer, owned by postgres, with a pinned search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.get_notifications(int, bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_unread_notification_count()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.mark_notifications_read(bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_post(bigint)', 'EXECUTE'),
  'authenticated may call the four RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.get_notifications(int, bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_unread_notification_count()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_notifications_read(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_post(bigint)', 'EXECUTE'),
  'anon may call none of them'
);
-- grantee 0 is PUBLIC in an ACL.
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid in ('public.get_notifications(int, bigint)'::regprocedure,
                     'public.get_unread_notification_count()'::regprocedure,
                     'public.mark_notifications_read(bigint)'::regprocedure,
                     'public.get_post(bigint)'::regprocedure,
                     'public.visible_notifications()'::regprocedure)
       and a.grantee = 0
  ),
  'PUBLIC holds no execute grant on any of them'
);
select ok(
  not has_function_privilege('authenticated', 'public.visible_notifications()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.visible_notifications()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notify_on_follow()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notify_on_like()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notify_on_comment()', 'EXECUTE'),
  'visible_notifications and the three trigger functions are internal: no client role may execute them'
);
select is(
  (select array_agg(c.relname::text || ':' || t.tgname::text order by t.tgname)
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where t.tgname in ('notify_on_follow', 'notify_on_like', 'notify_on_comment')
      and not t.tgisinternal),
  array['post_comments:notify_on_comment', 'follows:notify_on_follow', 'post_likes:notify_on_like'],
  'the three triggers are on follows, post_likes and post_comments'
);
-- get_post has to stay mappable by the FeedRpcRow path in packages/api.
select is(
  pg_get_function_result('public.get_post(bigint)'::regprocedure),
  pg_get_function_result('public.get_feed(int, bigint)'::regprocedure),
  'get_post returns exactly get_feed''s columns, in get_feed''s order'
);

-- ---------------------------------------------------------------------------
-- 2. The triggers write
-- ---------------------------------------------------------------------------

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004601'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004603", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004601'::uuid);

-- a posts twice: a soft drink, and (bucket 2, since bucket 3 now holds one) an
-- alcoholic Bev for the age-gate case. Then a likes and comments on a's own
-- post, which must notify nobody.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where label = 'soft'), 3::smallint, 0, 0);
insert into t_posts values ('p1', (select max(id) from public.feed_events));
select public.submit_ranking((select id from t_bevs where label = 'alc'), 2::smallint, 0, 0);
insert into t_posts values ('alc', (select max(id) from public.feed_events));
select public.like_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'my own post');

-- b likes and comments on p1, c likes it after b, and b likes the alcoholic post.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'nice one');
insert into t_cmts values ('b1', (select max(id) from public.post_comments));
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004603", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'alc'));

reset role;

select is(
  (select array_agg(u.label order by n.id)
     from public.notifications n join t_users u on u.id = n.actor_id
    where n.recipient_id = '00000000-0000-4000-8000-000000004601' and n.kind = 'follow'),
  array['b', 'c'],
  'each follow_user wrote one follow notification for the person followed'
);
select is(
  (select array_agg(u.label order by n.id)
     from public.notifications n join t_users u on u.id = n.actor_id
    where n.recipient_id = '00000000-0000-4000-8000-000000004601' and n.kind = 'like'
      and n.feed_event_id = (select id from t_posts where label = 'p1')),
  array['b', 'c'],
  'each like_post wrote one like notification for the post''s author'
);
select is(
  (select array_agg(n.comment_id)
     from public.notifications n
    where n.recipient_id = '00000000-0000-4000-8000-000000004601' and n.kind = 'comment'),
  array[(select id from t_cmts where label = 'b1')],
  'add_comment wrote one comment notification, pointing at that comment'
);
select is(
  (select count(*)::int from public.notifications
    where actor_id = '00000000-0000-4000-8000-000000004601'),
  0,
  'liking and commenting on your own post notifies nobody'
);

-- ---------------------------------------------------------------------------
-- 3. What a reads
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';

select is(
  (select array_agg(g.kind order by g.id desc) from public.get_notifications(50) g),
  array['like', 'like', 'comment', 'follow', 'follow'],
  'the inbox: the alcoholic post''s like, p1''s likes as one row, the comment, two follows -- newest first'
);
select is(
  (select g.actor_count from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  2,
  'two likers on one post are ONE row with actor_count 2'
);
select is(
  (select array[g.actors -> 0 ->> 'user_id', g.actors -> 1 ->> 'user_id']
     from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  array['00000000-0000-4000-8000-000000004603', '00000000-0000-4000-8000-000000004602'],
  'its actors are newest first: c, then b'
);
select ok(
  (select g.bev_id = (select id from t_bevs where label = 'soft')
          and g.bev_name is not null and g.bev_category_id is not null
          and g.comment_id is null and g.comment_body is null
     from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  'a like row carries the post''s Bev and no comment'
);
select is(
  (select g.comment_body from public.get_notifications(50) g where g.kind = 'comment'),
  'nice one',
  'a comment row carries the comment''s body'
);
select ok(
  (select g.feed_event_id is null and g.bev_id is null and g.comment_id is null
          and g.actor_count = 1
          and (g.actors -> 0 ->> 'is_following') = 'false'
          and (g.actors -> 0 ->> 'handle') = 'pgtapnotif02'
     from public.get_notifications(50) g
    where g.kind = 'follow' and (g.actors -> 0 ->> 'user_id') = '00000000-0000-4000-8000-000000004602'),
  'a follow row has no post, one actor, and says a does not follow b back'
);
select ok(
  (select bool_and(g.unread) from public.get_notifications(50) g),
  'every row starts unread'
);
select is(
  public.get_unread_notification_count(),
  5,
  'the badge counts displayed rows: six unread notifications, but p1''s two likes are one row'
);
select is(
  (select array_agg(g.id order by g.id desc)
     from public.get_notifications(2, (select min(x.id) from public.get_notifications(2) x)) g),
  (select (array_agg(f.id order by f.id desc))[3:4] from public.get_notifications(50) f),
  'keyset paging: page 2 starts below page 1''s last row and is rows 3-4 of the whole list'
);
select is(
  (select count(*)::int from public.get_notifications(0)),
  1,
  'a limit below 1 is clamped to 1'
);

-- Somebody else's inbox: d has none, sees none of a's, and cannot mark a's.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004604", "role": "authenticated"}';
select is(
  (select count(*)::int from public.get_notifications(50)),
  0,
  'd reads none of a''s notifications'
);
select is(public.get_unread_notification_count(), 0, 'and d''s badge is 0');
select lives_ok(
  $$ select public.mark_notifications_read() $$,
  'd may mark their own (empty) inbox read'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  public.get_unread_notification_count(),
  5,
  'and that touched nothing of a''s'
);

-- The age gate: under 21, the alcoholic post's like is hidden from list and badge.
reset role;
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '18 years')::date
 where id = '00000000-0000-4000-8000-000000004601';
set local bevi.rpc_bypass = 'false';
set local role authenticated;
select is(
  (select count(*)::int from public.get_notifications(50) g
    where g.feed_event_id = (select id from t_posts where label = 'alc')),
  0,
  'under 21, a like on an alcoholic Bev''s post is not shown'
);
select is(public.get_unread_notification_count(), 4, 'nor counted');
reset role;
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-000000004601';
set local bevi.rpc_bypass = 'false';
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 4. mark_notifications_read
-- ---------------------------------------------------------------------------

select lives_ok($$ select public.mark_notifications_read() $$, 'a marks everything read');
select is(public.get_unread_notification_count(), 0, 'the badge is 0');
select ok(
  (select bool_and(not g.unread) and count(*) = 5 from public.get_notifications(50) g),
  'every row is still listed, and none is unread'
);
select lives_ok($$ select public.mark_notifications_read() $$, 'marking again is a no-op, not an error');
select is(public.get_unread_notification_count(), 0, 'and the badge stays 0');

-- ---------------------------------------------------------------------------
-- 5. Undo and redo: unlike, unfollow, delete a comment
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.unlike_post((select id from t_posts where label = 'p1'));
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  (select array[g.actor_count::text, g.actors -> 0 ->> 'user_id']
     from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  array['1', '00000000-0000-4000-8000-000000004603'],
  'after b unlikes, p1''s row is c alone'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
reset role;
select is(
  (select count(*)::int from public.notifications
    where kind = 'like' and actor_id = '00000000-0000-4000-8000-000000004602'
      and feed_event_id = (select id from t_posts where label = 'p1')),
  1,
  'like, unlike, like again leaves ONE notification row, not two'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  (select g.actor_count from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  2,
  'and that row is shown again'
);
select is(
  public.get_unread_notification_count(),
  0,
  'it comes back as it was, already read: a re-like is not a new badge'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.delete_comment((select id from t_cmts where label = 'b1'));
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  (select count(*)::int from public.get_notifications(50) g where g.kind = 'comment'),
  0,
  'a soft-deleted comment''s notification is not shown'
);

-- Unfollowing is a direct delete through follows_delete, as packages/api does it.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
delete from public.follows
 where follower_id = '00000000-0000-4000-8000-000000004602'
   and followee_id = '00000000-0000-4000-8000-000000004601';
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  (select count(*)::int from public.get_notifications(50) g
    where g.kind = 'follow' and (g.actors -> 0 ->> 'user_id') = '00000000-0000-4000-8000-000000004602'),
  0,
  'after b unfollows, b''s follow notification is not shown'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004601'::uuid);
reset role;
select is(
  (select count(*)::int from public.notifications
    where kind = 'follow' and actor_id = '00000000-0000-4000-8000-000000004602'
      and recipient_id = '00000000-0000-4000-8000-000000004601'),
  1,
  'follow, unfollow, follow again leaves ONE notification row'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  (select count(*)::int from public.get_notifications(50) g
    where g.kind = 'follow' and (g.actors -> 0 ->> 'user_id') = '00000000-0000-4000-8000-000000004602'),
  1,
  'and it reappears once b follows again'
);

-- ---------------------------------------------------------------------------
-- 6. get_post
-- ---------------------------------------------------------------------------

select is(
  (select g.id from public.get_post((select id from t_posts where label = 'p1')) g),
  (select id from t_posts where label = 'p1'),
  'get_post: the author gets their own post'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004602", "role": "authenticated"}';
select is(
  (select array[g.id::text, g.like_count::text, g.liked_by_me::text]
     from public.get_post((select id from t_posts where label = 'p1')) g),
  array[(select id from t_posts where label = 'p1')::text, '3', 'true'],
  'get_post: a follower gets it, with get_feed''s engagement columns'
);
select throws_ok(
  $$ select * from public.get_post(9999999) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_post: a post that does not exist is not found'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004604", "role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_post((select id from t_posts where label = 'p1')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_post: a stranger''s post is the same not found'
);

-- ---------------------------------------------------------------------------
-- 7. Blocks, in both directions
-- ---------------------------------------------------------------------------

-- a blocks c.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004603'::uuid);
select is(
  (select count(*)::int from public.get_notifications(50) g, jsonb_array_elements(g.actors) x
    where x ->> 'user_id' = '00000000-0000-4000-8000-000000004603'),
  0,
  'after a blocks c, c is in none of a''s rows'
);
select is(
  (select g.actor_count from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  1,
  'and p1''s likes row counts b alone'
);
select public.unblock_user('00000000-0000-4000-8000-000000004603'::uuid);
select is(
  (select g.actor_count from public.get_notifications(50) g
    where g.kind = 'like' and g.feed_event_id = (select id from t_posts where label = 'p1')),
  2,
  'after a unblocks c, c''s like is shown again'
);
select is(
  (select count(*)::int from public.get_notifications(50) g where g.kind = 'follow'
      and (g.actors -> 0 ->> 'user_id') = '00000000-0000-4000-8000-000000004603'),
  0,
  'but not c''s follow: the block removed the follow edge, and unblocking does not restore it'
);

-- c follows a again and comments: a new, unread notification from c.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004603", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004601'::uuid);
select public.add_comment((select id from t_posts where label = 'p1'), 'from c');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(public.get_unread_notification_count(), 1, 'c''s new comment is the one unread row');

-- Now c blocks a: the record is c's, the effect reaches a.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004603", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004601'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  public.get_unread_notification_count(),
  0,
  'a block c made hides c''s unread comment from a''s badge'
);
select is(
  (select count(*)::int from public.get_notifications(50) g, jsonb_array_elements(g.actors) x
    where x ->> 'user_id' = '00000000-0000-4000-8000-000000004603'),
  0,
  'and c from every row of a''s list'
);
select lives_ok(
  $$ select public.mark_notifications_read() $$,
  'a marks everything read while c''s comment is hidden'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004603", "role": "authenticated"}';
select public.unblock_user('00000000-0000-4000-8000-000000004601'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004601", "role": "authenticated"}';
select is(
  public.get_unread_notification_count(),
  1,
  'after c unblocks a, c''s comment is back, still unread: mark-read only marks what was shown'
);

-- mark_notifications_read(p_up_to_id) stops at the id it is given.
select lives_ok(
  $$ select public.mark_notifications_read(
       (select g.id from public.get_notifications(50) g where g.kind = 'comment') - 1) $$,
  'a marks read up to just below c''s comment'
);
select is(public.get_unread_notification_count(), 1, 'c''s comment, above that id, is still unread');
select lives_ok(
  $$ select public.mark_notifications_read(
       (select g.id from public.get_notifications(50) g where g.kind = 'comment')) $$,
  'a marks read up to c''s comment'
);
select is(public.get_unread_notification_count(), 0, 'now it is read too');

-- ---------------------------------------------------------------------------
-- 8. A post that is gone takes its notifications with it
-- ---------------------------------------------------------------------------

reset role;
select ok(
  (select count(*) > 0 from public.notifications
    where feed_event_id = (select id from t_posts where label = 'p1')),
  'before: p1 has like and comment notifications'
);
set local role authenticated;
select lives_ok(
  $$ select public.remove_ranking((select id from t_bevs where label = 'soft')) $$,
  'a removes the ranking behind p1'
);
reset role;
select is(
  (select count(*)::int from public.notifications
    where feed_event_id = (select id from t_posts where label = 'p1')),
  0,
  'removing the ranking deleted the post, and the cascade took its notifications'
);
set local role authenticated;
select is(
  (select count(*)::int from public.get_notifications(50) g
    where g.feed_event_id = (select id from t_posts where label = 'p1')),
  0,
  'and the inbox no longer mentions it'
);

-- ---------------------------------------------------------------------------
-- 9. Signed out
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select * from public.get_notifications() $$,
  '42501', null,
  'anon cannot execute get_notifications'
);
select throws_ok(
  $$ select public.get_unread_notification_count() $$,
  '42501', null,
  'anon cannot execute get_unread_notification_count'
);

reset role;
select * from finish();
rollback;
