-- 20261112000100: find_similar_bevs ranks the chosen category first and never
-- filters by it.
--
-- The production bug this pins (2026-11-09): a Red Bull flavour was created
-- under Sports Drinks by mistake. The duplicate check filtered by the chosen
-- category, every catalog Red Bull is `energy`, so none was offered. This file
-- runs against the seeded catalog (20261026000200: Red Bull Original Energy
-- Drink, Red Bull Sugarfree, Red Bull Tropical Edition and Red Bull Watermelon
-- Edition, all `energy`, with the alias 'red bull' on the Original; Corona
-- Extra in `beer`, alcoholic). The seed has no rankings, so the order inside a
-- tier falls to similarity.
--
-- Fixture uuid prefix: ...0000000c5bNN. Checked against every file in
-- supabase/tests/ (24's list plus a08NN, d11aNN, ed7aNN, 23NN, 24NNN): c5bNN
-- collides with none.
--
-- The people:
--   c5b01  adult (30)
--   c5b02  under 21 (16)
-- The Bevs (both `sports`, both active, both created by c5b01):
--   c5b10  'pgTAP Red Bull', brand 'Red Bull', flavour 'Fiji Apple & Ginger':
--          the miscategorised Bev; a TOKEN match for "Red Bull".
--   c5b11  'Red Bul', no brand: a TRIGRAM-only match for "Red Bull"
--          (similarity 0.7, but no "bull" token anywhere in its text).
begin;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000c5b01', 'pgtapdupcat1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000c5b02', 'pgtapdupcat2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000c5b01';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000c5b02';
set local bevi.rpc_bypass = 'false';

insert into public.bevs (id, name, brand, flavor, category_id, photo_path, price_tier,
                         status, source, created_by)
values ('00000000-0000-4000-8000-0000000c5b10', 'pgTAP Red Bull', 'Red Bull', 'Fiji Apple & Ginger',
        'sports', 'pgtap/c5b10.jpg', 1, 'active', 'user', '00000000-0000-4000-8000-0000000c5b01'),
       ('00000000-0000-4000-8000-0000000c5b11', 'Red Bul', null, null,
        'sports', 'pgtap/c5b11.jpg', 1, 'active', 'user', '00000000-0000-4000-8000-0000000c5b01');

-- ---------------------------------------------------------------------------
-- 1. Signature, grants and definer settings are unchanged
-- ---------------------------------------------------------------------------

select ok(to_regprocedure('public.find_similar_bevs(text, text, text, text, integer)') is not null,
          'find_similar_bevs(text, text, text, text, int) still exists');
select ok(
  has_function_privilege('authenticated', 'public.find_similar_bevs(text, text, text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.find_similar_bevs(text, text, text, text, integer)', 'execute'),
  'find_similar_bevs: authenticated may execute, anon may not'
);
select ok(
  (select p.prosecdef and p.provolatile = 's'
          and exists (select 1 from unnest(p.proconfig) as cfg(setting)
                       where replace(cfg.setting, ' ', '') = 'search_path=public,extensions')
     from pg_proc p
    where p.oid = to_regprocedure('public.find_similar_bevs(text, text, text, text, integer)')),
  'find_similar_bevs is still stable security definer with search_path = public, extensions'
);

-- ---------------------------------------------------------------------------
-- 2. As a signed-in adult
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000c5b01", "role": "authenticated"}';

-- (a) The bug: another category's token match is offered.
select is(
  (select count(*)::int from public.find_similar_bevs('Red Bull', null, 'sports', null, 10) f
    where f.brand = 'Red Bull' and f.category_id = 'energy'),
  4,
  'category sports: "Red Bull" still offers all four energy Red Bulls'
);
select ok(
  exists (select 1 from public.find_similar_bevs('Red Bull', 'Red Bull', 'sports', 'Fiji Apple & Ginger', 5) f
           where f.bev_id = '7337b304-8257-570d-bfd8-8a5235cfb81c'),
  'the incident''s inputs (Red Bull / Red Bull / Fiji Apple & Ginger, sports) offer Red Bull Original Energy Drink'
);

-- (b) Inside the token tier, the chosen category comes first.
select is(
  (select f.bev_id from public.find_similar_bevs('Red Bull', null, 'sports', null, 10) with ordinality f
    order by f.ordinality limit 1),
  '00000000-0000-4000-8000-0000000c5b10'::uuid,
  'category sports: the sports Red Bull is first, above the energy ones'
);
select ok(
  (with res as (
     select f.bev_id, f.category_id, f.ordinality as ord
       from public.find_similar_bevs('Red Bull', null, 'energy', null, 10) with ordinality f
   )
   select coalesce((select ord from res where bev_id = '00000000-0000-4000-8000-0000000c5b10'), 0)
          > (select max(ord) from res where category_id = 'energy' and bev_id in
               ('7337b304-8257-570d-bfd8-8a5235cfb81c', 'cb728448-96c4-54fc-8e91-6df453a652da',
                '960be6a4-3815-5eb2-96bc-f75f6260f05f', 'f488d82d-2de1-574e-a25e-2aaceca26537'))),
  'category energy: the sports Red Bull is still returned, below all four energy Red Bulls'
);

-- Token hits stay the primary key: a same-category trigram-only row never
-- outranks another category's token match.
select ok(
  (with res as (
     select f.bev_id, f.ordinality as ord
       from public.find_similar_bevs('Red Bull', null, 'sports', null, 10) with ordinality f
   )
   select coalesce((select ord from res where bev_id = '00000000-0000-4000-8000-0000000c5b11'), 0)
          > (select max(ord) from res where bev_id in
               ('7337b304-8257-570d-bfd8-8a5235cfb81c', 'cb728448-96c4-54fc-8e91-6df453a652da',
                '960be6a4-3815-5eb2-96bc-f75f6260f05f', 'f488d82d-2de1-574e-a25e-2aaceca26537'))),
  'category sports: the sports trigram-only "Red Bul" is returned, but below every energy Red Bull token match'
);

-- (d) No category: today's order (token hits, then similarity).
select is(
  (select f.name from public.find_similar_bevs('Red Bull') with ordinality f
    order by f.ordinality limit 1),
  'Red Bull Original Energy Drink',
  'no category: "Red Bull" puts Red Bull Original first (alias "red bull", similarity 1)'
);
select ok(
  (with res as (
     select f.similarity as sim, f.ordinality as ord
       from public.find_similar_bevs('Red Bull', null, null, null, 10) with ordinality f
      where f.brand = 'Red Bull'
   ), w as (
     select sim, lag(sim) over (order by ord) as prev from res
   )
   select count(*) = 5 and bool_and(prev is null or sim <= prev) from w),
  'no category: the five Red Bull token matches (four energy, one sports) sort by similarity alone'
);

-- (c) Adults: a different category still reaches an alcoholic match, so the
-- under-21 checks below are not vacuous.
select ok(
  exists (select 1 from public.find_similar_bevs('Corona Extra', 'Corona', 'soda', null, 5) f
           where f.name = 'Corona Extra'),
  'adult, category soda: "Corona Extra" offers Corona Extra (beer)'
);

-- ---------------------------------------------------------------------------
-- 3. Under 21: the age gate holds whatever category is passed
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000c5b02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.find_similar_bevs('Corona Extra', 'Corona', 'soda', null, 5) f
     join public.categories c on c.id = f.category_id
    where c.is_alcoholic),
  0,
  'under 21, category soda: no alcoholic Bev is offered'
);
select is(
  (select count(*)::int from public.find_similar_bevs('Corona Extra', 'Corona', 'beer', null, 5) f
     join public.categories c on c.id = f.category_id
    where c.is_alcoholic),
  0,
  'under 21, category beer: no alcoholic Bev is offered'
);

reset role;

select * from finish();
rollback;
