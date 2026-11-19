-- The hygiene sweep's table privileges, as an INVARIANT over `public` rather
-- than a list of tables.
--
-- WHAT THIS FILE IS FOR. Supabase ships
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so every table created in this folder arrives with INSERT, UPDATE, DELETE
-- and TRUNCATE granted to `anon` and `authenticated`. RLS denies the DML --
-- supabase/CLAUDE.md forbids a write policy for `authenticated` on a content
-- table, so there is no permissive policy to match. **TRUNCATE IS NOT SUBJECT
-- TO RLS.** There is no such thing as a TRUNCATE policy; Postgres checks the
-- table privilege and stops. So `truncate public.bevs cascade` with the
-- publishable key and any signed-in session was, until the sweep, a privilege
-- check that passed.
--
-- WHY IT IS WRITTEN AS A SCHEMA-WIDE QUERY AND NOT A LIST. The sweep closed the
-- hole on the tables that existed when it was written. It cannot close it on
-- the next table, and the record is not encouraging: in the three weeks the
-- sweep spent in review `public` gained eleven tables that needed the revoke,
-- and exactly one migration (`bev_icons`, copied by `bev_nutrition` and
-- `app_config`) remembered to write it. `user_blocks` and `content_reports`
-- (20261118220000) were the worst instance of it: `user_blocks` IS the
-- abuse-safety feature, and one TRUNCATE would have unblocked every abuser
-- from every victim, silently, with the feed simply showing them again.
--
-- Those two are swept in section 2e of the migration rather than 2a, and
-- `authenticated` deliberately keeps INSERT/UPDATE/DELETE on them: RLS already
-- denies all three, and `41_blocks_and_reports.test.sql` asserts two of them
-- as bare statements that must NOT raise. So this file asserts the TRUNCATE is
-- gone and does not assert the DML either way -- the verb RLS cannot deny is
-- the one with anything left to prove.
--
-- A list of table names would have been green for both of them. The first
-- assertion below is the one that matters: it asks the catalogue which tables
-- in `public` still grant TRUNCATE to a client role and requires the answer to
-- be none, so a table added next month fails this file on the day it lands,
-- names itself in the diagnostic, and sends its author to the note in the
-- sweep. That is the whole point -- the finding was never "these 32 tables",
-- it was "the default privileges are still in place".
--
-- `has_table_privilege` rather than `information_schema.role_table_grants`:
-- the information_schema views filter by what the current user can see, and
-- they report a privilege differently depending on whether it arrived through
-- a default-privileges ACL entry or an explicit grant. `has_table_privilege`
-- answers the question Postgres itself asks at statement time, which is the
-- question this file is about.
--
-- No fixtures: every assertion is about the catalogue or about a privilege
-- check that fails before a row is read.

begin;
select plan(16);

