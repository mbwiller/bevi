-- T-31, Release 2 (20261127000100): push notifications and their settings.
--
-- What this file is for: the settings read their defaults and store what they
-- are given; a post subscription needs a follow and dies with it (unfollow,
-- block, account deletion); the people list is the people you follow; a device
-- token belongs to one account and is capped; the queue is written once per
-- thing that happened (a like / unlike / like loop is one push) and once per
-- subscriber for a NEW ranking only; and claim_push_batch -- the one place a
-- push is judged -- returns exactly the pushes that may go out, with tokens and
-- the badge, and finishes every other one with the reason. Then the lease,
-- finish and retry, the receipts, the drain's housekeeping, and that nothing
-- was POSTed: with no Vault secrets the poke is inert.
--
-- Release 1's 46_notifications.test.sql still runs unchanged: this migration
-- re-created visible_notifications() over visible_notifications_for(), and
-- that file is the proof its behaviour did not move.
--
-- THE PEOPLE (uuid band ...0000000047NN; nothing else in supabase/tests/ uses
-- it, and seed.sql creates no users). Everyone is 30 except m, who is 18.
--
--   a 01  the poster; recipient of most pushes
--   b 02  follows a; subscribed to a's posts; likes and comments
--   c 03  follows a; the unfollow case, later paused
--   d 04  follows a; later turns follow pushes off
--   m 05  the minor; follows a, subscribed (the age gate)
--   e 06  tokens; the block case
--   x 07  blocks b; later a new follower of a
--   y 08  blocked by b; later the recipient with no device
--   z 09  deletes their account
--   w 10  a new follower of a (the writers)
--   v 11  follows a, then a blocks v
--   u 12  follows a, then blocks a
--   t 13  follows a, then unfollows
--
-- All of it happens in one transaction, so now() is one instant; the ages a
-- test needs (a stale lease, an expired push, an old ticket) are written by
-- hand as postgres.
begin;
select plan(105);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000047' || v.nn)::uuid
  from (values ('a', '01'), ('b', '02'), ('c', '03'), ('d', '04'), ('m', '05'), ('e', '06'), ('x', '07'),
               ('y', '08'), ('z', '09'), ('w', '10'), ('v', '11'), ('u', '12'), ('t', '13')) v(label, nn);
grant select on t_users to authenticated, service_role;

-- handle_new_user makes each profile; the handle is the email's local part.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtappush' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users);
update public.profiles set birth_date = (current_date - interval '18 years')::date
 where id = '00000000-0000-4000-8000-000000004705';
set local bevi.rpc_bypass = 'false';

create temporary table t_bevs (label text primary key, id uuid) on commit drop;
insert into t_bevs (label, id)
select 'soft' || s.n, s.id
  from (
    select b.id, row_number() over (order by b.name, b.id) as n
      from public.bevs b join public.categories c on c.id = b.category_id
     where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
  ) s
 where s.n <= 2;
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

-- One row per queued push a test is about, by label.
create temporary table t_ob (label text primary key, id bigint not null unique) on commit drop;
grant select on t_ob to authenticated, service_role;

-- claim_push_batch's columns, in its order.
create temporary table t_claim (
  id bigint, kind text, recipient_id uuid, tokens text[], actor_id uuid, actor_handle text,
  feed_event_id bigint, bev_name text, bev_brand text, bev_flavor text,
  comment_id bigint, comment_body text, badge integer
) on commit drop;
grant select, insert on t_claim to service_role;
grant select on t_claim to authenticated;

-- Each person's view of private.is_blocked and viewer_is_adult, for section 11.
create temporary table t_parity (who text, other text, blocked boolean, adult boolean) on commit drop;
grant insert on t_parity to authenticated;

-- Counting pg_net's queue needs a function: a static reference to
-- net.http_request_queue would not parse where pg_net is absent (as 12_embed).
create temporary table t_net (queued int not null) on commit drop;
create function pg_temp.net_queued() returns int language plpgsql as $fn$
declare n int := 0;
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'select count(*)::int from net.http_request_queue' into n;
  end if;
  return n;
end;
$fn$;
insert into t_net (queued) values (pg_temp.net_queued());

select is(
  (select count(*)::int from t_bevs where id is not null),
  3,
  'fixture: the seeded catalog has two non-alcoholic Bevs and an alcoholic one to post'
);

-- ---------------------------------------------------------------------------
-- 1. Schema and privileges
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class
    where oid in ('public.notification_settings'::regclass, 'public.post_notification_subscriptions'::regclass,
                  'public.push_tokens'::regclass, 'public.push_outbox'::regclass, 'public.push_tickets'::regclass)
      and relrowsecurity),
  5,
  'RLS is on for all five new tables'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('notification_settings', 'post_notification_subscriptions', 'push_tokens', 'push_outbox', 'push_tickets')),
  0,
  'and none has a policy: every read and write is a definer function'
);
select is(
  (select coalesce(string_agg(t.tbl || '/' || r.rolname || '/' || p.priv, ', ' order by t.tbl, r.rolname, p.priv), '')
     from (values ('public.notification_settings'), ('public.post_notification_subscriptions'),
                  ('public.push_tokens'), ('public.push_outbox'), ('public.push_tickets')) t(tbl)
     cross join (values ('anon'), ('authenticated')) r(rolname)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.rolname, t.tbl, p.priv)),
  '',
  'no client role holds any privilege on the five tables'
);

