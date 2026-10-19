-- S-12 + A-11 (20261019000100): user_category_stats is written, kept fresh by
-- the ranking RPCs, and read through get_taste_profile.
--
-- f1 holds the "five rankings" case of shared/fixtures/user-stats.vectors.json
-- (n = 5 >= MIN_N_USER, so its z-scores use f1's own stats and nothing else in
-- the database can move them). Stored values are numeric(5,3) / numeric(6,3),
-- so the expected figures are the vectors rounded to 3 places:
--   boba             n 1  mean 5.330  sd 0.000  affinity  0.086
--   coffee           n 2  mean 3.220  sd 2.510  affinity -0.272
--   diet_soda        n 1  mean 3.000  sd 0.000  affinity -0.209
--   sparkling_water  n 1  mean 8.500  sd 0.000  affinity  0.487
-- f2 (adult) and f3 (16) are viewers; f4 is an adult with a wine ranking; f3
-- also gets a wine ranking inserted directly (bad data an under-21 owner
-- cannot normally have).
begin;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000f1', 'pgtaptp1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000f2', 'pgtaptp2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000f3', 'pgtaptp3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000f4', 'pgtaptp4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns silently pins birth_date unless the trusted-RPC
-- bypass flag is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2',
              '00000000-0000-4000-8000-0000000000f4');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000f3';
set local bevi.rpc_bypass = 'false';

-- Seed Bevs by category, in a stable order.
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select l, (select b.id from public.bevs b
            where b.category_id = cat and b.source = 'seed' and b.status = 'active'
            order by b.name collate "C", b.id offset off limit 1)
  from (values ('diet', 'diet_soda', 0), ('coffee1', 'coffee', 0), ('coffee2', 'coffee', 1),
               ('sparkling', 'sparkling_water', 0), ('boba', 'boba', 0),
               ('soda1', 'soda', 0), ('soda2', 'soda', 1), ('wine', 'wine', 0)) v(l, cat, off);
grant select on t_bevs to authenticated;

-- f1: the vectors' five rankings (bucket follows the score band; positions
-- are unique per bucket).
insert into public.rankings (user_id, bev_id, bucket, position, score)
select '00000000-0000-4000-8000-0000000000f1'::uuid, (select id from t_bevs where label = l), bk, pos, sc
  from (values ('diet', 1, 0, 3.00), ('coffee1', 1, 1, 0.71), ('sparkling', 3, 0, 8.50),
               ('boba', 2, 0, 5.33), ('coffee2', 2, 1, 5.73)) v(l, bk, pos, sc);
insert into public.rankings (user_id, bev_id, bucket, position, score)
values ('00000000-0000-4000-8000-0000000000f4', (select id from t_bevs where label = 'wine'), 3, 0, 9.00),
       ('00000000-0000-4000-8000-0000000000f3', (select id from t_bevs where label = 'wine'), 3, 0, 9.00);

select public.refresh_user_category_stats('00000000-0000-4000-8000-0000000000f1');
select public.refresh_user_category_stats('00000000-0000-4000-8000-0000000000f3');
select public.refresh_user_category_stats('00000000-0000-4000-8000-0000000000f4');

