-- Internal bug reporting (20261109000300_bug_reports.sql): the internal-role
-- gate and the operator path that hands it out, the idempotency ledger with
-- its kind/severity/title and its evidence paths, the grants that keep a
-- client from writing a ticket identifier, and the private evidence bucket.
--
-- Fixture uuid suffix b1/b2 ("b" for bugs); checked against the other files
-- in supabase/tests/, which use a1, c1..c3, d1..d6, e1..e3, f1..f4 and the
-- longer numeric suffixes. handle_new_user derives the handle from the email's
-- local part, so b1's handle is 'pgtapbug1'.
begin;
select plan(51);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000b1', 'pgtapbug1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000b2', 'pgtapbug2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- The operator path. b1 becomes the internal tester the way an operator does
-- it; b2 stays an ordinary user. protect_profile_columns raises
-- BEVI_UNAUTHORIZED on any role change made by someone who is not an admin,
-- and Studio has no auth.uid(), so set_profile_role is the only way through.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.profiles set role = 'tester' where id = '00000000-0000-4000-8000-0000000000b1' $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'a plain update of role is refused by the trigger even for the owner: there is no auth.uid() to be an admin'
);

select lives_ok(
  $$ select public.set_profile_role('pgtapbug1', 'tester') $$,
  'set_profile_role hands out the tester role without tripping the trigger'
);
select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  'tester',
  'profiles.role accepts the new tester value'
);
select is(
  current_setting('bevi.rpc_bypass', true),
  'false',
  'set_profile_role turns the bypass flag back off before it returns'
);

select throws_ok(
  $$ select public.set_profile_role('pgtapbug1', 'wizard') $$,
  '22023', 'BEVI_VALIDATION',
  'set_profile_role only knows user, admin and tester'
);
select throws_ok(
  $$ select public.set_profile_role('nobody_here_b1', 'tester') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'set_profile_role names a handle that does not exist'
);

-- The CHECK constraint itself, reached with the bypass on so the trigger is
-- not what refuses it.
do $$ begin perform set_config('bevi.rpc_bypass', 'true', true); end $$;
select throws_ok(
  $$ update public.profiles set role = 'wizard' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '23514', null,
  'profiles.role still rejects anything outside user/admin/tester'
);
do $$ begin perform set_config('bevi.rpc_bypass', 'false', true); end $$;

select ok(
  not has_function_privilege('authenticated', 'public.set_profile_role(text, text)', 'execute'),
  'authenticated may NOT call set_profile_role: a signed-in user cannot promote anyone'
);
select ok(
  not has_function_privilege('anon', 'public.set_profile_role(text, text)', 'execute'),
  'anon may not call set_profile_role'
);
select ok(
  has_function_privilege('service_role', 'public.set_profile_role(text, text)', 'execute'),
  'service_role may call set_profile_role'
);

-- ---------------------------------------------------------------------------
-- Grants: a client may ask whether it can report, and may claim a slot. It may
-- never write an outcome.
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.can_report_bugs()', 'execute'),
  'authenticated may call can_report_bugs');
select ok(not has_function_privilege('anon', 'public.can_report_bugs()', 'execute'),
  'anon may not call can_report_bugs');
select ok(has_function_privilege('authenticated', 'public.claim_bug_report(text, text, text, text, text[])', 'execute'),
  'authenticated may call claim_bug_report');
select ok(
  not has_function_privilege('authenticated', 'public.finish_bug_report(bigint, text, text, text, text)', 'execute'),
  'authenticated may NOT call finish_bug_report: only the Edge Function''s service role records a ticket id'
);
select ok(
  has_function_privilege('service_role', 'public.finish_bug_report(bigint, text, text, text, text)', 'execute'),
  'service_role may call finish_bug_report'
);
select ok(
  not has_function_privilege('authenticated', 'public.forget_bug_evidence(text[])', 'execute'),
  'authenticated may not clear evidence paths'
);

-- ---------------------------------------------------------------------------
-- RLS shape: reads are own-row, writes have no policy at all
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bug_reports'::regclass),
  'RLS is enabled on bug_reports'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'bug_reports' and cmd <> 'SELECT'),
  0,
  'no insert/update/delete policy on bug_reports: writes go through the two security-definer functions'
);

-- ---------------------------------------------------------------------------
-- The evidence bucket is private, capped, and image-only
-- ---------------------------------------------------------------------------

select ok(
  (select not public from storage.buckets where id = 'bug-evidence'),
  'bug-evidence is a PRIVATE bucket: a screenshot never gets a public URL'
);
select is(
  (select file_size_limit from storage.buckets where id = 'bug-evidence'),
  (10 * 1024 * 1024)::bigint,
  'bug-evidence objects are capped at 10 MB'
);
select ok(
  (select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
     and array_length(allowed_mime_types, 1) = 3
     from storage.buckets where id = 'bug-evidence'),
  'bug-evidence accepts exactly the three image types the client re-encodes to'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'storage_bug_evidence_insert'
      and cmd = 'INSERT' and 'authenticated' = any(roles)
      and with_check like '%is_internal_reporter()%'),
  1,
  'only internal reporters may insert evidence, and only into their own folder'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'storage_bug_evidence_%' and cmd <> 'INSERT'),
  0,
  'no select/update/delete policy on bug-evidence objects'
);

-- ---------------------------------------------------------------------------
-- An ordinary user is refused, and cannot promote themselves
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';