create temporary table t_fns (kind text, sig text) on commit drop;
insert into t_fns (kind, sig) values
  ('rpc', 'public.get_notification_settings()'),
  ('rpc', 'public.update_notification_settings(boolean, boolean, boolean, boolean, boolean)'),
  ('rpc', 'public.set_post_notification(uuid, boolean)'),
  ('rpc', 'public.get_post_notification_people(text, int, int)'),
  ('rpc', 'public.register_push_token(text, text)'),
  ('rpc', 'public.unregister_push_token(text)'),
  ('worker', 'public.claim_push_batch(int)'),
  ('worker', 'public.finish_push_batch(bigint[], text)'),
  ('worker', 'public.record_push_tickets(jsonb)'),
  ('worker', 'public.claim_push_receipts(int)'),
  ('worker', 'public.finish_push_receipts(text[])'),
  ('worker', 'public.prune_push_tokens(text[])'),
  ('internal', 'public.blocked_between(uuid, uuid)'),
  ('internal', 'public.user_is_adult(uuid)'),
  ('internal', 'public.visible_notifications_for(uuid)'),
  ('internal', 'public.notification_settings_of(uuid)'),
  ('internal', 'public.push_poke(text)'),
  ('internal', 'public.drain_push_outbox()'),
  ('internal', 'public.drop_post_notification_on_unfollow()'),
  ('internal', 'public.poke_push_sender()'),
  ('internal', 'public.enqueue_push_on_notification()'),
  ('internal', 'public.enqueue_push_on_post()');

select is(
  (select count(*)::int
     from t_fns f join pg_proc p on p.oid = f.sig::regprocedure
    where p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) c(setting) where c.setting like 'search_path=%')),
  22,
  'all 22 new functions are security definer, owned by postgres, with a pinned search_path'
);
select is(
  (select coalesce(string_agg(f.sig, ', ' order by f.sig), '') from t_fns f
    where f.kind = 'rpc' and not has_function_privilege('authenticated', f.sig, 'EXECUTE')),
  '',
  'authenticated may call the six app RPCs'
);
select is(
  (select coalesce(string_agg(f.sig || '/' || r.rolname, ', ' order by f.sig, r.rolname), '')
     from t_fns f cross join (values ('anon'), ('authenticated')) r(rolname)
    where (f.kind <> 'rpc' or r.rolname = 'anon')
      and has_function_privilege(r.rolname, f.sig, 'EXECUTE')),
  '',
  'anon may call none of them, and no client role may call a worker or internal function'
);
select is(
  (select coalesce(string_agg(f.sig, ', ' order by f.sig), '') from t_fns f
    where f.kind = 'worker' and not has_function_privilege('service_role', f.sig, 'EXECUTE')),
  '',
  'service_role may call the six worker functions'
);
select is(
  (select coalesce(string_agg(f.sig, ', ' order by f.sig), '') from t_fns f
    where f.kind = 'internal' and has_function_privilege('service_role', f.sig, 'EXECUTE')),
  '',
  'and none of the internal ones: no role can make the database POST the bearer token by hand'
);
-- grantee 0 is PUBLIC in an ACL.
select ok(
  not exists (
    select 1 from t_fns f join pg_proc p on p.oid = f.sig::regprocedure, aclexplode(p.proacl) a
     where a.grantee = 0
  ),
  'PUBLIC holds no execute grant on any of them'
);
select is(
  (select array_agg(c.relname::text || ':' || t.tgname::text order by t.tgname)
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where t.tgname in ('drop_post_notification_on_unfollow', 'enqueue_push_on_notification',
                       'enqueue_push_on_post', 'poke_push_sender')
      and not t.tgisinternal),
  array['follows:drop_post_notification_on_unfollow', 'notifications:enqueue_push_on_notification',
        'feed_events:enqueue_push_on_post', 'push_outbox:poke_push_sender'],
  'the four triggers: follows (delete), notifications and feed_events (insert), push_outbox (statement)'
);
select is(
  (select count(*)::int from cron.job where jobname = 'drain-push-outbox' and schedule = '* * * * *'),
  1,
  'the drain runs every minute from pg_cron'
);
-- Re-created, not changed: the same signature and result type as Release 1's.
select ok(
  (select p.proretset and p.prorettype = 'public.notifications'::regtype and p.pronargs = 0
     from pg_proc p where p.oid = 'public.visible_notifications()'::regprocedure)
  and not has_function_privilege('authenticated', 'public.visible_notifications()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.visible_notifications()', 'EXECUTE'),
  'visible_notifications() keeps its signature, its result type and its revokes'
);
-- 41_blocks_and_reports.test.sql's allowlist, restated: the internal
-- functions here read user_blocks, but no client role can call them.
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ilike '%user_blocks%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['block_user', 'list_blocked_users', 'report_content', 'unblock_user'],
  'test 41''s allowlist is unchanged: no client-callable function here reads user_blocks'
);

-- ---------------------------------------------------------------------------
-- 2. Settings
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';