-- The stored rows equal the golden vectors (rounded to the columns' scale).
select is(
  (select array_agg(row(category_id, rating_count, mean_score, stddev_score, affinity_z)::text
                    order by category_id)
     from public.user_category_stats where user_id = '00000000-0000-4000-8000-0000000000f1'),
  array['(boba,1,5.330,0.000,0.086)', '(coffee,2,3.220,2.510,-0.272)',
        '(diet_soda,1,3.000,0.000,-0.209)', '(sparkling_water,1,8.500,0.000,0.487)'],
  'refresh_user_category_stats matches user-stats.vectors.json "five rankings"'
);

-- Re-running replaces rather than duplicates.
select public.refresh_user_category_stats('00000000-0000-4000-8000-0000000000f1');
select is((select count(*)::int from public.user_category_stats
            where user_id = '00000000-0000-4000-8000-0000000000f1'), 4, 'a refresh is idempotent');

-- The under-21 owner's wine row is stored, so the under-21 owner check below tests the filter.
select is((select count(*)::int from public.user_category_stats
            where user_id = '00000000-0000-4000-8000-0000000000f3' and category_id = 'wine'),
          1, 'the under-21 owner''s alcoholic row exists in the table');

-- ---------------------------------------------------------------------------
-- The ranking RPCs keep it fresh (f2, through refresh_user_stats).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';

select public.submit_ranking((select id from t_bevs where label = 'soda1'), 3::smallint, 0, 0);
select is((select array_agg(category_id || ':' || rating_count)
             from public.user_category_stats where user_id = '00000000-0000-4000-8000-0000000000f2'),
          array['soda:1'], 'submit_ranking writes the category row');
select is((select rating_count from public.user_stats where user_id = '00000000-0000-4000-8000-0000000000f2'),
          1, 'refresh_user_stats still updates user_stats');

select public.submit_ranking((select id from t_bevs where label = 'sparkling'), 3::smallint, 1, 1);
select is((select array_agg(category_id || ':' || rating_count order by category_id)
             from public.user_category_stats where user_id = '00000000-0000-4000-8000-0000000000f2'),
          array['soda:1', 'sparkling_water:1'], 'a second ranking adds its category');

select public.rerank_bev((select id from t_bevs where label = 'sparkling'), 1::smallint, 0, 0);
-- It was Loved (>= 7); a Didn't-like score is below 4.
select ok((select s.mean_score < 4
             from public.user_category_stats s
            where s.user_id = '00000000-0000-4000-8000-0000000000f2' and s.category_id = 'sparkling_water'),
          'rerank_bev into Didn''t like moves the category mean into that band');

select public.remove_ranking((select id from t_bevs where label = 'soda1'));
select is((select array_agg(category_id || ':' || rating_count)
             from public.user_category_stats where user_id = '00000000-0000-4000-8000-0000000000f2'),
          array['sparkling_water:1'], 'remove_ranking drops the emptied category');

-- ---------------------------------------------------------------------------
-- get_taste_profile
-- ---------------------------------------------------------------------------
-- An adult viewer sees f1's four categories, highest mean first.
select is(
  (select array_agg(row(t.category_id, t.rating_count, t.mean_score, t.affinity_z)::text order by t.ordinality)
     from public.get_taste_profile('00000000-0000-4000-8000-0000000000f1') with ordinality t),
  array['(sparkling_water,1,8.500,0.487)', '(boba,1,5.330,0.086)',
        '(coffee,2,3.220,-0.272)', '(diet_soda,1,3.000,-0.209)'],
  'adult viewer: every category, highest mean first'
);

-- Direct reads of the table are owner-only (get_taste_profile is the way in).
select is((select count(*)::int from public.user_category_stats
            where user_id = '00000000-0000-4000-8000-0000000000f2'),
          1, 'direct read: a user sees their own rows');
select is((select count(*)::int from public.user_category_stats
            where user_id = '00000000-0000-4000-8000-0000000000f1'),
          0, 'direct read: not another user''s rows');

-- An adult sees another adult's alcoholic category.
select is((select array_agg(category_id) from public.get_taste_profile('00000000-0000-4000-8000-0000000000f4')),
          array['wine'], 'adult viewer, adult owner: the alcoholic category shows');

-- An under-21 owner's alcoholic row never shows, even to an adult.
select is((select count(*)::int from public.get_taste_profile('00000000-0000-4000-8000-0000000000f3')),
          0, 'adult viewer, under-21 owner: no alcoholic category');

-- Your own profile works too.
select is((select array_agg(category_id) from public.get_taste_profile('00000000-0000-4000-8000-0000000000f2')),
          array['sparkling_water'], 'own profile');

-- An under-21 viewer.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}';
select is((select count(*)::int from public.get_taste_profile('00000000-0000-4000-8000-0000000000f4')),
          0, 'under-21 viewer: an adult''s alcoholic category is hidden');
select is((select count(*)::int from public.get_taste_profile('00000000-0000-4000-8000-0000000000f1')),
          4, 'under-21 viewer: non-alcoholic categories still show');
select is((select count(*)::int from public.user_category_stats
            where user_id = '00000000-0000-4000-8000-0000000000f4' and category_id = 'wine'),
          0, 'direct read: an under-21 cannot read an adult''s alcoholic row');

-- Unknown user.
select throws_ok(
  $$ select * from public.get_taste_profile('00000000-0000-4000-8000-00000000ffff') $$,
  'P0002', 'BEVI_NOT_FOUND', 'unknown user is not_found'
);

-- Signed out.
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_taste_profile('00000000-0000-4000-8000-0000000000f1') $$,
  '42501', 'BEVI_UNAUTHORIZED', 'no session is unauthorized'
);

reset role;

-- Grants.
select ok(has_function_privilege('authenticated', 'public.get_taste_profile(uuid)', 'execute'),
          'authenticated may call get_taste_profile');
select ok(not has_function_privilege('anon', 'public.get_taste_profile(uuid)', 'execute'),
          'anon may not call get_taste_profile');
select ok(not has_function_privilege('authenticated', 'public.refresh_user_category_stats(uuid)', 'execute'),
          'no client may call refresh_user_category_stats');
select ok(not has_function_privilege('authenticated', 'public.refresh_all_user_category_stats()', 'execute'),
          'no client may call refresh_all_user_category_stats');
select ok(not has_function_privilege('authenticated', 'public.refresh_user_stats(uuid)', 'execute'),
          'refresh_user_stats stays client-proof');

select * from finish();
rollback;
