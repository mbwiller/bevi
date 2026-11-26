-- IS-7 follow-up (20261119100000): report_content accepts exactly what the
-- caller can be shown -- the feed, a profile, comments, AND Explore -- and no
-- more, with both review rules intact: (a) content whose author blocked the
-- caller stays not-found, (b) the "I blocked them" exception is one-way.
--
-- THE PEOPLE (uuid band ...0000000042NN, used by no other file):
--
--   label  NN  follows   notes
--   me     01  mid       the caller
--   mid    02  far       me's only follow: the bridge to far
--   far    03  -         two hops from me
--   str    04  -         no path from me at all
--   blk    05  mid       comments on mid's post, then blocks me
--   kid    06  -         16 years old (the alcohol gate)
--   f10-29     -         filler, added in phase 2 to end D-01's fallback
--
-- PHASE 1 runs with fewer than 20 profiles, so get_explore's D-01 fallback
-- shows everyone. PHASE 2 adds 20 profiles, and Explore becomes two hops.
-- In both, every "reportable" assertion is paired with what get_explore
-- itself returns, so the two cannot drift apart unnoticed.
begin;
select plan(20);

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000042' || v.nn)::uuid
  from (values ('me', '01'), ('mid', '02'), ('far', '03'), ('str', '04'), ('blk', '05'), ('kid', '06')) v(label, nn);
grant select on t_users to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapexplore' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

set local bevi.rpc_bypass = 'true';
update public.profiles
   set birth_date = case when id = (select id from t_users where label = 'kid')
                         then (current_date - interval '16 years')::date
                         else (current_date - interval '30 years')::date end
 where id in (select id from t_users);
set local bevi.rpc_bypass = 'false';
update public.profiles set timezone = 'UTC' where id in (select id from t_users);

-- Onboarded, because submit_ranking posts nothing before onboarding ends
-- (20261128000100) and this file's rankings are meant to be posts.
update public.profiles set onboarded = true where id in (select id from t_users);

insert into public.follows (follower_id, followee_id)
select a.id, b.id
  from (values ('me', 'mid'), ('mid', 'far'), ('blk', 'mid')) v(f, t)
  join t_users a on a.label = v.f
  join t_users b on b.label = v.t;

create temporary table t_bevs (n int primary key, id uuid not null) on commit drop;
insert into t_bevs (n, id)
select row_number() over (order by b.name, b.id), b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id
 limit 4;
-- n = 0: one alcoholic Bev, for the age gate.
insert into t_bevs (n, id)
select 0, b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
 order by b.name, b.id
 limit 1;
grant select on t_bevs to authenticated;

create temporary table t_posts (label text primary key, id bigint not null) on commit drop;
create temporary table t_cmts  (label text primary key, id bigint not null) on commit drop;
grant select, insert on t_posts, t_cmts to authenticated;

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004202", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 1), 3::smallint, 0, 0);
insert into t_posts values ('mid', (select max(id) from public.feed_events));

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004203", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 2), 3::smallint, 0, 0);
insert into t_posts values ('far', (select max(id) from public.feed_events));
select public.add_comment((select id from t_posts where label = 'far'), 'far on far''s post');
insert into t_cmts values ('far', (select max(id) from public.post_comments));
select public.submit_ranking((select id from t_bevs where n = 4), 2::smallint, 0, 0);
insert into t_posts values ('far2', (select max(id) from public.feed_events));

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004204", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 3), 3::smallint, 0, 0);
insert into t_posts values ('str', (select max(id) from public.feed_events));
select public.submit_ranking((select id from t_bevs where n = 0), 2::smallint, 0, 0);
insert into t_posts values ('str_alc', (select max(id) from public.feed_events));

-- blk follows mid, so blk may comment on mid's post; then blk blocks me.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004205", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 4), 3::smallint, 0, 0);
insert into t_posts values ('blk', (select max(id) from public.feed_events));
select public.add_comment((select id from t_posts where label = 'mid'), 'blk on mid''s post');
insert into t_cmts values ('blk', (select max(id) from public.post_comments));
select public.block_user('00000000-0000-4000-8000-000000004201'::uuid);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004201", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where n = 1), 3::smallint, 0, 0);
insert into t_posts values ('me', (select max(id) from public.feed_events));

