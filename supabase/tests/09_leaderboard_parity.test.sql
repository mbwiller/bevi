-- A-14 (20261019000200): get_bev_leaderboard matches packages/ranking.
--
-- Expects a database with no rankings (test 1). Locally, run `supabase db reset`
-- first if the live vitest suite has already written rankings to the same stack.
--
-- The fixture is built so every figure is exact. Six users, six soda Bevs and
-- two water Bevs, picked from the seed catalog in `name collate "C", id` order:
--
--   Bev        ranked by        n  score  sum   soda board (m = 8)  global board (m = 6)
--   S1         u1..u6           6  8.00    48   (24+48)/9 = 8.0000  (18+48)/9 = 7.3333
--   S2, S3     u1..u3           3  8.00    24   (24+24)/6 = 8.0000  (18+24)/6 = 7.0000
--   S4, S5, S6 u1..u6           6  8.00    48   (24+48)/9 = 8.0000  (18+48)/9 = 7.3333
--   W1, W2     u1..u6           6  1.00     6                   --  (18+ 6)/9 = 2.6667
--
--   soda:   30 rankings, mean 8.000  -> at BAYES_CATEGORY_PRIOR_MIN, own mean
--   water:  12 rankings, mean 1.000  -> below it, so the global mean
--   global: 42 rankings, mean 6.000
--
-- Every soda score equals the soda prior, so the whole soda board ties at
-- 8.0000 and its order is decided entirely by the tie-break: n desc, then
-- name in code-point order. Before this migration the soda board used the
-- global prior (S1 would read 7.3333) and had no tie-break at all.
begin;
select plan(10);

select is((select count(*)::int from public.rankings), 0, 'precondition: no rankings before the fixture');

-- globalPrior(): GLOBAL_FALLBACK.mean when the system has no rankings. The old
-- inline expression in get_bev_leaderboard coalesced to 0 here.
select is(public.bayes_prior(null), 5.0::numeric, 'with no rankings the prior is 5.0, not 0');

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000e1', 'pgtaplb1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e2', 'pgtaplb2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e3', 'pgtaplb3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e4', 'pgtaplb4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e5', 'pgtaplb5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e6', 'pgtaplb6@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id::text like '00000000-0000-4000-8000-0000000000e%';
set local bevi.rpc_bypass = 'false';

create temporary table t_users (idx int primary key, id uuid not null) on commit drop;
insert into t_users (idx, id)
select n, ('00000000-0000-4000-8000-0000000000e' || n)::uuid from generate_series(1, 6) n;

create temporary table t_bevs (label text primary key, id uuid not null, name text not null) on commit drop;
insert into t_bevs (label, id, name)
select 'S' || rn, id, name
  from (select b.id, b.name, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'soda' and b.status = 'active') s
 where rn <= 6;
insert into t_bevs (label, id, name)
select 'W' || rn, id, name
  from (select b.id, b.name, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'water' and b.status = 'active') s
 where rn <= 2;

-- u1..u3 rank all six sodas; u4..u6 rank S1, S4, S5 and S6 only. Everyone
-- ranks both waters. 30 soda rankings exactly, which is the threshold.
create temporary table t_rank (user_id uuid, bev_id uuid, bucket smallint, score numeric(4,2)) on commit drop;
insert into t_rank (user_id, bev_id, bucket, score)
select u.id, b.id, 3::smallint, 8.00
  from t_users u join t_bevs b on b.label like 'S%'
 where u.idx <= 3 or b.label in ('S1', 'S4', 'S5', 'S6');
insert into t_rank (user_id, bev_id, bucket, score)
select u.id, b.id, 1::smallint, 1.00
  from t_users u join t_bevs b on b.label like 'W%';

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select r.user_id, r.bev_id, r.bucket,
       (row_number() over (partition by r.user_id, r.bucket order by r.bev_id) - 1)::int,
       r.score, now()
  from t_rank r;

select public.refresh_bev_stats(array(select id from t_bevs));
select public.refresh_global_stats();

-- ---------------------------------------------------------------- the priors
select is(public.bayes_prior(null), 6.000::numeric, 'the global prior is the mean of every stored score');
select is(public.bayes_prior('water'), 6.000::numeric,
          'a category below 30 rankings falls back to the global prior');
select is(public.bayes_prior('soda'), 8.000::numeric,
          'a category at 30 rankings uses its own mean (categoryPrior)');

-- ---------------------------------------------------------------- the boards
-- The board assertions join t_bevs while the role is authenticated, and a temp
-- table created by postgres is not readable by it (07_bev_of_period grants
-- t_expect the same way).
grant select on t_bevs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

select is(
  (select round(l.bayes_score, 4) from public.get_bev_leaderboard('soda') l
    join t_bevs b on b.id = l.id where b.label = 'S1'),
  8.0000::numeric,
  'the soda board shrinks toward the soda mean'
);

select is(
  (select round(l.bayes_score, 4) from public.get_bev_leaderboard() l
    join t_bevs b on b.id = l.id where b.label = 'S1'),
  7.3333::numeric,
  'the same Bev on the overall board shrinks toward the global mean'
);

-- WITH ORDINALITY, so the assertion reads the function's own row order rather
-- than whatever order the join happens to produce.
--
-- Every soda ties at 8.0000, so this is the tie-break alone: n desc, then name.
select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard('soda') with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['S1', 'S4', 'S5', 'S6', 'S2', 'S3'],
  'the soda board orders by rating_count desc, then name in code-point order'
);

select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard() with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['S1', 'S4', 'S5', 'S6', 'S2', 'S3', 'W1', 'W2'],
  'the overall board orders by bayes desc, then rating_count desc, then name'
);

select throws_ok(
  $$ select public.bayes_prior(null) $$,
  '42501',
  'permission denied for function bayes_prior',
  'calling bayes_prior directly is denied'
);

select * from finish();
rollback;
