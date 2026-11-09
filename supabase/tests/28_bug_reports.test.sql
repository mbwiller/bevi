-- Internal bug reporting (20261102000500_bug_reports.sql): the internal-role
-- gate, the idempotency ledger, the grants that keep a client from writing a
-- ticket identifier, and the private evidence bucket.
begin;
select plan(32);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000b1', 'pgtapbug1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000b2', 'pgtapbug2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- b1 is the internal tester; b2 stays an ordinary user.
--
-- protect_profile_columns raises BEVI_UNAUTHORIZED on any role change made by
-- someone who is not already an admin, and there is no bypass flag for it
-- (unlike birth_date) -- which is the rule working, not a gap. Granting the
-- first internal role is an operator action against the database, so the test
-- does what the operator does: turn the trigger off for exactly these two
-- statements. Everything after this runs with it back on.
alter table public.profiles disable trigger protect_profile_columns;

update public.profiles set role = 'tester' where id = '00000000-0000-4000-8000-0000000000b1';

-- ---------------------------------------------------------------------------
-- The role itself
-- ---------------------------------------------------------------------------

select is(
  (select role from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'),
  'tester',
  'profiles.role accepts the new tester value'
);
select throws_ok(
  $$ update public.profiles set role = 'wizard' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '23514', null,
  'profiles.role still rejects anything outside user/admin/tester'
);

alter table public.profiles enable trigger protect_profile_columns;

select throws_ok(
  $$ update public.profiles set role = 'tester' where id = '00000000-0000-4000-8000-0000000000b2' $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'nobody but an admin can hand out the tester role'
);

-- ---------------------------------------------------------------------------
-- Grants: a client may ask whether it can report, and may claim a slot. It may
-- never write an outcome.
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.can_report_bugs()', 'execute'),
  'authenticated may call can_report_bugs');
select ok(not has_function_privilege('anon', 'public.can_report_bugs()', 'execute'),
  'anon may not call can_report_bugs');
select ok(has_function_privilege('authenticated', 'public.claim_bug_report(text, text)', 'execute'),
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
-- An ordinary user is refused
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';

select is(public.can_report_bugs(), false, 'an ordinary user cannot report bugs');
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555') $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'claim_bug_report refuses an ordinary user even when called directly'
);

-- ---------------------------------------------------------------------------
-- The tester's happy path and its idempotency
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';

select is(public.can_report_bugs(), true, 'a tester can report bugs');

select throws_ok(
  $$ select * from public.claim_bug_report('short') $$,
  '22023', 'BEVI_VALIDATION',
  'an idempotency key under 8 characters is validation'
);
select throws_ok(
  $$ select * from public.claim_bug_report('11111111-2222-4333-8444-555555555555',
       '00000000-0000-4000-8000-0000000000b2/theirs.jpg') $$,
  '22023', 'BEVI_VALIDATION',
  'an evidence path in someone else''s folder is validation'
);

select ok(
  (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555',
     '00000000-0000-4000-8000-0000000000b1/shot.jpg')),
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
select ok(
  not (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555')),
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
  (select ticket_identifier || ' ' || state from public.claim_bug_report('11111111-2222-4333-8444-555555555555')),
  'BEV-901 created',
  'replaying the same key returns the ticket that already exists'
);
select ok(
  not (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555')),
  'a replay never claims a second attempt'
);

-- A failed attempt is retryable.
reset role;
select public.finish_bug_report(
  (select id from public.bug_reports where idempotency_key = '11111111-2222-4333-8444-555555555555'),
  'failed', null, null, 'linear_unreachable'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
select ok(
  (select claimed from public.claim_bug_report('11111111-2222-4333-8444-555555555555')),
  'a failed attempt is re-armed and claimed by the next try'
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

select * from finish();
rollback;
