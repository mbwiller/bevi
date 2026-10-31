-- A-13 (20261026000100 + 20261026000200): the category hierarchy.
--
-- What this file is for, in order: the two new columns and their constraints;
-- that the seed really loaded D-04's tree and reassigned the catalog; the two
-- guard triggers, which are the only thing standing between `category_id` and
-- the leaf drifting apart; `category_root` / `category_is_alcoholic` on both a
-- root and a leaf; and the two RPCs -- the tree's age gate and order, and
-- `get_bev_leaves`' null-versus-absent distinction, which is the part a caller
-- is most likely to get wrong.
--
-- The one invariant worth stating plainly, because every assertion below leans
-- on it: `bevs.category_id` is STILL one of the 15 roots after A-13. The app
-- keys exhaustive maps off those ids, so if any seeded Bev ends up pointing at
-- a leaf, the app breaks rather than this test. Hence `no seeded Bev sits on a
-- leaf` below.
--
-- Fixture uuid prefix: ...0000000ca0NN ("ca" for category). Checked against
-- every other file in supabase/tests/: 09_leaderboard_parity uses ab001..ab006
-- and ab011..ab013, 10_explore uses d1..d6 and ff01..ff14, 11_graph_tables uses
-- ed0NN, and the earlier files use a1, b1..b2, c1..c3, e1..e3, f1..f4 and ffff.
-- ca0NN collides with none.
--
-- The people:
--   ca001  adult (30)   sees the whole tree
--   ca002  minor (16)   sees neither an alcoholic root nor its leaves
begin;
select plan(53);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000ca001', 'pgtapcat1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca002', 'pgtapcat2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date silently unless the trusted-RPC
-- bypass is on, so without this every age is null (nobody adult) and the
-- age-gate assertions would pass for the wrong reason.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000ca001';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000ca002';
set local bevi.rpc_bypass = 'false';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- Asserted over the catalogs with `ok`, the way 00_schema and the rest of this
-- suite do it, rather than with pgTAP's has_column / has_index / has_function:
-- nothing else here uses those, so this file does not depend on a helper the
-- CI image has never had to provide.
select ok(
  (select is_nullable = 'YES' and data_type = 'text'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'categories' and column_name = 'parent_id'),
  'categories.parent_id exists, is text and is nullable: a root has none'
);
select ok(
  (select is_nullable = 'YES' and data_type = 'text'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'bevs' and column_name = 'leaf_category_id'),
  'bevs.leaf_category_id exists, is text and is nullable: the shape rule allows a Bev on its parent'
);

-- A self-referencing FK, so a leaf cannot point at a category that is not there.
select ok(
  exists (
    select 1
      from pg_constraint
     where conname = 'categories_parent_id_fkey'
       and conrelid = 'public.categories'::regclass
       and confrelid = 'public.categories'::regclass
       and contype = 'f'
  ),
  'categories.parent_id is a self-referencing foreign key'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bevs'::regclass
       and contype = 'f'
       and confrelid = 'public.categories'::regclass
       and conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.bevs'::regclass and attname = 'leaf_category_id')]
  ),
  'bevs.leaf_category_id references categories'
);

select ok(to_regclass('public.bevs_leaf_category_idx') is not null,
          'the partial index on leaf_category_id exists');
select ok(
  (select indpred is not null
     from pg_index
    where indexrelid = 'public.bevs_leaf_category_idx'::regclass),
  'and it is partial, so it indexes only the Bevs that have a leaf'
);

select ok(
  to_regprocedure('public.category_root(text)') is not null
  and to_regprocedure('public.category_is_alcoholic(text)') is not null
  and to_regprocedure('public.get_category_tree()') is not null
  and to_regprocedure('public.get_bev_leaves(uuid[])') is not null,
  'all four new functions exist with the expected signatures'
);

