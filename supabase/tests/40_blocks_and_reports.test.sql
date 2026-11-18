-- IS-7 (20261118220000 + 20261118220100): blocking, content reporting, and
-- the filtering that makes a block mean anything. App Store Review Guideline
-- 1.2 asks for all three.
--
-- THE PEOPLE (uuid band ...0000000040NN; nothing else in supabase/tests/ uses
-- it, and seed.sql creates no users, so every list below is exactly these):
--
--   label  NN  rating_count  follows
--   me     01  10            vil opp pal
--   vil    02   9            me pal          <- me blocks vil
--   opp    03   8            me              <- opp blocks me
--   pal    04   7            me vil          <- unaffected bystander
--
-- Two blocks in opposite directions, on purpose: `me` is the BLOCKER of vil
-- and the BLOCKED of opp, and every read path has to hide both. A test with
-- only one direction would pass with a one-directional filter, which is the
-- bug this whole migration exists to avoid.
--
-- THE POSTS. Each person ranks one Bev of their own, and vil also ranks pal's
-- Bev so that "also Bev'd by ..." has something to say. On pal's post there
-- are two comments (pal's and vil's) and two likes (me's and vil's), all made
-- BEFORE the blocks, so the assertions can be made twice -- once before and
-- once after -- and the change is attributable to the block rather than to
-- the fixture.
--
-- WHAT THIS FILE DOES NOT CLAIM. Several of the "after" assertions have two
-- sufficient causes, because block_user also deletes both follow edges: a
-- blocked person drops out of the friends board both because they are blocked
-- and because they are no longer followed. The predicates are asserted
-- individually where that is possible (get_feed from vil's side, where no
-- unfollow can explain it, and the direct PostgREST reads, which no RPC
-- touches) and the rest are belt-and-braces by design.
begin;
select plan(100);

-- ---------------------------------------------------------------------------
-- Users, follows, Bevs
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000040' || v.nn)::uuid
  from (values ('me', '01'), ('vil', '02'), ('opp', '03'), ('pal', '04')) v(label, nn);
grant select on t_users to authenticated;

-- handle_new_user makes each profile, its user_stats row and its streaks row.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapblock' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
-- Everyone is 30, so the alcohol age gate is never what hides a row here.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users);
set local bevi.rpc_bypass = 'false';

update public.profiles set timezone = 'UTC' where id in (select id from t_users);

insert into public.follows (follower_id, followee_id)
select a.id, b.id
  from (values ('me', 'vil'), ('me', 'opp'), ('me', 'pal'),
               ('vil', 'me'), ('vil', 'pal'),
               ('opp', 'me'),
               ('pal', 'me'), ('pal', 'vil')) v(f, t)
  join t_users a on a.label = v.f
  join t_users b on b.label = v.t;

update public.user_stats s
   set follower_count  = (select count(*) from public.follows f where f.followee_id = s.user_id),
       following_count = (select count(*) from public.follows f where f.follower_id = s.user_id)
 where s.user_id in (select id from t_users);

create temporary table t_bevs (n int primary key, id uuid not null) on commit drop;
insert into t_bevs (n, id)
select row_number() over (order by b.name, b.id), b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id
 limit 4;
grant select on t_bevs to authenticated;

create temporary table t_posts (label text primary key, id bigint not null) on commit drop;
create temporary table t_cmts  (label text primary key, id bigint not null) on commit drop;
grant select, insert on t_posts, t_cmts to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Schema and privileges
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_blocks'::regclass),
  'user_blocks has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_reports'::regclass),
  'content_reports has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('user_blocks', 'content_reports')
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on user_blocks or content_reports'
);
select ok(
  not has_function_privilege('authenticated', 'public.resolve_content_report(bigint,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.resolve_content_report(bigint,text,uuid)', 'EXECUTE'),
  'resolve_content_report is the operator path: no client role may execute it'
);
select ok(
  has_function_privilege('service_role', 'public.resolve_content_report(bigint,text,uuid)', 'EXECUTE'),
  'resolve_content_report is executable by service_role'
);
select ok(
  has_function_privilege('authenticated', 'public.is_blocked(uuid)', 'EXECUTE'),
  'is_blocked is executable by authenticated -- it is used in RLS policies, which run as the caller'
);

