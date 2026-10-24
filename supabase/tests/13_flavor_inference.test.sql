-- D-11 (20261023000200): bev_flavor_profiles' inference columns and
-- infer_bev_flavor_profile().
--
-- What this file is for, in order: the three new columns and the generated
-- `inferred` flag; the provenance CHECK; that adding columns did not add a
-- write path for `authenticated`, and that `authenticated` cannot execute the
-- function either; then the four parts of D-11's rule -- nearest SEEDED Bev IN
-- THE SAME CATEGORY, brand as the tie-break, nothing written below 0.6 cosine,
-- and an inferred row marked as such with its provenance.
--
-- Fixture uuid prefix: ...00000d11aNNN ("d11" for the decision). Checked
-- against every file in supabase/tests/: 00..08 use a1, b1..b2, c1..c3,
-- e1..e3, f1..f4 and ffff; 09_leaderboard_parity uses ab001..ab006 and
-- ab011..ab013; 10_explore uses d1..d6 and ff01..ff14; 11_graph_tables uses
-- ed001..ed003; 12_embed_webhook takes its own. d11aNNN collides with none.
--
-- The embeddings are 384-d with three non-zero leading components and zeros
-- after, so every cosine below is an exact small fraction:
--   axis  [1,0,0]  the target of every group
--   cos95 [3,1,0]  3/sqrt(10) = 0.9487  -- above the 0.6 floor
--   cos71 [1,1,0]  1/sqrt(2)  = 0.7071  -- above the floor
--   cos45 [1,2,0]  1/sqrt(5)  = 0.4472  -- BELOW the floor
--
-- Three independent groups, in three different categories, so one group's
-- candidates can never be the other's:
--   soda       target1 (user, no profile, brand 'Acme Soda Co')
--              far    cos71  seed, catalog profile base 'cream'
--              near   cos95  seed, catalog profile base 'cola'      <- must win
--              other  cos100 seed, catalog profile, but in diet_soda -> ignored
--              notseed cos100 USER-created with an INFERRED profile  -> ignored
--   energy     target2 (user, no profile, brand 'Acme Energy Co')
--              tieB   cos71  seed, brand 'Zeta Energy Co', base 'citrus', id a202
--              tieA   cos71  seed, brand 'Acme Energy Co', base 'tea',    id a203
--              -> the brand tie-break must pick tieA even though a202 < a203,
--                 which is what makes this a test of the tie-break and not of
--                 the id ordering that would otherwise decide it.
--   water      target3 (user, no profile)
--              low    cos45  seed, catalog profile -> below the floor
begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create temporary table t_vec (label text primary key, v extensions.vector(384)) on commit drop;
insert into t_vec (label, v)
select x.label,
       ('[' || x.a::text || ',' || x.b::text || ',' || x.c::text ||
        (select string_agg(',0', '') from generate_series(1, 381)) || ']')::extensions.vector(384)
  from (values ('axis', 1, 0, 0),
               ('cos95', 3, 1, 0),
               ('cos71', 1, 1, 0),
               ('cos45', 1, 2, 0)) x(label, a, b, c);

insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source, photo_path)
values
  ('00000000-0000-4000-8000-00000d11a101', 'pgTAP D11 Target One', 'Acme Soda Co',   null, 'soda',      2, 'active', 'user', 'pgtap/d11-t1.jpg'),
  ('00000000-0000-4000-8000-00000d11a102', 'pgTAP D11 Far',        'Far Soda Co',    null, 'soda',      2, 'active', 'seed', 'pgtap/d11-far.jpg'),
  ('00000000-0000-4000-8000-00000d11a103', 'pgTAP D11 Near',       'Near Soda Co',   null, 'soda',      2, 'active', 'seed', 'pgtap/d11-near.jpg'),
  ('00000000-0000-4000-8000-00000d11a104', 'pgTAP D11 Other Cat',  'Other Soda Co',  null, 'diet_soda', 2, 'active', 'seed', 'pgtap/d11-other.jpg'),
  ('00000000-0000-4000-8000-00000d11a105', 'pgTAP D11 Not Seed',   'User Soda Co',   null, 'soda',      2, 'active', 'user', 'pgtap/d11-notseed.jpg'),
  ('00000000-0000-4000-8000-00000d11a201', 'pgTAP D11 Target Two', 'Acme Energy Co', null, 'energy',    2, 'active', 'user', 'pgtap/d11-t2.jpg'),
  ('00000000-0000-4000-8000-00000d11a202', 'pgTAP D11 Tie B',      'Zeta Energy Co', null, 'energy',    2, 'active', 'seed', 'pgtap/d11-tieb.jpg'),
  ('00000000-0000-4000-8000-00000d11a203', 'pgTAP D11 Tie A',      'Acme Energy Co', null, 'energy',    2, 'active', 'seed', 'pgtap/d11-tiea.jpg'),
  ('00000000-0000-4000-8000-00000d11a301', 'pgTAP D11 Target Three', 'Acme Water Co', null, 'water',    2, 'active', 'user', 'pgtap/d11-t3.jpg'),
  ('00000000-0000-4000-8000-00000d11a302', 'pgTAP D11 Low',        'Low Water Co',   null, 'water',     2, 'active', 'seed', 'pgtap/d11-low.jpg'),
  ('00000000-0000-4000-8000-00000d11a401', 'pgTAP D11 No Embedding', 'Acme Tea Co',  null, 'tea',       2, 'active', 'user', 'pgtap/d11-noemb.jpg');

