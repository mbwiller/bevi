-- A-16 (4) (20261110000100): bev_graph_stats, its RLS, the service-role writer
-- replace_bev_graph_stats(), and the `bevGraph` key get_prediction_snapshot()
-- gained.
--
-- What this file is for, in order: the table's shape (floats are double
-- precision, the community id has a shape) and that RLS is on with exactly ONE
-- policy, a select for `authenticated`; that the writer is the service role's
-- and nobody else's; that `bevGraph` is `[]` (never null) while the table is
-- empty; that the writer REPLACES rather than appends; that EACH validation
-- rejects with BEVI_VALIDATION and its own detail and leaves the previous rows
-- exactly as they were; what a signed-in adult, a signed-in minor and anon can
-- read directly, and that no client role can write; and the snapshot key --
-- the tuple shape [bev_id, community_id, pagerank, bridge], bev_id order, the
-- rounding, visible Bevs only for an adult and for a minor, every pre-existing
-- key still present, the grants unchanged.
--
-- Every snapshot is taken as the signed-in user and stored in t_snap; the
-- assertions then read t_snap as the owner.
--
-- Fixture uuid prefix: ...000000a164NN ("a164" for A-16 (4)). Checked against
-- every other file in supabase/tests/: 02..10 use a1, b1..b3, c1..c3, d1..d6,
-- e1..e3, f1..f4, ff01..ff14 and ffff; 09_leaderboard_parity ab0NN;
-- 11_graph_tables ed0NN; 12_embed_webhook be0NN and be0a1; 13_flavor_inference
-- d11aNNN; 14_graph_edge_writer ed7a0NN and fffffff; 15_category_hierarchy
-- c1301 and ca0NN; 16_taste_graph a16NN (...0000000a16NN, one hex digit
-- shorter than this file's); 17 b21NN; 18 a14NN; 19 b14NN; 21 cd0NN; 22 d12NN;
-- 23 23NN; 24 b1cNN; 25 the 24xxx band and 24bNNN; 26 a08NN; 27 a08bNN;
-- 29 a08cNN. a164NN collides with none: 16's ids are ...0000000a1601..03 and
-- these are ...000000a16401.. .
--
-- The people:
--   a16401  adult (30)
--   a16402  minor (16)
--
-- The Bevs, inserted here with literal ids so their order is fixed
-- (a16411 < a16412 < a16413 < a16414 < a16415):
--   A  a16411  soda, active
--   B  a16412  soda, active
--   C  a16413  soda, HIDDEN (moderation took it down; its row survives the night)
--   X  a16414  beer, active: alcoholic
--   D  a16415  soda, active, and in NO payload: created since the last sync
--
-- The generation the reads are tested on (`full`): A and B share community
-- c_aaaaaaaaaaaaaaaa, C and X are alone in theirs. PageRank
-- 0.412345678912 + 0.3 + 0.187654321088 + 0.1 = 1; the first is there to be
-- rounded to 8 decimals, and B's bridge 0.123456 to 4.
begin;
select plan(75);

-- ---------------------------------------------------------------------------
-- People and Bevs
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-000000a16401', 'pgtapgstats1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-000000a16402', 'pgtapgstats2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date silently unless the trusted-RPC
-- bypass is on; without it nobody is adult and the age gate passes for the
-- wrong reason.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-000000a16401';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-000000a16402';
set local bevi.rpc_bypass = 'false';

insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source, photo_path)
values
  ('00000000-0000-4000-8000-000000a16411', 'pgTAP Graph Stats A', 'Stats Co', null, 'soda', 2, 'active', 'user', 'pgtap/gs-a.jpg'),
  ('00000000-0000-4000-8000-000000a16412', 'pgTAP Graph Stats B', 'Stats Co', null, 'soda', 2, 'active', 'user', 'pgtap/gs-b.jpg'),
  ('00000000-0000-4000-8000-000000a16413', 'pgTAP Graph Stats C', 'Stats Co', null, 'soda', 2, 'hidden', 'user', 'pgtap/gs-c.jpg'),
  ('00000000-0000-4000-8000-000000a16414', 'pgTAP Graph Stats X', 'Stats Co', null, 'beer', 2, 'active', 'user', 'pgtap/gs-x.jpg'),
  ('00000000-0000-4000-8000-000000a16415', 'pgTAP Graph Stats D', 'Stats Co', null, 'soda', 2, 'active', 'user', 'pgtap/gs-d.jpg');

