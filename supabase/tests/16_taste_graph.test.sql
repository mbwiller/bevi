-- A-16 (2) (20261026000300): user_neighbors, its RLS, and the three
-- service-role functions the nightly taste-graph job calls.
--
-- What this file is for, in order: the table shape and its CHECKs; RLS, which
-- is the part that matters most here because this is the first table in the
-- schema whose rows name ANOTHER user; that the three new functions are
-- service-role only, including the one that returns every user's rankings;
-- `replace_user_neighbors`' validation and its atomicity; and that an EMPTY
-- payload is accepted, which is where it deliberately differs from
-- `replace_bev_edges`.
--
-- The privacy claim worth testing rather than asserting in a comment: a signed
-- in user may read their OWN neighbour rows and nobody else's, and may not
-- call `ranking_z_inputs()` at all. `rankings_select` limits a user to their
-- own rankings and their followees'; that function returns everyone's, so a
-- leftover default EXECUTE grant on it would hand any account the whole
-- ranking table in one request. Section 3 is that test.
--
-- Fixture uuid prefix: ...0000000tg0NN would not be valid hex, so this file
-- uses ...000000a16NN ("a16" for A-16). Checked against every other file in
-- supabase/tests/: 09_leaderboard_parity uses ab001..ab006 and ab011..ab013,
-- 10_explore uses d1..d6 and ff01..ff14, 11_graph_tables uses ed0NN,
-- 15_category_hierarchy uses ca0NN, and the earlier files use a1, b1..b2,
-- c1..c3, e1..e3, f1..f4 and ffff. a16NN collides with none.
--
-- The people:
--   a1601  adult (30)   owns neighbour rows
--   a1602  adult (30)   is a1601's neighbour, and owns rows of their own
--   a1603  adult (30)   owns nothing: the "no rows" tier
begin;
select plan(41);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000a1601', 'pgtaptg1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000a1602', 'pgtaptg2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000a1603', 'pgtaptg3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000a1601',
              '00000000-0000-4000-8000-0000000a1602',
              '00000000-0000-4000-8000-0000000a1603');
set local bevi.rpc_bypass = 'false';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.user_neighbors') is not null, 'user_neighbors exists');
select ok(to_regclass('public.user_neighbors_user_sim_idx') is not null,
          'the (user_id, sim desc, neighbor_id) index exists');

select ok(
  to_regprocedure('public.replace_user_neighbors(jsonb, text)') is not null
  and to_regprocedure('public.ranking_z_inputs()') is not null
  and to_regprocedure('public.bev_co_rater_counts(int)') is not null,
  'all three new functions exist with the expected signatures'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_neighbors'::regclass),
  'RLS is enabled on user_neighbors'
);

-- No policy at all. Writes: the job writes as the service role, which
-- bypasses RLS (supabase/CLAUDE.md's rule for content tables). Reads: a row
-- names another user's uuid, which must never reach a client; Stage 4 reads
-- through the definer snapshot RPC, which emits aliases.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'user_neighbors'),
  0,
  'user_neighbors has no policy at all: no client read or write path'
);

-- ---------------------------------------------------------------------------
-- 2. The table's own CHECKs
-- ---------------------------------------------------------------------------
-- Written as direct inserts, as the owner, because the point is the
-- constraint rather than the RPC.

select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1601',
             0.5, 2, 0, 'blend', '1.3.0') $$,
  '23514',
  null,
  'nobody is their own neighbour'
);

-- numeric(5,4) is 5 digits with 4 after the point, so it spans (-10, 10) and
-- 1.5 fits the TYPE comfortably. The CHECK is what holds sim to a correlation's
-- range, which is the constraint worth having: a similarity above 1 is a job
-- bug, not a storage problem.
select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             1.5, 2, 0, 'blend', '1.3.0') $$,
  '23514',
  null,
  'sim above 1 is rejected by the CHECK (the type would have accepted it)'
);

-- And the type's own bound, so the precision is pinned too: four decimals is
-- lossless for everything the job stores, and a wild value cannot be truncated
-- into range.
select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             10.5, 2, 0, 'blend', '1.3.0') $$,
  '22003',
  null,
  'and a value outside numeric(5,4) overflows rather than rounding into range'
);

select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             0.5, -1, 0, 'blend', '1.3.0') $$,
  '23514',
  null,
  'a negative common count is rejected'
);

select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             0.5, 2, 0, 'cosine', '1.3.0') $$,
  '23514',
  null,
  'a method outside (pearson, attr, blend) is rejected'
);

-- A NEGATIVE sim is allowed: the floor is the job's policy, not the schema's,
-- so lowering TASTE_SIM_FLOOR must not need a migration.
select lives_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             -0.4, 2, 0, 'blend', '1.3.0') $$,
  'a negative sim is storable: the 0.1 floor belongs to the job, not the table'
);

-- Both directions of one pair are two distinct rows, which is the whole reason
-- this table is not canonically oriented like bev_edges.
select lives_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1602', '00000000-0000-4000-8000-0000000a1601',
             -0.4, 2, 0, 'blend', '1.3.0') $$,
  'the reverse direction is a separate row, not a primary-key conflict'
);