insert into public.bev_embeddings (bev_id, embedding)
select x.id, (select v from t_vec where label = x.label)
  from (values
    ('00000000-0000-4000-8000-00000d11a101'::uuid, 'axis'),
    ('00000000-0000-4000-8000-00000d11a102'::uuid, 'cos71'),
    ('00000000-0000-4000-8000-00000d11a103'::uuid, 'cos95'),
    ('00000000-0000-4000-8000-00000d11a104'::uuid, 'axis'),  -- cosine 1, wrong category
    ('00000000-0000-4000-8000-00000d11a105'::uuid, 'axis'),  -- cosine 1, not seeded
    ('00000000-0000-4000-8000-00000d11a201'::uuid, 'axis'),
    ('00000000-0000-4000-8000-00000d11a202'::uuid, 'cos71'),
    ('00000000-0000-4000-8000-00000d11a203'::uuid, 'cos71'), -- the exact same vector: a true tie
    ('00000000-0000-4000-8000-00000d11a301'::uuid, 'axis'),
    ('00000000-0000-4000-8000-00000d11a302'::uuid, 'cos45')
  ) x(id, label);

insert into public.bev_flavor_profiles (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve)
values
  ('00000000-0000-4000-8000-00000d11a102', 'cream',   true,  0, 2, true,  false, 'cold'),
  ('00000000-0000-4000-8000-00000d11a103', 'cola',    true,  2, 3, false, false, 'cold'),
  ('00000000-0000-4000-8000-00000d11a104', 'berry',   true,  1, 0, false, false, 'cold'),
  ('00000000-0000-4000-8000-00000d11a202', 'citrus',  true,  3, 2, false, false, 'cold'),
  ('00000000-0000-4000-8000-00000d11a203', 'tea',     false, 2, 1, false, false, 'either'),
  ('00000000-0000-4000-8000-00000d11a302', 'mineral', true,  0, 0, false, false, 'cold');

-- The distractor that is nearest of all and must still lose: a user-created Bev
-- whose own profile is inferred. If `p.source = 'catalog'` were dropped from
-- the candidate query, one bad copy would propagate down a chain of these.
insert into public.bev_flavor_profiles
  (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve, source, inferred_from, inferred_similarity)
values
  ('00000000-0000-4000-8000-00000d11a105', 'grape', true, 0, 3, false, false, 'cold',
   'inferred', '00000000-0000-4000-8000-00000d11a103', 0.91);

-- ---------------------------------------------------------------------------
-- 1. The columns, the generated flag and the provenance CHECK
-- ---------------------------------------------------------------------------

select ok(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'bev_flavor_profiles'
      and column_name in ('inferred', 'inferred_from', 'inferred_similarity')) = 3,
  'bev_flavor_profiles has inferred, inferred_from and inferred_similarity'
);
-- 's' = stored generated. The flag is derived from `source`, so relabelling a
-- row cannot leave the two disagreeing.
select is(
  (select attgenerated from pg_attribute
    where attrelid = 'public.bev_flavor_profiles'::regclass and attname = 'inferred'),
  's'::"char",
  'inferred is a stored generated column, not a second settable copy of source'
);
select throws_ok(
  $$ insert into public.bev_flavor_profiles
       (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve, source)
     values ('00000000-0000-4000-8000-00000d11a401', 'tea', false, 1, 1, false, false, 'hot', 'inferred') $$,
  '23514',
  null,
  'an inferred row with no inferred_from is rejected: provenance is not optional'
);
select throws_ok(
  $$ insert into public.bev_flavor_profiles
       (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve, inferred_from, inferred_similarity)
     values ('00000000-0000-4000-8000-00000d11a401', 'tea', false, 1, 1, false, false, 'hot',
             '00000000-0000-4000-8000-00000d11a103', 0.9) $$,
  '23514',
  null,
  'and a catalog row claiming provenance is rejected too, so the flag means what it says'
);