-- Snapshots, written as the signed-in user, read back as the owner.
create temporary table t_snap (label text primary key, j jsonb not null) on commit drop;
grant insert, select on t_snap to authenticated;

-- ---------------------------------------------------------------------------
-- Payloads
-- ---------------------------------------------------------------------------

create temporary table t_payload (label text primary key, rows jsonb) on commit drop;
insert into t_payload (label, rows) values
  ('full', '[
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 2,
      "pagerank": 0.412345678912, "strength": 3.25, "degree": 4, "bridge": 0.25},
     {"bev_id": "00000000-0000-4000-8000-000000a16412", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 2,
      "pagerank": 0.3, "strength": 1, "degree": 1, "bridge": 0.123456},
     {"bev_id": "00000000-0000-4000-8000-000000a16413", "community_id": "c_bbbbbbbbbbbbbbbb", "community_size": 1,
      "pagerank": 0.187654321088, "strength": 0.5, "degree": 1, "bridge": 0},
     {"bev_id": "00000000-0000-4000-8000-000000a16414", "community_id": "c_cccccccccccccccc", "community_size": 1,
      "pagerank": 0.1, "strength": 0, "degree": 0, "bridge": 0}]'::jsonb),
  -- The generation every rejected call must leave in place.
  ('smaller', '[
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_dddddddddddddddd", "community_size": 2,
      "pagerank": 0.75, "strength": 1, "degree": 1, "bridge": 0},
     {"bev_id": "00000000-0000-4000-8000-000000a16412", "community_id": "c_dddddddddddddddd", "community_size": 2,
      "pagerank": 0.25, "strength": 1, "degree": 1, "bridge": 0}]'::jsonb),
  ('one', '[
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_eeeeeeeeeeeeeeee", "community_size": 1,
      "pagerank": 1, "strength": 0, "degree": 0, "bridge": 0}]'::jsonb);

-- One good single-row payload, broken one field at a time. `jsonb_set` on the
-- 'one' payload keeps every other field valid, so each rejection below can
-- only be the check it is named for.
create function pg_temp.broken(p_path text[], p_value jsonb) returns jsonb language sql as $fn$
  select jsonb_set((select rows from t_payload where label = 'one'), p_path, p_value)
$fn$;

-- What a call does: 'accepted <n>', or '<sqlstate> <message>: <detail>'.
-- throws_ok cannot see the detail, and the detail is what tells the job's log
-- which check refused the payload.
create function pg_temp.outcome(p_rows jsonb, p_version text) returns text language plpgsql as $fn$
declare
  v_n      int;
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  v_n := public.replace_bev_graph_stats(p_rows, p_version);
  return 'accepted ' || v_n;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_msg || ': ' || v_detail;
end;
$fn$;