select ok(
  has_function_privilege('authenticated', 'public.get_category_tree()', 'execute')
  and has_function_privilege('authenticated', 'public.get_bev_leaves(uuid[])', 'execute'),
  'authenticated may execute both new RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.get_category_tree()', 'execute')
  and not has_function_privilege('anon', 'public.get_bev_leaves(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.category_root(text)', 'execute')
  and not has_function_privilege('anon', 'public.category_is_alcoholic(text)', 'execute'),
  'anon may execute none of the four new functions'
);

-- Both guards must be attached, or every assertion in section 3 would pass
-- vacuously if someone dropped a trigger.
select ok(
  exists (select 1 from pg_trigger where tgname = 'bevs_leaf_category_guard'
            and tgrelid = 'public.bevs'::regclass and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'categories_depth_guard'
                and tgrelid = 'public.categories'::regclass and not tgisinternal),
  'both guard triggers are attached'
);

-- ---------------------------------------------------------------------------
-- 2. What the seed loaded (20261026000200, from data/catalog)
-- ---------------------------------------------------------------------------
-- These pin D-04's shape, not its content: if someone adds a leaf the counts
-- move and this file should move with them. The STRUCTURAL claims below -- two
-- levels, inherited flags, roots unchanged -- are the ones that must never move.

select is((select count(*)::int from public.categories where parent_id is null), 15,
          'the 15 roots are unchanged in number');
select is((select count(*)::int from public.categories where parent_id is not null), 60,
          'D-04''s 60 leaves loaded');

select is(
  (select count(*)::int
     from public.categories c
     join public.categories p on p.id = c.parent_id
    where p.parent_id is not null),
  0,
  'exactly two levels: no leaf parents another leaf'
);

select is(
  (select count(*)::int
     from public.categories c
     join public.categories p on p.id = c.parent_id
    where c.is_alcoholic <> p.is_alcoholic),
  0,
  'every leaf inherits its root''s is_alcoholic, which is what the one-hop age gate assumes'
);

select is((select count(*)::int from public.categories where parent_id = id), 0,
          'no category is its own parent');

-- THE cross-lane invariant: `category_id` still holds one of the 15.
select is(
  (select count(*)::int
     from public.bevs b
     join public.categories c on c.id = b.category_id
    where c.parent_id is not null),
  0,
  'no Bev''s category_id points at a leaf: the app''s Record<CategoryId, ...> maps stay exhaustive'
);

select is(
  (select count(*)::int from public.bevs where source = 'seed' and leaf_category_id is not null),
  344,
  '344 seeded Bevs were reassigned to a leaf'
);

select is(
  (select count(*)::int from public.bevs where source = 'seed' and leaf_category_id is null),
  34,
  '34 seeded Bevs sit on an unsplit parent (water 14, sports 20)'
);

-- The two unsplit roots have no leaves to point at, so their Bevs must be null
-- rather than pointing at a leaf of some other root.
select is(
  (select count(*)::int
     from public.bevs b
    where b.category_id in ('water', 'sports') and b.leaf_category_id is not null),
  0,
  'nothing under water or sports claims a leaf'
);

-- One of the six §7 corrections, spot-checked end to end: Ramune moved from
-- `other` to `soda` AND got a leaf, which only the regenerated seed can do.
select is(
  (select b.category_id || '/' || b.leaf_category_id
     from public.bevs b
    where b.id = '6df7af3f-c022-5005-a606-99a122537661'),
  'soda/lemon_lime',
  'the §7 correction moved ramune-original to soda/lemon_lime'
);

-- ---------------------------------------------------------------------------
-- 3. The guard triggers
-- ---------------------------------------------------------------------------
-- These are the whole reason the redundancy between `category_id` and
-- `leaf_category_id` is safe, so each failure mode gets its own assertion.

select lives_ok(
  $$ update public.bevs set leaf_category_id = 'cola'
      where id = (select id from public.bevs where category_id = 'soda' and source = 'seed' order by id limit 1) $$,
  'a leaf under the Bev''s own category is accepted'
);

select throws_ok(
  $$ update public.bevs set leaf_category_id = 'lager'
      where id = (select id from public.bevs where category_id = 'soda' and source = 'seed' order by id limit 1) $$,
  '22023', 'BEVI_VALIDATION',
  'a leaf under a DIFFERENT root is rejected'
);