select is(public.can_report_bugs(), false, 'an ordinary user cannot report bugs');
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'bad', 'anything') $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'claim_bug_report refuses an ordinary user even when called directly'
);
select throws_ok(
  $$ update public.profiles set role = 'tester' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'a signed-in non-admin cannot hand themselves the tester role'
);

-- ---------------------------------------------------------------------------
-- The tester's happy path and its idempotency
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';

select is(public.can_report_bugs(), true, 'a tester can report bugs');

select throws_ok(
  $$ select * from public.claim_bug_report('short', 'bug', 'bad', 'Ratings vanish') $$,
  '22023', 'BEVI_VALIDATION',
  'an idempotency key under 8 characters is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'bad', 'Ratings vanish',
       array['00000000-0000-4000-8000-0000000000b2/theirs.jpg']) $$,
  '22023', 'BEVI_VALIDATION',
  'an evidence path in someone else''s folder is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'bad', 'Ratings vanish',
       array['00000000-0000-4000-8000-0000000000b1/a.jpg', '00000000-0000-4000-8000-0000000000b1/b.jpg',
             '00000000-0000-4000-8000-0000000000b1/c.jpg', '00000000-0000-4000-8000-0000000000b1/d.jpg']) $$,
  '22023', 'BEVI_VALIDATION',
  'more than three evidence paths is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'rant', 'bad', 'Ratings vanish') $$,
  '22023', 'BEVI_VALIDATION',
  'an unknown kind is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'meh', 'Ratings vanish') $$,
  '22023', 'BEVI_VALIDATION',
  'an unknown severity is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'bad', '   ') $$,
  '22023', 'BEVI_VALIDATION',
  'a blank title is validation'
);

select ok(
  (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'blocker', '  Ratings vanish  ',
     array['00000000-0000-4000-8000-0000000000b1/shot.jpg', '00000000-0000-4000-8000-0000000000b1/shot2.jpg'])),
  'the first call claims the attempt'
);
select is(
  (select state from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'pending',
  'the ledger row starts pending with no ticket identifier'
);
select is(
  (select ticket_identifier from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  null::text,
  'no identifier is invented before the provider confirms one'
);
select is(
  (select kind || ' ' || severity || ' ' || title from public.bug_reports
     where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'bug blocker Ratings vanish',
  'the row stores the kind, the severity and the trimmed title as filed'
);
select is(
  (select evidence_paths from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  array['00000000-0000-4000-8000-0000000000b1/shot.jpg', '00000000-0000-4000-8000-0000000000b1/shot2.jpg'],
  'both evidence paths are staged on the row'
);
select ok(
  not (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'blocker', 'Ratings vanish')),
  'a second call while the first is in flight does NOT claim: the caller answers 409, never a duplicate ticket'
);

-- The Edge Function's service-role half records the outcome.
reset role;
select public.finish_bug_report(
  (select id from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'created', 'BEV-901', 'https://linear.app/bevi/issue/BEV-901'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select is(
  (select ticket_identifier || ' ' || state
     from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'blocker', 'Ratings vanish')),
  'BEV-901 created',
  'replaying the same key returns the ticket that already exists'
);
select ok(
  not (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'bug', 'blocker', 'Ratings vanish')),
  'a replay never claims a second attempt'
);

-- A failed attempt is retryable, and the retry's edits win while its staged
-- evidence is kept when the retry sends none.
reset role;
select public.finish_bug_report(
  (select id from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'failed', null, null, 'linear_unreachable'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select ok(
  (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555', 'fix', 'annoying', 'Ratings vanish, still')),
  'a failed attempt is re-armed and claimed by the next try'
);
select is(
  (select kind || ' ' || severity || ' ' || title from public.bug_reports
     where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'fix annoying Ratings vanish, still',
  'the re-arm takes the retry''s kind, severity and title'
);
select is(
  (select cardinality(evidence_paths) from public.bug_reports
     where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  2,
  'the re-arm keeps the staged evidence when the retry sends none'
);

-- Reads are own-row.
select is(
  (select count(*)::int from public.bug_reports),
  1,
  'a tester sees their own submissions'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
select is(
  (select count(*)::int from public.bug_reports),
  0,
  'another user sees none of them'
);

-- finish_bug_report refuses to mark a ticket created without an identifier.
reset role;
select throws_ok(
  $$ select public.finish_bug_report(
       (select id from public.bug_reports limit 1), 'created', null, null) $$,
  '22023', 'BEVI_VALIDATION',
  'finish_bug_report will not mark a report created without an identifier and URL'
);
select throws_ok(
  $$ select public.finish_bug_report((select id from public.bug_reports limit 1), 'done') $$,
  '22023', 'BEVI_VALIDATION',
  'finish_bug_report only accepts created or failed'
);

-- The retention sweep's bookkeeping removes only the paths it names.
select is(
  public.forget_bug_evidence(array['00000000-0000-4000-8000-0000000000b1/shot.jpg']),
  1,
  'forget_bug_evidence reports the one row it touched'
);
select is(
  (select evidence_paths from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  array['00000000-0000-4000-8000-0000000000b1/shot2.jpg'],
  'only the named path is gone; the other object is still remembered'
);
select is(
  public.forget_bug_evidence(array['00000000-0000-4000-8000-0000000000b1/never-there.jpg']),
  0,
  'a path nothing holds touches no row'
);

select * from finish();
rollback;
