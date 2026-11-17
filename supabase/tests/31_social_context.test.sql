-- Social context (20261111000100), contract 2.12.0:
--   feed_also_bevd + the `also_bevd` column on get_feed and get_user_feed,
--   get_friends_leaderboard, and get_followed_by.
--
-- THE PEOPLE (uuid band ...0000000031NN; nothing else in supabase/tests/ uses
-- it, and seed.sql creates no users, so every board below is exactly these):
--
--   label  NN  points                       follows
--   me     01  12                           ana ben cat dan fay gus
--   ana    02  20                           eve
--   ben    03  12                           eve sol
--   cat    04  12 = 9 ranked + streak 1*3   eve
--   dan    05  12
--   eve    06  30                           dan
--   fay    07   5
--   gus    08   0  (Unranked)
--   sol    09   7                           nobody
--   kid    10   0  (Unranked, and 16)       ana ben eve
--   new    11   0  (Unranked)               nobody
--
-- Points are set the way 25_vectors_fixtures sets them: user_stats.rating_count
-- and streaks by hand, so every figure is exact. The rankings rows further
-- down exist for also_bevd only and do not move anybody's points (nothing
-- maintains user_stats from a bare insert).
--
-- THE BOARDS these give:
--   global          eve 30 | ana 20 | me ben dan cat 12 | sol 7 | fay 5
--                   rank 1    2        3  3   3   3        7       8
--   me's friends    ana 20 | me ben dan cat 12 | fay 5        (gus Unranked)
--                   rank 1    2  2   2   2        6
-- Inside the 12s: me, ben and dan have 12 Bevs ranked and cat has 9, so cat is
-- last although cat's account is the oldest; me is older than ben and dan;
-- ben and dan were created at the same instant, so ben's smaller id wins.
--
-- THE POSTS, oldest first, and who else ranked each Bev (how long ago):
--   p1  ana  hit      hit:    eve 5m, ana 10m, ben 1h, cat 2h, dan 3h, fay 4h,
--   p2  ben  hit              me 5h, sol 6h
--   p3  ana  lonely   lonely: ana only
--   p4  me   hit
--   p5  ana  booze    booze:  ana, ben            (an alcoholic Bev)
--   p6  ana  pair     pair:   ana, then ben and cat at the same instant
begin;
select plan(82);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000031' || v.nn)::uuid
  from (values ('me', '01'), ('ana', '02'), ('ben', '03'), ('cat', '04'), ('dan', '05'), ('eve', '06'),
               ('fay', '07'), ('gus', '08'), ('sol', '09'), ('kid', '10'), ('new', '11')) v(label, nn);
grant select on t_users to authenticated;