select throws_ok(
  $$ update public.bevs set leaf_category_id = 'soda'
      where id = (select id from public.bevs where category_id = 'soda' and source = 'seed' order by id limit 1) $$,
  '22023', 'BEVI_VALIDATION',
  'a ROOT in leaf_category_id is rejected: null is how a Bev sits on its parent'
);

select lives_ok(
  $$ update public.bevs set leaf_category_id = null
      where id = (select id from public.bevs where category_id = 'soda' and source = 'seed' order by id limit 1) $$,
  'clearing the leaf is always allowed'
);

-- Moving the category without moving the leaf must fail, not silently leave a
-- leaf hanging under the wrong root. This is the case a careless UPDATE hits.
select throws_ok(
  $$ update public.bevs set category_id = 'diet_soda'
      where id = (select id from public.bevs where leaf_category_id = 'cola' order by id limit 1) $$,
  '22023', 'BEVI_VALIDATION',
  'changing category_id while a now-foreign leaf remains is rejected'
);

-- The other half of the invariant: category_id is always a root, on insert,
-- on update -- and so through create_bev, which inserts whatever categories.id it is given.
select throws_ok(
  $$ insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source)
     values ('00000000-0000-4000-8000-0000000c1301', 'pgTAP Leaf Cola', 'pgTAP Leaf',
             null, 'cola', 2, 'pending_photo', 'user') $$,
  '22023', 'BEVI_VALIDATION',
  'inserting a Bev whose category_id is a leaf is rejected'
);
select throws_ok(
  $$ update public.bevs set category_id = 'cola', leaf_category_id = null
      where id = (select id from public.bevs where category_id = 'soda' and source = 'seed' order by id limit 1) $$,
  '22023', 'BEVI_VALIDATION',
  'moving a Bev''s category_id onto a leaf is rejected'
);

-- The depth guard. A third level is the thing that would quietly break
-- `category_is_alcoholic` and Wu-Palmer, so it is a constraint.
select throws_ok(
  $$ insert into public.categories (id, name, parent_id, sort_order, is_alcoholic)
     values ('too_deep', 'Too Deep', 'cola', 1, false) $$,
  '22023', 'BEVI_VALIDATION',
  'a category three levels deep is rejected'
);

-- The CHECK half of "exactly two levels", which the trigger cannot see: a row
-- that parents itself has no ancestor chain to walk.
select throws_ok(
  $$ insert into public.categories (id, name, parent_id, sort_order, is_alcoholic)
     values ('self_parent', 'Self', 'self_parent', 1, false) $$,
  '23514',
  null,
  'a self-parenting category is rejected by categories_parent_not_self'
);

-- And moving an existing root under one of its own leaves, which would make a
-- cycle. The guard is statement-level precisely so it sees the end state.
select throws_ok(
  $$ update public.categories set parent_id = 'cola' where id = 'soda' $$,
  '22023', 'BEVI_VALIDATION',
  'moving a root under its own leaf is rejected'
);

-- ---------------------------------------------------------------------------
-- 4. category_root and category_is_alcoholic
-- ---------------------------------------------------------------------------

select is(public.category_root('soda'), 'soda', 'category_root of a root is itself');
select is(public.category_root('cola'), 'soda', 'category_root of a leaf is its root');
select is(public.category_root('no_such_category'), null, 'category_root of an unknown id is null');

select is(public.category_is_alcoholic('soda'), false, 'soda is not alcoholic');
select is(public.category_is_alcoholic('beer'), true, 'beer is alcoholic');
select is(public.category_is_alcoholic('lager'), true,
          'a LEAF of an alcoholic root is alcoholic: the age gate walks up one hop');
select is(public.category_is_alcoholic('cola'), false, 'a leaf of a non-alcoholic root is not');
select is(public.category_is_alcoholic('no_such_category'), null,
          'an unknown id is null, so a caller must coalesce rather than read false');