select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1602',
             0.9, 3, 1, 'blend', '1.3.0') $$,
  '23505',
  null,
  'the same direction twice is a primary-key conflict'
);

-- ---------------------------------------------------------------------------
-- 3. RLS and the grants: the privacy half
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1601", "role": "authenticated"}';

select is(
  (select count(*)::int from public.user_neighbors),
  0,
  'a1601 sees no rows, not even their own: a row names the neighbour''s uuid'
);
select is(
  (select count(*)::int from public.user_neighbors
    where neighbor_id = '00000000-0000-4000-8000-0000000a1602'),
  0,
  'and in particular not the row naming a1602'
);

select throws_ok(
  $$ insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
     values ('00000000-0000-4000-8000-0000000a1601', '00000000-0000-4000-8000-0000000a1603',
             0.9, 2, 0, 'blend', '1.3.0') $$,
  '42501',
  null,
  'an authenticated user cannot insert a neighbour row, even their own'
);

-- NOT a throws_ok: RLS with no DELETE policy makes no row visible to the
-- command, so the DELETE silently affects zero rows rather than raising. The
-- assertion that matters is therefore that the data SURVIVES, which is also
-- the stronger claim -- a client cannot destroy a generation.
select lives_ok(
  $$ delete from public.user_neighbors $$,
  'a client DELETE does not raise: with no DELETE policy it simply matches nothing'
);
reset role;
select is(
  (select count(*)::int from public.user_neighbors
    where user_id = '00000000-0000-4000-8000-0000000a1601'),
  1,
  'and the row survives, so no client can wipe a neighbour generation'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1601", "role": "authenticated"}';

-- THE ONE THAT MATTERS: ranking_z_inputs returns every user's rankings, which
-- rankings_select deliberately does not. A leftover default grant here would
-- hand any signed-in account the whole ranking table.
select throws_ok(
  $$ select * from public.ranking_z_inputs() $$,
  '42501',
  null,
  'an authenticated user cannot call ranking_z_inputs: it returns everyone''s rankings'
);
select throws_ok(
  $$ select * from public.replace_user_neighbors('[]'::jsonb, '1.3.0') $$,
  '42501',
  null,
  'an authenticated user cannot replace the neighbour table'
);
select throws_ok(
  $$ select * from public.bev_co_rater_counts(3) $$,
  '42501',
  null,
  'an authenticated user cannot call bev_co_rater_counts'
);

select ok(
  not has_function_privilege('authenticated', 'public.ranking_z_inputs()', 'execute')
  and not has_function_privilege('anon', 'public.ranking_z_inputs()', 'execute')
  and not has_function_privilege('authenticated', 'public.replace_user_neighbors(jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.replace_user_neighbors(jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.bev_co_rater_counts(int)', 'execute')
  and not has_function_privilege('anon', 'public.bev_co_rater_counts(int)', 'execute'),
  'neither authenticated nor anon holds EXECUTE on any of the three'
);
select ok(
  has_function_privilege('service_role', 'public.ranking_z_inputs()', 'execute')
  and has_function_privilege('service_role', 'public.replace_user_neighbors(jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.bev_co_rater_counts(int)', 'execute'),
  'the service role holds EXECUTE on all three'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1603", "role": "authenticated"}';
select is(
  (select count(*)::int from public.user_neighbors),
  0,
  'a user with no neighbour rows sees none: the doc''s "not yet synced" tier'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. replace_user_neighbors
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.replace_user_neighbors('[]'::jsonb, '') $$,
  '22023', 'BEVI_VALIDATION',
  'a blank version is rejected'
);
select throws_ok(
  $$ select public.replace_user_neighbors('{}'::jsonb, '1.3.0') $$,
  '22023', 'BEVI_VALIDATION',
  'a non-array payload is rejected'
);

-- The deliberate difference from replace_bev_edges: empty is ACCEPTED, because
-- no neighbours is the expected result at current data volume (#122).
select is(
  (select public.replace_user_neighbors('[]'::jsonb, '1.3.0')),
  0,
  'an EMPTY payload is accepted and writes nothing, unlike replace_bev_edges'
);
select is(
  (select count(*)::int from public.user_neighbors),
  0,
  'and it replaced the table, so a stale generation is never served'
);

select throws_ok(
  $$ select public.replace_user_neighbors(
       '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
          "neighbor_id": "00000000-0000-4000-8000-0000000a1601",
          "sim": 0.5, "common": 2, "shared_attrs": 0, "method": "blend"}]'::jsonb, '1.3.0') $$,
  '22023', 'BEVI_VALIDATION',
  'a self-row is named as such rather than hitting the CHECK'
);

select throws_ok(
  $$ select public.replace_user_neighbors(
       '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
          "neighbor_id": "00000000-0000-4000-8000-0000000a1602",
          "sim": 0.5, "common": 2, "shared_attrs": 0, "method": "cosine"}]'::jsonb, '1.3.0') $$,
  '22023', 'BEVI_VALIDATION',
  'an unknown method is named rather than hitting the CHECK'
);

select throws_ok(
  $$ select public.replace_user_neighbors(
       '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
          "neighbor_id": "00000000-0000-4000-8000-00000000dead",
          "sim": 0.5, "common": 2, "shared_attrs": 0, "method": "blend"}]'::jsonb, '1.3.0') $$,
  '22023', 'BEVI_VALIDATION',
  'an unknown user id is named rather than hitting the foreign key'
);

