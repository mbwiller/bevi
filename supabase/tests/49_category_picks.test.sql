-- DELIVERABLE-44 (20261128000200): go-to categories. `user_category_picks`
-- and `set_category_picks()`.
--
-- THE PEOPLE (uuid band ...0000000047NN; nothing else in supabase/tests/ uses
-- it, and seed.sql creates no users):
--
--   label  NN  age
--   ada    01  30     the main caller
--   kid    02  15     under 21: alcohol is refused
--   oli    03  30     a bystander, for the privacy assertions
--
-- What a validation failure says is checked with pg_temp.picks_error(), which
-- returns `<sqlstate> <message> <detail>`: throws_ok cannot see the detail,
-- and `detail = 'categoryIds'` is what packages/api turns into
-- `{ field: 'categoryIds' }`.
begin;
select plan(47);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000047' || v.nn)::uuid
  from (values ('ada', '01'), ('kid', '02'), ('oli', '03')) v(label, nn);
grant select on t_users to authenticated;

-- handle_new_user makes each profile, its user_stats row and its streaks row.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtappicks' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users where label in ('ada', 'oli'));
update public.profiles set birth_date = (current_date - interval '15 years')::date
 where id = (select id from t_users where label = 'kid');
set local bevi.rpc_bypass = 'false';

-- Calls set_category_picks and reports how it failed, or 'ok'. Runs as
-- whoever calls it (not a definer), so the session's claims are the caller.
create function pg_temp.picks_error(p_ids text[]) returns text
language plpgsql as $fn$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  perform public.set_category_picks(p_ids);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_msg || ' ' || coalesce(v_detail, '');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Schema, policies, privileges
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_category_picks'::regclass),
  'user_category_picks has RLS enabled'
);
select is(
  (select array_agg(policyname::text || '/' || cmd order by policyname)
     from pg_policies
    where schemaname = 'public' and tablename = 'user_category_picks'),
  array['user_category_picks_select/SELECT'],
  'one policy on user_category_picks, and it is SELECT: no direct write path'
);
select ok(
  has_table_privilege('authenticated', 'public.user_category_picks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.user_category_picks', 'INSERT')
  and not has_table_privilege('authenticated', 'public.user_category_picks', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.user_category_picks', 'DELETE')
  and not has_table_privilege('authenticated', 'public.user_category_picks', 'TRUNCATE'),
  'authenticated keeps SELECT (the policy stands on it) and nothing else'
);
select ok(
  not has_table_privilege('anon', 'public.user_category_picks', 'SELECT')
  and not has_table_privilege('anon', 'public.user_category_picks', 'INSERT')
  and not has_table_privilege('anon', 'public.user_category_picks', 'UPDATE')
  and not has_table_privilege('anon', 'public.user_category_picks', 'DELETE')
  and not has_table_privilege('anon', 'public.user_category_picks', 'TRUNCATE'),
  'anon holds no privilege on user_category_picks'
);
select ok(
  (select p.prosecdef and r.rolname = 'postgres' and p.proconfig @> array['search_path=public']
     from pg_proc p
     join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.set_category_picks(text[])'::regprocedure),
  'set_category_picks is security definer, owned by postgres, with a pinned search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.set_category_picks(text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_category_picks(text[])', 'EXECUTE'),
  'set_category_picks is executable by authenticated and not by anon'
);

-- ---------------------------------------------------------------------------
-- 2. No caller
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.set_category_picks(array['soda']) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'set_category_picks without a caller is BEVI_UNAUTHORIZED'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select * from public.set_category_picks(array['soda']) $$,
  '42501', null,
  'anon cannot call set_category_picks'
);
reset role;

-- ---------------------------------------------------------------------------
-- 3. Set, read back, replace, clear (ada, 21+)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';

