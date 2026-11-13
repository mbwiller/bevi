-- 20261112000200_bev_icons.sql: the `bev-icons` bucket, the `bev_icons` table
-- and its RLS, the `publish_bev_icons` writer, and the merge trigger.
--
-- In order: (1) shape, bucket, RLS and grants, which is the access model --
-- `authenticated` reads, nobody but the service role writes; (2) the table's
-- CHECKs, the content-addressed path above all; (3) every validation error
-- of publish_bev_icons, and that a refused call writes nothing; (4) a first
-- publish over a fixture that exercises skipped_missing, followed_merge, both
-- arms of the duplicate rule, the delete of a row the manifest no longer
-- names, and the inactive list; (5) who sees which icon row (an under-21
-- caller and an alcoholic Bev, a hidden Bev, anon) and that no client can
-- write; (6) a second publish: insert/update/unchanged/delete counts and an
-- updated_at that moves only on a real change; (7) the merge trigger, both
-- branches, through merge_bev itself (22_duplicates calls it the same way, as
-- the test's own role), plus the publish that reconciles afterwards and a
-- non-merge status change that must not move anything; (8) the cascade.
--
-- Fixture uuid prefix: ...00000001c0NN ("1c0" for icons). Checked against
-- every file in supabase/tests/ on main (a1, b1..b3, c1..c3, d1..d6, e1..e3,
-- f1..f4, ffff, ff01..ff14, dead, a08NN, a14NN, a16NN, ab0NN, b1cNN, be0NN,
-- c13NN, ca0NN, d11aNNN, d12NN, ed0NN, ed7aNNN, 23NN, 24NN, 31NN) and the open
-- PR #197's 32_find_similar_category_boost (c5bNN): 1c0NN collides with none.
--
-- The people: 1c001 is 30, 1c002 is 16.
-- The Bevs, all inserted here as `source = 'seed'` (active without a photo,
-- and the embed trigger stays quiet), all rolled back:
--   W1..W8  1c0a1..1c0a8  active `water`
--   ALC     1c0b1         active, in an alcoholic root category
--   HID     1c0c1         hidden
--   MRG     1c0d1         merged into W4
--   MRG2    1c0d2         merged into W5
--   MRG3    1c0d3         merged into W6
--   MRG4    1c0d4         merged into W6
--   MISSING 1c0e1         never inserted (a user-created Bev that exists only on prod)
begin;
select plan(79);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-00000001c001', 'pgtapicon1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-00000001c002', 'pgtapicon2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-00000001c001';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-00000001c002';
set local bevi.rpc_bypass = 'false';

insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-00000001c0a1', 'pgTAP Icon Water 1', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a2', 'pgTAP Icon Water 2', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a3', 'pgTAP Icon Water 3', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a4', 'pgTAP Icon Water 4', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a5', 'pgTAP Icon Water 5', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a6', 'pgTAP Icon Water 6', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a7', 'pgTAP Icon Water 7', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0a8', 'pgTAP Icon Water 8', 'pgTAP', 'water', 1, 'active', 'seed'),
       ('00000000-0000-4000-8000-00000001c0c1', 'pgTAP Icon Hidden', 'pgTAP', 'water', 1, 'hidden', 'seed');

-- An alcoholic ROOT category (bevs_leaf_category_guard refuses a leaf in category_id).
insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
select '00000000-0000-4000-8000-00000001c0b1', 'pgTAP Icon Lager', 'pgTAP', c.id, 1, 'active', 'seed'
  from public.categories c
 where c.is_alcoholic and c.parent_id is null
 order by c.id
 limit 1;

insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
values ('00000000-0000-4000-8000-00000001c0d1', 'pgTAP Icon Merged 1', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-00000001c0a4', 'seed'),
       ('00000000-0000-4000-8000-00000001c0d2', 'pgTAP Icon Merged 2', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-00000001c0a5', 'seed'),
       ('00000000-0000-4000-8000-00000001c0d3', 'pgTAP Icon Merged 3', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-00000001c0a6', 'seed'),
       ('00000000-0000-4000-8000-00000001c0d4', 'pgTAP Icon Merged 4', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-00000001c0a6', 'seed');

-- One manifest row, the way scripts/icons/publish-core.ts builds it: a
-- 64-hex sha256 (two md5s) that changes with `p_v` (a redraw), and the
-- content-addressed path derived from it.
create function pg_temp.icon(p_bev text, p_slug text, p_v text default '1', p_status text default 'needs-review')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'bev_id',        p_bev,
    'slug',          p_slug,
    'path',          p_slug || '.' || left(md5(p_slug || p_v) || md5(p_v || p_slug), 16) || '.svg',
    'sha256',        md5(p_slug || p_v) || md5(p_v || p_slug),
    'style_version', 'bevi-dimensional-v1',
    'status',        p_status
  );
$$;

create temporary table t_res (n integer primary key, j jsonb not null) on commit drop;

-- ---------------------------------------------------------------------------
-- 1. Shape, bucket, RLS and grants
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.bev_icons') is not null, 'bev_icons exists');

select is(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'bev_icons'),
  array['bev_id', 'slug', 'path', 'sha256', 'style_version', 'status', 'created_at', 'updated_at'],
  'bev_icons has exactly the contracted columns, in order'
);

select is(
  (select array_agg(a.attname::text)
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.bev_icons'::regclass and i.indisprimary),
  array['bev_id'],
  'the primary key is bev_id: one icon per Bev'
);

select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.bev_icons'::regclass and contype = 'f'
             and confrelid = 'public.bevs'::regclass and confdeltype = 'c'),
  'bev_id references bevs(id) on delete cascade'
);

select is(
  (select count(*)::int from pg_index
    where indrelid = 'public.bev_icons'::regclass and indisunique and not indisprimary),
  0,
  'no unique index on slug or path: a slug may move between Bevs inside one publish'
);

select ok((select public from storage.buckets where id = 'bev-icons'),
          'bev-icons is a PUBLIC bucket: icons are read by URL');
select is((select file_size_limit from storage.buckets where id = 'bev-icons'), 524288::bigint,
          'bev-icons objects are capped at 512 KiB');
select is((select allowed_mime_types from storage.buckets where id = 'bev-icons'), array['image/svg+xml'],
          'bev-icons accepts SVG and nothing else');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%bev-icons%' or coalesce(with_check, '') like '%bev-icons%')),
  0,
  'no storage.objects policy names bev-icons: only the service role writes, and a public bucket needs none to read'
);

select ok((select relrowsecurity from pg_class where oid = 'public.bev_icons'::regclass),
          'RLS is enabled on bev_icons');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'bev_icons'), 1,
          'bev_icons has exactly one policy');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_icons'
      and cmd = 'SELECT' and roles = '{authenticated}'::name[]),
  1,
  'and it is SELECT for authenticated: no write policy'
);

select ok(has_table_privilege('authenticated', 'public.bev_icons', 'select'), 'authenticated may select bev_icons');
select ok(not has_table_privilege('authenticated', 'public.bev_icons', 'insert'), 'authenticated may not insert');
select ok(not has_table_privilege('authenticated', 'public.bev_icons', 'update'), 'authenticated may not update');
select ok(not has_table_privilege('authenticated', 'public.bev_icons', 'delete'), 'authenticated may not delete');
select ok(not has_table_privilege('anon', 'public.bev_icons', 'select'), 'anon may not select bev_icons');
select ok(not has_table_privilege('anon', 'public.bev_icons', 'insert'), 'anon may not insert');

select ok(not has_function_privilege('authenticated', 'public.publish_bev_icons(jsonb)', 'execute'),
          'authenticated cannot execute publish_bev_icons');
select ok(not has_function_privilege('anon', 'public.publish_bev_icons(jsonb)', 'execute'),
          'anon cannot either');
