-- A-03 (20261014000300): post_comments, the three RPCs, and the two new
-- get_feed columns.
begin;
select plan(20);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000d1', 'pgtapcomment1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d2', 'pgtapcomment2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d3', 'pgtapcomment3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000000d1',
              '00000000-0000-4000-8000-0000000000d2',
              '00000000-0000-4000-8000-0000000000d3');

-- d2 follows d1, so d1's post is in d2's feed. d3 follows nobody.
insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d1');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_comments'::regclass),
  'post_comments has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'post_comments'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on post_comments'
);

-- ---------------------------------------------------------------------------
-- d1 posts, then comments on it eight times (one past the inline seven).
-- ---------------------------------------------------------------------------

-- Both fixture tables are made here, by the owner, before the role switch:
-- `authenticated` needs explicit grants to use them (without that the
-- assertions die with 42501 instead of running), and creating one *as*
-- authenticated would instead depend on it holding TEMP on the database.
create temporary table t_event (id bigint) on commit drop;
create temporary table t_comments (n int, id bigint) on commit drop;
grant select, insert on t_event, t_comments to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select public.submit_ranking(
  (select b.id from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
    order by b.name, b.id limit 1),
  3::smallint, 0, 0);
insert into t_event values ((select max(id) from public.feed_events));

select throws_ok(
  $$ select public.add_comment((select id from t_event), '   ') $$,
  '22023', 'BEVI_VALIDATION',
  'an empty body is rejected'
);
select throws_ok(
  $$ select public.add_comment((select id from t_event), E'\n\t\n') $$,
  '22023', 'BEVI_VALIDATION',
  'a whitespace-only body (newlines, tabs) is rejected'
);
select throws_ok(
  $$ select public.add_comment((select id from t_event), repeat('x', 281)) $$,
  '22023', 'BEVI_VALIDATION',
  'a 281-character body is rejected'
);

insert into t_comments (n, id)
select g.g, c.id
  from generate_series(1, 8) g,
       lateral public.add_comment((select id from t_event), 'comment ' || g.g) c;

select is(
  (select count(*)::int from public.get_comments((select id from t_event), 20, null)),
  8,
  'get_comments returns all eight'
);

-- ---------------------------------------------------------------------------
-- Keyset paging, newest first.
-- ---------------------------------------------------------------------------

select is(
  (select count(distinct id)::int from (
     select id from public.get_comments((select id from t_event), 2, null)
     union all
     select id from public.get_comments(
       (select id from t_event), 2,
       (select min(id) from public.get_comments((select id from t_event), 2, null)))
   ) pages),
  4,
  'two pages of two return four distinct comments, none repeated'
);
select is(
  (select id from public.get_comments((select id from t_event), 1, null)),
  (select id from t_comments where n = 8),
  'the first page starts at the newest comment'
);

-- ---------------------------------------------------------------------------
-- get_feed's inline seven.
-- ---------------------------------------------------------------------------

select is(
  (select jsonb_array_length(comments) from public.get_feed(20, null)
    where id = (select id from t_event)),
  7,
  'get_feed carries seven comments inline'
);
select is(
  (select (comments -> 0 ->> 'id')::bigint from public.get_feed(20, null)
    where id = (select id from t_event)),
  (select id from t_comments where n = 1),
  'oldest first, which is the reading order under a post'
);
select is(
  (select (comments -> 6 ->> 'id')::bigint from public.get_feed(20, null)
    where id = (select id from t_event)),
  (select id from t_comments where n = 7),
  'the inline seven are the first seven, not the newest'
);
select is(
  (select comment_count from public.get_feed(20, null)
    where id = (select id from t_event)),
  8,
  'comment_count is the full total, not the inline seven'
);

-- ---------------------------------------------------------------------------
-- Deleting.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.delete_comment((select id from t_comments where n = 1)) $$,
  'delete_comment on an own comment succeeds'
);
select ok(
  (select count(*)::int from public.get_comments((select id from t_event), 20, null)) = 7
    and (select comment_count from public.get_feed(20, null)
          where id = (select id from t_event)) = 7,
  'a deleted comment leaves both get_comments and comment_count'
);
select lives_ok(
  $$ select public.delete_comment((select id from t_comments where n = 1)) $$,
  'deleting it again does not raise'
);

-- ---------------------------------------------------------------------------
-- As d2 (follows d1): can read the thread, cannot delete d1's comments.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';

select is(
  (select count(*)::int from public.post_comments
    where feed_event_id = (select id from t_event)),
  7,
  'a follower reads the live comments directly through RLS'
);

select throws_ok(
  $$ select public.delete_comment((select id from t_comments where n = 2)) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'another user''s comment cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- As d3 (follows nobody): the post is not theirs to see, nor its comments.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d3", "role": "authenticated"}';

select is(
  (select count(*)::int from public.post_comments
    where feed_event_id = (select id from t_event)),
  0,
  'RLS hides comments on a post the caller cannot see'
);
select throws_ok(
  $$ select * from public.get_comments((select id from t_event), 20, null) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'get_comments on an invisible post is not found'
);
select throws_ok(
  $$ select public.add_comment((select id from t_event), 'hi') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'add_comment on an invisible post is not found'
);

reset role;
select * from finish();
rollback;