select is(
  (select array[s.paused, s.follows, s.likes, s.comments, s.posts] from public.get_notification_settings() s),
  array[false, true, true, true, false],
  'with no row: not paused; follows, likes and comments on; posts off'
);
reset role;
select is(
  (select count(*)::int from public.notification_settings where user_id = '00000000-0000-4000-8000-000000004701'),
  0,
  'and reading them wrote nothing'
);
set local role authenticated;
select is(
  (select array[s.paused, s.follows, s.likes, s.comments, s.posts]
     from public.update_notification_settings(true, false, true, false, true) s),
  array[true, false, true, false, true],
  'update returns the five switches as stored'
);
select is(
  (select array[s.paused, s.follows, s.likes, s.comments, s.posts] from public.get_notification_settings() s),
  array[true, false, true, false, true],
  'and get reads them back'
);
select throws_ok(
  $$ select * from public.update_notification_settings(false, true, null, true, true) $$,
  '22023', 'BEVI_VALIDATION',
  'a null switch is a validation error, never "leave it as it was"'
);
select is(
  (select array[s.paused, s.follows, s.likes, s.comments, s.posts] from public.get_notification_settings() s),
  array[true, false, true, false, true],
  'and the refused update stored nothing'
);
-- Un-pause, flags untouched: exactly what was on comes back.
select is(
  (select array[s.paused, s.follows, s.likes, s.comments, s.posts]
     from public.update_notification_settings(false, false, true, false, true) s),
  array[false, false, true, false, true],
  'un-pausing leaves the four switches as they were'
);
-- a back to the defaults for the rest of the file.
select public.update_notification_settings(false, true, true, true, false);

-- ---------------------------------------------------------------------------
-- 3. Post subscriptions
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
select public.follow_user('00000000-0000-4000-8000-000000004703'::uuid);
select public.follow_user('00000000-0000-4000-8000-000000004705'::uuid);
select public.follow_user('00000000-0000-4000-8000-000000004707'::uuid);
select public.follow_user('00000000-0000-4000-8000-000000004708'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004703", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004704", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004709", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
-- x blocks b, and b blocks y: one block each way, each deleting b's follow.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004707", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004702'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004708'::uuid);

-- b, who follows a.
select lives_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true) $$,
  'b turns on post pushes for a, whom b follows'
);
select lives_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true) $$,
  'turning it on again is not an error'
);
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004702'),
  1,
  'and leaves one row'
);
set local role authenticated;
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004704'::uuid, true) $$,
  '22023', 'BEVI_VALIDATION',
  'b does not follow d: validation (not following)'
);
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004702'::uuid, true) $$,
  '22023', 'BEVI_VALIDATION',
  'nor can b subscribe to b'
);
-- No follow edge is always "not following", so the answer never tells a
-- blocked or missing person from one who exists.
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-0000000047ff'::uuid, true) $$,
  '22023', 'BEVI_VALIDATION',
  'a profile that does not exist is the same not following'
);
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004707'::uuid, true) $$,
  '22023', 'BEVI_VALIDATION',
  'so is x, who blocked b (the block took the follow)'
);
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004708'::uuid, true) $$,
  '22023', 'BEVI_VALIDATION',
  'and so is y, whom b blocked'
);
select lives_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004704'::uuid, false) $$,
  'turning off someone never turned on resolves'
);

-- c: an unfollow by the client's own direct delete (follows_delete).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004703", "role": "authenticated"}';
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);
delete from public.follows
 where follower_id = '00000000-0000-4000-8000-000000004703'
   and followee_id = '00000000-0000-4000-8000-000000004701';
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004703'),
  0,
  'an unfollow (a direct delete) removes the subscription'
);
set local role authenticated;
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004703'),
  0,
  'and following again does not bring it back'
);

-- m: an unfollow through unfollow_user, then m subscribes again for section 7.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);
select public.unfollow_user('00000000-0000-4000-8000-000000004701'::uuid);
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004705'),
  0,
  'unfollow_user removes it too'
);
set local role authenticated;
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);

-- e: a block by the person subscribed to.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004706'::uuid);
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004706'),
  0,
  'a block (which deletes the follow) removes it'
);
set local role authenticated;
select public.unblock_user('00000000-0000-4000-8000-000000004706'::uuid);

-- z: an account deletion.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004709", "role": "authenticated"}';
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);
select lives_ok($$ select public.delete_my_account() $$, 'z, subscribed to a, deletes their account');
reset role;
select is(
  (select count(*)::int from public.post_notification_subscriptions
    where subscriber_id = '00000000-0000-4000-8000-000000004709'),
  0,
  'and the subscription went with it'
);