-- handle_new_user makes each profile (handle = the email's local part), its
-- user_stats row and its streaks row.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapsoc' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users where label in ('me', 'ana'));
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = (select id from t_users where label = 'kid');
set local bevi.rpc_bypass = 'false';

update public.profiles p
   set timezone = 'UTC', created_at = v.created_at::timestamptz
  from (values ('me',  '2026-10-01T00:00:00Z'), ('ana', '2026-10-02T00:00:00Z'),
               ('ben', '2026-10-03T00:00:00Z'), ('cat', '2026-09-01T00:00:00Z'),
               ('dan', '2026-10-03T00:00:00Z'), ('eve', '2026-10-04T00:00:00Z'),
               ('fay', '2026-10-05T00:00:00Z'), ('gus', '2026-10-06T00:00:00Z'),
               ('sol', '2026-10-06T00:00:00Z'), ('kid', '2026-10-06T00:00:00Z'),
               ('new', '2026-10-06T00:00:00Z')) v(label, created_at)
  join t_users u on u.label = v.label
 where p.id = u.id;

update public.user_stats s
   set rating_count = v.n
  from (values ('me', 12), ('ana', 20), ('ben', 12), ('cat', 9), ('dan', 12), ('eve', 30),
               ('fay', 5), ('gus', 0), ('sol', 7), ('kid', 0), ('new', 0)) v(label, n)
  join t_users u on u.label = v.label
 where s.user_id = u.id;

-- cat's three other points: a live one-day streak.
update public.streaks
   set current_days = 1, last_ranked_on = (now() at time zone 'UTC')::date
 where user_id = (select id from t_users where label = 'cat');

-- ---------------------------------------------------------------------------
-- Follows. The four edges with a time are the ones get_followed_by orders by.
-- ---------------------------------------------------------------------------

insert into public.follows (follower_id, followee_id, created_at)
select a.id, b.id, now() - v.age
  from (values
    ('me',  'ana', interval '9 days'), ('me',  'ben', interval '9 days'), ('me',  'cat', interval '9 days'),
    ('me',  'dan', interval '9 days'), ('me',  'fay', interval '9 days'), ('me',  'gus', interval '9 days'),
    ('kid', 'ana', interval '9 days'), ('kid', 'ben', interval '9 days'),
    -- Who follows eve: three people me follows, and kid, whom me does not.
    ('ana', 'eve', interval '3 hours'), ('ben', 'eve', interval '1 hour'), ('cat', 'eve', interval '2 hours'),
    ('kid', 'eve', interval '10 minutes'),
    -- The other direction: eve follows dan, which must not read as "dan follows eve".
    ('eve', 'dan', interval '9 days'),
    ('ben', 'sol', interval '1 hour')
  ) v(follower, followee, age)
  join t_users a on a.label = v.follower
  join t_users b on b.label = v.followee;

-- ---------------------------------------------------------------------------
-- Bevs: three non-alcoholic seed Bevs and one alcoholic, in a stable order.
-- ---------------------------------------------------------------------------

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select l, (select b.id from public.bevs b
             join public.categories c on c.id = b.category_id
            where b.source = 'seed' and b.status = 'active' and c.is_alcoholic = alc
            order by b.name collate "C", b.id offset off limit 1)
  from (values ('hit', false, 0), ('lonely', false, 1), ('pair', false, 2), ('booze', true, 0)) v(l, alc, off);
grant select on t_bevs to authenticated;

-- ---------------------------------------------------------------------------
-- Rankings and posts. Written straight into rankings/feed_events rather than
-- through submit_ranking, which would stamp every ranked_at with the same
-- now(): "most recently ranked first" needs backdated rows (10_explore does
-- the same for its decay order).
-- ---------------------------------------------------------------------------

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, v.bucket::smallint, v.pos, v.score, now() - v.age
  from (values
    ('ana', 'hit',    3, 0, 9.10, interval '10 minutes'),
    ('ana', 'lonely', 3, 1, 8.80, interval '20 minutes'),
    ('ana', 'booze',  3, 2, 8.50, interval '30 minutes'),
    ('ana', 'pair',   3, 3, 8.30, interval '40 minutes'),
    ('ben', 'hit',    3, 0, 8.20, interval '1 hour'),
    ('ben', 'booze',  2, 0, 5.00, interval '2 hours'),
    ('ben', 'pair',   2, 1, 4.50, interval '1 day'),
    ('cat', 'hit',    3, 0, 7.30, interval '2 hours'),
    ('cat', 'pair',   3, 1, 7.10, interval '1 day'),
    ('dan', 'hit',    2, 0, 6.40, interval '3 hours'),
    ('fay', 'hit',    2, 0, 5.50, interval '4 hours'),
    ('me',  'hit',    3, 0, 9.90, interval '5 hours'),
    ('eve', 'hit',    1, 0, 1.00, interval '5 minutes'),
    ('sol', 'hit',    1, 0, 2.00, interval '6 hours')
  ) v(who, bev, bucket, pos, score, age)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev;

create temporary table t_posts (label text primary key, id bigint not null) on commit drop;
grant select on t_posts to authenticated;

-- One insert per post, in order, so the feed ids ascend p1..p6.
do $$
declare
  v       record;
  v_event bigint;
begin
  for v in
    select t.ord, t.label, r.user_id, r.bev_id, r.id as ranking_id, r.ranked_at
      from (values (1, 'p1', 'ana', 'hit'), (2, 'p2', 'ben', 'hit'), (3, 'p3', 'ana', 'lonely'),
                   (4, 'p4', 'me', 'hit'), (5, 'p5', 'ana', 'booze'), (6, 'p6', 'ana', 'pair')
           ) t(ord, label, who, bev)
      join t_users u on u.label = t.who
      join t_bevs b on b.label = t.bev
      join public.rankings r on r.user_id = u.id and r.bev_id = b.id
     order by t.ord
  loop
    insert into public.feed_events (actor_id, kind, bev_id, ranking_id, created_at)
    values (v.user_id, 'ranked', v.bev_id, v.ranking_id, v.ranked_at)
    returning id into v_event;

    insert into t_posts (label, id) values (v.label, v_event);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Where the results are captured, once per caller, so each assertion below is
-- a plain select. Made as the owner: `authenticated` needs explicit grants on
-- a temp table or every later statement dies with 42501 instead of testing.
-- ---------------------------------------------------------------------------

create temporary table t_raw (
  viewer             text    not null,
  src                text    not null,
  ord                bigint  not null,
  id                 bigint  not null,
  actor_id           uuid,
  score              numeric,
  bucket             smallint,
  in_my_want_to_try  boolean,
  like_count         integer,
  liked_by_me        boolean,
  comment_count      integer,
  comments           jsonb,
  also_bevd          jsonb
) on commit drop;
grant select, insert on t_raw to authenticated;

-- `also_txt` reads "<count>:<the items' people, in order>", e.g. '4:ben,cat,dan'.
create temporary view v_feed as
select r.viewer, r.src, r.ord,
       coalesce(p.label, 'unexpected post ' || r.id::text) as post,
       r.actor_id, r.score, r.bucket, r.in_my_want_to_try, r.like_count, r.liked_by_me,
       r.comment_count, jsonb_array_length(r.comments) as inline_comments,
       r.also_bevd,
       (r.also_bevd ->> 'count') || ':' || array_to_string(array(
         select coalesce(u.label, 'unexpected user')
           from jsonb_array_elements(r.also_bevd -> 'items') with ordinality i(item, ord)
           left join t_users u on u.id = (i.item ->> 'user_id')::uuid
          order by i.ord), ',') as also_txt
  from t_raw r
  left join t_posts p on p.id = r.id;
grant select on v_feed to authenticated;

create temporary table t_fb_raw (
  viewer             text    not null,
  ord                bigint  not null,
  user_id            uuid,
  followed_by_count  integer,
  followed_by        jsonb
) on commit drop;
grant select, insert on t_fb_raw to authenticated;

-- `by_txt` reads "<count>:<the people, in order>", e.g. '3:ben,cat'.
create temporary view v_fb as
select r.viewer, r.ord,
       coalesce(a.label, 'unexpected user') as asked,
       r.followed_by,
       r.followed_by_count::text || ':' || array_to_string(array(
         select coalesce(u.label, 'unexpected user')
           from jsonb_array_elements(r.followed_by) with ordinality i(item, ord)
           left join t_users u on u.id = (i.item ->> 'user_id')::uuid
          order by i.ord), ',') as by_txt
  from t_fb_raw r
  left join t_users a on a.id = r.user_id;
grant select on v_fb to authenticated;

-- ---------------------------------------------------------------------------
-- Shape, ownership and grants.
-- ---------------------------------------------------------------------------

select is((select count(*)::int from t_posts), 6, 'fixture: all six posts were written');
select is((select count(distinct id)::int from t_bevs), 4, 'fixture: four distinct seed Bevs');

select ok(
  -- 20261112000300 appends bev_icon_path after it (34_bev_icon_paths).
  pg_get_function_result('public.get_feed(int, bigint)'::regprocedure) ~ 'comments jsonb, also_bevd jsonb(, bev_icon_path text)?\)$',
  'get_feed gained exactly one column, also_bevd, after comments'
);
select is(
  pg_get_function_result('public.get_user_feed(uuid, int, bigint)'::regprocedure),
  pg_get_function_result('public.get_feed(int, bigint)'::regprocedure),
  'get_user_feed still returns exactly get_feed''s columns'
);
-- Both end in bev_icon_path since 20261112000300, which is set aside first.
select ok(
  starts_with(
    replace(pg_get_function_result('public.get_feed(int, bigint)'::regprocedure), ', bev_icon_path text', ''),
    left(replace(pg_get_function_result('public.get_explore(int, timestamptz, int)'::regprocedure), ', bev_icon_path text', ''), -1)
  ),
  'get_explore''s columns are still a prefix of get_feed''s'
);
select ok(
  not has_function_privilege('anon', 'public.get_feed(int, bigint)', 'execute')
    and has_function_privilege('authenticated', 'public.get_feed(int, bigint)', 'execute'),
  'get_feed: not anon, authenticated yes (the grants survived the drop and create)'
);
select ok(
  not has_function_privilege('anon', 'public.get_user_feed(uuid, int, bigint)', 'execute')
    and has_function_privilege('authenticated', 'public.get_user_feed(uuid, int, bigint)', 'execute'),
  'get_user_feed: not anon, authenticated yes'
);
select ok(
  not has_function_privilege('anon', 'public.get_friends_leaderboard(int, int)', 'execute')
    and has_function_privilege('authenticated', 'public.get_friends_leaderboard(int, int)', 'execute'),
  'get_friends_leaderboard: not anon, authenticated yes'
);
select ok(
  not has_function_privilege('anon', 'public.get_followed_by(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.get_followed_by(uuid[])', 'execute'),
  'get_followed_by: not anon, authenticated yes'
);
select ok(
  not has_function_privilege('anon', 'public.feed_also_bevd(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.feed_also_bevd(uuid, uuid)', 'execute'),
  'feed_also_bevd is internal: neither anon nor authenticated may call it'
);
select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in ('public.feed_also_bevd(uuid, uuid)'::regprocedure,
                    'public.get_feed(int, bigint)'::regprocedure,
                    'public.get_user_feed(uuid, int, bigint)'::regprocedure,
                    'public.get_friends_leaderboard(int, int)'::regprocedure,
                    'public.get_followed_by(uuid[])'::regprocedure)
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) c(setting) where c.setting like 'search_path=%')),
  5,
  'all five are security definer, owned by postgres, with a pinned search_path'
);

