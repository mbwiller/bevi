-- 20261101000600: search_bevs finds a Bev by any piece of its words, and
-- find_similar_bevs accepts the same token match.
--
-- The production bug this pins: "A&W" returned nothing, because pg_trgm
-- similarity("a&w", "a&w a&w root beer root beer") is 4/14 < 0.3. Everything
-- below runs against the seeded catalog (20261026000200: A&W Root Beer, A&W
-- Diet Root Beer, A&W Cream Soda, the Dr Pepper family, Mountain Dew Baja
-- Blast, Barq's, Mug, Corona...), so the only fixtures are two people and one
-- alias. The seed has no rankings and this file adds none, so every
-- rating_count is 0 and the order inside a tier falls to relevance, then name.
--
-- Fixture uuid prefix: ...0000000b1cNN ("b1c" for search). Checked against
-- every file in supabase/tests/ (a1, b1..b2, c1..c3, d1..d6, e1..e3, f1..f4,
-- ffff, ff14, dead, a14NN, a16NN, ab0NN, b14NN, b21NN, be0NN, c13NN, ca0NN,
-- d12NN, ed0NN): b1cNN collides with none.
--
-- The people:
--   b1c01  adult (30)
--   b1c02  under 21 (16)
begin;
select plan(39);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000b1c01', 'pgtapsearch1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b1c02', 'pgtapsearch2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id = '00000000-0000-4000-8000-0000000b1c01';
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000b1c02';
set local bevi.rpc_bypass = 'false';

-- An alias no seeded Bev's text contains, on A&W Cream Soda.
insert into public.bev_aliases (alias, bev_id, source)
values ('zqpgtapfizz', '9a8a0be9-81a0-5ffb-a5ea-7b9f05cb2a82', 'manual');

-- ---------------------------------------------------------------------------
-- 1. Signatures and grants (create or replace kept both)
-- ---------------------------------------------------------------------------

select ok(to_regprocedure('public.search_bevs(text, text, integer)') is not null,
          'search_bevs(text, text, int) still exists');
select ok(to_regprocedure('public.find_similar_bevs(text, text, text, text, integer)') is not null,
          'find_similar_bevs(text, text, text, text, int) still exists');
select ok(
  has_function_privilege('authenticated', 'public.search_bevs(text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.search_bevs(text, text, integer)', 'execute'),
  'search_bevs: authenticated may execute, anon may not'
);
select ok(
  has_function_privilege('authenticated', 'public.find_similar_bevs(text, text, text, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.find_similar_bevs(text, text, text, text, integer)', 'execute'),
  'find_similar_bevs: authenticated may execute, anon may not'
);

-- ---------------------------------------------------------------------------
-- 2. As a signed-in adult
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1c01", "role": "authenticated"}';

-- The bug.
select is(
  (select count(*)::int from public.search_bevs('A&W', null, 50) s
    where s.name in ('A&W Root Beer', 'A&W Diet Root Beer', 'A&W Cream Soda')),
  3,
  '"A&W" finds A&W Root Beer, A&W Diet Root Beer and A&W Cream Soda'
);
select ok(
  not exists (select 1 from public.search_bevs('A&W', null, 50) s
               where strpos(lower(coalesce(s.brand, '') || ' ' || s.name || ' ' || coalesce(s.flavor, '')), 'a&w') = 0),
  '"A&W" returns nothing without "a&w" in it'
);
select ok(
  not exists (select 1 from public.search_bevs('A&W', null, 50) s where s.name like 'Mountain Dew%'),
  '"A&W" is one token: it does not mean "an a and a w somewhere" (no Mountain Dew)'
);

select is(
  (select s.name from public.search_bevs('a&w root', null, 50) with ordinality s
    order by s.ordinality limit 1),
  'A&W Root Beer',
  '"a&w root": A&W Root Beer first'
);
select ok(
  exists (select 1 from public.search_bevs('a&w root', null, 50) s where s.name = 'A&W Diet Root Beer')
  and not exists (select 1 from public.search_bevs('a&w root', null, 50) s where s.name = 'A&W Cream Soda'),
  '"a&w root": A&W Diet Root Beer too, never the cream soda'
);

select is(
  (select count(*)::int from public.search_bevs('root beer', null, 50) s
    where s.name in ('A&W Root Beer', 'Barq''s Root Beer', 'Mug Root Beer')),
  3,
  '"root beer" finds A&W, Barq''s and Mug'
);
select ok(
  exists (select 1 from public.search_bevs('beer root', null, 50) s where s.name = 'A&W Root Beer'),
  'token order does not matter ("beer root")'
);

select ok(
  exists (select 1 from public.search_bevs('diet dr', null, 50) s where s.name = 'Diet Dr Pepper'),
  '"diet dr" finds Diet Dr Pepper'
);
select ok(
  not exists (select 1 from public.search_bevs('diet dr', null, 50) s
               where s.name in ('Diet Pepsi', 'Dr Pepper')),
  '"diet dr" needs both tokens: no Diet Pepsi (trigram 0.38, the fallback stays off) and no Dr Pepper'
);

select is(
  (select count(*)::int from public.search_bevs('pepper', null, 50) s
    where s.name in ('Dr Pepper', 'Diet Dr Pepper', 'Dr Pepper Cherry', 'Dr Pepper Zero Sugar')),
  4,
  '"pepper" finds the Dr Pepper family'
);
select ok(
  exists (select 1 from public.search_bevs('dr pepper', null, 50) s where s.name = 'Dr Pepper'),
  '"dr pepper" finds Dr Pepper'
);
select is(
  (select count(*)::int from public.search_bevs('mountain', null, 50) s
    where s.name in ('Mountain Dew', 'Mountain Dew Baja Blast')),
  2,
  '"mountain" finds Mountain Dew and Baja Blast'
);
select is(
  (select s.name from public.search_bevs('baja', null, 50) with ordinality s
    order by s.ordinality limit 1),
  'Mountain Dew Baja Blast',
  '"baja": Baja Blast first'
);

-- Typeahead: partial words, and the word-prefix tier.
select is(
  (select count(*)::int
     from (select s.name from public.search_bevs('a&', null, 50) with ordinality s
            order by s.ordinality limit 3) x
    where x.name in ('A&W Root Beer', 'A&W Diet Root Beer', 'A&W Cream Soda')),
  3,
  '"a&": the three A&W Bevs come first'
);

-- `starts`: does some whitespace-delimited word of the Bev's haystack (search
-- text, category name, aliases) start with the query? Recomputed here from
-- the tables rather than taken from the function, so the tier is checked
-- against an independent statement of the rule.
select ok(
  exists (select 1 from public.search_bevs('dr', null, 400) s where s.name = 'Dr Pepper'),
  '"dr" finds Dr Pepper'
);
select ok(
  (with res as (
     select s.id, s.ordinality as ord from public.search_bevs('dr', null, 400) with ordinality s
   ), w as (
     select res.ord,
            exists (select 1
                      from public.bevs b
                      join public.categories c on c.id = b.category_id
                     cross join lateral regexp_split_to_table(
                         lower(b.search_text || ' ' || c.name || ' ' ||
                               coalesce((select string_agg(a.alias, ' ') from public.bev_aliases a
                                          where a.bev_id = b.id), '')),
                         '\s+') as word
                     where b.id = res.id and word like 'dr%') as starts
       from res
   )
   select coalesce(max(ord) filter (where starts), 0)
          < coalesce(min(ord) filter (where not starts), 1000000)
     from w),
  '"dr": every Bev with a word starting "dr" (Dr Pepper among them) sorts above every mid-word "dr"'
);