-- ---------------------------------------------------------------------------
-- 4b. get_category_progress stays at the 15 roots
-- ---------------------------------------------------------------------------
-- The regression this migration's section 6 exists to stop. It iterated
-- `categories` wholesale, so the 60 leaves would have turned 15 rows into 75 --
-- and `categories.list()` keeps exactly the categories this RPC returns, so the
-- app's 15-item pickers would have been handed leaf ids.

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_category_progress()),
  15,
  'get_category_progress returns the 15 roots, not all 75 categories'
);
select is(
  (select count(*)::int
     from public.get_category_progress() p
     join public.categories c on c.id = p.category_id
    where c.parent_id is not null),
  0,
  'and no leaf appears in it, so categories.list() can never serve one'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. get_category_tree
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca001", "role": "authenticated"}';

select is((select count(*)::int from public.get_category_tree()), 75,
          'an adult sees all 75 nodes');

-- Root-then-leaf: a client builds the tree in one pass, so no leaf may appear
-- before its own root. Expressed as "no leaf whose parent comes later".
select is(
  (with t as (select id, parent_id, row_number() over () as pos from public.get_category_tree())
   select count(*)::int
     from t leaf
     join t root on root.id = leaf.parent_id
    where leaf.parent_id is not null and root.pos > leaf.pos),
  0,
  'every leaf follows its own root, so one pass builds the tree'
);

select is(
  (select emoji from public.get_category_tree() where id = 'cola'),
  null,
  'a leaf carries no emoji: the app draws it with its root''s'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_category_tree() where is_alcoholic),
  0,
  'a minor sees no alcoholic node'
);

-- The gate is on the ROOT, so a leaf of `beer` has to go with `beer` itself --
-- the mistake would be filtering on the leaf's own flag and leaking it.
select is(
  (select count(*)::int from public.get_category_tree() where id in ('beer', 'lager', 'wine', 'red_wine')),
  0,
  'a minor sees neither an alcoholic root nor any of its leaves'
);

-- ---------------------------------------------------------------------------
-- 6. get_bev_leaves
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca001", "role": "authenticated"}';

-- A visible Bev with a leaf: the ordinary case.
select is(
  (select leaf_category_id from public.get_bev_leaves(
     array['6df7af3f-c022-5005-a606-99a122537661'::uuid])),
  'lemon_lime',
  'a Bev with a leaf reports it'
);

-- NULL versus ABSENT, which is the distinction a caller most needs: a visible
-- Bev with no leaf is a ROW with null, while an invisible one is no row at all.
select is(
  (select count(*)::int from public.get_bev_leaves(
     (select array_agg(id) from public.bevs where category_id = 'water' and status = 'active'))),
  (select count(*)::int from public.bevs where category_id = 'water' and status = 'active'),
  'every visible Bev on an unsplit parent is RETURNED, with a null leaf'
);

select is(
  (select count(*)::int from public.get_bev_leaves(array[]::uuid[])),
  0,
  'no ids means no rows'
);

select is(
  (select count(*)::int from public.get_bev_leaves(array['00000000-0000-4000-8000-00000000dead'::uuid])),
  0,
  'an unknown id is absent, not an error'
);

select throws_ok(
  $$ select * from public.get_bev_leaves(
       (select array_agg(('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid)
          from generate_series(1, 501) as g)) $$,
  '22023', 'BEVI_VALIDATION',
  'over 500 ids is a validation error, as in get_bev_similarities'
);

-- The age gate, both directions: a minor asking about an alcoholic Bev gets
-- nothing back rather than a leaf that tells them it exists.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_bev_leaves(
     (select array_agg(b.id)
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where c.is_alcoholic and b.status = 'active'))),
  0,
  'a minor gets no row for an alcoholic Bev'
);

reset role;
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_bev_leaves(null::uuid[]) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_bev_leaves without a session is unauthorized'
);
select throws_ok(
  $$ select * from public.get_category_tree() $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_category_tree without a session is unauthorized'
);

select * from finish();
rollback;