-- ---------------------------------------------------------------------------
-- 4. get_post_notification_people
-- ---------------------------------------------------------------------------
-- b follows a (subscribed), c and m; x's and y's follows were taken by the blocks.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select is(
  (select array_agg(g.handle order by g.n)
     from public.get_post_notification_people() with ordinality
          g(user_id, handle, display_name, avatar_path, timezone, onboarded, created_at, subscribed, n)),
  array['pgtappush01', 'pgtappush03', 'pgtappush05'],
  'the people b follows, the subscribed one first, then by handle'
);
select is(
  (select array_agg(g.subscribed order by g.n)
     from public.get_post_notification_people() with ordinality
          g(user_id, handle, display_name, avatar_path, timezone, onboarded, created_at, subscribed, n)),
  array[true, false, false],
  'each with whether a post push is on'
);
select ok(
  (select g.user_id = '00000000-0000-4000-8000-000000004701' and g.display_name is not null
          and g.timezone is not null and g.created_at is not null
     from public.get_post_notification_people() g where g.handle = 'pgtappush01'),
  'each row embeds the person as list_blocked_users does'
);
select is(
  (select array_agg(g.handle) from public.get_post_notification_people('PUSH05') g),
  array['pgtappush05'],
  'q matches the handle, ignoring case'
);
select is(
  (select array_agg(g.handle) from public.get_post_notification_people('@pgtappush03') g),
  array['pgtappush03'],
  'and a leading @ is ignored'
);
select is(
  (select count(*)::int from public.get_post_notification_people('%')),
  0,
  'a LIKE wildcard is matched literally, not as "anything"'
);
select is(
  (select array_agg(g.handle) from public.get_post_notification_people(null, 1, 1) g),
  array['pgtappush03'],
  'offset paging: limit 1, offset 1 is the second row'
);
select throws_ok(
  $$ select * from public.get_post_notification_people(repeat('a', 81)) $$,
  '22023', 'BEVI_VALIDATION',
  'a query over 80 characters is a validation error'
);
-- A block row on its own, with the follow left in place, so the filter is
-- what hides c and not a missing follow.
reset role;
insert into public.user_blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-8000-000000004703', '00000000-0000-4000-8000-000000004702');
set local role authenticated;
select is(
  (select array_agg(g.handle order by g.n)
     from public.get_post_notification_people() with ordinality
          g(user_id, handle, display_name, avatar_path, timezone, onboarded, created_at, subscribed, n)),
  array['pgtappush01', 'pgtappush05'],
  'someone across a block is not listed, even while the follow row exists'
);
select throws_ok(
  $$ select public.set_post_notification('00000000-0000-4000-8000-000000004703'::uuid, true) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a follow row beside a block (no client path makes one) is the one case left not found'
);
reset role;
delete from public.user_blocks
 where blocker_id = '00000000-0000-4000-8000-000000004703'
   and blocked_id = '00000000-0000-4000-8000-000000004702';

-- ---------------------------------------------------------------------------
-- 5. Device tokens
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[pgtap-a]') $$,
  'a registers a device'
);
reset role;
select is(
  (select array[t.user_id::text, t.platform] from public.push_tokens t where t.token = 'ExponentPushToken[pgtap-a]'),
  array['00000000-0000-4000-8000-000000004701', 'ios'],
  'it is a''s, on ios by default'
);
set local role authenticated;
select throws_ok(
  $$ select public.register_push_token('not-a-token') $$,
  '22023', 'BEVI_VALIDATION',
  'something that is not an Expo push token is refused'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[]') $$,
  '22023', 'BEVI_VALIDATION',
  'an empty one too'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[pgtap-a]', 'web') $$,
  '22023', 'BEVI_VALIDATION',
  'and an unknown platform'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
select public.register_push_token('ExponentPushToken[pgtap-a]', 'android');
reset role;
select is(
  (select array[t.user_id::text, t.platform] from public.push_tokens t where t.token = 'ExponentPushToken[pgtap-a]'),
  array['00000000-0000-4000-8000-000000004706', 'android'],
  'the same device signed in as e moves to e: one device, one account'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.register_push_token('ExponentPushToken[pgtap-a]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
select lives_ok(
  $$ select public.unregister_push_token('ExponentPushToken[pgtap-a]') $$,
  'e unregistering a''s token resolves'
);
reset role;
select is(
  (select t.user_id from public.push_tokens t where t.token = 'ExponentPushToken[pgtap-a]'),
  '00000000-0000-4000-8000-000000004701'::uuid,
  'but touched nothing: only your own token can be unregistered'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.unregister_push_token('ExponentPushToken[pgtap-a]');
select lives_ok(
  $$ select public.unregister_push_token('ExponentPushToken[pgtap-a]') $$,
  'unregistering twice is not an error'
);
reset role;
select is(
  (select count(*)::int from public.push_tokens where token = 'ExponentPushToken[pgtap-a]'),
  0,
  'and a''s own unregister deleted it'
);

-- The cap: e registers ten, aged one minute apart (01 the oldest), then an eleventh.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
do $$
begin
  for i in 1..10 loop
    perform public.register_push_token('ExpoPushToken[pgtap-e-' || lpad(i::text, 2, '0') || ']');
  end loop;
end;
$$;
reset role;
update public.push_tokens t
   set last_seen_at = now() - (11 - right(rtrim(t.token, ']'), 2)::int) * interval '1 minute'
 where t.token like 'ExpoPushToken[pgtap-e-%';
set local role authenticated;
select public.register_push_token('ExpoPushToken[pgtap-e-11]');
reset role;
select is(
  (select array_agg(right(rtrim(t.token, ']'), 2) order by t.token)
     from public.push_tokens t where t.user_id = '00000000-0000-4000-8000-000000004706'),
  array['02', '03', '04', '05', '06', '07', '08', '09', '10', '11'],
  'at most ten per user: the eleventh pushed out the one seen longest ago'
);

-- The devices section 7 sends to. c, y and the rest have none.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.register_push_token('ExponentPushToken[pgtap-a]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.register_push_token('ExponentPushToken[pgtap-b]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
select public.register_push_token('ExpoPushToken[pgtap-m]');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004704", "role": "authenticated"}';
select public.register_push_token('ExponentPushToken[pgtap-d]');

-- ---------------------------------------------------------------------------
-- 6. The writers
-- ---------------------------------------------------------------------------

reset role;
delete from public.push_outbox;
set local role authenticated;

-- b and m want a's posts pushed (posts is off by default).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.update_notification_settings(false, true, true, true, true);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
select public.update_notification_settings(false, true, true, true, true);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where label = 'soft1'), 3::smallint, 0, 0);
insert into t_posts values ('p1', (select max(id) from public.feed_events));

-- w follows a for the first time.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004710", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);

-- b likes, unlikes and likes again, then comments.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
select public.unlike_post((select id from t_posts where label = 'p1'));
select public.like_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'b on p1');
insert into t_cmts values ('b1', (select max(id) from public.post_comments));

reset role;
select is(
  (select array_agg(u.label order by u.label)
     from public.push_outbox o join t_users u on u.id = o.recipient_id
    where o.kind = 'post' and o.feed_event_id = (select id from t_posts where label = 'p1')),
  array['b', 'm'],
  'a new ranking queues a post push for each subscriber (b, m) and for nobody else, a included'
);
select is(
  (select count(*)::int from public.push_outbox
    where kind = 'follow' and recipient_id = '00000000-0000-4000-8000-000000004701'
      and actor_id = '00000000-0000-4000-8000-000000004710'),
  1,
  'a follow queues one follow push'
);
select is(
  (select count(*)::int from public.push_outbox
    where kind = 'like' and actor_id = '00000000-0000-4000-8000-000000004702'
      and feed_event_id = (select id from t_posts where label = 'p1')),
  1,
  'like, unlike, like again queues ONE like push, ever'
);
select is(
  (select array_agg(o.comment_id) from public.push_outbox o
    where o.kind = 'comment' and o.recipient_id = '00000000-0000-4000-8000-000000004701'),
  array[(select id from t_cmts where label = 'b1')],
  'a comment queues one comment push, pointing at the comment'
);
select is(
  (select count(*)::int from public.notifications
    where feed_event_id = (select id from t_posts where label = 'p1')
      and recipient_id in ('00000000-0000-4000-8000-000000004702', '00000000-0000-4000-8000-000000004705')),
  0,
  'a post push adds nothing to the subscribers'' inboxes'
);

-- A second post, then a re-rank of it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where label = 'soft2'), 2::smallint, 0, 0);
insert into t_posts values ('p2', (select max(id) from public.feed_events));
select public.rerank_bev((select id from t_bevs where label = 'soft2'), 2::smallint, 0, 0);
insert into t_posts values ('p2r', (select max(id) from public.feed_events));
reset role;
select is(
  (select kind from public.feed_events where id = (select id from t_posts where label = 'p2r')),
  'reranked',
  'fixture: the re-rank wrote a reranked event'
);
select is(
  (select count(*)::int from public.push_outbox where feed_event_id = (select id from t_posts where label = 'p2r')),
  0,
  'a re-rank queues no post push'
);
select is(
  (select count(*)::int from public.push_outbox where feed_event_id = (select id from t_posts where label = 'p2')),
  0,
  'and the old post went, taking its queued pushes with it'
);