select ok(
  (select count(*) from public.search_bevs('a', null, 400)) > 0,
  'one character is a query: "a" returns rows'
);
select ok(
  (with res as (
     select s.id, s.ordinality as ord from public.search_bevs('a', null, 400) with ordinality s
   ), w as (
     select res.ord,
            exists (select 1
                      from public.bevs b
                      join public.categories c on c.id = b.category_id
                     cross join lateral regexp_split_to_table(
                         lower(b.search_text || ' ' || c.name || ' ' ||
                               coalesce((select string_agg(a.alias, ' ') from public.bev_aliases a
                                          where a.bev_id = b.id), '')),
                         '\s+') as word
                     where b.id = res.id and word like 'a%') as starts
       from res
   )
   select bool_and(starts) filter (where ord = 1)
          and coalesce(max(ord) filter (where starts), 0)
              < coalesce(min(ord) filter (where not starts), 1000000)
     from w),
  '"a": a Bev with a word starting "a" is first, and all of them sort above mid-word matches'
);
select is(
  (select count(*)::int from public.search_bevs('a', null, 5)),
  5,
  'p_limit still caps the result'
);

-- Empty queries.
select is((select count(*)::int from public.search_bevs('', null, 50)), 0, 'an empty query returns no rows');
select is((select count(*)::int from public.search_bevs('   ', null, 50)), 0, 'a whitespace-only query returns no rows');
select is((select count(*)::int from public.search_bevs(null, null, 50)), 0, 'a null query returns no rows');