select ok(has_function_privilege('service_role', 'public.publish_bev_icons(jsonb)', 'execute'),
          'service_role can');

select ok(
  exists (select 1 from pg_trigger
           where tgrelid = 'public.bevs'::regclass and tgname = 'bevs_merge_moves_icon' and not tgisinternal),
  'bevs_merge_moves_icon exists on bevs'
);
select ok(not has_function_privilege('authenticated', 'public.bev_icons_follow_merge()', 'execute'),
          'nobody can call the trigger function by hand');

-- ---------------------------------------------------------------------------
-- 2. The table's CHECKs (as the owner, so only the constraints can refuse)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
     values ('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1', 'pgtap-icon-w1.svg',
             repeat('a', 64), 'v1', 'needs-review') $$,
  '23514', null,
  'a path that is not <slug>.<16 hex>.svg is refused'
);
select throws_ok(
  $$ insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
     values ('00000000-0000-4000-8000-00000001c0a1', 'Bad_Slug', 'Bad_Slug.' || repeat('a', 16) || '.svg',
             repeat('a', 64), 'v1', 'needs-review') $$,
  '23514', null,
  'a slug that is not kebab-case is refused, even with a consistent path'
);
select throws_ok(
  $$ insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
     values ('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1', 'pgtap-icon-w1.' || repeat('A', 16) || '.svg',
             repeat('A', 64), 'v1', 'needs-review') $$,
  '23514', null,
  'an uppercase sha256 is refused'
);
-- W7's row is there before the first publish, which must delete it.
select lives_ok(
  $$ insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
     select '00000000-0000-4000-8000-00000001c0a7', r ->> 'slug', r ->> 'path', r ->> 'sha256',
            r ->> 'style_version', r ->> 'status'
       from pg_temp.icon('00000000-0000-4000-8000-00000001c0a7', 'pgtap-icon-w7-old') as t(r) $$,
  'a well-formed row passes every CHECK'
);

-- ---------------------------------------------------------------------------
-- 3. publish_bev_icons: every validation error
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.publish_bev_icons(null) $$,
  '22023', 'BEVI_VALIDATION', 'p_rows null is refused');
select throws_ok($$ select public.publish_bev_icons('{}'::jsonb) $$,
  '22023', 'BEVI_VALIDATION', 'p_rows that is not an array is refused');
select throws_ok($$ select public.publish_bev_icons('[]'::jsonb) $$,
  '22023', 'BEVI_VALIDATION', 'an EMPTY array is refused: an empty manifest must never wipe the table');
select throws_ok($$ select public.publish_bev_icons('["pgtap-icon-w1"]'::jsonb) $$,
  '22023', 'BEVI_VALIDATION', 'an element that is not an object is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1') - 'status')) $$,
  '22023', 'BEVI_VALIDATION', 'a row missing a field is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(jsonb_set(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'), '{style_version}', '""'))) $$,
  '22023', 'BEVI_VALIDATION', 'a row with an empty field is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(jsonb_set(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'), '{bev_id}', '"not-a-uuid"'))) $$,
  '22023', 'BEVI_VALIDATION', 'a bev_id that is not a uuid is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(jsonb_set(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'), '{slug}', '"Bad_Slug"'))) $$,
  '22023', 'BEVI_VALIDATION', 'a slug that is not kebab-case is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(jsonb_set(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'), '{sha256}', '"abc"'))) $$,
  '22023', 'BEVI_VALIDATION', 'a sha256 that is not 64 lowercase hex is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(jsonb_set(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'), '{path}',
       '"pgtap-icon-w1.0000000000000000.svg"'))) $$,
  '22023', 'BEVI_VALIDATION', 'a path that does not match slug and sha256 is refused');
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'),
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a2', 'pgtap-icon-w2'),
       pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1-again'))) $$,
  '22023', 'BEVI_VALIDATION', 'a duplicate bev_id is refused, even among good rows');