-- ---------------------------------------------------------------------------
-- 7. claim_push_batch
-- ---------------------------------------------------------------------------
-- One fresh row per case. The first five may go out; every other one has one
-- reason not to.

delete from public.push_outbox;
set local role authenticated;

-- follow_ok: x follows a.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004707", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
-- like_c, like_d, comment_ok: c and d like p1, c comments.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004703", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'c on p1');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004704", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
-- paused: c subscribes to a, then pauses (posts on).
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004703", "role": "authenticated"}';
select public.set_post_notification('00000000-0000-4000-8000-000000004701'::uuid, true);
select public.update_notification_settings(true, true, true, true, true);
-- post_b, age_gate (m), paused (c): a posts an alcoholic Bev.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where label = 'alc'), 1::smallint, 0, 0);
insert into t_posts values ('p3', (select max(id) from public.feed_events));
-- kind_off: d turns follow pushes off; b follows d.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004704", "role": "authenticated"}';
select public.update_notification_settings(false, false, true, true, false);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004704'::uuid);
-- no_tokens: e follows y, who has no device.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004706", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004708'::uuid);
-- blocked_by_recipient: v follows a, a blocks v.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004711", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select public.block_user('00000000-0000-4000-8000-000000004711'::uuid);
-- blocked_by_actor: u follows a, then u blocks a.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004712", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
select public.block_user('00000000-0000-4000-8000-000000004701'::uuid);
-- unliked, deleted_comment: m likes and unlikes; comments and deletes it.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
select public.like_post((select id from t_posts where label = 'p1'));
select public.unlike_post((select id from t_posts where label = 'p1'));
select public.add_comment((select id from t_posts where label = 'p1'), 'm on p1');
insert into t_cmts values ('m1', (select max(id) from public.post_comments));
select public.delete_comment((select id from t_cmts where label = 'm1'));
-- unfollowed: t follows a, then unfollows.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004713", "role": "authenticated"}';
select public.follow_user('00000000-0000-4000-8000-000000004701'::uuid);
delete from public.follows
 where follower_id = '00000000-0000-4000-8000-000000004713'
   and followee_id = '00000000-0000-4000-8000-000000004701';

reset role;
insert into t_ob (label, id)
select 'follow_ok', o.id from public.push_outbox o
 where o.kind = 'follow' and o.recipient_id = '00000000-0000-4000-8000-000000004701'
   and o.actor_id = '00000000-0000-4000-8000-000000004707'