-- The table, as one comparable value: who is in it, with what, stamped how.
create function pg_temp.fingerprint() returns text language sql as $fn$
  select coalesce(string_agg(
           right(bev_id::text, 6) || ' ' || community_id || ' ' || community_size || ' ' || pagerank::text || ' ' ||
           strength::text || ' ' || degree || ' ' || bridge::text || ' ' || version,
           ' | ' order by bev_id), '(empty)')
    from public.bev_graph_stats
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Shape, RLS, policies, grants
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_graph_stats'::regclass),
  'bev_graph_stats has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'bev_graph_stats'),
  1,
  'it has exactly one policy'
);
select is(
  (select policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') from pg_policies
    where schemaname = 'public' and tablename = 'bev_graph_stats'),
  'bev_graph_stats_select SELECT authenticated',
  'and that one is a select for authenticated: no insert, update or delete policy for anyone'
);
-- The predicate is a POSITIVE exists over bevs and categories with both halves
-- of bevs_select; a negative one would be fail-open (the migration says why).
select alike(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'bev_graph_stats'),
  '%EXISTS%bevs%categories%status%''active''%is_alcoholic%viewer_is_adult()%',
  'the policy is an exists over the Bev: active, and alcoholic only for an adult'
);
select unalike(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'bev_graph_stats'),
  '%NOT (EXISTS%',
  'and it is not written as a negative exists'
);
select is(
  (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
     from pg_attribute a
    where a.attrelid = 'public.bev_graph_stats'::regclass and a.attnum > 0 and not a.attisdropped),
  'bev_id uuid, community_id text, community_size integer, pagerank double precision, strength double precision, '
    || 'degree integer, bridge double precision, version text, computed_at timestamp with time zone',
  'the columns: the three signals are double precision, not numeric'
);
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'bev_graph_stats' and indexdef ilike '%(community_id)%'),
  'there is an index on community_id'
);
select throws_ok(
  $$ insert into public.bev_graph_stats (bev_id, community_id, community_size, pagerank, strength, degree, bridge, version)
     values ('00000000-0000-4000-8000-000000a16411', '00000000-0000-4000-8000-000000a16412', 1, 1, 0, 0, 0, '1.7.0') $$,
  '23514', null,
  'a Bev id cannot be stored as a community id, even by the owner: the CHECK on its shape refuses it'
);
select throws_ok(
  $$ insert into public.bev_graph_stats (bev_id, community_id, community_size, pagerank, strength, degree, bridge, version)
     values ('00000000-0000-4000-8000-000000a16411', 'c_aaaaaaaaaaaaaaaa', 1, 1, 0, 0, 1, '1.7.0') $$,
  '23514', null,
  'and a bridge score of exactly 1 is outside [0, 1)'
);
select ok(
  has_function_privilege('service_role', 'public.replace_bev_graph_stats(jsonb, text)', 'execute'),
  'the service role can execute replace_bev_graph_stats: it is the nightly job'
);
select ok(
  not has_function_privilege('authenticated', 'public.replace_bev_graph_stats(jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.replace_bev_graph_stats(jsonb, text)', 'execute'),
  'neither authenticated nor anon can: it replaces the whole table'
);

-- ---------------------------------------------------------------------------
-- 2. The empty table: bevGraph is [] and nothing else moved
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.bev_graph_stats), 0,
          'the table is empty until a sync writes it');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a16401", "role": "authenticated"}';
insert into t_snap (label, j) values ('empty', public.get_prediction_snapshot());
reset role;

select is((select jsonb_typeof(j -> 'bevGraph') from t_snap where label = 'empty'), 'array',
          'bevGraph is a JSON array while bev_graph_stats is empty');
select is((select j -> 'bevGraph' from t_snap where label = 'empty'), '[]'::jsonb,
          'and it is [] (coalesced, not null)');
select ok((select j ?& array['generatedAt', 'viewer', 'global', 'users', 'categoryStats', 'bevs', 'rankings',
                             'edges', 'userNeighbors']
             from t_snap where label = 'empty'),
          'every pre-existing key is still present in the empty snapshot');

-- ---------------------------------------------------------------------------
-- 3. replace_bev_graph_stats writes, stamps and REPLACES
-- ---------------------------------------------------------------------------

select is(
  (select public.replace_bev_graph_stats((select rows from t_payload where label = 'full'), '1.7.0')),
  4,
  'the row count comes back, so the job can compare it with what it sent'
);
select is(
  (select array_agg(right(bev_id::text, 6) order by bev_id) from public.bev_graph_stats),
  array['a16411', 'a16412', 'a16413', 'a16414'],
  'all four rows are stored, the hidden Bev''s and the alcoholic one''s included'
);
select is(
  (select version from public.bev_graph_stats where bev_id = '00000000-0000-4000-8000-000000a16411'),
  '1.7.0',
  'p_version is stamped on every row: RANKING_VERSION at compute time'
);
select is(
  (select pagerank from public.bev_graph_stats where bev_id = '00000000-0000-4000-8000-000000a16411'),
  0.412345678912::double precision,
  'the table keeps the full double, unrounded'
);
select is(
  (select community_id || ' ' || community_size || ' ' || degree || ' ' || strength::text || ' ' || bridge::text
     from public.bev_graph_stats where bev_id = '00000000-0000-4000-8000-000000a16411'),
  'c_aaaaaaaaaaaaaaaa 2 4 3.25 0.25',
  'and every other column survives the round trip'
);
select ok(
  (select bool_and(computed_at is not null) from public.bev_graph_stats),
  'computed_at is set'
);
-- The point of "replace": the second call must not leave the first call's rows
-- behind. A nightly write that appended would keep the stats of Bevs that left
-- the graph, and communities that no longer exist.
select is(
  (select public.replace_bev_graph_stats((select rows from t_payload where label = 'smaller'), '1.7.1')),
  2,
  'a second call with fewer rows returns the smaller count'
);
select is(
  pg_temp.fingerprint(),
  'a16411 c_dddddddddddddddd 2 0.75 1 1 0 1.7.1 | a16412 c_dddddddddddddddd 2 0.25 1 1 0 1.7.1',
  'and the table holds only the second payload: it is replaced, not appended to'
);