-- The typo fallback.
select ok(
  exists (select 1 from public.search_bevs('pepsii', null, 50) s where s.name = 'Pepsi'),
  'a typo ("pepsii") still finds Pepsi through the trigram fallback'
);

-- Category filter.
select is(
  (select array_agg(s.name order by s.name) from public.search_bevs('A&W', 'soda', 50) s),
  array['A&W Cream Soda', 'A&W Root Beer'],
  'p_category_id filters: "A&W" in soda is the root beer and the cream soda, not the diet (diet_soda)'
);

-- Aliases and accents.
select is(
  (select array_agg(s.id) from public.search_bevs('zqpgtap', null, 50) s),
  array['9a8a0be9-81a0-5ffb-a5ea-7b9f05cb2a82'::uuid],
  'an alias is searched by substring ("zqpgtap" -> the Bev aliased "zqpgtapfizz")'
);
select is(
  (select s.name from public.search_bevs('coke', null, 50) with ordinality s
    order by s.ordinality limit 1),
  'Coca-Cola Classic',
  '"coke" (a seeded alias): Coca-Cola Classic first'
);
select ok(
  exists (select 1 from public.search_bevs('mtn', null, 50) s where s.name = 'Mountain Dew'),
  '"mtn" finds Mountain Dew through its alias "mtn dew"'
);
select ok(
  exists (select 1 from public.search_bevs('Pépper', null, 50) s where s.name = 'Dr Pepper'),
  'the query is unaccented and lowercased ("Pépper")'
);

-- An adult sees an alcoholic Bev the query matches (so section 3 means something).
select ok(
  exists (select 1 from public.search_bevs('corona', null, 50) s where s.name = 'Corona Extra'),
  'an adult searching "corona" finds Corona Extra'
);

-- ---------------------------------------------------------------------------
-- 3. Under 21: the age gate holds for token matches too
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1c02", "role": "authenticated"}';

select ok(
  not exists (select 1 from public.search_bevs('corona', null, 50) s
                join public.categories c on c.id = s.category_id
               where c.is_alcoholic),
  'under 21: "corona" returns no alcoholic Bev'
);
select ok(
  exists (select 1 from public.search_bevs('beer', null, 400) s where s.name = 'A&W Root Beer')
  and not exists (select 1 from public.search_bevs('beer', null, 400) s
                    join public.categories c on c.id = s.category_id
                   where c.is_alcoholic),
  'under 21: "beer" finds root beer and nothing alcoholic'
);
select is(
  (select count(*)::int from public.find_similar_bevs('Corona Extra', 'Corona', null, null, 5) f
     join public.categories c on c.id = f.category_id
    where c.is_alcoholic),
  0,
  'under 21: find_similar_bevs hides alcoholic Bevs as before'
);

-- ---------------------------------------------------------------------------
-- 4. find_similar_bevs (adult)
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1c01", "role": "authenticated"}';

select is(
  (select f.name from public.find_similar_bevs('A&W Root Beer', 'A&W', 'soda') with ordinality f
    order by f.ordinality limit 1),
  'A&W Root Beer',
  'find_similar_bevs("A&W Root Beer", "A&W", soda): A&W Root Beer first'
);
select is(
  (select count(*)::int
     from (select f.brand from public.find_similar_bevs('A&W') with ordinality f
            order by f.ordinality limit 3) x
    where x.brand = 'A&W'),
  3,
  'find_similar_bevs("A&W"): the token match puts the three A&W Bevs first'
);
select ok(
  exists (select 1 from public.find_similar_bevs('Pepsii') f where f.name = 'Pepsi'),
  'find_similar_bevs stays fuzzy: "Pepsii" still offers Pepsi'
);

reset role;

select * from finish();
rollback;
