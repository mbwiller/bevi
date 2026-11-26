-- can_rank_bugs() (20261125000100): ranking bug tickets is a founder's act.
--
-- What this file is for: that the function is security definer, stable and
-- owned by postgres with a pinned search_path; that `authenticated` may call
-- it and `anon` may not (nor PUBLIC); and that it answers false for an
-- ordinary user, false for a tester (who can still report: the two gates
-- differ on exactly this role), and true for an admin.
--
-- Fixture uuid suffix b451..b453; checked against the other files in
-- supabase/tests/, none uses it. handle_new_user derives the handle from the
-- email's local part, so b451's handle is 'pgtaprank1'. The roles are handed
-- out the way an operator does it, with set_profile_role, as
-- 28_bug_reports.test.sql does.
begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-00000000b451', 'pgtaprank1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-00000000b452', 'pgtaprank2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-00000000b453', 'pgtaprank3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- b451 stays an ordinary user; b452 is a tester; b453 is an admin.
do $$ begin
  perform public.set_profile_role('pgtaprank2', 'tester');
  perform public.set_profile_role('pgtaprank3', 'admin');
end $$;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.can_rank_bugs()'::regprocedure),
  'can_rank_bugs() is security definer, as can_report_bugs() is'
);
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.can_rank_bugs()'::regprocedure),
  's',
  'can_rank_bugs() is stable'
);
select is(
  (select r.rolname::text
     from pg_proc p join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.can_rank_bugs()'::regprocedure),
  'postgres',
  'can_rank_bugs() is owned by postgres'
);
select ok(
  (select p.proconfig @> array['search_path=public']
     from pg_proc p where p.oid = 'public.can_rank_bugs()'::regprocedure),
  'can_rank_bugs() pins its search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.can_rank_bugs()', 'execute'),
  'authenticated may call can_rank_bugs'
);
select ok(
  not has_function_privilege('anon', 'public.can_rank_bugs()', 'execute'),
  'anon may not call can_rank_bugs'
);
-- grantee 0 is PUBLIC in an ACL.
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.can_rank_bugs()'::regprocedure and a.grantee = 0
  ),
  'PUBLIC has no execute grant on can_rank_bugs()'
);

-- ---------------------------------------------------------------------------
-- Who may rank
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b451", "role": "authenticated"}';
select is(public.can_rank_bugs(), false, 'an ordinary user cannot rank bug tickets');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b452", "role": "authenticated"}';
select is(public.can_report_bugs(), true, 'a tester can report bugs');
select is(public.can_rank_bugs(), false, 'a tester cannot rank bug tickets: ranking is a founder''s act on the shared order');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000b453", "role": "authenticated"}';
select is(public.can_rank_bugs(), true, 'an admin can rank bug tickets');

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select public.can_rank_bugs() $$,
  '42501', null,
  'anon cannot execute can_rank_bugs()'
);

reset role;
select * from finish();
rollback;