-- ---------------------------------------------------------------------------
-- 4. Validation. Each rejection names its check, and each leaves the previous
--    generation ('smaller', stamped 1.7.1) exactly as it was.
-- ---------------------------------------------------------------------------

create temporary table t_before (print text not null) on commit drop;
insert into t_before (print) values (pg_temp.fingerprint());

-- First the control: the payload the broken ones are cut from is itself good.
-- An accepted call really does replace the table (pg_temp.outcome's handler
-- only fires on an error), so 'smaller' is put back straight afterwards.
select is(pg_temp.outcome((select rows from t_payload where label = 'one'), '1.7.0'), 'accepted 1',
          'control: the single-row payload the broken ones are derived from is accepted');
select is(pg_temp.outcome((select rows from t_payload where label = 'smaller'), '1.7.1'), 'accepted 2',
          'control: and the previous generation is put back');
select is(pg_temp.fingerprint(), (select print from t_before),
          'control: the table is the previous generation again');

select is(pg_temp.outcome((select rows from t_payload where label = 'one'), '   '),
          '22023 BEVI_VALIDATION: version', 'a blank version is refused');
select is(pg_temp.outcome((select rows from t_payload where label = 'one'), null),
          '22023 BEVI_VALIDATION: version', 'and a null one');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome('{"bev_id": "00000000-0000-4000-8000-000000a16411"}'::jsonb, '1.7.0'),
          '22023 BEVI_VALIDATION: rows', 'a payload that is not an array is refused');
