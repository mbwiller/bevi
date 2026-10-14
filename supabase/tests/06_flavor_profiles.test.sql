-- A-17 (20261014000400 schema, 20261014000500 seed): bev_flavor_profiles.
begin;
select plan(9);

select ok(to_regclass('public.bev_flavor_profiles') is not null, 'bev_flavor_profiles exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_flavor_profiles'::regclass),
  'it has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_flavor_profiles'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'and no direct write policy for authenticated'
);

-- The seed loads one profile per catalog Bev. Both directions, because a
-- missing profile and an orphaned profile are different bugs.
select is(
  (select count(*)::int from public.bev_flavor_profiles), 378,
  '378 profiles loaded'
);
select is(
  (select count(*)::int
     from public.bevs b
     left join public.bev_flavor_profiles f on f.bev_id = b.id
    where b.source = 'seed' and b.status = 'active' and f.bev_id is null),
  0,
  'every active seed Bev has one'
);

-- The age gate keys off category.is_alcoholic, so a profile that disagrees
-- with it would make the graph's `alcohol` term contradict the gate. The
-- catalog validator checks this at label time; this is the same invariant
-- asserted against what actually landed.
select is(
  (select count(*)::int
     from public.bev_flavor_profiles f
     join public.bevs b on b.id = f.bev_id
     join public.categories c on c.id = b.category_id
    where f.alcohol <> c.is_alcoholic),
  0,
  'no profile disagrees with its category on alcohol'
);

select throws_ok(
  $$ insert into public.bev_flavor_profiles (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve)
     select id, 'fizzy', true, 1, 3, false, false, 'cold' from public.bevs limit 1 $$,
  '23514',
  null,
  'the base vocabulary is enforced'
);
select throws_ok(
  $$ insert into public.bev_flavor_profiles (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve)
     select id, 'cola', true, 1, 4, false, false, 'cold' from public.bevs limit 1 $$,
  '23514',
  null,
  'sweetness is capped at 3'
);

-- The anchor for the graph's sanity report (TASKS.md §1d): Coca-Cola and Pepsi
-- must come out near-identical, and the profile term is one reason they do. If
-- this fails, the Coke-Pepsi >= 0.8 check in A-16 will fail too.
select ok(
  (select f.base from public.bev_flavor_profiles f
     join public.bevs b on b.id = f.bev_id where b.name = 'Coca-Cola Classic')
  = (select f.base from public.bev_flavor_profiles f
       join public.bevs b on b.id = f.bev_id where b.name = 'Pepsi'),
  'Coca-Cola and Pepsi share a base family'
);

select * from finish();
rollback;
