-- The version gate (20261118210313_app_config.sql, IA-2 half 1): the
-- singleton row, the column constraints, the trigger that keeps `updated_at`
-- honest when the row is edited by hand, and the two access facts the gate
-- depends on -- a signed-out caller CAN read it, and an ordinary signed-in
-- caller CANNOT write it.
--
-- The signed-out read is the one worth stating out loud: a store binary that
-- is too old to sign in still has to be able to learn that it is too old, so
-- `anon` holds both the select policy and the execute grant on
-- `get_app_config()`. That matches what the contract already promises --
-- `shared/src/api.ts:7` lists `meta.getAppConfig` among the methods that do
-- not throw 'unauthorized' when signed out.
--
-- Fixture uuid suffix ac ("app config"); checked against the other files in
-- supabase/tests/, which use a1, b1..b3, c1..c3, d1..d6, e1..e3, f1..f4 and
-- the longer numeric suffixes.
begin;
select plan(50);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000ac', 'pgtapappconfig@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'app_config', 'app_config exists');
select has_column('public', 'app_config', 'id', 'id (the singleton key)');
select has_column('public', 'app_config', 'min_app_version', 'min_app_version');
select has_column('public', 'app_config', 'min_contract_version', 'min_contract_version');
select has_column('public', 'app_config', 'maintenance', 'maintenance');
select has_column('public', 'app_config', 'maintenance_message', 'maintenance_message');
select has_column('public', 'app_config', 'ios_min_build', 'ios_min_build');
select has_column('public', 'app_config', 'updated_at', 'updated_at');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_config'::regclass),
  'RLS is enabled on app_config'
);

-- ---------------------------------------------------------------------------
-- The seeded row: permissive, so nothing is gated on day one
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.app_config), 1, 'exactly one row is seeded');
select is((select min_app_version from public.app_config), '0.0.0',
          'min_app_version is seeded below any shippable build');
select is((select min_contract_version from public.app_config), '0.0.0',
          'min_contract_version is seeded below any shippable contract');
select is((select maintenance from public.app_config), false, 'maintenance starts off');
select is((select maintenance_message from public.app_config), null::text,
          'no maintenance message until someone writes one');
select is((select ios_min_build from public.app_config), null::integer,
          'ios_min_build is null until a TestFlight build exists');

-- ---------------------------------------------------------------------------
-- The singleton. `id boolean primary key check (id = true)`: the CHECK admits
-- only `true`, the primary key admits it only once. These run as the table
-- owner, so nothing here is RLS or grants doing the work -- the constraint is.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.app_config (id, min_app_version, min_contract_version)
     values (false, '1.0.0', '2.0.0') $$,
  '23514', null,
  'a second row cannot sneak in under id = false'
);
select throws_ok(
  $$ insert into public.app_config (min_app_version, min_contract_version)
     values ('1.0.0', '2.0.0') $$,
  '23505', null,
  'a second row cannot reuse id = true'
);
select throws_ok(
  $$ update public.app_config set id = false $$,
  '23514', null,
  'the existing row cannot be moved off id = true either'
);
select is((select count(*)::int from public.app_config), 1, 'still exactly one row');

-- ---------------------------------------------------------------------------
-- Column constraints. The gate is compared against by clients, so a value
-- the client cannot parse is worse than no gate at all.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.app_config set min_app_version = 'latest' $$,
  '23514', null,
  'min_app_version must be major.minor.patch'
);
select throws_ok(
  $$ update public.app_config set min_contract_version = '2.14' $$,
  '23514', null,
  'min_contract_version must be major.minor.patch'
);
select throws_ok(
  $$ update public.app_config set maintenance_message = repeat('x', 281) $$,
  '23514', null,
  'the maintenance message is bounded: it is rendered on a phone'
);
select throws_ok(
  $$ update public.app_config set ios_min_build = 0 $$,
  '23514', null,
  'a CFBundleVersion floor of 0 is not a floor'
);
select lives_ok(
  $$ update public.app_config set ios_min_build = 1, maintenance_message = 'Back by 9pm ET.' $$,
  'real values are accepted'
);

-- ---------------------------------------------------------------------------
-- updated_at. This row has no write RPC -- it is edited by hand in Studio --
-- so the trigger, not the writer, is what keeps the timestamp honest.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.app_config set updated_at = '2000-01-01T00:00:00Z' $$,
  'a hand edit may pass any updated_at it likes'
);
select ok(
  (select updated_at from public.app_config) > now() - interval '1 minute',
  'the trigger stamps updated_at regardless of what the writer passed'
);