select is(pg_temp.outcome(null, '1.7.0'),
          '22023 BEVI_VALIDATION: rows', 'and a null one');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome('[]'::jsonb, '1.7.0'),
          '22023 BEVI_VALIDATION: rows: empty',
          'an EMPTY array is refused: an empty result is a broken run, and accepting it would wipe the table');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome(pg_temp.broken('{0,bridge}', 'null'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a column is null', 'a null column is refused');
select is(pg_temp.outcome((select jsonb_build_array((rows -> 0) - 'strength') from t_payload where label = 'one'), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a column is null', 'and so is a missing one');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome(pg_temp.broken('{0,pagerank}', '1.5'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a pagerank above 1 is refused');
select is(pg_temp.outcome(pg_temp.broken('{0,pagerank}', '-0.1'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a negative pagerank');
select is(pg_temp.outcome(pg_temp.broken('{0,bridge}', '1'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a bridge score of exactly 1 (the range is [0, 1))');
select is(pg_temp.outcome(pg_temp.broken('{0,strength}', '-1'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a negative strength');
select is(pg_temp.outcome(pg_temp.broken('{0,degree}', '-1'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a negative degree');
select is(pg_temp.outcome(pg_temp.broken('{0,degree}', '2.5'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a degree that is not a whole number');
select is(pg_temp.outcome(pg_temp.broken('{0,community_size}', '0'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: a value is out of range', 'a community of size 0');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome(pg_temp.broken('{0,community_id}', '"00000000-0000-4000-8000-000000a16411"'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: community_id is not c_ + 16 hex',
          'a community id that is a Bev id is refused: the hub must never be stored');
select is(pg_temp.outcome(pg_temp.broken('{0,community_id}', '"c_AAAAAAAAAAAAAAAA"'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: community_id is not c_ + 16 hex', 'upper-case hex is not the shape');
select is(pg_temp.outcome(pg_temp.broken('{0,community_id}', '"c_aaaaaaaaaaaaaaa"'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: community_id is not c_ + 16 hex', 'nor are 15 characters');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(
  pg_temp.outcome('[
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 2,
      "pagerank": 0.5, "strength": 1, "degree": 1, "bridge": 0},
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 2,
      "pagerank": 0.5, "strength": 1, "degree": 1, "bridge": 0}]'::jsonb, '1.7.0'),
  '22023 BEVI_VALIDATION: rows: duplicate bev_id',
  'two rows for one Bev are a bug in the caller, named as one rather than as a primary-key violation'
);
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome(pg_temp.broken('{0,bev_id}', '"00000000-0000-4000-8000-000000a164ff"'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: unknown bev id',
          'an id that is not a Bev is refused before the delete, not by the foreign key after it');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(
  pg_temp.outcome('[
     {"bev_id": "00000000-0000-4000-8000-000000a16411", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 3,
      "pagerank": 0.5, "strength": 1, "degree": 1, "bridge": 0},
     {"bev_id": "00000000-0000-4000-8000-000000a16412", "community_id": "c_aaaaaaaaaaaaaaaa", "community_size": 3,
      "pagerank": 0.5, "strength": 1, "degree": 1, "bridge": 0}]'::jsonb, '1.7.0'),
  '22023 BEVI_VALIDATION: rows: community_size disagrees with the rows of that community',
  'a community_size of 3 on a community with two rows is refused: the payload is not one whole generation'
);
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

select is(pg_temp.outcome(pg_temp.broken('{0,pagerank}', '0.9'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: pagerank does not sum to 1',
          'a pagerank total of 0.9 is refused: a partial payload');
select is(pg_temp.outcome(pg_temp.broken('{0,pagerank}', '0.99999'::jsonb), '1.7.0'),
          '22023 BEVI_VALIDATION: rows: pagerank does not sum to 1',
          'and so is one that is 1e-5 short: the tolerance is 1e-6');
select is(pg_temp.fingerprint(), (select print from t_before), 'the previous rows are intact');

-- ---------------------------------------------------------------------------
-- 5. Direct reads and writes under RLS
-- ---------------------------------------------------------------------------

-- Tonight's generation: all four, the hidden one and the alcoholic one too.
select is(
  (select public.replace_bev_graph_stats((select rows from t_payload where label = 'full'), '1.7.0')),
  4,
  'the full generation is written for the read tests'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a16401", "role": "authenticated"}';

select is(
  (select array_agg(right(bev_id::text, 6) order by bev_id) from public.bev_graph_stats),
  array['a16411', 'a16412', 'a16414'],
  'an adult reads the rows of the active Bevs, the alcoholic one included, and NOT the hidden Bev''s'
);
-- D is active, visible to this caller and has no row, so the only thing that
-- can refuse this insert is the absence of an insert policy (or of the
-- privilege): either way 42501.
select throws_ok(
  $$ insert into public.bev_graph_stats (bev_id, community_id, community_size, pagerank, strength, degree, bridge, version)
     values ('00000000-0000-4000-8000-000000a16415', 'c_ffffffffffffffff', 1, 0.5, 0, 0, 0, '1.7.0') $$,
  '42501', null,
  'authenticated cannot insert: the sync writes as the service role'
);
select throws_ok(
  $$ select public.replace_bev_graph_stats('[]'::jsonb, '1.7.0') $$,
  '42501', null,
  'and authenticated cannot call the writer at all'
);
-- An update or a delete with no policy matches no row and raises nothing (and
-- on a stack that grants the role no such privilege it raises 42501). Both
-- are "cannot": try each, swallow only that error, and compare the table
-- afterwards.
do $$
begin
  begin
    update public.bev_graph_stats set pagerank = 0, community_id = 'c_ffffffffffffffff' where true;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.bev_graph_stats where true;
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a16402", "role": "authenticated"}';
select is(
  (select array_agg(right(bev_id::text, 6) order by bev_id) from public.bev_graph_stats),
  array['a16411', 'a16412'],
  'a minor reads neither the alcoholic Bev''s row nor the hidden one''s'
);
do $$
begin
  begin
    update public.bev_graph_stats set bridge = 0.5 where true;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.bev_graph_stats where true;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select is(
  pg_temp.fingerprint(),
  'a16411 c_aaaaaaaaaaaaaaaa 2 0.412345678912 3.25 4 0.25 1.7.0 | a16412 c_aaaaaaaaaaaaaaaa 2 0.3 1 1 0.123456 1.7.0 | '
    || 'a16413 c_bbbbbbbbbbbbbbbb 1 0.187654321088 0.5 1 0 1.7.0 | a16414 c_cccccccccccccccc 1 0.1 0 0 0 1.7.0',
  'an update and a delete of every row, tried by the adult and by the minor, changed nothing'
);

-- anon: the table's one policy names `authenticated` (section 1), so with RLS
-- on anon can read no row; and it cannot write one.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ insert into public.bev_graph_stats (bev_id, community_id, community_size, pagerank, strength, degree, bridge, version)
     values ('00000000-0000-4000-8000-000000a16415', 'c_ffffffffffffffff', 1, 0.5, 0, 0, 0, '1.7.0') $$,
  '42501', null,
  'anon cannot insert'
);
select throws_ok(
  $$ select public.replace_bev_graph_stats('[]'::jsonb, '1.7.0') $$,
  '42501', null,
  'nor call the writer'
);
reset role;

-- ---------------------------------------------------------------------------
-- 6. The snapshot key
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a16401", "role": "authenticated"}';
insert into t_snap (label, j) values ('adult', public.get_prediction_snapshot());
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000a16402", "role": "authenticated"}';
insert into t_snap (label, j) values ('minor', public.get_prediction_snapshot());
reset role;

select ok((select j ?& array['generatedAt', 'viewer', 'global', 'users', 'categoryStats', 'bevs', 'rankings',
                             'edges', 'userNeighbors', 'bevGraph']
             from t_snap where label = 'adult'),
          'with data, every pre-existing key and the new one are present');
-- The whole value at once: the tuple shape, the order, the rounding (A's
-- pagerank to 8 decimals, B's bridge to 4) and who is in it.
select is(
  (select j -> 'bevGraph' from t_snap where label = 'adult'),
  '[["00000000-0000-4000-8000-000000a16411", "c_aaaaaaaaaaaaaaaa", 0.41234568, 0.25],
    ["00000000-0000-4000-8000-000000a16412", "c_aaaaaaaaaaaaaaaa", 0.3, 0.1235],
    ["00000000-0000-4000-8000-000000a16414", "c_cccccccccccccccc", 0.1, 0]]'::jsonb,
  'an adult gets [bev_id, community_id, pagerank, bridge] for every visible Bev, in bev_id order, rounded'
);
select ok(
  not exists (select 1 from t_snap s, jsonb_array_elements(s.j -> 'bevGraph') x
               where s.label = 'adult'
                 and (jsonb_typeof(x) <> 'array' or jsonb_array_length(x) <> 4
                      or jsonb_typeof(x -> 0) <> 'string' or jsonb_typeof(x -> 1) <> 'string'
                      or jsonb_typeof(x -> 2) <> 'number' or jsonb_typeof(x -> 3) <> 'number')),
  'every tuple is [string, string, number, number]: the two signals are JSON numbers, not strings'
);
select is(
  (select position('00000000-0000-4000-8000-000000a16413' in (j -> 'bevGraph')::text) from t_snap where label = 'adult'),
  0,
  'the hidden Bev''s row is in the table but not in the adult''s bevGraph'
);
select is(
  (select j -> 'bevGraph' from t_snap where label = 'minor'),
  '[["00000000-0000-4000-8000-000000a16411", "c_aaaaaaaaaaaaaaaa", 0.41234568, 0.25],
    ["00000000-0000-4000-8000-000000a16412", "c_aaaaaaaaaaaaaaaa", 0.3, 0.1235]]'::jsonb,
  'a minor gets neither the alcoholic Bev''s tuple nor the hidden one''s'
);
-- D is active and visible but was created after the last sync: it is in `bevs`
-- and simply has no tuple, which the package reads as "no signal".
select ok(
  (select exists (select 1 from jsonb_array_elements(j -> 'bevs') b where b ->> 0 = '00000000-0000-4000-8000-000000a16415')
          and position('00000000-0000-4000-8000-000000a16415' in (j -> 'bevGraph')::text) = 0
     from t_snap where label = 'adult'),
  'a visible Bev with no row is in `bevs` and has no bevGraph tuple'
);
-- A tuple exists only for a Bev that is also in `bevs`: the two keys share one gate.
select ok(
  not exists (
    select 1 from t_snap s, jsonb_array_elements(s.j -> 'bevGraph') g
     where not exists (select 1 from jsonb_array_elements(s.j -> 'bevs') b where b ->> 0 = g ->> 0)),
  'in every snapshot, each bevGraph tuple is for a Bev that is in `bevs`'
);

-- Grants and the session guard, unchanged.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select public.get_prediction_snapshot() $$,
  '42501', null,
  'anon cannot call get_prediction_snapshot'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select public.get_prediction_snapshot() $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'a session without a user is unauthorized'
);
reset role;

select * from finish();
rollback;
