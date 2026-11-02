-- A-14 (20261019000200): get_bev_leaderboard matches packages/ranking.
--
-- Expects a database with no rankings (test 1). Locally, run `supabase db reset`
-- first if the live vitest suite has already written rankings to the same stack.
--
-- The fixture is built so every figure is exact. Six users, six soda Bevs and
-- two water Bevs, picked from the seed catalog in `name collate "C", id` order,
-- plus three `energy` Bevs this file inserts itself (P1..P3, see "the collation
-- fixture" below) to pin the last two clauses of the order:
--
--   Bev        ranked by        n  score  sum   soda board (m = 8)  global board (m = 6)
--   S1         u1..u6           6  8.00    48   (24+48)/9 = 8.0000  (18+48)/9 = 7.3333
--   S2, S3     u1..u3           3  8.00    24   (24+24)/6 = 8.0000  (18+24)/6 = 7.0000
--   S4, S5, S6 u1..u6           6  8.00    48   (24+48)/9 = 8.0000  (18+48)/9 = 7.3333
--   P1, P2, P3 u1..u6           6  6.00    36                   --  (18+36)/9 = 6.0000
--   W1, W2     u1..u6           6  1.00     6                   --  (18+ 6)/9 = 2.6667
--
--   soda:   30 rankings, mean 8.000  -> at BAYES_CATEGORY_PRIOR_MIN, own mean
--   energy: 18 rankings, mean 6.000  -> below it, so the global prior
--   water:  12 rankings, mean 1.000  -> below it, so the global prior
--   global: 60 rankings, mean 6.000  (240 + 108 + 12) / (30 + 18 + 12)
--
-- The P rankings are 6.00 on purpose: 18 scores sitting exactly on the global
-- mean leave that mean at 6.000, so all three priors and every soda and water
-- figure above read the same as they did before P1..P3 existed. They are in
-- `energy` rather than `soda` or `water` for the same reason -- either of those
-- categories would move its own mean and so its prior.
--
-- Every soda score equals the soda prior, so the whole soda board ties at
-- 8.0000 and its order is decided entirely by the tie-break: n desc, then
-- name in code-point order. Before this migration the soda board used the
-- global prior (S1 would read 7.3333) and had no tie-break at all.
begin;
select plan(12);

select is((select count(*)::int from public.rankings), 0, 'precondition: no rankings before the fixture');

-- globalPrior(): GLOBAL_FALLBACK.mean when the system has no rankings. The old
-- inline expression in get_bev_leaderboard coalesced to 0 here.
select is(public.bayes_prior(null), 5.0::numeric, 'with no rankings the prior is 5.0, not 0');

-- ---------------------------------------------------------------- fixture
-- The `...0ab_` prefix is this file's alone. 07_user_feed.test.sql takes
-- `...00e1`..`00e3` and is the one test in the suite with no `rollback;` (it
-- relies on the backend aborting at disconnect), and it runs before this one in
-- pg_prove order, so those ids are not safe to reuse here.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000ab001', 'pgtaplb1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ab002', 'pgtaplb2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ab003', 'pgtaplb3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ab004', 'pgtaplb4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ab005', 'pgtaplb5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ab006', 'pgtaplb6@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id::text like '00000000-0000-4000-8000-0000000ab00_';
set local bevi.rpc_bypass = 'false';

create temporary table t_users (idx int primary key, id uuid not null) on commit drop;
insert into t_users (idx, id)
select n, ('00000000-0000-4000-8000-0000000ab00' || n)::uuid from generate_series(1, 6) n;

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

-- ------------------------------------------------- the collation fixture
-- The S and W labels above are handed out by the same `name collate "C", b.id`
-- expression the function orders by, so on their own they cannot tell that
-- expression apart from one that used the database's default collation, or from
-- one that stopped at the name. P1..P3 are labelled by hand instead, so the
-- expected order below is a constant the test asserts rather than something the
-- fixture rederives from the server's collation.
--
-- P1 vs P2/P3 pins `collate "C"`. Under C every uppercase letter sorts before
-- every lowercase one, so 'Z' (U+005A) < 'a' (U+0061) and the order is
--   P1 'ZZ pgTAP Parity', then 'aa pgTAP Parity'.
-- Under the usual Supabase default, en_US.UTF-8, letters compare
-- case-insensitively at the primary level, so 'aa...' < 'zz...' and the order
-- is the reverse:
--   'aa pgTAP Parity', then P1 'ZZ pgTAP Parity'.
-- A regression to the default collation therefore fails the assertion.
--
-- P2 and P3 carry the *same* name and differ only in id, so nothing but the
-- final `b.id asc` can order them; ...ab012 < ...ab013, so P2 precedes P3.
-- bevs_natural_uq is on (category_id, lower(brand), lower(name),
-- lower(flavor)), hence the two different brands. `source = 'seed'` is what
-- lets an active Bev have no photo (bevs_active_needs_photo, 20261012000200).
insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-0000000ab011', 'ZZ pgTAP Parity', 'pgTAP', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ab012', 'aa pgTAP Parity', 'pgTAP A', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ab013', 'aa pgTAP Parity', 'pgTAP B', null,
        'energy', 2, 'active', 'seed');

