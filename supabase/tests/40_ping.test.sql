-- IA-9 (20261118214500): public.ping(), the keepalive RPC.
--
-- What this file is for: that the function exists with the shape the keepalive
-- depends on (no arguments, returns timestamptz, `stable`), that it is
-- security INVOKER and owned by postgres, that PUBLIC has no grant on it while
-- `anon` and `authenticated` do, and that both of those roles can actually
-- call it and get a current timestamp back.
--
-- The grants are the point of the file. The keepalive workflow authenticates
-- with the PUBLISHABLE key, which is the `anon` role: if a later migration
-- revokes that grant the schedule starts failing silently (the project then
-- pauses a week later, which is the failure this whole thing exists to
-- prevent), and this test is what catches it first.
--
-- No fixtures: the function reads nothing, so there is nothing to set up.

begin;
select plan(10);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select ok(
  to_regprocedure('public.ping()') is not null,
  'public.ping() exists and takes no arguments'
);

select is(
  (select pg_catalog.format_type(p.prorettype, null)
     from pg_proc p where p.oid = 'public.ping()'::regprocedure),
  'timestamp with time zone',
  'ping() returns timestamptz'
);

-- `stable`, not `volatile`: the function is one `select now()` and nothing
-- about it should invite a planner to treat it as a write.
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'public.ping()'::regprocedure),
  's',
  'ping() is stable'
);

-- Security INVOKER. It reads no table, so it needs no one else's privileges,
-- and a definer function granted to anon is a thing worth never adding by
-- accident.
select ok(
  (select not p.prosecdef from pg_proc p where p.oid = 'public.ping()'::regprocedure),
  'ping() is security invoker, not definer'
);

select is(
  (select r.rolname::text
     from pg_proc p join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.ping()'::regprocedure),
  'postgres',
  'ping() is owned by postgres'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- grantee 0 is PUBLIC in an ACL. The migration revokes Postgres's implicit
-- grant, so no entry for it may survive.
select ok(
  not exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.ping()'::regprocedure
       and a.grantee = 0
  ),
  'PUBLIC has no execute grant on ping()'
);

select ok(
  has_function_privilege('anon', 'public.ping()', 'execute'),
  'anon can execute ping() -- the keepalive runs on the publishable key'
);

select ok(
  has_function_privilege('authenticated', 'public.ping()', 'execute'),
  'authenticated can execute ping()'
);

-- ---------------------------------------------------------------------------
-- Calling it
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select ok(
  public.ping() between now() - interval '1 minute' and now() + interval '1 minute',
  'anon calls ping() and gets the current time'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select ok(
  public.ping() between now() - interval '1 minute' and now() + interval '1 minute',
  'authenticated calls ping() and gets the current time'
);

reset role;
select * from finish();
rollback;