-- Well-formed rows that name no Bev at all (the job pointed at the wrong
-- stack): refused, because writing them would delete every existing row.
select throws_ok(
  $$ select public.publish_bev_icons(jsonb_build_array(
       pg_temp.icon('00000000-0000-4000-8000-00000001c0fe', 'pgtap-icon-nowhere-1'),
       pg_temp.icon('00000000-0000-4000-8000-00000001c0fd', 'pgtap-icon-nowhere-2'))) $$,
  '22023', 'BEVI_VALIDATION', 'a payload in which no row names an existing Bev is refused');

select is(
  (select array_agg(slug) from public.bev_icons where bev_id::text like '00000000-0000-4000-8000-00000001c0%'),
  array['pgtap-icon-w7-old'],
  'none of the refused calls wrote anything'
);

-- ---------------------------------------------------------------------------
-- 4. First publish
-- ---------------------------------------------------------------------------
-- Kept: W1, W2, W3, ALC, HID, W4 (via MRG), W5 (its own row beats MRG2's lower
-- slug), W6 (MRG4's 'pgtap-icon-m-a' beats MRG3's 'pgtap-icon-m-b'). Skipped:
-- MISSING. Deleted: W7's direct row.

insert into t_res (n, j)
select 1, public.publish_bev_icons(jsonb_build_array(
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a2', 'pgtap-icon-w2'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a3', 'pgtap-icon-w3'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0b1', 'pgtap-icon-alc'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0c1', 'pgtap-icon-hidden'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0e1', 'pgtap-icon-missing'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d1', 'pgtap-icon-merged'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a5', 'pgtap-icon-w5'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d2', 'pgtap-icon-a-dup'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d3', 'pgtap-icon-m-b'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d4', 'pgtap-icon-m-a')
));

select is(
  (select array[(j ->> 'received')::int, (j ->> 'inserted')::int, (j ->> 'updated')::int,
                (j ->> 'unchanged')::int, (j ->> 'deleted')::int]
     from t_res where n = 1),
  array[11, 8, 0, 0, 1],
  'first publish: 11 received, 8 inserted, 0 updated, 0 unchanged, 1 deleted'
);
select is((select j -> 'skipped_missing' from t_res where n = 1),
          '["00000000-0000-4000-8000-00000001c0e1"]'::jsonb,
          'a Bev that does not exist here is skipped and reported');
select is((select j -> 'followed_merge' from t_res where n = 1),
          '[{"from": "00000000-0000-4000-8000-00000001c0d1", "to": "00000000-0000-4000-8000-00000001c0a4"},
            {"from": "00000000-0000-4000-8000-00000001c0d4", "to": "00000000-0000-4000-8000-00000001c0a6"}]'::jsonb,
          'rows written under a surviving Bev are reported as {from, to}');
select is((select j -> 'dropped_duplicate' from t_res where n = 1),
          '["00000000-0000-4000-8000-00000001c0d2", "00000000-0000-4000-8000-00000001c0d3"]'::jsonb,
          'the losers of the duplicate rule are reported');
select is((select j -> 'inactive' from t_res where n = 1),
          '["00000000-0000-4000-8000-00000001c0c1"]'::jsonb,
          'an icon row whose Bev is not active is written and reported as inactive');