insert into t_bevs (label, id, name) values
  ('P1', '00000000-0000-4000-8000-0000000ab011', 'ZZ pgTAP Parity'),
  ('P2', '00000000-0000-4000-8000-0000000ab012', 'aa pgTAP Parity'),
  ('P3', '00000000-0000-4000-8000-0000000ab013', 'aa pgTAP Parity');

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
-- Equal n and equal sum across P1..P3, so the three tie on bayes_score and on
-- rating_count and the order clause has to fall through to name and then id.
insert into t_rank (user_id, bev_id, bucket, score)
select u.id, b.id, 2::smallint, 6.00
  from t_users u join t_bevs b on b.label like 'P%';

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
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ab001", "role": "authenticated"}';

select is(
  (select round(l.bayes_score, 4) from public.get_bev_leaderboard('soda') l
    join t_bevs b on b.id = l.id where b.label = 'S1'),
  8.0000::numeric,
  'the soda board shrinks toward the soda mean'
);

-- (18 + 48)/9 = 7.3333..., which the board returns rounded to 2 dp since
-- 20261101000300 (A-14 3.5). The order assertions below still rest on the
-- exact figure, which is what get_bev_leaderboard orders by.
select is(
  (select l.bayes_score from public.get_bev_leaderboard() l
    join t_bevs b on b.id = l.id where b.label = 'S1'),
  7.33::numeric,
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
  array['S1', 'S4', 'S5', 'S6', 'S2', 'S3', 'P1', 'P2', 'P3', 'W1', 'W2'],
  'the overall board orders by bayes desc, then rating_count desc, then name'
);

-- The tie the next assertion rests on. Without this, an order that came out
-- right for the wrong reason -- P1..P3 separated by score rather than by name
-- and id -- would still pass.
select is(
  (select count(*)::int
     from public.get_bev_leaderboard('energy') l
     join t_bevs b on b.id = l.id and b.label like 'P%'
    where l.rating_count = 6 and round(l.bayes_score, 4) = 6.0000::numeric),
  3,
  'P1, P2 and P3 all tie at 6.0000 with n = 6, so only name and id can order them'
);

-- The tail of leaderboardOrder(), in isolation: `name collate "C" asc` (P1
-- first, which the database default collation would not do) and then `id asc`
-- between P2 and P3, which share a name.
select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard('energy') with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['P1', 'P2', 'P3'],
  'a name tie breaks in code-point order, and an identical name breaks on id asc'
);

select throws_ok(
  $$ select public.bayes_prior(null) $$,
  '42501',
  'permission denied for function bayes_prior',
  'calling bayes_prior directly is denied'
);

reset role;

select * from finish();
rollback;