-- ---------------------------------------------------------------------------
-- 2. Who may write, and who may call
-- ---------------------------------------------------------------------------
-- Adding columns did not add a write path. The existing select policy
-- (`using (true)`, 20261014000400) is unchanged and still the only policy.

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_flavor_profiles'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'still no direct write policy for authenticated on bev_flavor_profiles'
);
select ok(
  not has_function_privilege('authenticated', 'public.infer_bev_flavor_profile(uuid)', 'execute'),
  'authenticated cannot execute infer_bev_flavor_profile: inferring a profile is a pipeline step, not a user action'
);
select ok(
  not has_function_privilege('anon', 'public.infer_bev_flavor_profile(uuid)', 'execute'),
  'and neither can anon'
);
select ok(
  has_function_privilege('service_role', 'public.infer_bev_flavor_profile(uuid)', 'execute'),
  'the service role can: it is the builder and the write webhook'
);

-- ---------------------------------------------------------------------------
-- 3. The nearest seeded Bev in the same category
-- ---------------------------------------------------------------------------

select is(
  (select outcome from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a101')),
  'inferred',
  'a Bev with no profile and a usable neighbour gets one'
);
select is(
  (select inferred_from from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a101'),
  '00000000-0000-4000-8000-00000d11a103'::uuid,
  'the nearest SEEDED Bev in the SAME category wins: not the cosine-1 row in diet_soda, not the cosine-1 row whose own profile is inferred'
);
select is(
  (select base from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a101'),
  'cola',
  'and the whole profile is copied, not just the pointer'
);
-- 3/sqrt(10) = 0.9487..., so this also proves neither cosine-1 distractor won.
select ok(
  (select inferred_similarity from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a101') between 0.948 and 0.949,
  'the recorded similarity is the winner''s cosine (0.9487), not the distractors'' 1.0'
);
select ok(
  (select inferred from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a101')
  and (select source from public.bev_flavor_profiles
        where bev_id = '00000000-0000-4000-8000-00000d11a101') = 'inferred',
  'the row is marked as inferred, by source and by the derived flag'
);
select is(
  (select outcome from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a101')),
  'has_profile',
  'calling it again changes nothing: the job is idempotent and resumable'
);
select is(
  (select count(*)::int from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a101'),
  1,
  'and there is still exactly one profile row for it'
);

-- ---------------------------------------------------------------------------
-- 4. Brand as the tie-break
-- ---------------------------------------------------------------------------
-- tieA and tieB carry the SAME vector, so the cosine cannot separate them and
-- `b.id asc` would pick tieB (a202 < a203). Only the brand comparison picks
-- tieA, and it has to agree with normaliseBrand() in @bevi/ranking.

select is(
  (select inferred_from from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a201')),
  '00000000-0000-4000-8000-00000d11a203'::uuid,
  'on an exact cosine tie the same-brand candidate wins, even though its id sorts last'
);
select is(
  (select base from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a201'),
  'tea',
  'and it is that candidate''s profile that was copied, not the lower id''s'
);

-- ---------------------------------------------------------------------------
-- 5. The 0.6 floor leaves the profile empty
-- ---------------------------------------------------------------------------
-- 1/sqrt(5) = 0.4472. Below the floor the Bev keeps NO profile and falls back
-- to the category and brand terms of edgeWeight -- a wrong `base` would cost
-- more than a missing one, because profileSimilarity weights base at 0.40.

select is(
  (select outcome from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a301')),
  'below_floor',
  'the nearest seeded Bev below 0.6 cosine is reported, not used'
);
select is(
  (select count(*)::int from public.bev_flavor_profiles
    where bev_id = '00000000-0000-4000-8000-00000d11a301'),
  0,
  'and the profile stays EMPTY: nothing was written'
);
select ok(
  (select similarity from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a301')) < 0.6,
  'the report still carries the cosine it declined, so a near miss is visible'
);

-- ---------------------------------------------------------------------------
-- 6. The remaining outcomes
-- ---------------------------------------------------------------------------

select is(
  (select outcome from public.infer_bev_flavor_profile('00000000-0000-4000-8000-00000d11a401')),
  'no_embedding',
  'a Bev with no embedding yet is reported rather than guessed at'
);
select throws_ok(
  $$ select * from public.infer_bev_flavor_profile(null) $$,
  '22023', 'BEVI_VALIDATION',
  'a null bevId is a validation error'
);

select * from finish();
rollback;