select is((select slug from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a4'),
          'pgtap-icon-merged',
          'a row naming a merged Bev lands on the Bev it was merged into');
select is((select slug from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a5'),
          'pgtap-icon-w5',
          'duplicate rule, first arm: the row whose own bev_id is the target wins over a lower slug');
select is((select slug from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a6'),
          'pgtap-icon-m-a',
          'duplicate rule, second arm: otherwise the lowest slug wins');
select is(
  (select count(*)::int from public.bev_icons
    where bev_id in ('00000000-0000-4000-8000-00000001c0d1', '00000000-0000-4000-8000-00000001c0d2',
                     '00000000-0000-4000-8000-00000001c0d3', '00000000-0000-4000-8000-00000001c0d4',
                     '00000000-0000-4000-8000-00000001c0e1')),
  0,
  'no row is written under a merged or missing id'
);
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a7'), 0,
          'a row the manifest no longer names is deleted');
select is(
  (select array[(j ->> 'active_bevs')::int, (j ->> 'active_with_icon')::int,
                (j ->> 'active_without_photo_or_icon')::int]
     from t_res where n = 1),
  array[
    (select count(*)::int from public.bevs where status = 'active'),
    7,
    (select count(*)::int from public.bevs b
      where b.status = 'active' and b.photo_path is null
        and not exists (select 1 from public.bev_icons bi where bi.bev_id = b.id))
  ],
  'the reconciliation counts: every active Bev, the 7 with an icon, and those with neither photo nor icon'
);

-- ---------------------------------------------------------------------------
-- 5. Who sees what
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000001c001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bev_icons
    where bev_id in ('00000000-0000-4000-8000-00000001c0a1', '00000000-0000-4000-8000-00000001c0b1')),
  2,
  'an adult sees the water Bev''s icon and the alcoholic Bev''s icon'
);
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0c1'), 0,
          'nobody but an admin sees a hidden Bev''s icon: bevs_select applies inside the policy');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000001c002", "role": "authenticated"}';

select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a1'), 1,
          'an under-21 caller sees the water Bev''s icon');
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0b1'), 0,
          'but not the alcoholic Bev''s: the age filter of bevs_select carries over');