select is(
  (select count(*)::int from public.user_category_picks),
  0,
  'ada starts with no picks: [] until set'
);
select results_eq(
  $$ select category_id, rank::int from public.set_category_picks(array['coffee', 'soda', 'tea']) $$,
  $$ values ('coffee'::text, 1), ('soda'::text, 2), ('tea'::text, 3) $$,
  'set_category_picks returns the saved picks in rank order, the array position being the rank'
);
select results_eq(
  $$ select category_id, rank::int from public.user_category_picks order by rank $$,
  $$ values ('coffee'::text, 1), ('soda'::text, 2), ('tea'::text, 3) $$,
  'ada reads the same three back from the table through RLS'
);
select ok(
  (select bool_and(user_id = '00000000-0000-4000-8000-000000004701') from public.user_category_picks),
  'every row is stamped with the caller as user_id'
);

select results_eq(
  $$ select category_id, rank::int from public.set_category_picks(array['juice']) $$,
  $$ values ('juice'::text, 1) $$,
  'replacing three picks with one returns the one'
);
select results_eq(
  $$ select category_id, rank::int from public.user_category_picks $$,
  $$ values ('juice'::text, 1) $$,
  'and leaves exactly one row: the replace deleted the other two'
);

-- A favourite that moves: the same ids in a new order re-rank, no PK clash.
select results_eq(
  $$ select category_id, rank::int from public.set_category_picks(array['tea', 'juice']) $$,
  $$ values ('tea'::text, 1), ('juice'::text, 2) $$,
  'a pick that changes rank is re-ranked in the same call'
);

select is(
  (select count(*)::int from public.set_category_picks('{}'::text[])),
  0,
  'an empty array is valid and returns nothing'
);
select is(
  (select count(*)::int from public.user_category_picks),
  0,
  'and clears the picks'
);

-- ---------------------------------------------------------------------------
-- 4. Validation: BEVI_VALIDATION, detail 'categoryIds'
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select category_id from public.set_category_picks(array['water']) $$,
  $$ values ('water'::text) $$,
  'ada picks water before the failures below'
);

select is(pg_temp.picks_error(null::text[]), '22023 BEVI_VALIDATION categoryIds',
  'a null array is BEVI_VALIDATION on categoryIds');
select is(pg_temp.picks_error(array['soda', 'juice', 'tea', 'coffee']), '22023 BEVI_VALIDATION categoryIds',
  'four picks is BEVI_VALIDATION on categoryIds');
select is(pg_temp.picks_error(array['soda', null]), '22023 BEVI_VALIDATION categoryIds',
  'a null entry is BEVI_VALIDATION on categoryIds');
select is(pg_temp.picks_error(array['soda', 'tea', 'soda']), '22023 BEVI_VALIDATION categoryIds',
  'a repeated category is BEVI_VALIDATION on categoryIds');
select is(pg_temp.picks_error(array['soda', 'no_such_category']), '22023 BEVI_VALIDATION categoryIds',
  'an id that is not a category is BEVI_VALIDATION on categoryIds');
select is(pg_temp.picks_error(array['cola']), '22023 BEVI_VALIDATION categoryIds',
  'a leaf (cola, under soda) is BEVI_VALIDATION on categoryIds: picks are top-level only');
select is(pg_temp.picks_error(array[['soda', 'tea']]), '22023 BEVI_VALIDATION categoryIds',
  'a two-dimensional array is BEVI_VALIDATION on categoryIds');

select results_eq(
  $$ select category_id, rank::int from public.user_category_picks $$,
  $$ values ('water'::text, 1) $$,
  'none of the refused calls touched the saved picks'
);

-- ---------------------------------------------------------------------------
-- 5. The age gate
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select category_id, rank::int from public.set_category_picks(array['beer', 'wine', 'spirits_cocktails']) $$,
  $$ values ('beer'::text, 1), ('wine'::text, 2), ('spirits_cocktails'::text, 3) $$,
  'ada, 21+, may pick all three alcoholic categories'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004702", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.set_category_picks(array['beer']) $$,
  '42501', 'BEVI_AGE_RESTRICTED',
  'kid, under 21, may not pick beer'
);
select throws_ok(
  $$ select * from public.set_category_picks(array['soda', 'wine']) $$,
  '42501', 'BEVI_AGE_RESTRICTED',
  'one alcoholic category refuses the whole list'
);
select is(pg_temp.picks_error(array['lager']), '22023 BEVI_VALIDATION categoryIds',
  'a leaf under beer is a validation failure for kid, not an age one: validation runs first');