union all
select 'like_c', o.id from public.push_outbox o
 where o.kind = 'like' and o.actor_id = '00000000-0000-4000-8000-000000004703'
union all
select 'like_d', o.id from public.push_outbox o
 where o.kind = 'like' and o.actor_id = '00000000-0000-4000-8000-000000004704'
union all
select 'comment_ok', o.id from public.push_outbox o
 where o.kind = 'comment' and o.actor_id = '00000000-0000-4000-8000-000000004703'
union all
select 'post_b', o.id from public.push_outbox o
 where o.kind = 'post' and o.recipient_id = '00000000-0000-4000-8000-000000004702'
union all
select 'age_gate', o.id from public.push_outbox o
 where o.kind = 'post' and o.recipient_id = '00000000-0000-4000-8000-000000004705'
union all
select 'paused', o.id from public.push_outbox o
 where o.kind = 'post' and o.recipient_id = '00000000-0000-4000-8000-000000004703'
union all
select 'kind_off', o.id from public.push_outbox o
 where o.kind = 'follow' and o.recipient_id = '00000000-0000-4000-8000-000000004704'
union all
select 'no_tokens', o.id from public.push_outbox o
 where o.kind = 'follow' and o.recipient_id = '00000000-0000-4000-8000-000000004708'
union all
select 'blocked_by_recipient', o.id from public.push_outbox o
 where o.kind = 'follow' and o.actor_id = '00000000-0000-4000-8000-000000004711'
union all
select 'blocked_by_actor', o.id from public.push_outbox o
 where o.kind = 'follow' and o.actor_id = '00000000-0000-4000-8000-000000004712'
union all
select 'unliked', o.id from public.push_outbox o
 where o.kind = 'like' and o.actor_id = '00000000-0000-4000-8000-000000004705'
union all
select 'deleted_comment', o.id from public.push_outbox o
 where o.kind = 'comment' and o.actor_id = '00000000-0000-4000-8000-000000004705'
union all
select 'unfollowed', o.id from public.push_outbox o
 where o.kind = 'follow' and o.actor_id = '00000000-0000-4000-8000-000000004713';

-- Two written by hand: one queued two days ago, one out of attempts.
with ins as (
  insert into public.push_outbox (recipient_id, actor_id, kind, created_at)
  values ('00000000-0000-4000-8000-000000004701', '00000000-0000-4000-8000-000000004702', 'follow',
          now() - interval '2 days')
  returning id
)
insert into t_ob (label, id) select 'expired', ins.id from ins;
with ins as (
  insert into public.push_outbox (recipient_id, actor_id, kind, attempts)
  values ('00000000-0000-4000-8000-000000004701', '00000000-0000-4000-8000-000000004702', 'follow', 5)
  returning id
)
insert into t_ob (label, id) select 'attempts5', ins.id from ins;

select is(
  (select count(*)::int from public.push_outbox),
  (select count(*)::int from t_ob),
  'fixture: sixteen cases, sixteen queued rows, nothing else in the queue'
);

set local role service_role;
insert into t_claim select * from public.claim_push_batch(100);
reset role;

select is(
  (select array_agg(b.label order by b.label collate "C") from t_claim c join t_ob b on b.id = c.id),
  array['comment_ok', 'follow_ok', 'like_c', 'like_d', 'post_b'],
  'the claim returns exactly the five pushes that may go out'
);
select is(
  (select array_agg(b.label || '=' || coalesce(o.last_error, 'null') order by b.label collate "C")
     from t_ob b join public.push_outbox o on o.id = b.id
    where b.label not in ('comment_ok', 'follow_ok', 'like_c', 'like_d', 'post_b')
      and o.sent_at is not null),
  array['age_gate=skipped: age gate',
        'attempts5=skipped: attempts',
        'blocked_by_actor=skipped: blocked',
        'blocked_by_recipient=skipped: blocked',
        'deleted_comment=skipped: not true',
        'expired=skipped: expired',
        'kind_off=skipped: kind off',
        'no_tokens=skipped: no tokens',
        'paused=skipped: paused',
        'unfollowed=skipped: not true',
        'unliked=skipped: not true'],
  'every other one is finished in the same statement, with its reason'
);
select ok(
  (select bool_and(o.claimed_at is not null and o.sent_at is null and o.attempts = 1)
     from t_ob b join public.push_outbox o on o.id = b.id
    where b.label in ('comment_ok', 'follow_ok', 'like_c', 'like_d', 'post_b')),
  'the five are leased, not finished, and the lease counted their first attempt'
);
select ok(
  (select o.sent_at is not null and o.attempts = 5
     from public.push_outbox o where o.id = (select id from t_ob where label = 'attempts5')),
  'a push already claimed five times is finished, never claimed a sixth time'
);
select ok(
  (select c.kind = 'follow' and c.recipient_id = '00000000-0000-4000-8000-000000004701'
          and c.tokens = array['ExponentPushToken[pgtap-a]'] and c.actor_handle = 'pgtappush07'
          and c.feed_event_id is null and c.bev_name is null and c.comment_id is null
     from t_claim c where c.id = (select id from t_ob where label = 'follow_ok')),
  'a follow push: the recipient''s tokens and the actor''s handle, no post'
);
select ok(
  (select c.kind = 'like' and c.feed_event_id = (select id from t_posts where label = 'p1')
          and c.bev_name = (select b.name from public.bevs b where b.id = (select id from t_bevs where label = 'soft1'))
          and c.comment_body is null
     from t_claim c where c.id = (select id from t_ob where label = 'like_c')),
  'a like push carries the post and its Bev''s name'
);
select is(
  (select c.comment_body from t_claim c where c.id = (select id from t_ob where label = 'comment_ok')),
  'c on p1',
  'a comment push carries the comment''s body'
);
select ok(
  (select c.kind = 'post' and c.tokens = array['ExponentPushToken[pgtap-b]']
          and c.actor_handle = 'pgtappush01'
          and c.bev_name = (select b.name from public.bevs b where b.id = (select id from t_bevs where label = 'alc'))
     from t_claim c where c.id = (select id from t_ob where label = 'post_b')),
  'a post push goes to the subscriber, about the poster''s Bev'
);