-- ===========================================================================
-- get_friends_leaderboard
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003101", "role": "authenticated"}';

select lives_ok(
  $$ select * from public.get_friends_leaderboard(50, 0) $$,
  'get_friends_leaderboard runs for a signed-in caller'
);
select is(
  (select array_agg(coalesce(u.label, 'unexpected user') order by t.ordinality)
     from public.get_friends_leaderboard(50, 0) with ordinality t
     left join t_users u on u.id = t.user_id),
  array['ana', 'me', 'ben', 'dan', 'cat', 'fay'],
  'membership and order: the caller and the ranked people they follow; not eve or sol (not followed), not gus (Unranked)'
);
select is(
  (select array_agg(t.points order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  array[20, 12, 12, 12, 12, 5],
  'points are user_rank_points()''s: rating_count, plus 3 per streak day for cat'
);
select is(
  (select array_agg(t.friend_rank order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  array[1, 2, 2, 2, 2, 6],
  'friend_rank counts from 1 within the set; ties share a rank and the next rank skips'
);
select is(
  (select array_agg(coalesce(u.label, 'unexpected user') order by g.ordinality)
     from public.get_user_leaderboard(50) with ordinality g
     left join t_users u on u.id = g.user_id),
  array['eve', 'ana', 'me', 'ben', 'dan', 'cat', 'sol', 'fay'],
  'the global board, for comparison: the same people in the same relative order, with eve and sol among them'
);
select is(
  (select array_agg(g.bevi_rank order by g.ordinality) from public.get_user_leaderboard(50) with ordinality g),
  array[1, 2, 3, 3, 3, 3, 7, 8],
  'and the global ranks: ana is 2 on Bevi and 1 among me''s friends'
);
select is(
  (select array_agg(t.user_id order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  (select array_agg(g.user_id order by g.ordinality)
     from public.get_user_leaderboard(50) with ordinality g
    where g.user_id = auth.uid()
       or g.user_id in (select f.followee_id from public.follows f where f.follower_id = auth.uid())),
  'the friends board is the global board with everyone else removed: every tie breaks the same way'
);
select is(
  (select array_agg(t.points order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  (select array_agg(g.points order by g.ordinality)
     from public.get_user_leaderboard(50) with ordinality g
    where g.user_id = auth.uid()
       or g.user_id in (select f.followee_id from public.follows f where f.follower_id = auth.uid())),
  'and each person has the same points on both boards'
);
select is(
  (select array_agg(t.rating_count order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  array[20, 12, 12, 12, 9, 5],
  'rating_count: cat ties on points with fewer Bevs ranked, so sorts after the others'
);
select is(
  (select array_agg(t.current_streak_days order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  array[0, 0, 0, 0, 1, 0],
  'current_streak_days is the effective streak'
);
select is(
  (select array_agg(t.can_see_alcohol order by t.ordinality) from public.get_friends_leaderboard(50, 0) with ordinality t),
  array[false, true, false, false, false, false],
  'can_see_alcohol is the caller''s own flag only (ana is 30 too, and reads false)'
);
select is(
  (select array_agg(t.handle order by t.ordinality) from public.get_friends_leaderboard(2, 0) with ordinality t),
  array['pgtapsoc02', 'pgtapsoc01'],
  'paging: the first page of two, with the profile columns'
);
select is(
  (select array_agg(coalesce(u.label, 'unexpected user') || ' ' || t.friend_rank::text order by t.ordinality)
     from public.get_friends_leaderboard(2, 2) with ordinality t
     left join t_users u on u.id = t.user_id),
  array['ben 2', 'dan 2'],
  'paging: the second page continues, and its ranks are the set''s, not the page''s'
);
select is(
  (select array_agg(coalesce(u.label, 'unexpected user') || ' ' || t.friend_rank::text order by t.ordinality)
     from public.get_friends_leaderboard(2, 4) with ordinality t
     left join t_users u on u.id = t.user_id),
  array['cat 2', 'fay 6'],
  'paging: the third page ends the set'
);
select is(
  (select count(*)::int from public.get_friends_leaderboard(2, 6)),
  0,
  'paging: past the end is an empty page'
);
select is(
  (select array_agg(t.friend_rank) from public.get_friends_leaderboard(0, -5) t),
  array[1],
  'p_limit 0 and a negative offset are clamped (to one row from the top) instead of raising'
);
select is(
  (select count(*)::int from public.get_friends_leaderboard(null, null)),
  6,
  'null arguments fall back to the defaults'
);

-- sol follows nobody: the board is sol alone, at rank 1 (7th on Bevi).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003109", "role": "authenticated"}';

select is(
  (select array_agg(coalesce(u.label, 'unexpected user') || ' ' || t.friend_rank::text || ' ' || t.points::text)
     from public.get_friends_leaderboard(50, 0) t
     left join t_users u on u.id = t.user_id),
  array['sol 1 7'],
  'a caller with no follows is alone on the board, at rank 1'
);

-- new follows nobody and has ranked nothing.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003111", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_friends_leaderboard(50, 0)),
  0,
  'an Unranked caller with no follows gets an empty board, not an error'
);

-- kid has ranked nothing and follows ana, ben and eve.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003110", "role": "authenticated"}';

select is(
  (select array_agg(coalesce(u.label, 'unexpected user') || ' ' || t.friend_rank::text order by t.ordinality)
     from public.get_friends_leaderboard(50, 0) with ordinality t
     left join t_users u on u.id = t.user_id),
  array['eve 1', 'ana 2', 'ben 3'],
  'the board is relative to the caller; an Unranked caller has no row on their own board'
);

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$ select * from public.get_friends_leaderboard(50, 0) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_friends_leaderboard: no session is unauthorized'
);

-- ===========================================================================
-- also_bevd on get_feed and get_user_feed
-- ===========================================================================

-- As me: a like and a comment on p1 and a bookmark of p3's Bev, so the columns
-- that were there before have something to show.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003101", "role": "authenticated"}';

select public.like_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'nice');
select public.add_want_to_try((select id from t_bevs where label = 'lonely'));

select lives_ok($$ select * from public.get_feed(50, null) $$, 'get_feed runs');
select lives_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-000000003102', 50, null) $$,
  'get_user_feed runs'
);

insert into t_raw
select 'me', 'feed', t.ordinality, t.id, t.actor_id, t.score, t.bucket, t.in_my_want_to_try,
       t.like_count, t.liked_by_me, t.comment_count, t.comments, t.also_bevd
  from public.get_feed(50, null) with ordinality t;
insert into t_raw
select 'me', 'user:ana', t.ordinality, t.id, t.actor_id, t.score, t.bucket, t.in_my_want_to_try,
       t.like_count, t.liked_by_me, t.comment_count, t.comments, t.also_bevd
  from public.get_user_feed('00000000-0000-4000-8000-000000003102', 50, null) with ordinality t;
insert into t_raw
select 'me', 'user:me', t.ordinality, t.id, t.actor_id, t.score, t.bucket, t.in_my_want_to_try,
       t.like_count, t.liked_by_me, t.comment_count, t.comments, t.also_bevd
  from public.get_user_feed('00000000-0000-4000-8000-000000003101', 50, null) with ordinality t;

-- What get_feed did before this migration.
select is(
  (select array_agg(f.post order by f.ord) from v_feed f where f.viewer = 'me' and f.src = 'feed'),
  array['p6', 'p5', 'p4', 'p3', 'p2', 'p1'],
  'get_feed: the caller''s own and followed users'' posts, newest first, as before'
);
select is(
  (select array[f.like_count, f.comment_count, f.inline_comments]
     from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p1'),
  array[1, 1, 1],
  'get_feed: like_count, comment_count and the inline comments are unchanged'
);
select ok(
  (select f.liked_by_me and not f.in_my_want_to_try
     from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p1')
  and (select f.in_my_want_to_try and not f.liked_by_me
         from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p3'),
  'get_feed: liked_by_me and in_my_want_to_try are still the caller''s own'
);
select is(
  (select f.score::text || ' ' || f.bucket::text
     from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p2'),
  '8.20 3',
  'get_feed: score and bucket are still the ACTOR''s ranking (ben''s), not a friend''s'
);
select is(
  (select array_agg(p.label order by t.ordinality)
     from public.get_feed(2, null) with ordinality t
     join t_posts p on p.id = t.id),
  array['p6', 'p5'],
  'get_feed: p_limit still caps the page'
);
select is(
  (select array_agg(p.label order by t.ordinality)
     from public.get_feed(2, (select id from t_posts where label = 'p5')) with ordinality t
     join t_posts p on p.id = t.id),
  array['p4', 'p3'],
  'get_feed: p_before_id still continues after the previous page'
);

-- The new column.
select is(
  (select f.also_txt from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p1'),
  '4:ben,cat,dan',
  'also_bevd: at most three, most recently ranked first, and the count is all four (fay is the fourth)'
);
select is(
  (select f.also_txt from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p2'),
  '4:ana,cat,dan',
  'also_bevd: the ACTOR is excluded per post -- on ben''s post of the same Bev, ben is out and ana is in'
);
select is(
  (select f.also_txt from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p4'),
  '5:ana,ben,cat',
  'also_bevd: on the caller''s own post the caller is not listed, and all five friends count'
);
select is(
  (select f.also_bevd from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p3'),
  '{"count": 0, "items": []}'::jsonb,
  'also_bevd: a Bev nobody else ranked is count 0 and an empty array, not null'
);
select is(
  (select f.also_txt from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p5'),
  '1:ben',
  'also_bevd: an adult caller sees who else ranked an alcoholic Bev'
);
select is(
  (select f.also_txt from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p6'),
  '2:ben,cat',
  'also_bevd: two people who ranked at the same instant come in id order'
);
select ok(
  not exists (
    select 1
      from v_feed f
     cross join lateral jsonb_array_elements(f.also_bevd -> 'items') i(item)
     where f.viewer = 'me'
       and (i.item ->> 'user_id')::uuid in (f.actor_id, '00000000-0000-4000-8000-000000003101')
  ),
  'also_bevd: no row of either function ever lists its own actor or the caller'
);
select ok(
  not exists (
    select 1
      from v_feed f
     cross join lateral jsonb_array_elements(f.also_bevd -> 'items') i(item)
     where f.viewer = 'me'
       and (i.item ->> 'user_id')::uuid in ('00000000-0000-4000-8000-000000003106',
                                           '00000000-0000-4000-8000-000000003109')
  ),
  'also_bevd: people the caller does not follow (eve, the most recent ranker of all, and sol) never appear'
);
select ok(
  (select bool_and(jsonb_array_length(f.also_bevd -> 'items') <= 3
                   and (f.also_bevd ->> 'count')::int >= jsonb_array_length(f.also_bevd -> 'items'))
     from v_feed f),
  'also_bevd: never more than three items, and the count is never less than the items'
);
select is(
  (select array_agg(jk.jkey order by jk.jkey)
     from v_feed f
    cross join lateral jsonb_object_keys(f.also_bevd -> 'items' -> 0) jk(jkey)
    where f.viewer = 'me' and f.src = 'feed' and f.post = 'p1'),
  array['avatar_path', 'bucket', 'created_at', 'display_name', 'handle', 'onboarded', 'score', 'timezone', 'user_id'],
  'also_bevd: an item is a profile''s public columns plus score and bucket -- no birth_date, nothing else'
);
select is(
  (select (f.also_bevd -> 'items' -> 0 ->> 'handle') || ' ' || (f.also_bevd -> 'items' -> 0 ->> 'score')
          || ' ' || (f.also_bevd -> 'items' -> 0 ->> 'bucket') || ' ' || (f.also_bevd -> 'items' -> 0 ->> 'timezone')
     from v_feed f where f.viewer = 'me' and f.src = 'feed' and f.post = 'p1'),
  'pgtapsoc03 8.20 3 UTC',
  'also_bevd: the score and bucket are that friend''s own ranking of the Bev (ben''s 8.20, LOVED)'
);

-- get_user_feed carries the same value for the same post.
select is(
  (select array_agg(f.post order by f.ord) from v_feed f where f.viewer = 'me' and f.src = 'user:ana'),
  array['p6', 'p5', 'p3', 'p1'],
  'get_user_feed: one user''s posts, newest first, as before'
);
select is(
  (select jsonb_agg(f.also_bevd order by f.ord) from v_feed f where f.viewer = 'me' and f.src = 'user:ana'),
  (select jsonb_agg(f.also_bevd order by f.ord) from v_feed f
    where f.viewer = 'me' and f.src = 'feed' and f.post in ('p6', 'p5', 'p3', 'p1')),
  'get_user_feed: also_bevd is the same value get_feed gives for the same posts'
);
select is(
  (select array_agg(f.post || ' ' || f.also_txt order by f.ord) from v_feed f where f.viewer = 'me' and f.src = 'user:me'),
  array['p4 5:ana,ben,cat'],
  'get_user_feed on the caller''s own profile: relative to the caller, who is not listed'
);
select is(
  (select array[f.like_count, f.comment_count, f.inline_comments]
     from v_feed f where f.viewer = 'me' and f.src = 'user:ana' and f.post = 'p1'),
  array[1, 1, 1],
  'get_user_feed: like_count, comment_count and the inline comments are unchanged'
);

-- As kid (16; follows ana, ben and eve, not me).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003110", "role": "authenticated"}';

insert into t_raw
select 'kid', 'feed', t.ordinality, t.id, t.actor_id, t.score, t.bucket, t.in_my_want_to_try,
       t.like_count, t.liked_by_me, t.comment_count, t.comments, t.also_bevd
  from public.get_feed(50, null) with ordinality t;
insert into t_raw
select 'kid', 'user:ana', t.ordinality, t.id, t.actor_id, t.score, t.bucket, t.in_my_want_to_try,
       t.like_count, t.liked_by_me, t.comment_count, t.comments, t.also_bevd
  from public.get_user_feed('00000000-0000-4000-8000-000000003102', 50, null) with ordinality t;

select is(
  (select array_agg(f.post order by f.ord) from v_feed f where f.viewer = 'kid' and f.src = 'feed'),
  array['p6', 'p3', 'p2', 'p1'],
  'get_feed: under 21 the alcoholic post (p5) is still hidden, and a stranger''s post (p4) is not there'
);
select is(
  (select array_agg(f.post order by f.ord) from v_feed f where f.viewer = 'kid' and f.src = 'user:ana'),
  array['p6', 'p3', 'p1'],
  'get_user_feed: under 21 the alcoholic post is still hidden'
);
select is(
  (select array_agg(f.post || ' ' || f.also_txt order by f.ord) from v_feed f where f.viewer = 'kid' and f.src = 'feed'),
  array['p6 1:ben', 'p3 0:', 'p2 2:eve,ana', 'p1 2:eve,ben'],
  'also_bevd is relative to the caller: kid follows eve, so eve leads; cat, dan and fay are not kid''s to see here'
);
select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-000000003101', 50, null)),
  0,
  'get_user_feed: a stranger''s page is still empty, not an error'
);
select throws_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-00000000ffff', 50, null) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_user_feed: an unknown user is still not found'
);
select throws_ok(
  $$ select public.feed_also_bevd(null, null) $$,
  '42501', null,
  'feed_also_bevd cannot be called by a client'
);

-- As new (follows nobody).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003111", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_feed(50, null)),
  0,
  'get_feed: someone who follows nobody and has posted nothing still has an empty feed'
);

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-000000003102', 50, null) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_user_feed: no session is still unauthorized'
);

-- feed_also_bevd on its own, as the owner (no client role may call it). The
-- claims still say who "the caller" is: auth.uid() reads them, not the role.
reset role;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003110", "role": "authenticated"}';
select is(
  public.feed_also_bevd((select id from t_bevs where label = 'booze'),
                        (select id from t_users where label = 'ana')),
  '{"count": 0, "items": []}'::jsonb,
  'feed_also_bevd gates alcohol itself: under 21, ben''s ranking of the alcoholic Bev is not counted'
);
select is(
  public.feed_also_bevd((select id from t_bevs where label = 'hit'),
                        (select id from t_users where label = 'ana')) ->> 'count',
  '2',
  'and for the same caller a non-alcoholic Bev is counted as usual'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003101", "role": "authenticated"}';
select is(
  public.feed_also_bevd((select id from t_bevs where label = 'booze'),
                        (select id from t_users where label = 'ana')) ->> 'count',
  '1',
  'feed_also_bevd: the same alcoholic Bev is counted for a caller of 21 or more'
);
select is(
  public.feed_also_bevd(null, (select id from t_users where label = 'ana')),
  '{"count": 0, "items": []}'::jsonb,
  'feed_also_bevd: a post whose Bev is gone has nobody'
);

-- ===========================================================================
-- get_followed_by
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003101", "role": "authenticated"}';

select lives_ok(
  $$ select * from public.get_followed_by(array['00000000-0000-4000-8000-000000003106']::uuid[]) $$,
  'get_followed_by runs for a signed-in caller'
);

-- eve twice: one row per distinct id.
insert into t_fb_raw
select 'me', t.ordinality, t.user_id, t.followed_by_count, t.followed_by
  from public.get_followed_by(array['00000000-0000-4000-8000-000000003106',
                                    '00000000-0000-4000-8000-000000003109',
                                    '00000000-0000-4000-8000-000000003111',
                                    '00000000-0000-4000-8000-000000003106']::uuid[]) with ordinality t;

select is(
  (select array_agg(f.asked order by f.ord) from v_fb f where f.viewer = 'me'),
  array['eve', 'sol', 'new'],
  'get_followed_by: one row per distinct id asked about, in id order'
);
select is(
  (select f.by_txt from v_fb f where f.viewer = 'me' and f.asked = 'eve'),
  '3:ben,cat',
  'followed_by: at most two, the most recent follower first, and the count is all three (ana is the third)'
);
select is(
  (select f.by_txt from v_fb f where f.viewer = 'me' and f.asked = 'sol'),
  '1:ben',
  'followed_by: one mutual is one profile and a count of 1'
);
select is(
  (select f.by_txt || ' ' || f.followed_by::text from v_fb f where f.viewer = 'me' and f.asked = 'new'),
  '0: []',
  'followed_by: nobody the caller follows follows them -- count 0 and an empty array, not null'
);
select ok(
  not exists (
    select 1
      from v_fb f
     cross join lateral jsonb_array_elements(f.followed_by) i(item)
     where f.viewer = 'me'
       and (i.item ->> 'user_id')::uuid in ('00000000-0000-4000-8000-000000003101',
                                           '00000000-0000-4000-8000-000000003110')
  ),
  'followed_by: never the caller, and never kid, who follows eve but whom the caller does not follow'
);
select is(
  (select array_agg(jk.jkey order by jk.jkey)
     from v_fb f
    cross join lateral jsonb_object_keys(f.followed_by -> 0) jk(jkey)
    where f.viewer = 'me' and f.asked = 'eve'),
  array['avatar_path', 'created_at', 'display_name', 'handle', 'onboarded', 'timezone', 'user_id'],
  'followed_by: an item is a profile''s public columns -- no birth_date, nothing else'
);
select is(
  (select f.followed_by -> 0 ->> 'handle' from v_fb f where f.viewer = 'me' and f.asked = 'eve'),
  'pgtapsoc03',
  'followed_by: the profile is the follower''s (ben)'
);
select is(
  (select t.followed_by_count
     from public.get_followed_by(array['00000000-0000-4000-8000-000000003105']::uuid[]) t),
  0,
  'followed_by reads the edge one way: eve follows dan, but nobody me follows does'
);
select is(
  (select array_agg(t.followed_by_count::text || ' ' || t.followed_by::text)
     from public.get_followed_by(array['00000000-0000-4000-8000-00000000ffff']::uuid[]) t),
  array['0 []'],
  'get_followed_by: an id that is no user is answered like anyone nobody follows'
);
select is(
  (select count(*)::int from public.get_followed_by('{}'::uuid[]))
    + (select count(*)::int from public.get_followed_by(null)),
  0,
  'get_followed_by: an empty or null list is an empty result'
);
select throws_ok(
  $$ select * from public.get_followed_by(array(select gen_random_uuid() from generate_series(1, 51))) $$,
  '22023', 'BEVI_VALIDATION',
  'get_followed_by: more than 50 ids is a validation error'
);
select lives_ok(
  $$ select * from public.get_followed_by(array(select gen_random_uuid() from generate_series(1, 50))) $$,
  'get_followed_by: exactly 50 ids is allowed'
);

-- As kid (follows ana, ben and eve).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003110", "role": "authenticated"}';

insert into t_fb_raw
select 'kid', t.ordinality, t.user_id, t.followed_by_count, t.followed_by
  from public.get_followed_by(array['00000000-0000-4000-8000-000000003106',
                                    '00000000-0000-4000-8000-000000003105']::uuid[]) with ordinality t;

select is(
  (select array_agg(f.asked || ' ' || f.by_txt order by f.ord) from v_fb f where f.viewer = 'kid'),
  array['dan 1:eve', 'eve 2:ben,ana'],
  'followed_by is relative to the caller: kid does not follow cat, and does follow eve, who follows dan'
);

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$ select * from public.get_followed_by(array['00000000-0000-4000-8000-000000003106']::uuid[]) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_followed_by: no session is unauthorized'
);

reset role;
select * from finish();
rollback;