select throws_ok(
  $$ insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
     values ('00000000-0000-4000-8000-00000001c0a8', 'pgtap-icon-w8', 'pgtap-icon-w8.' || repeat('a', 16) || '.svg',
             repeat('a', 64), 'v1', 'needs-review') $$,
  '42501', null,
  'authenticated cannot insert an icon row'
);
select throws_ok(
  $$ update public.bev_icons set status = 'approved' $$,
  '42501', null,
  'authenticated cannot update one'
);
select throws_ok(
  $$ delete from public.bev_icons $$,
  '42501', null,
  'authenticated cannot delete one'
);
select throws_ok(
  $$ select public.publish_bev_icons('[]'::jsonb) $$,
  '42501', null,
  'authenticated cannot call publish_bev_icons'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok(
  $$ select count(*) from public.bev_icons $$,
  '42501', null,
  'anon cannot read bev_icons at all'
);
select throws_ok(
  $$ select public.publish_bev_icons('[]'::jsonb) $$,
  '42501', null,
  'anon cannot call publish_bev_icons'
);

reset role;

-- ---------------------------------------------------------------------------
-- 6. Second publish: counts, and updated_at only on a real change
-- ---------------------------------------------------------------------------
-- W2 is redrawn (new sha256, so a new path), W3's status changes, W7 is new,
-- HID is gone from the manifest; everything else is byte-for-byte the same.
-- now() is constant inside this transaction, so updated_at is first pushed
-- into the past to make "untouched" observable.

update public.bev_icons set updated_at = '2000-01-01 00:00:00+00';

insert into t_res (n, j)
select 2, public.publish_bev_icons(jsonb_build_array(
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a2', 'pgtap-icon-w2', '2'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a3', 'pgtap-icon-w3', '1', 'approved'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0b1', 'pgtap-icon-alc'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d1', 'pgtap-icon-merged'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a5', 'pgtap-icon-w5'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d4', 'pgtap-icon-m-a'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a7', 'pgtap-icon-w7')
));

select is(
  (select array[(j ->> 'received')::int, (j ->> 'inserted')::int, (j ->> 'updated')::int,
                (j ->> 'unchanged')::int, (j ->> 'deleted')::int]
     from t_res where n = 2),
  array[8, 1, 2, 5, 1],
  'second publish: 8 received, 1 inserted, 2 updated, 5 unchanged, 1 deleted'
);
select is(
  (select updated_at from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a1'),
  '2000-01-01 00:00:00+00'::timestamptz,
  'an unchanged row is not written: its updated_at stays put'
);
select ok(
  (select updated_at = now()
          and path = pg_temp.icon('00000000-0000-4000-8000-00000001c0a2', 'pgtap-icon-w2', '2') ->> 'path'
     from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a2'),
  'a redrawn icon gets its new content-addressed path and a new updated_at'
);
select is((select status from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a3'), 'approved',
          'a status change alone is an update');
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0c1'), 0,
          'the hidden Bev''s icon, no longer in the manifest, is deleted');
select is((select j -> 'inactive' from t_res where n = 2), '[]'::jsonb,
          'so nothing is inactive any more');

-- ---------------------------------------------------------------------------
-- 7. The merge trigger, through merge_bev
-- ---------------------------------------------------------------------------

-- Branch 1: the destination (W8) has no icon, so W2's moves to it.
select lives_ok(
  $$ select public.merge_bev('00000000-0000-4000-8000-00000001c0a2', '00000000-0000-4000-8000-00000001c0a8') $$,
  'merge_bev(W2 -> W8) runs'
);
select is((select slug from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a8'), 'pgtap-icon-w2',
          'the icon moved to the Bev that absorbed its Bev');
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a2'), 0,
          'and is no longer on the merged Bev');

-- Branch 2: the destination (W1) has its own icon, so both stay.
select lives_ok(
  $$ select public.merge_bev('00000000-0000-4000-8000-00000001c0a3', '00000000-0000-4000-8000-00000001c0a1') $$,
  'merge_bev(W3 -> W1) runs'
);
select is(
  (select array_agg(slug order by slug) from public.bev_icons
    where bev_id in ('00000000-0000-4000-8000-00000001c0a1', '00000000-0000-4000-8000-00000001c0a3')),
  array['pgtap-icon-w1', 'pgtap-icon-w3'],
  'when the destination already has an icon, both rows are left as they were'
);

-- The next publish reconciles: the same manifest now resolves W2 -> W8 and
-- W3 -> W1, where W1's own row wins.
insert into t_res (n, j)
select 3, public.publish_bev_icons(jsonb_build_array(
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a1', 'pgtap-icon-w1'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a2', 'pgtap-icon-w2', '2'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a3', 'pgtap-icon-w3', '1', 'approved'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0b1', 'pgtap-icon-alc'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d1', 'pgtap-icon-merged'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a5', 'pgtap-icon-w5'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0d4', 'pgtap-icon-m-a'),
  pg_temp.icon('00000000-0000-4000-8000-00000001c0a7', 'pgtap-icon-w7')
));

select is((select j -> 'dropped_duplicate' from t_res where n = 3),
          '["00000000-0000-4000-8000-00000001c0a3"]'::jsonb,
          'after the merge, the next publish drops the merged Bev''s row in favour of the survivor''s own');
select is(
  (select array[(j ->> 'unchanged')::int, (j ->> 'deleted')::int] from t_res where n = 3),
  array[7, 1],
  'the other seven are unchanged (W2''s moved row, now on W8, included) and the merged Bev''s row is deleted'
);
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a3'), 0,
          'no icon row is left on a merged Bev');

-- A status change that is not a merge moves nothing.
update public.bevs set status = 'hidden' where id = '00000000-0000-4000-8000-00000001c0a5';
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a5'), 1,
          'hiding a Bev leaves its icon row where it is');

-- ---------------------------------------------------------------------------
-- 8. Cascade
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a7'), 1,
          'precondition: W7 has an icon');
select lives_ok(
  $$ delete from public.bevs where id = '00000000-0000-4000-8000-00000001c0a7' $$,
  'a Bev with an icon can be deleted'
);
select is((select count(*)::int from public.bev_icons where bev_id = '00000000-0000-4000-8000-00000001c0a7'), 0,
          'and its icon row goes with it');

select * from finish();
rollback;