-- Back to the shipped values for the read tests below.
update public.app_config
   set min_app_version = '0.0.0', min_contract_version = '0.0.0',
       maintenance = false, maintenance_message = null, ios_min_build = null;

-- ---------------------------------------------------------------------------
-- get_app_config(): the grants
-- ---------------------------------------------------------------------------
select has_function('public', 'get_app_config', 'get_app_config() exists');
select ok(
  (select prosecdef from pg_proc where oid = 'public.get_app_config()'::regprocedure),
  'get_app_config() is security definer'
);
select ok(has_function_privilege('anon', 'public.get_app_config()', 'execute'),
          'a signed-out caller can execute get_app_config()');
select ok(has_function_privilege('authenticated', 'public.get_app_config()', 'execute'),
          'a signed-in caller can execute get_app_config()');
select ok(not has_function_privilege('anon', 'public.app_config_touch_updated_at()', 'execute'),
          'the trigger function is not part of the client surface');
select ok(not has_function_privilege('authenticated', 'public.app_config_touch_updated_at()', 'execute'),
          'the trigger function is not part of the client surface for signed-in callers either');

-- ---------------------------------------------------------------------------
-- Table grants and policies: read for both client roles, no write path
-- ---------------------------------------------------------------------------
select ok(has_table_privilege('anon', 'public.app_config', 'SELECT'),
          'anon is granted select');
select ok(has_table_privilege('authenticated', 'public.app_config', 'SELECT'),
          'authenticated is granted select');
select ok(not has_table_privilege('anon', 'public.app_config', 'INSERT,UPDATE,DELETE'),
          'anon holds no write grant');
select ok(not has_table_privilege('authenticated', 'public.app_config', 'INSERT,UPDATE,DELETE'),
          'authenticated holds no write grant');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'app_config' and cmd <> 'SELECT'),
  0,
  'no policy on app_config permits a write'
);

-- ---------------------------------------------------------------------------
-- Signed out. The whole point of IA-2: a binary too old to sign in must still
-- be able to find out that it is too old.
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select is((select count(*)::int from public.app_config), 1,
          'an anonymous caller can read the row');
select is((select maintenance from public.app_config), false,
          'an anonymous caller sees the maintenance flag');
select is((select (public.get_app_config()).min_app_version), '0.0.0',
          'an anonymous caller can call get_app_config()');
select is((select (public.get_app_config()).min_contract_version), '0.0.0',
          'get_app_config() returns the contract floor to a signed-out caller');
select is((select (public.get_app_config()).maintenance), false,
          'get_app_config() returns the maintenance flag to a signed-out caller');
select throws_ok(
  $$ update public.app_config set maintenance = true $$,
  '42501', null,
  'an anonymous caller cannot flip the maintenance flag'
);
select throws_ok(
  $$ insert into public.app_config (id, min_app_version, min_contract_version)
     values (false, '1.0.0', '2.0.0') $$,
  '42501', null,
  'an anonymous caller cannot insert'
);

-- ---------------------------------------------------------------------------
-- An ordinary signed-in user: reads, never writes. A client that could raise
-- or lower its own gate would not be a gate.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "00000000-0000-4000-8000-0000000000ac", "role": "authenticated"}';

select is((select count(*)::int from public.app_config), 1,
          'a signed-in user can read the row');
select is((select (public.get_app_config()).min_app_version), '0.0.0',
          'a signed-in user can call get_app_config()');
select throws_ok(
  $$ update public.app_config set min_app_version = '0.0.1' $$,
  '42501', null,
  'an ordinary user cannot lower the version floor'
);
select throws_ok(
  $$ update public.app_config set maintenance = true $$,
  '42501', null,
  'an ordinary user cannot declare maintenance'
);
select throws_ok(
  $$ delete from public.app_config $$,
  '42501', null,
  'an ordinary user cannot delete the row'
);
select throws_ok(
  $$ insert into public.app_config (id, min_app_version, min_contract_version)
     values (false, '1.0.0', '2.0.0') $$,
  '42501', null,
  'an ordinary user cannot insert a second row'
);

reset role;
select * from finish();
rollback;