-- ---------------------------------------------------------------------------
-- 2. Posts, comments and likes -- all before any block
-- ---------------------------------------------------------------------------

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004001", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 1), 3::smallint, 0, 0);
insert into t_posts values ('me', (select max(id) from public.feed_events));

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004002", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 2), 3::smallint, 0, 0);
insert into t_posts values ('vil', (select max(id) from public.feed_events));

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004003", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 3), 3::smallint, 0, 0);
insert into t_posts values ('opp', (select max(id) from public.feed_events));

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004004", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 4), 3::smallint, 0, 0);
insert into t_posts values ('pal', (select max(id) from public.feed_events));
select public.add_comment((select id from t_posts where label = 'pal'), 'pal on pal''s post');
insert into t_cmts values ('pal', (select max(id) from public.post_comments));

-- vil follows pal, so pal's post is visible to vil: vil comments and likes,
-- and also ranks pal's Bev so "also Bev'd" has an entry.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004002", "role": "authenticated"}';
select public.add_comment((select id from t_posts where label = 'pal'), 'vil on pal''s post');
insert into t_cmts values ('vil', (select max(id) from public.post_comments));
select public.like_post((select id from t_posts where label = 'pal'));
-- Bucket 2, not 3: vil's bucket 3 already holds the Bev above, and
-- submit_ranking checks p_expected_bucket_size against it.
select public.submit_ranking((select id from t_bevs where n = 4), 2::smallint, 0, 0);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004001", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'pal'));