-- The badge is the recipient's unread displayed rows, as the app's badge reads it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select is(
  (select array_agg(distinct c.badge) from t_claim c where c.recipient_id = '00000000-0000-4000-8000-000000004701'),
  array[public.get_unread_notification_count()],
  'a''s pushes carry a''s badge: get_unread_notification_count as a reads it'
);
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
select is(
  (select c.badge from t_claim c where c.id = (select id from t_ob where label = 'post_b')),
  public.get_unread_notification_count(),
  'and b''s post push carries b''s'
);
reset role;

set local role service_role;
select is(
  (select count(*)::int from public.claim_push_batch(100)),
  0,
  'a leased push is not claimed twice'
);

-- ---------------------------------------------------------------------------
-- 8. Finishing, retrying, and an expired lease
-- ---------------------------------------------------------------------------

select is(
  public.finish_push_batch(array[(select id from t_ob where label = 'follow_ok')]),
  1,
  'finish with no error: one row sent'
);
select is(
  public.finish_push_batch(array[(select id from t_ob where label = 'like_c'), (select id from t_ob where label = 'like_d')],
                           'expo 503'),
  2,
  'finish with an error: two rows to retry'
);
select is(
  public.finish_push_batch(array[(select id from t_ob where label = 'follow_ok')], 'too late'),
  0,
  'a finished push cannot be failed afterwards'
);
reset role;
select ok(
  (select o.sent_at is not null and o.last_error is null
     from public.push_outbox o where o.id = (select id from t_ob where label = 'follow_ok')),
  'the sent one is done'
);
select ok(
  (select bool_and(o.sent_at is null and o.claimed_at is null and o.attempts = 1 and o.last_error = 'expo 503')
     from public.push_outbox o
    where o.id in (select id from t_ob where label in ('like_c', 'like_d'))),
  'the failed ones are unsent, unleased, with the error; finishing does not count another attempt'
);
-- comment_ok's lease is six minutes old: its sender is gone.
update public.push_outbox set claimed_at = now() - interval '6 minutes'
 where id = (select id from t_ob where label = 'comment_ok');
set local role service_role;
select is(
  (select array_agg(c.id order by c.id) from public.claim_push_batch(100) c),
  (select array_agg(b.id order by b.id) from t_ob b where b.label in ('comment_ok', 'like_c', 'like_d')),
  'the next claim takes the two to retry and the expired lease, and nothing else'
);
reset role;
select ok(
  (select bool_and(o.attempts = 2)
     from public.push_outbox o
    where o.id in (select id from t_ob where label in ('comment_ok', 'like_c', 'like_d'))),
  'each re-claim counted one more attempt'
);

-- A sender that dies after Expo took the message never reports back. post_b
-- was claimed once and never finished: let its lease run out, again and again.
create temporary table t_reclaims (n int primary key, returned boolean, att int) on commit drop;
do $$
declare
  v_id  bigint := (select id from t_ob where label = 'post_b');
  v_ret boolean;
  v_att int;
begin
  for i in 1..5 loop
    update public.push_outbox set claimed_at = now() - interval '6 minutes' where id = v_id;
    v_ret := exists (select 1 from public.claim_push_batch(100) c where c.id = v_id);
    select o.attempts into v_att from public.push_outbox o where o.id = v_id;
    insert into t_reclaims values (i, v_ret, v_att);
  end loop;
end;
$$;
select is(
  (select array_agg(r.returned::text || '/' || r.att order by r.n) from t_reclaims r),
  array['true/2', 'true/3', 'true/4', 'true/5', 'false/5'],
  'an unfinished push is re-claimed after each expired lease, one attempt each, and after the fifth claim never again'
);
select ok(
  (select o.sent_at is not null and o.last_error = 'skipped: attempts'
     from public.push_outbox o where o.id = (select id from t_ob where label = 'post_b')),
  'and it is finished as skipped: attempts, not left unsent'
);

-- ---------------------------------------------------------------------------
-- 9. Tickets, receipts, dead tokens
-- ---------------------------------------------------------------------------

