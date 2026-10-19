-- S-07 + A-06 (20261018000200): get_category_progress.
begin;
select plan(11);

-- u1 is 30 (sees alcohol), u2 is 16.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000d1', 'pgtapprog1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d2', 'pgtapprog2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns silently pins birth_date unless the trusted-RPC
-- bypass flag is on, so a bare update would leave both ages null.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000000d1';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000d2';
set local bevi.rpc_bypass = 'false';

-- The category under test: the first non-alcoholic category with a seed Bev,
-- and its active count measured as the owner, before RLS is in play.
create temporary table t_cat on commit drop as
select b.category_id as id,
       (select count(*)::int from public.bevs x
         where x.category_id = b.category_id and x.status = 'active') as active
  from public.bevs b join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.name, b.id limit 1;
grant select on t_cat to authenticated;

-- Two non-active Bevs in that category: u1's own pending_photo (which
-- bevs_select shows to u1) and a hidden one. Neither may count.
insert into public.bevs (name, category_id, price_tier, status, created_by, source)
select 'Pgtap pending Bev', id, 1, 'pending_photo', '00000000-0000-4000-8000-0000000000d1', 'user' from t_cat;
insert into public.bevs (name, category_id, price_tier, status, source)
select 'Pgtap hidden Bev', id, 1, 'hidden', 'user' from t_cat;

select ok(
  not has_function_privilege('anon', 'public.get_category_progress()', 'execute'),
  'anon cannot call get_category_progress'
);

set local role authenticated;

-- No signed-in user.
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_category_progress() $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'raises BEVI_UNAUTHORIZED without a caller'
);

-- ---------------------------------------------------------------------------
-- As u1 (adult, no rankings yet).
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_category_progress()),
  (select count(*)::int from public.categories),
  'an adult gets one row per category, alcoholic ones included'
);
select is(
  (select coalesce(sum(ranked), 0)::int from public.get_category_progress()),
  0,
  'a caller with no rankings has ranked 0 everywhere'
);
select is(
  (select total from public.get_category_progress() p join t_cat on t_cat.id = p.category_id),
  (select active from t_cat),
  'total counts only active Bevs (not the caller''s pending_photo one, not a hidden one)'
);
select ok(
  (select bool_and(total >= 0) from public.get_category_progress()),
  'totals are never negative'
);

select public.submit_ranking(
  (select b.id from public.bevs b join t_cat on t_cat.id = b.category_id
    where b.source = 'seed' and b.status = 'active'
    order by b.name, b.id limit 1),
  3::smallint, 0, 0);

select is(
  (select ranked from public.get_category_progress() p join t_cat on t_cat.id = p.category_id),
  1,
  'a ranking counts in its category'
);
select is(
  (select coalesce(sum(ranked), 0)::int from public.get_category_progress()),
  1,
  'and nowhere else'
);

-- ---------------------------------------------------------------------------
-- As u2 (16).
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d2", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_category_progress() p
     join public.categories c on c.id = p.category_id where c.is_alcoholic),
  0,
  'an under-21 caller gets no alcoholic categories'
);
select is(
  (select count(*)::int from public.get_category_progress()),
  (select count(*)::int from public.categories where not is_alcoholic),
  'but every other category'
);
select is(
  (select coalesce(sum(ranked), 0)::int from public.get_category_progress()),
  0,
  'and only their own rankings count'
);

select * from finish();
rollback;