-- ---------------------------------------------------------------------------
-- 1. The invariant
-- ---------------------------------------------------------------------------
-- Ordinary tables and partitioned tables ('r' and 'p'). Views are excluded:
-- a view has no TRUNCATE and `profiles_view` manages its own grants
-- (20261118220100).
select is(
  (select coalesce(string_agg(c.relname || '/' || r.rolname, ', '
                              order by c.relname, r.rolname), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(rolname)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')),
  '',
  'no table in public grants TRUNCATE to anon or authenticated -- RLS cannot deny TRUNCATE, so the privilege is the only thing standing in front of it'
);

-- `anon` is the publishable key with no session. It has no legitimate direct
-- table access at all: its only reads are through `check_invite_code()`,
-- `check_handle()` and `get_app_config()`, every one of them a definer owned
-- by postgres.
select is(
  (select coalesce(string_agg(c.relname || '/' || p.priv, ', '
                              order by c.relname, p.priv), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, p.priv)),
  '',
  'anon holds no INSERT, UPDATE or DELETE on any table in public'
);

-- The two deliberate exceptions, as an exact set, so a third one has to be a
-- decision rather than a default. `app_config` is read signed out on purpose
-- (a gated client must be able to read the gate before it signs in, IA-2);
-- `ranking_events` kept SELECT for both roles when it revoked the rest
-- (20261101000200) and reads zero rows anyway, RLS being on with no policy.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT')),
  'app_config, ranking_events',
  'anon keeps SELECT on exactly the two tables that are documented to allow it'
);

-- `service_role` is named in no revoke in the sweep: it keeps `grant all` from
-- the same default privileges and it has BYPASSRLS, which is what the nightly
-- sync, graph:edges and the embed function run as. Asserted so a future
-- tightening of the two client roles cannot quietly take the operator path
-- with it.
select ok(
  has_table_privilege('service_role', 'public.bevs', 'TRUNCATE')
  and has_table_privilege('service_role', 'public.bev_embeddings', 'INSERT'),
  'service_role is untouched by the sweep -- it keeps TRUNCATE and INSERT'
);

-- ---------------------------------------------------------------------------
-- 2. The statement itself, not just the catalogue
-- ---------------------------------------------------------------------------
-- 42501 is insufficient_privilege. These fail at the privilege check, before
-- any row or policy is considered, which is the distinction the whole sweep
-- rests on: an RLS denial on a TRUNCATE does not exist.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok(
  'truncate public.bevs cascade',
  '42501',
  null,
  'authenticated cannot truncate public.bevs -- the whole catalog, every ranking and every edge, from one request'
);

-- The IS-7 pair. `user_blocks` is the one that would have mattered most: it is
-- read by `private.is_blocked()` from the RLS policies on profiles, follows,
-- rankings, feed_events, post_comments and post_likes, so emptying it
-- un-hides every blocked account everywhere at once.
select throws_ok(
  'truncate public.user_blocks',
  '42501',
  null,
  'authenticated cannot truncate public.user_blocks -- one request would unblock every abuser from every victim'
);

select throws_ok(
  'truncate public.content_reports',
  '42501',
  null,
  'authenticated cannot truncate public.content_reports -- the operator queue is not the reported party''s to empty'
);

select throws_ok(
  'truncate public.rankings',
  '42501',
  null,
  'authenticated cannot truncate public.rankings'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok(
  'truncate public.profiles cascade',
  '42501',
  null,
  'anon cannot truncate public.profiles'
);

reset role;

-- ---------------------------------------------------------------------------
-- 3. What the sweep deliberately LEFT, because a policy depends on it
-- ---------------------------------------------------------------------------
-- Section 2d: revoking a privilege that a permissive policy is written against
-- turns that policy into dead code and breaks a working path. These four
-- assertions are the regression test for that -- they fail if someone later
-- "finishes" the sweep by revoking everything.
--
-- `profiles` is the sharpest case. 20261012000400 revoked SELECT and re-granted
-- it column by column; `revoke all on public.profiles` would strip those column
-- grants and blind the app to its own profile, so the sweep names verbs instead.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'),
  'profiles'' per-column SELECT grants survived -- the sweep revokes verbs, never `all`, on this table'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated keeps UPDATE on profiles -- profiles_update (own row) is a live path (packages/api/src/profile.ts)'
);

select ok(
  has_table_privilege('authenticated', 'public.follows', 'INSERT')
  and has_table_privilege('authenticated', 'public.follows', 'DELETE'),
  'authenticated keeps INSERT and DELETE on follows -- its own-row policies are a supported path'
);

select ok(
  has_table_privilege('authenticated', 'public.want_to_try', 'INSERT')
  and has_table_privilege('authenticated', 'public.want_to_try', 'DELETE'),
  'authenticated keeps INSERT and DELETE on want_to_try'
);

select ok(
  has_table_privilege('authenticated', 'public.featured_bevs', 'INSERT'),
  'authenticated keeps INSERT on featured_bevs -- its policies are gated on is_admin()'
);

-- The IS-7 tables keep the SELECT their own policies are written against; only
-- the write verbs and TRUNCATE were taken.
select ok(
  has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
  and has_table_privilege('authenticated', 'public.content_reports', 'SELECT'),
  'user_blocks and content_reports keep SELECT -- user_blocks_select and content_reports_select still have a privilege to stand on'
);

-- ---------------------------------------------------------------------------
-- 4. The definer path, which is what every write actually goes through
-- ---------------------------------------------------------------------------
-- A `security definer` function runs with its OWNER's privileges, and every
-- function in this schema is owned by postgres, so revoking from the client
-- roles cannot reach them. Asserted because it is the half of the sweep's
-- argument that would make it unsafe if it were wrong.
-- Looked up by name rather than by signature: these functions have gained
-- parameters before (`submit_ranking` is on its seventh) and this assertion is
-- about ownership, not arity. `count(*) = 4` keeps it honest -- if a rename
-- made the list match nothing, `bool_and` over zero rows would be null and the
-- assertion would not quietly pass.
select ok(
  (select count(*) = 4 and bool_and(p.prosecdef and r.rolname = 'postgres')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname in ('submit_ranking', 'block_user', 'unblock_user', 'report_content')),
  'the RPCs that write these tables are security definer owned by postgres, so the revokes cannot reach them'
);

select * from finish();
rollback;
