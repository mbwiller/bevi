-- find_similar_bevs returns the Bev's icon path (20261113000100).
--
-- The duplicate check was the one Bev read 20261112000300 left without an
-- icon column. This file checks the column (last, the eleven before it
-- unchanged), the state the drop had to restore (grants, owner, definer,
-- pinned search_path), and the value: a Bev with a bev_icons row carries its
-- path, a Bev without one is still offered, with null. What the function
-- matches and how it orders is 24_search_tokens' and
-- 32_find_similar_category_boost's business; both run against this
-- definition.
--
-- Fixture uuid prefix: ...0000000035NN (the file number). Checked against
-- every other file in supabase/tests/ and seed.sql: nothing else uses it.
--
-- THE BEVS: two active, non-alcoholic seed Bevs, the first two by name.
-- `icon` has a bev_icons row, `plain` has none. bev_icons is written directly
-- as the test's superuser, as 34_bev_icon_paths does: these Bevs' rows are
-- deleted first, and the inserted path satisfies the table's CHECK
-- (slug || '.' || left(sha256, 16) || '.svg').
begin;
select plan(8);

-- ---------------------------------------------------------------------------
-- One signed-in user; two Bevs; one icon
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-000000003501', 'pgtapdupicon1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated');

create temporary table t_bevs (
  label text primary key,
  id uuid not null,
  name text not null,
  brand text,
  flavor text
) on commit drop;
insert into t_bevs (label, id, name, brand, flavor)
select v.l, p.id, p.name, p.brand, p.flavor
  from (values ('icon', 0), ('plain', 1)) v(l, off)
 cross join lateral (
   select b.id, b.name, b.brand, b.flavor
     from public.bevs b
     join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
    order by b.name collate "C", b.id
   offset v.off limit 1
 ) p;
grant select on t_bevs to authenticated;

delete from public.bev_icons where bev_id in (select id from t_bevs);

insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
select t.id, 'pgtap-dup-icon', 'pgtap-dup-icon.fedcba9876543210.svg',
       'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
       coalesce((select o.style_version from public.bev_icons o limit 1), '1'),
       coalesce((select o.status from public.bev_icons o limit 1), 'published')
  from t_bevs t
 where t.label = 'icon';

select is((select count(*)::int from t_bevs), 2, 'the fixture found its two seed Bevs');

-- ---------------------------------------------------------------------------
-- The column, and the state the drop had to restore
-- ---------------------------------------------------------------------------

select is(
  pg_get_function_result('public.find_similar_bevs(text, text, text, text, int)'::regprocedure),
  'TABLE(bev_id uuid, name text, brand text, flavor text, thumb_path text, similarity real, '
    || 'category_id text, price_tier smallint, price_estimated boolean, rating_count integer, '
    || 'bayes_score numeric, icon_path text)',
  'find_similar_bevs: the eleven columns of 20261112000100, in order, then icon_path'
);

select is(
  pg_get_function_arguments('public.find_similar_bevs(text, text, text, text, int)'::regprocedure),
  'p_name text, p_brand text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text, '
    || 'p_flavor text DEFAULT NULL::text, p_limit integer DEFAULT 5',
  'find_similar_bevs: the signature and its defaults are unchanged'
);

select ok(
  has_function_privilege('authenticated', 'public.find_similar_bevs(text, text, text, text, int)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.find_similar_bevs(text, text, text, text, int)', 'EXECUTE'),
  'find_similar_bevs: authenticated may execute, anon may not'
);

select ok(
  (select p.prosecdef
          and pg_get_userbyid(p.proowner) = 'postgres'
          and p.provolatile = 's'
          and exists (select 1 from unnest(p.proconfig) c(setting)
                       where c.setting like 'search_path=%')
     from pg_proc p
    where p.oid = 'public.find_similar_bevs(text, text, text, text, int)'::regprocedure),
  'find_similar_bevs: stable, security definer, owned by postgres, with a pinned search_path'
);

-- ---------------------------------------------------------------------------
-- The value, as a signed-in user
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003501", "role": "authenticated"}';

-- Each Bev is looked up by its own name, brand and flavour, so every token of
-- the query is in its search_text and it is a token match.
select is(
  (select f.icon_path
     from t_bevs t
    cross join lateral public.find_similar_bevs(t.name, t.brand, null, t.flavor, 50) f
    where t.label = 'icon' and f.bev_id = t.id),
  'pgtap-dup-icon.fedcba9876543210.svg',
  'find_similar_bevs: the Bev with an icon carries its path'
);

select is(
  (select count(*)::int
     from t_bevs t
    cross join lateral public.find_similar_bevs(t.name, t.brand, null, t.flavor, 50) f
    where t.label = 'plain' and f.bev_id = t.id and f.icon_path is null),
  1,
  'find_similar_bevs: the Bev without one is still offered, with a null path'
);

-- The icon adds no row: no Bev is offered twice.
select is(
  (select count(*)::int
     from (select f.bev_id
             from t_bevs t
            cross join lateral public.find_similar_bevs(t.name, t.brand, null, t.flavor, 50) f
            where t.label = 'icon'
            group by f.bev_id
           having count(*) > 1) d),
  0,
  'find_similar_bevs: a Bev with an icon is offered once'
);

reset role;

select * from finish();
rollback;