select is(
  (select count(*)::int from public.user_category_picks),
  0,
  'the refusals saved nothing for kid'
);
select results_eq(
  $$ select category_id, rank::int from public.set_category_picks(array['boba', 'energy']) $$,
  $$ values ('boba'::text, 1), ('energy'::text, 2) $$,
  'kid may pick categories that are not alcoholic'
);

-- ---------------------------------------------------------------------------
-- 6. Private to the owner
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(category_id order by rank) from public.user_category_picks),
  array['boba', 'energy'],
  'kid reads their own picks and none of ada''s'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004703", "role": "authenticated"}';
select is(
  (select count(*)::int from public.user_category_picks),
  0,
  'oli, with no picks, reads no rows at all: neither ada''s nor kid''s'
);
select is(
  (select count(*)::int from public.user_category_picks
    where user_id = '00000000-0000-4000-8000-000000004701'),
  0,
  'oli cannot read ada''s picks even by asking for her id'
);
select results_eq(
  $$ select category_id from public.set_category_picks(array['sports']) $$,
  $$ values ('sports'::text) $$,
  'oli sets a pick of their own'
);
select is(
  (select array_agg(user_id::text) from public.user_category_picks),
  array['00000000-0000-4000-8000-000000004703'],
  'and reads exactly that one row, their own'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select count(*) from public.user_category_picks $$,
  '42501', null,
  'anon cannot read user_category_picks at all'
);
reset role;

-- ---------------------------------------------------------------------------
-- 7. No direct writes, even of your own rows
-- ---------------------------------------------------------------------------
-- 42501 at the privilege check: the verbs were revoked, so these never reach
-- RLS. Each runs in throws_ok's own savepoint.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.user_category_picks (user_id, rank, category_id)
     values ('00000000-0000-4000-8000-000000004701', 1, 'juice') $$,
  '42501', null,
  'no direct insert into user_category_picks, even of your own row'
);
select throws_ok(
  $$ update public.user_category_picks set category_id = 'juice'
      where user_id = '00000000-0000-4000-8000-000000004701' and rank = 1 $$,
  '42501', null,
  'no direct update of user_category_picks'
);
select throws_ok(
  $$ delete from public.user_category_picks where user_id = '00000000-0000-4000-8000-000000004701' $$,
  '42501', null,
  'no direct delete from user_category_picks'
);
select throws_ok(
  $$ truncate public.user_category_picks $$,
  '42501', null,
  'no truncate of user_category_picks'
);
select results_eq(
  $$ select category_id, rank::int from public.user_category_picks order by rank $$,
  $$ values ('beer'::text, 1), ('wine'::text, 2), ('spirits_cocktails'::text, 3) $$,
  'ada''s picks are as set_category_picks left them'
);

-- ---------------------------------------------------------------------------
-- 8. Account deletion takes the picks with it
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select count(*)::int from public.user_category_picks
    where user_id = '00000000-0000-4000-8000-000000004701'),
  3,
  'before deletion: ada has three picks'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000004701", "role": "authenticated"}';
select lives_ok(
  $$ select public.delete_my_account() $$,
  'ada deletes her account'
);

reset role;
select is(
  (select count(*)::int from public.user_category_picks
    where user_id = '00000000-0000-4000-8000-000000004701'),
  0,
  'deleting an account removes its picks (the cascade from profiles)'
);
select is(
  (select count(*)::int from public.user_category_picks
    where user_id in ('00000000-0000-4000-8000-000000004702', '00000000-0000-4000-8000-000000004703')),
  3,
  'and leaves everyone else''s alone'
);

select * from finish();
rollback;