select throws_ok(
  $$ select public.replace_user_neighbors(
       '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
          "neighbor_id": "00000000-0000-4000-8000-0000000a1602",
          "sim": 0.5, "common": 2, "shared_attrs": 0, "method": "blend"},
         {"user_id": "00000000-0000-4000-8000-0000000a1601",
          "neighbor_id": "00000000-0000-4000-8000-0000000a1602",
          "sim": 0.9, "common": 3, "shared_attrs": 1, "method": "blend"}]'::jsonb, '1.3.0') $$,
  '22023', 'BEVI_VALIDATION',
  'a duplicated pair is named rather than hitting the primary key'
);

-- The happy path, including that the version comes from the argument and not
-- from the payload.
select is(
  (select public.replace_user_neighbors(
     '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
        "neighbor_id": "00000000-0000-4000-8000-0000000a1602",
        "sim": 0.8125, "common": 4, "shared_attrs": 2, "method": "blend"},
       {"user_id": "00000000-0000-4000-8000-0000000a1602",
        "neighbor_id": "00000000-0000-4000-8000-0000000a1601",
        "sim": 0.8125, "common": 4, "shared_attrs": 2, "method": "blend"}]'::jsonb, '1.3.0')),
  2,
  'both directions of one pair are written and counted'
);

select results_eq(
  $$ select user_id, neighbor_id, sim, common, shared_attrs, method, version
       from public.user_neighbors order by user_id $$,
  $$ values ('00000000-0000-4000-8000-0000000a1601'::uuid,
             '00000000-0000-4000-8000-0000000a1602'::uuid,
             0.8125::numeric(5,4), 4::smallint, 2::smallint, 'blend', '1.3.0'),
            ('00000000-0000-4000-8000-0000000a1602'::uuid,
             '00000000-0000-4000-8000-0000000a1601'::uuid,
             0.8125::numeric(5,4), 4::smallint, 2::smallint, 'blend', '1.3.0') $$,
  'the stored rows are the payload, stamped with the version argument'
);

-- A second call replaces rather than appends, which is what makes the job
-- idempotent.
select is(
  (select public.replace_user_neighbors(
     '[{"user_id": "00000000-0000-4000-8000-0000000a1601",
        "neighbor_id": "00000000-0000-4000-8000-0000000a1603",
        "sim": 0.2, "common": 0, "shared_attrs": 2, "method": "attr"}]'::jsonb, '1.4.0')),
  1,
  'a second call returns its own row count'
);
select is(
  (select count(*)::int from public.user_neighbors),
  1,
  'and replaced the previous generation rather than appending to it'
);
select is(
  (select version from public.user_neighbors),
  '1.4.0',
  'the new generation carries the new version'
);

-- ---------------------------------------------------------------------------
-- 5. ranking_z_inputs and bev_co_rater_counts, as the owner
-- ---------------------------------------------------------------------------
-- The seed catalog has no rankings, so both are empty here. What is worth
-- pinning is the SHAPE -- `score` must arrive as a float8, because
-- `zScoresFromRankings` throws on a non-finite score and PostgREST renders
-- numeric as a JSON string, and `active` must be there at all.

select is(
  (select count(*)::int from public.ranking_z_inputs()),
  0,
  'no rankings in the seed, so ranking_z_inputs is empty rather than erroring'
);

select is(
  (select t.typname
     from pg_proc p
     join unnest(p.proallargtypes) with ordinality as a(oid, ord) on true
     join pg_type t on t.oid = a.oid
    where p.oid = 'public.ranking_z_inputs()'::regprocedure
      and a.ord = 3),
  'float8',
  'ranking_z_inputs returns score as float8, not numeric'
);

-- Every ranking comes back, whatever the Bev's status, FLAGGED rather than
-- filtered: the job takes mu and sigma from all of them (as
-- get_prediction_snapshot does) and only then keeps active Bevs as co-rated.
-- The seed has no rankings to filter, so the contract pinned here is the
-- column list, which is what the job's strict `active` check reads.
select is(
  (select string_agg(a.name || ':' || t.typname, ',' order by a.ord)
     from pg_proc p
     join unnest(p.proargnames, p.proallargtypes) with ordinality as a(name, oid, ord) on true
     join pg_type t on t.oid = a.oid
    where p.oid = 'public.ranking_z_inputs()'::regprocedure),
  'user_id:uuid,bev_id:uuid,score:float8,active:bool',
  'ranking_z_inputs returns (user_id, bev_id, score float8, active bool): every ranking, with its Bev flagged'
);

select is(
  (select count(*)::int from public.bev_co_rater_counts(3)),
  0,
  'no Bev has 3 raters in the seed, so the cop term has nothing to say'
);

select * from finish();
rollback;
