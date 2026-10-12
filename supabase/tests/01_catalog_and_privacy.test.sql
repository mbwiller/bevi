-- The seeded catalog (20261012000300) and the profile privacy rules
-- (20261012000400).
begin;
select plan(9);

select is((select count(*)::int from public.categories), 15, '15 categories');
select is((select count(*)::int from public.bevs where source = 'seed' and status = 'active'), 378, '378 active seed Bevs');
select ok(
  (select count(*) from public.bevs b join public.categories c on c.id = b.category_id
    where b.source = 'seed' and b.is_starter and not c.is_alcoholic) >= 30,
  'at least 30 non-alcoholic starters (onboarding needs 30 candidates)'
);
select is((select count(*)::int from public.bevs where source = 'seed' and photo_path is not null), 0, 'seed Bevs have no photo yet');
select is(
  (select count(*)::int from public.bevs where source = 'seed' and name ilike 'Hazy IPA'), 0,
  'the invented Local Brewery rows are gone'
);
select ok(
  not exists (select alias from public.bev_aliases where alias in ('frappe', 'high noon', 'cutwater')),
  'aliases shared by several Bevs are skipped'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'SELECT'),
  'authenticated cannot select profiles.birth_date'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'),
  'authenticated can still select the public profile columns'
);
select ok(
  not has_table_privilege('anon', 'public.profiles_view', 'SELECT')
    and not has_table_privilege('authenticated', 'public.profiles_view', 'UPDATE'),
  'profiles_view: no anon reads, no writes through it'
);

select * from finish();
rollback;
