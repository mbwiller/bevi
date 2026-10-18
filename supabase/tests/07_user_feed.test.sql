-- S-20 (20261018000300): get_user_feed, one user's posts in get_feed's shape,
-- gated by feed_event_visible.
begin;
select plan(17);

-- e1 posts (adult, so it can rank an alcoholic Bev); e2 follows e1 and is 16;
-- e3 is an adult who follows nobody.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000e1', 'pgtapufeed1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e2', 'pgtapufeed2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e3', 'pgtapufeed3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000000e1';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000e2';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000000e3';
set local bevi.rpc_bypass = 'false';

insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1');

-- ---------------------------------------------------------------------------
-- Shape and grants.
-- ---------------------------------------------------------------------------

select is(
  pg_get_function_result('public.get_user_feed(uuid, int, bigint)'::regprocedure),
  pg_get_function_result('public.get_feed(int, bigint)'::regprocedure),
  'get_user_feed returns exactly get_feed''s columns'
);
select ok(
  not has_function_privilege('anon', 'public.get_user_feed(uuid, int, bigint)', 'execute'),
  'anon cannot execute get_user_feed'
);
select ok(
  has_function_privilege('authenticated', 'public.get_user_feed(uuid, int, bigint)', 'execute'),
  'authenticated can execute get_user_feed'
);

-- ---------------------------------------------------------------------------
-- Three posts by e1, oldest first: plain, alcoholic, plain. One bucket each,
-- so every submit is the first in its bucket.
-- ---------------------------------------------------------------------------

create temporary table t_events (label text primary key, id bigint) on commit drop;
grant select, insert on t_events to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
    order by b.name, b.id limit 1),
  3::smallint, 0, 0);
insert into t_events values ('plain1', (select max(id) from public.feed_events));

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
    order by b.name, b.id limit 1),
  2::smallint, 0, 0);
insert into t_events values ('booze', (select max(id) from public.feed_events));

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
    order by b.name desc, b.id limit 1),
  1::smallint, 0, 0);
insert into t_events values ('plain2', (select max(id) from public.feed_events));

-- ---------------------------------------------------------------------------
-- As e2 (follows e1, under 21): a like and a comment, then e1's page.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e2", "role": "authenticated"}';

select public.like_post((select id from t_events where label = 'plain1'));
select public.add_comment((select id from t_events where label = 'plain1'), 'nice');

select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)),
  2,
  'a follower under 21 sees the followee''s two non-alcoholic posts'
);
select ok(
  not exists (
    select 1 from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)
     where id = (select id from t_events where label = 'booze')
  ),
  'the alcoholic post is hidden from a caller under 21'
);
select is(
  (select liked_by_me from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)
    where id = (select id from t_events where label = 'plain1')),
  true,
  'liked_by_me is the caller''s own like'
);

-- ---------------------------------------------------------------------------
-- As e1: their own profile.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

select is(
  (select array_agg(id order by ord)
     from (select id, row_number() over () as ord
             from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)) t),
  array[(select id from t_events where label = 'plain2'),
        (select id from t_events where label = 'booze'),
        (select id from t_events where label = 'plain1')],
  'the owner sees all three posts, newest first'
);
select is(
  (select array[like_count, comment_count, jsonb_array_length(comments)]
     from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)
    where id = (select id from t_events where label = 'plain1')),
  array[1, 1, 1],
  'like_count, comment_count and the inline comments match get_feed''s'
);
select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 2, null)),
  2,
  'p_limit caps the page'
);
select is(
  (select array_agg(id)
     from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 2,
                               (select id from t_events where label = 'booze'))),
  array[(select id from t_events where label = 'plain1')],
  'p_before_id continues after the last row of the previous page'
);
select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-0000000000e2', 20, null)),
  0,
  'a user with no posts has an empty page'
);

-- ---------------------------------------------------------------------------
-- As e3 (follows nobody): a stranger's posts are not visible.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e3", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null)),
  0,
  'a stranger gets an empty page, not an error'
);
select is(
  (select count(*)::int from public.get_feed(20, null)),
  0,
  'and get_feed agrees: none of those posts are visible'
);
select ok(
  (select count(*) from public.rankings where user_id = '00000000-0000-4000-8000-0000000000e1') > 0,
  'the stranger can still read the rankings themselves (rankings.listUser path)'
);

select throws_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-00000000ffff', 20, null) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'an unknown user is not found'
);
select lives_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 0, null) $$,
  'p_limit 0 is clamped instead of raising'
);

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$ select * from public.get_user_feed('00000000-0000-4000-8000-0000000000e1', 20, null) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'no session is unauthorized'
);

reset role;
select * from finish();