-- ---------------------------------------------------------------------------
-- Phase 1: fewer than 20 profiles, so Explore is everyone (D-01)
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) from public.profiles) < 20,
  'phase 1 runs under D-01: fewer than 20 profiles, so Explore shows everyone'
);
select ok(
  exists (select 1 from public.get_explore(50) x where x.id = (select id from t_posts where label = 'str')),
  'get_explore shows me str''s post: a stranger with no follow path'
);
select lives_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'str')) $$,
  'report_content: a stranger''s post that Explore shows is reportable (was BEVI_NOT_FOUND)'
);
select ok(
  not exists (select 1 from public.get_explore(50) x where x.id = (select id from t_posts where label = 'blk')),
  'get_explore does not show me blk''s post: blk blocked me'
);
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'blk')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a post whose author blocked the caller is still not found, Explore or not'
);
select throws_ok(
  $$ select public.report_content('spam', p_comment_id => (select id from t_cmts where label = 'blk')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a comment whose author blocked the caller is not found, though the post it is on is visible'
);
select throws_ok(
  $$ select public.report_content('spam', p_comment_id => (select id from t_cmts where label = 'far')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a comment on a stranger''s post is not found -- Explore never shows comments (D-15)'
);
select lives_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'mid')) $$,
  'report_content: a followed user''s post is reportable, as before'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004206", "role": "authenticated"}';
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'str_alc')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a minor cannot report a stranger''s alcoholic post -- Explore would not show it to them'
);
select lives_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'str')) $$,
  'report_content: the same minor can report the same stranger''s non-alcoholic post'
);

-- ---------------------------------------------------------------------------
-- Phase 2: 20 more profiles, so Explore is two hops
-- ---------------------------------------------------------------------------

reset role;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('00000000-0000-4000-8000-0000000042' || g)::uuid,
       'pgtapexplore' || g || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from generate_series(10, 29) g;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004201", "role": "authenticated"}';

select ok(
  (select count(*) from public.profiles) >= 20,
  'phase 2: at least 20 profiles, so D-01''s fallback is off'
);
select ok(
  exists (select 1 from public.get_explore(50) x where x.id = (select id from t_posts where label = 'far'))
    and not exists (select 1 from public.get_explore(50) x where x.id = (select id from t_posts where label = 'str_alc')),
  'get_explore now shows far (two hops, via mid) and not str (no path)'
);
select lives_ok(
  $$ select public.report_content('hate', p_feed_event_id => (select id from t_posts where label = 'far')) $$,
  'report_content: a two-hop stranger''s post that Explore shows is reportable'
);
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'str_alc')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: a post Explore cannot show me (no follow path, instance past D-01) is not found -- no wider than shown'
);

-- (b) The exception is one-directional.
select public.block_user('00000000-0000-4000-8000-000000004204'::uuid);
select lives_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'str_alc')) $$,
  'report_content: after me blocks str, me can report str''s post (Block then Report)'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004204", "role": "authenticated"}';
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'me')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: str, whom me blocked, cannot report me''s post'
);

-- (a) in two-hop mode: far blocks me, and far's Explore post goes dark.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004201", "role": "authenticated"}';
select ok(
  exists (select 1 from public.get_explore(50) x where x.id = (select id from t_posts where label = 'far2')),
  'before the block, get_explore shows me far''s second post'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004203", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004201'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004201", "role": "authenticated"}';
select throws_ok(
  $$ select public.report_content('spam', p_feed_event_id => (select id from t_posts where label = 'far2')) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'report_content: once its author blocked the caller, a two-hop Explore post is not found -- the same answer as a missing post'
);

-- ---------------------------------------------------------------------------
-- Shape and privileges: unchanged
-- ---------------------------------------------------------------------------

reset role;
select ok(
  has_function_privilege('authenticated', 'public.report_content(text,bigint,bigint,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.report_content(text,bigint,bigint,uuid,text)', 'EXECUTE'),
  'report_content keeps its signature and grants: authenticated yes, anon no'
);
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'report_content'),
  'bigint',
  'report_content still returns bigint'
);

select * from finish();
rollback;