set local role service_role;
select is(
  public.record_push_tickets(
    '[{"ticket_id": "t-1", "token": "ExponentPushToken[pgtap-a]"},
      {"ticket_id": "t-1", "token": "ExponentPushToken[pgtap-a]"},
      {"ticket_id": "t-2", "token": "ExponentPushToken[pgtap-b]"},
      {"ticket_id": "", "token": "ExponentPushToken[pgtap-b]"}]'::jsonb),
  2,
  'record_push_tickets stores each ticket once and skips a blank one'
);
select is(
  (select count(*)::int from public.claim_push_receipts()),
  0,
  'a ticket younger than 15 minutes has no receipt to fetch yet'
);
reset role;
update public.push_tickets set created_at = now() - interval '20 minutes' where ticket_id = 't-1';
set local role service_role;
select is(
  (select array_agg(r.ticket_id || '/' || r.token) from public.claim_push_receipts() r),
  array['t-1/ExponentPushToken[pgtap-a]'],
  'one that is 20 minutes old is due, with its token'
);
select is(public.finish_push_receipts(array['t-1']), 1, 'finish_push_receipts marks it checked');
select is(
  (select count(*)::int from public.claim_push_receipts()),
  0,
  'and it is not due again'
);
select is(
  public.prune_push_tokens(array['ExponentPushToken[pgtap-b]', 'ExponentPushToken[nobody]']),
  1,
  'prune_push_tokens deletes the dead token it knows'
);
reset role;
select is(
  (select count(*)::int from public.push_tokens where token = 'ExponentPushToken[pgtap-b]'),
  0,
  'and b''s device is gone'
);

-- ---------------------------------------------------------------------------
-- 10. The drain, and an inert poke
-- ---------------------------------------------------------------------------

with ins as (
  insert into public.push_outbox (recipient_id, actor_id, kind, created_at, sent_at)
  values ('00000000-0000-4000-8000-000000004701', '00000000-0000-4000-8000-000000004702', 'follow',
          now() - interval '8 days', now() - interval '8 days')
  returning id
)
insert into t_ob (label, id) select 'old_sent', ins.id from ins;
-- Never claimed: what piles up while push is not configured.
with ins as (
  insert into public.push_outbox (recipient_id, actor_id, kind, created_at)
  values ('00000000-0000-4000-8000-000000004701', '00000000-0000-4000-8000-000000004702', 'follow',
          now() - interval '8 days')
  returning id
)
insert into t_ob (label, id) select 'old_unsent', ins.id from ins;
insert into public.push_tickets (ticket_id, token, created_at)
values ('t-old', 'ExponentPushToken[pgtap-a]', now() - interval '3 days');

select lives_ok($$ select public.drain_push_outbox() $$, 'the drain runs with no Vault secrets');
select is(
  (select count(*)::int from public.push_outbox where id = (select id from t_ob where label = 'old_sent')),
  0,
  'it deleted a push finished more than a week ago'
);
select is(
  (select count(*)::int from public.push_outbox where id = (select id from t_ob where label = 'old_unsent')),
  0,
  'and one queued more than a week ago and never claimed, so an unconfigured queue stays bounded'
);
select is(
  (select count(*)::int from public.push_tickets where ticket_id = 't-old'),
  0,
  'and a ticket over two days old'
);
select is(
  (select count(*)::int from public.push_outbox
    where id in (select id from t_ob where label in ('follow_ok', 'expired', 'attempts5'))),
  3,
  'but kept everything recent'
);
select is(
  pg_temp.net_queued(),
  (select queued from t_net),
  'nothing was POSTed: every queue insert and the drain poked, and without the Vault secrets the poke did nothing'
);

-- ---------------------------------------------------------------------------
-- 11. The explicit-user helpers agree with the auth.uid() ones
-- ---------------------------------------------------------------------------
-- Each person's own answers from private.is_blocked and viewer_is_adult,
-- against blocked_between and user_is_adult for the same pairs. a blocked v,
-- u blocked a, b blocked y, x blocked b; m is 18.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
insert into t_parity select 'a', u.label, private.is_blocked(u.id), public.viewer_is_adult() from t_users u;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';
insert into t_parity select 'b', u.label, private.is_blocked(u.id), public.viewer_is_adult() from t_users u;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004705", "role": "authenticated"}';
insert into t_parity select 'm', u.label, private.is_blocked(u.id), public.viewer_is_adult() from t_users u;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004712", "role": "authenticated"}';
insert into t_parity select 'u', u.label, private.is_blocked(u.id), public.viewer_is_adult() from t_users u;
reset role;

select is(
  (select count(*)::int from t_parity where blocked),
  5,
  'fixture: five of those pairs are blocked (a/u, a/v, b/x, b/y, u/a)'
);
select is(
  (select coalesce(string_agg(p.who || '/' || p.other, ', ' order by p.who, p.other), '')
     from t_parity p
     join t_users me on me.label = p.who
     join t_users o on o.label = p.other
    where p.blocked is distinct from public.blocked_between(me.id, o.id)
       or p.adult is distinct from public.user_is_adult(me.id)),
  '',
  'blocked_between and user_is_adult agree with private.is_blocked and viewer_is_adult on every pair'
);

-- ---------------------------------------------------------------------------
-- 12. Clients cannot reach the worker; anon reaches nothing
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select throws_ok(
  $$ select * from public.claim_push_batch() $$,
  '42501', null,
  'a signed-in user cannot claim pushes'
);
select throws_ok(
  $$ select public.prune_push_tokens(array['ExponentPushToken[pgtap-a]']) $$,
  '42501', null,
  'nor delete anybody''s device'
);
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select * from public.get_notification_settings() $$,
  '42501', null,
  'anon cannot read settings'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[pgtap-anon]') $$,
  '42501', null,
  'nor register a device'
);

reset role;
select * from finish();
rollback;
