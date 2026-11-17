-- A-13 follow-up (20261101000400): categories_depth_guard also protects the
-- Bevs that use the tree.
--
-- A category can move without any Bev row being written, so
-- bevs_leaf_category_guard (a row trigger on bevs) never sees it. These tests
-- pin the two end-state rules the statement-level trigger gained: a category
-- that Bevs use as category_id stays a root, and one that Bevs use as
-- leaf_category_id stays a leaf, plus that the depth rule still runs first.
-- The false-positive direction matters as much: a category nothing references
-- must still move freely, and a no-op update must not trip anything.
--
-- Fixture uuid prefix: ...0000000cd0NN ("cd" for category depth). This file
-- inserts no auth.users or bevs, so no uuid is actually spent; the prefix is
-- reserved for any future fixture here. Checked against every other file in
-- supabase/tests/: the others use a1, b1..b2, c1..c3, e1..e3, f1..f4, ffff,
-- ab001..ab013, d1..d6, ff01..ff14, ed0NN, ca0NN and c1301; none uses cd0.
-- Category fixture ids are cd0_test_root and cd0_test_leaf.
--
-- All seeded ids used here exist in 20261026000200_catalog_seed.sql: roots
-- water, sports, soda, energy; leaf cola (under soda), which many seeded Bevs use
-- as their leaf_category_id (the precondition test asserts it).
--
-- Every failing statement runs inside throws_ok or pg_temp.cd0_catch, both of
-- which roll back to a savepoint, so the tree is intact for the next case.
begin;
select plan(18);

-- Runs a statement and reports 'sqlstate|message|detail', so a test can check
-- the detail (which names the category and the rule) as well as the sqlstate.
-- The exception block rolls the statement back.
create function pg_temp.cd0_catch(p_sql text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || '|' || sqlerrm || '|' || coalesce(v_detail, '');
end;
$$;

create temp table cd0_before as
select (select count(*)::int from public.bevs where category_id = 'water')  as water_bevs,
       (select count(*)::int from public.bevs where category_id = 'sports') as sports_bevs,
       (select count(*)::int from public.bevs where leaf_category_id = 'cola') as cola_bevs;

-- ---------------------------------------------------------------------------
-- 1. Rule 1: a root that Bevs use must stay a root
-- ---------------------------------------------------------------------------

select ok((select water_bevs from cd0_before) > 0 and (select sports_bevs from cd0_before) > 0
          and (select cola_bevs from cd0_before) > 0,
          'precondition: the seed has Bevs in water, sports and the cola leaf');

select throws_ok(
  $$ update public.categories set parent_id = 'soda' where id = 'water' $$,
  '22023', 'BEVI_VALIDATION',
  'moving the leafless root water under soda is rejected'
);
select alike(
  pg_temp.cd0_catch($$ update public.categories set parent_id = 'soda' where id = 'water' $$),
  '22023|BEVI_VALIDATION|category water %category_id%stay a root%',
  'and the detail names water and the rule'
);

select throws_ok(
  $$ update public.categories set parent_id = 'energy' where id = 'sports' $$,
  '22023', 'BEVI_VALIDATION',
  'moving the leafless root sports under energy is rejected'
);
select alike(
  pg_temp.cd0_catch($$ update public.categories set parent_id = 'energy' where id = 'sports' $$),
  '22023|BEVI_VALIDATION|category sports %category_id%stay a root%',
  'and the detail names sports and the rule'
);

-- ---------------------------------------------------------------------------
-- 2. Rule 2: a leaf that Bevs use must stay a leaf
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.categories set parent_id = null where id = 'cola' $$,
  '22023', 'BEVI_VALIDATION',
  'promoting the populated leaf cola to a root is rejected'
);
select alike(
  pg_temp.cd0_catch($$ update public.categories set parent_id = null where id = 'cola' $$),
  '22023|BEVI_VALIDATION|category cola %leaf_category_id%stay a leaf%',
  'and the detail names cola and the rule'
);

-- ---------------------------------------------------------------------------
-- 3. Nothing references it, so it moves freely
-- ---------------------------------------------------------------------------

insert into public.categories (id, name, parent_id, sort_order, is_alcoholic)
values ('cd0_test_root', 'CD0 Test Root', null, 90, false);

select lives_ok(
  $$ update public.categories set parent_id = 'soda' where id = 'cd0_test_root' $$,
  'a fresh root no Bev uses can be moved under soda'
);

insert into public.categories (id, name, parent_id, sort_order, is_alcoholic)
values ('cd0_test_leaf', 'CD0 Test Leaf', 'soda', 91, false);

select lives_ok(
  $$ update public.categories set parent_id = null where id = 'cd0_test_leaf' $$,
  'a fresh leaf no Bev uses can be promoted to a root'
);

-- A no-op write that touches the watched column must not trip a rule: the end
-- state is valid, and the populated rows stay where they are.
select lives_ok(
  $$ update public.categories set parent_id = parent_id where id in ('water', 'cola') $$,
  'rewriting parent_id to its current value on populated categories is accepted'
);

-- ---------------------------------------------------------------------------
-- 4. The depth rule still runs, and first
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.categories (id, name, parent_id, sort_order, is_alcoholic)
     values ('cd0_too_deep', 'CD0 Too Deep', 'cola', 1, false) $$,
  '22023', 'BEVI_VALIDATION',
  'a third level is still rejected'
);

-- water under cola breaks the depth rule AND rule 1 (water would be a leaf its
-- Bevs use as category_id). The detail must come from the depth rule.
select alike(
  pg_temp.cd0_catch($$ update public.categories set parent_id = 'cola' where id = 'water' $$),
  '22023|BEVI_VALIDATION|category water is three levels deep%',
  'a statement that breaks several rules reports the depth rule first'
);

-- ---------------------------------------------------------------------------
-- 5. The trigger is still the same statement-level one, and nothing leaked
-- ---------------------------------------------------------------------------

select ok(
  exists (select 1 from pg_trigger
           where tgname = 'categories_depth_guard'
             and tgrelid = 'public.categories'::regclass
             and not tgisinternal
             and (tgtype & 1) = 0),
  'categories_depth_guard is still attached and is still a statement-level trigger'
);

select is(
  (select count(*)::int from public.bevs where category_id = 'water'),
  (select water_bevs from cd0_before),
  'the water Bev count is unchanged after the rejected moves'
);
select is(
  (select count(*)::int from public.bevs where category_id = 'sports'),
  (select sports_bevs from cd0_before),
  'the sports Bev count is unchanged after the rejected moves'
);
select is(
  (select count(*)::int from public.categories where id in ('water', 'sports') and parent_id is not null),
  0,
  'water and sports are still roots'
);
select is(
  (select parent_id from public.categories where id = 'cola'),
  'soda',
  'cola is still a leaf of soda'
);
select is(
  (select count(*)::int from public.bevs where leaf_category_id = 'cola'),
  (select cola_bevs from cd0_before),
  'the cola leaf Bev count is unchanged after the rejected promotion'
);

select * from finish();
rollback;