-- The rankings above made refresh_user_stats recompute rating_count, so the
-- leaderboard figures are set HERE, after the posts, the way
-- 25_vectors_fixtures sets them: by hand, so every rank below is exact
-- (me 1, vil 2, opp 3, pal 4 -- no ties).
reset role;
update public.user_stats s
   set rating_count = v.n
  from (values ('me', 10), ('vil', 9), ('opp', 8), ('pal', 7)) v(label, n)
  join t_users u on u.label = v.label
 where s.user_id = u.id;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 3. Before the blocks: me can see everything
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(distinct f.actor_id::text) from public.get_feed(50) f),
  (select array_agg(u.id::text order by u.id::text) from t_users u),
  'before: me''s feed carries posts by all four'
);
select is(
  (select count(*)::int from public.get_feed(50) f where f.actor_id = (select id from t_users where label = 'vil')),
  2,
  'before: both of vil''s posts are in me''s feed'
);
select is(
  (select f.comment_count from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  2,
  'before: pal''s post shows 2 comments'
);
select is(
  (select jsonb_array_length(f.comments) from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  2,
  'before: both inline comments are there'
);
select is(
  (select (f.also_bevd ->> 'count')::int from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  1,
  'before: "also Bev''d by" names vil on pal''s post'
);
select is(
  (select count(*)::int from public.get_comments((select id from t_posts where label = 'pal'), 50)),
  2,
  'before: the thread has 2 comments'
);
select ok(
  public.feed_event_visible((select id from t_posts where label = 'vil')),
  'before: vil''s post is visible to me'
);
select is(
  (select count(*)::int from public.profiles_view pv join t_users u on u.id = pv.id),
  4,
  'before: all four profiles are in profiles_view'
);
select is(
  (select count(*)::int from public.get_user_leaderboard(50) l join t_users u on u.id = l.user_id),
  4,
  'before: all four are on the global board'
);
select is(
  (select count(*)::int from public.get_user_feed((select id from t_users where label = 'vil'), 50)),
  2,
  'before: vil''s profile feed has both posts'
);

-- ---------------------------------------------------------------------------
-- 4. The blocks
-- ---------------------------------------------------------------------------

-- me blocks vil.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004001", "role": "authenticated"}';
select lives_ok(
  $$ select public.block_user('00000000-0000-4000-8000-000000004002'::uuid) $$,
  'me blocks vil'
);
select lives_ok(
  $$ select public.block_user('00000000-0000-4000-8000-000000004002'::uuid) $$,
  'blocking again is a no-op, not an error'
);
select is(
  (select count(*)::int from public.user_blocks
    where blocker_id = '00000000-0000-4000-8000-000000004001'
      and blocked_id = '00000000-0000-4000-8000-000000004002'),
  1,
  'double-blocking leaves exactly one row'
);
select throws_ok(
  $$ select public.block_user('00000000-0000-4000-8000-000000004001'::uuid) $$,
  '22023', 'BEVI_VALIDATION',
  'a user cannot block themselves'
);
select throws_ok(
  $$ select public.block_user('00000000-0000-4000-8000-0000000040ff'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'blocking someone who does not exist is not found'
);

-- The follow edges in both directions are gone, and the counters agree.
select is(
  (select count(*)::int from public.follows
    where (follower_id = '00000000-0000-4000-8000-000000004001' and followee_id = '00000000-0000-4000-8000-000000004002')
       or (follower_id = '00000000-0000-4000-8000-000000004002' and followee_id = '00000000-0000-4000-8000-000000004001')),
  0,
  'blocking removed both follow edges between me and vil'
);
select is(
  (select array[s.follower_count, s.following_count] from public.user_stats s
    where s.user_id = '00000000-0000-4000-8000-000000004001'),
  array[2, 2],
  'me''s follower/following counts were repaired (pal and opp each way)'
);

-- opp blocks me. The record is opp's; the effect reaches me.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004003", "role": "authenticated"}';
select lives_ok(
  $$ select public.block_user('00000000-0000-4000-8000-000000004001'::uuid) $$,
  'opp blocks me'
);

-- ---------------------------------------------------------------------------
-- 5. After the blocks, from me's session: every read path
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004001", "role": "authenticated"}';

-- The RPCs.
select is(
  (select array_agg(distinct f.actor_id::text order by f.actor_id::text)
     from public.get_feed(50) f
     join t_users u on u.id = f.actor_id),
  (select array_agg(u.id::text order by u.id::text) from t_users u where u.label in ('me', 'pal')),
  'get_feed: only me and pal remain -- vil (I blocked) and opp (blocked me) are gone'
);
select is(
  (select f.comment_count from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  1,
  'get_feed: comment_count drops vil''s comment on pal''s post'
);
select is(
  (select jsonb_array_length(f.comments) from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  1,
  'get_feed: the inline comments drop vil''s, and agree with comment_count'
);
select is(
  (select f.comments -> 0 ->> 'author_id' from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  '00000000-0000-4000-8000-000000004004',
  'get_feed: the surviving inline comment is pal''s'
);
select is(
  (select (f.also_bevd ->> 'count')::int from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  0,
  'get_feed: "also Bev''d by" no longer names vil'
);
select is(
  (select count(*)::int from public.get_comments((select id from t_posts where label = 'pal'), 50)),
  1,
  'get_comments: the thread drops vil''s comment'
);
select ok(
  not public.feed_event_visible((select id from t_posts where label = 'vil')),
  'feed_event_visible: vil''s post is no longer visible to me'
);
select ok(
  not public.feed_event_visible((select id from t_posts where label = 'opp')),
  'feed_event_visible: opp''s post is no longer visible to me (opp blocked me)'
);
select throws_ok(
  $$ select public.get_user_feed('00000000-0000-4000-8000-000000004002'::uuid, 50) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_user_feed: a blocked person''s profile feed is not found'
);
select throws_ok(
  $$ select public.get_user_feed('00000000-0000-4000-8000-000000004003'::uuid, 50) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_user_feed: so is the feed of someone who blocked me'
);
select throws_ok(
  $$ select public.get_profile_stats('00000000-0000-4000-8000-000000004002'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_profile_stats: not found for a blocked person'
);
select throws_ok(
  $$ select public.get_taste_profile('00000000-0000-4000-8000-000000004003'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_taste_profile: not found for someone who blocked me'
);
select throws_ok(
  $$ select public.follow_user('00000000-0000-4000-8000-000000004002'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'follow_user: refuses across a block'
);
select throws_ok(
  $$ select public.like_post((select id from t_posts where label = 'vil')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'like_post: refuses on a blocked person''s post'
);
select throws_ok(
  $$ select public.add_comment((select id from t_posts where label = 'vil'), 'hello') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'add_comment: refuses on a blocked person''s post'
);
select is(
  (select array_agg(l.user_id::text order by l.user_id::text)
     from public.get_user_leaderboard(50) l join t_users u on u.id = l.user_id),
  (select array_agg(u.id::text order by u.id::text) from t_users u where u.label in ('me', 'pal')),
  'get_user_leaderboard: the global board drops both blocked people'
);
select is(
  (select l.bevi_rank from public.get_user_leaderboard(50) l
    where l.user_id = '00000000-0000-4000-8000-000000004004'),
  4,
  'get_user_leaderboard: bevi_rank stays the GLOBAL rank -- rows are removed, not renumbered'
);
select is(
  (select array_agg(l.user_id::text order by l.user_id::text)
     from public.get_friends_leaderboard(50) l join t_users u on u.id = l.user_id),
  (select array_agg(u.id::text order by u.id::text) from t_users u where u.label in ('me', 'pal')),
  'get_friends_leaderboard: the friends board drops both'
);
select is(
  (select fb.followed_by_count
     from public.get_followed_by(array['00000000-0000-4000-8000-000000004004']::uuid[]) fb),
  0,
  'get_followed_by: vil followed pal, but vil is blocked, so nobody I follow follows pal'
);

-- get_explore. The instance has fewer than 20 profiles, so D-01's fallback is
-- on and every profile the caller does not follow is a candidate -- which,
-- after the unfollows the block performed, now includes vil and opp. Without
-- the filter their posts would appear here; this is the assertion that catches
-- a filter put only in get_feed.
select is(
  (select count(*)::int from public.get_explore(50) e join t_users u on u.id = e.actor_id),
  0,
  'get_explore: neither blocked person is discoverable, although neither is followed any more'
);

-- The direct PostgREST reads. No RPC is involved in any of these, so nothing
-- but the RLS policies and profiles_view can be hiding the rows.
select is(
  (select array_agg(u.label order by u.label) from public.profiles_view pv join t_users u on u.id = pv.id),
  array['me', 'pal'],
  'profiles_view: user search, follower lists and suggestions see only me and pal'
);
select is(
  (select count(*)::int from public.profiles p join t_users u on u.id = p.id),
  2,
  'profiles_select: a direct read of the table is filtered too, not just the view'
);
select is(
  (select count(*)::int from public.follows f
    where f.follower_id in (select id from t_users) and f.followee_id in (select id from t_users)),
  2,
  'follows_select: only the me<->pal pair is readable; every edge touching vil or opp is hidden'
);
select is(
  (select count(*)::int from public.rankings r where r.user_id = '00000000-0000-4000-8000-000000004002'),
  0,
  'rankings_select: a blocked person''s rankings -- and their free-text notes -- are unreadable'
);
select is(
  (select count(*)::int from public.user_stats s where s.user_id in (select id from t_users)),
  2,
  'user_stats_select: filtered, which also keeps a blocked person out of the suggestion pool'
);
select is(
  (select count(*)::int from public.feed_events e where e.actor_id = '00000000-0000-4000-8000-000000004002'),
  0,
  'feed_events_select: a blocked person''s posts are unreadable'
);
select is(
  (select count(*)::int from public.post_comments c
    where c.feed_event_id = (select id from t_posts where label = 'pal')),
  1,
  'post_comments_select: vil''s comment on a post I CAN see is hidden'
);
select is(
  (select count(*)::int from public.post_likes pl
    where pl.feed_event_id = (select id from t_posts where label = 'pal')),
  1,
  'post_likes_select: who liked a post is filtered (the COUNT in get_feed deliberately is not)'
);
select is(
  (select f.like_count from public.get_feed(50) f where f.id = (select id from t_posts where label = 'pal')),
  2,
  'get_feed.like_count is deliberately NOT filtered: an aggregate with no identity attached'
);

-- ---------------------------------------------------------------------------
-- 6. The other side of the wall, and the bystander
-- ---------------------------------------------------------------------------

-- vil never asked for this and is never told. These assertions cannot be
-- explained by the unfollow: vil's feed is actor-or-followee, and the direct
-- reads below answer to RLS alone.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004002", "role": "authenticated"}';
select is(
  (select count(*)::int from public.get_feed(50) f where f.actor_id = '00000000-0000-4000-8000-000000004001'),
  0,
  'the effect is mutual: vil, who blocked nobody, cannot see me''s posts either'
);
select is(
  (select count(*)::int from public.profiles_view pv where pv.id = '00000000-0000-4000-8000-000000004001'),
  0,
  'vil cannot find me in profiles_view'
);
select throws_ok(
  $$ select public.get_user_feed('00000000-0000-4000-8000-000000004001'::uuid, 50) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'vil cannot open my profile feed'
);
select throws_ok(
  $$ select public.follow_user('00000000-0000-4000-8000-000000004001'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'vil cannot follow me again'
);
select throws_ok(
  $$ insert into public.follows (follower_id, followee_id)
     values ('00000000-0000-4000-8000-000000004002', '00000000-0000-4000-8000-000000004001') $$,
  '42501', NULL,
  'follows_insert: nor can vil create the edge directly, going around follow_user'
);
select is(
  (select count(*)::int from public.user_blocks),
  0,
  'vil cannot see that they were blocked: user_blocks shows only the blocks you made'
);
select is(
  (select count(*)::int from public.list_blocked_users(50)),
  0,
  'list_blocked_users is one-directional: vil blocked nobody, so vil''s list is empty'
);

-- pal is a bystander and keeps everything.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004004", "role": "authenticated"}';
select is(
  (select count(*)::int from public.profiles_view pv join t_users u on u.id = pv.id),
  4,
  'pal, who blocked nobody and is blocked by nobody, still sees all four profiles'
);
select is(
  (select count(*)::int from public.get_comments((select id from t_posts where label = 'pal'), 50)),
  2,
  'pal still sees both comments on pal''s own post'
);
select is(
  (select count(*)::int from public.get_feed(50) f where f.actor_id = '00000000-0000-4000-8000-000000004002'),
  2,
  'pal still sees vil''s posts -- a block between two other people is not global moderation'
);

-- me's own list, and lifting a block.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004001", "role": "authenticated"}';
select is(
  (select array_agg(b.user_id::text order by b.user_id::text) from public.list_blocked_users(50) b),
  array['00000000-0000-4000-8000-000000004002'],
  'list_blocked_users: me blocked vil, and NOT opp -- being blocked never appears in your own list'
);
select lives_ok(
  $$ select public.unblock_user('00000000-0000-4000-8000-0000000040ff'::uuid) $$,
  'unblocking someone who was never blocked is a no-op'
);

-- ---------------------------------------------------------------------------
-- 7. Reporting
-- ---------------------------------------------------------------------------

create temporary table t_reports (label text primary key, id bigint not null) on commit drop;
grant select, insert on t_reports to authenticated;

-- Reporting works ACROSS a block, in both orders: the sheet offers Report and
-- Block side by side, and a user who blocks first must still be able to
-- report. me has already blocked vil at this point.
select lives_ok(
  $$ insert into t_reports values ('post', public.report_content(
       'harassment', p_feed_event_id => (select id from t_posts where label = 'vil'))) $$,
  'report_content: a post, after the reporter already blocked its author'
);
select is(
  (select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'vil'))),
  (select id from t_reports where label = 'post'),
  'report_content is idempotent per (reporter, content): a second report returns the first id'
);
select is(
  (select count(*)::int from public.content_reports
    where feed_event_id = (select id from t_posts where label = 'vil')),
  1,
  'and files no second row, whatever reason the repeat gave'
);
select lives_ok(
  $$ insert into t_reports values ('comment', public.report_content(
       'hate', p_comment_id => (select id from t_cmts where label = 'vil'))) $$,
  'report_content: a comment'
);
select lives_ok(
  $$ insert into t_reports values ('profile', public.report_content(
       'other', p_user_id => '00000000-0000-4000-8000-000000004002'::uuid, p_note => 'the whole account')) $$,
  'report_content: a profile'
);
select is(
  (select array_agg(cr.content_type order by cr.content_type) from public.content_reports cr),
  array['comment', 'post', 'profile'],
  'the three kinds of report coexist: one row each, all open'
);
select is(
  (select array_agg(distinct cr.status) from public.content_reports cr),
  array['open'],
  'a new report is open, and nothing a client called has moved it'
);
select is(
  (select array_agg(distinct cr.reported_user_id::text) from public.content_reports cr),
  array['00000000-0000-4000-8000-000000004002'],
  'every report records the person complained about, whichever kind of content it names'
);
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'me')) $$,
  '22023', 'BEVI_VALIDATION',
  'report_content: you cannot report your own content'
);
select throws_ok(
  $$ select public.report_content('nonsense', p_user_id => '00000000-0000-4000-8000-000000004002'::uuid) $$,
  '22023', 'BEVI_VALIDATION',
  'report_content: an unknown reason is rejected'
);
select throws_ok(
  $$ select public.report_content('spam') $$,
  '22023', 'BEVI_VALIDATION',
  'report_content: no target is rejected'
);
select throws_ok(
  $$ select public.report_content('spam',
       p_feed_event_id => (select id from t_posts where label = 'vil'),
       p_user_id       => '00000000-0000-4000-8000-000000004002'::uuid) $$,
  '22023', 'BEVI_VALIDATION',
  'report_content: two targets at once is rejected'
);
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => 9999999) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a post that does not exist is not found'
);
select throws_ok(
  $$ select public.report_content('spam', p_user_id => '00000000-0000-4000-8000-0000000040ff'::uuid) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a profile that does not exist is not found'
);
select throws_ok(
  $$ select public.report_content('spam', p_user_id => '00000000-0000-4000-8000-000000004004'::uuid,
                                  p_note => repeat('x', 501)) $$,
  '22023', 'BEVI_VALIDATION',
  'report_content: an over-long note is rejected'
);

-- A reporter reads their own reports and nobody else's; nobody writes directly.
select is(
  (select count(*)::int from public.content_reports),
  3,
  'me reads the three reports me filed'
);
select throws_ok(
  $$ insert into public.content_reports (reporter_id, content_type, reported_user_id, reason)
     values ('00000000-0000-4000-8000-000000004001', 'profile',
             '00000000-0000-4000-8000-000000004004', 'spam') $$,
  '42501', NULL,
  'no direct insert into content_reports, even of your own row'
);
-- An UPDATE with no UPDATE policy does not raise -- RLS makes no row visible
-- to update, so it silently affects nothing. Assert the effect, not an error.
update public.content_reports set status = 'dismissed'
 where id = (select id from t_reports where label = 'post');
select is(
  (select status from public.content_reports where id = (select id from t_reports where label = 'post')),
  'open',
  'a reporter''s direct UPDATE moves nothing: their own report''s status is untouchable from a client'
);
select throws_ok(
  $$ insert into public.user_blocks (blocker_id, blocked_id)
     values ('00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004004') $$,
  '42501', NULL,
  'no direct insert into user_blocks: block_user is the only way in'
);
-- Same shape: no DELETE policy means no visible row to delete, not an error.
delete from public.user_blocks where blocker_id = '00000000-0000-4000-8000-000000004001';
select is(
  (select count(*)::int from public.user_blocks),
  1,
  'no direct delete from user_blocks: me''s block on vil survives it, so unblock_user is the only way out'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004004", "role": "authenticated"}';
select is(
  (select count(*)::int from public.content_reports),
  0,
  'pal, an ordinary user, reads none of me''s reports'
);
select is(
  (select count(*)::int from public.user_blocks),
  0,
  'pal reads none of me''s blocks'
);
select throws_ok(
  $$ select public.resolve_content_report((select id from t_reports where label = 'post'), 'dismissed') $$,
  '42501', NULL,
  'an ordinary user cannot execute resolve_content_report'
);

-- The operator path.
reset role;
select lives_ok(
  $$ select public.resolve_content_report((select id from t_reports where label = 'post'), 'actioned',
       '00000000-0000-4000-8000-000000004004'::uuid) $$,
  'resolve_content_report moves a report as the operator'
);
select is(
  (select status || ' ' || (resolved_at is not null)::text from public.content_reports
    where id = (select id from t_reports where label = 'post')),
  'actioned true',
  'and records when it was decided'
);
select throws_ok(
  $$ select public.resolve_content_report((select id from t_reports where label = 'post'), 'invented') $$,
  '22023', 'BEVI_VALIDATION',
  'resolve_content_report rejects a status outside the set'
);
select throws_ok(
  $$ select public.resolve_content_report(9999999, 'dismissed') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'resolve_content_report on a report that does not exist is not found'
);

-- ---------------------------------------------------------------------------
-- 8. Account deletion cleans up
-- ---------------------------------------------------------------------------
-- vil is on BOTH sides of a row in each table: blocked by me, and the subject
-- of all three of me's reports. Deleting the account has to take all of it.

select is(
  (select count(*)::int from public.user_blocks
    where blocker_id = '00000000-0000-4000-8000-000000004002'
       or blocked_id = '00000000-0000-4000-8000-000000004002'),
  1,
  'before deletion: one block row mentions vil'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004002", "role": "authenticated"}';
select lives_ok(
  $$ select public.delete_my_account() $$,
  'vil deletes their account'
);

reset role;
select is(
  (select count(*)::int from public.user_blocks
    where blocker_id = '00000000-0000-4000-8000-000000004002'
       or blocked_id = '00000000-0000-4000-8000-000000004002'),
  0,
  'deleting an account removes the blocks it is on either side of'
);
select is(
  (select count(*)::int from public.content_reports
    where reported_user_id = '00000000-0000-4000-8000-000000004002'),
  0,
  'and the reports filed about it'
);

-- The reporter's side of the same cascade.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004003", "role": "authenticated"}';
select lives_ok(
  $$ select public.report_content('spam', p_user_id => '00000000-0000-4000-8000-000000004004'::uuid) $$,
  'opp files a report about pal'
);
select lives_ok(
  $$ select public.delete_my_account() $$,
  'opp deletes their account'
);

reset role;
select is(
  (select count(*)::int from public.content_reports
    where reporter_id = '00000000-0000-4000-8000-000000004003'),
  0,
  'deleting an account removes the reports it filed'
);
select is(
  (select count(*)::int from public.user_blocks
    where blocker_id = '00000000-0000-4000-8000-000000004003'),
  0,
  'and the blocks it made'
);

select * from finish();
rollback;
