-- A-14 follow-ups (20261101000300): the Bayesian figures on the read path.
--
-- Expects a database with no rankings (test 1). Locally, run `supabase db reset`
-- first if the live vitest suite has already written rankings to the same stack.
--
-- What it pins, in the order the fixture builds up:
--   A. With global_stats empty, every live surface shrinks toward
--      GLOBAL_FALLBACK.mean = 5.0, not 0 (3.3), and bev_stats.bayes_score is
--      written by refresh_bev_stats with no cron (3.2).
--   B. Every live figure is rounded to 2 dp (3.5).
--   D. The prod bug: removing a Bev's last ranking nulls its bayes_score, and
--      a stale row is nulled by refresh_global_stats (3.2).
--   C. category_stats holds the hand-computed counts and means, and
--      bayes_prior(category) switches to the category mean at exactly 30
--      rankings (3.4). Ties on a category board still break n desc, name, id.
--   E. The leaderboard orders by the UNROUNDED figure: two Bevs that both
--      print 5.81 keep their exact order, against the name tie-break (3.5).
--
-- Fixture uuid prefix: ...0000000b14NN ("b14", for A-14). Checked against every
-- other file in supabase/tests/: they use a1, b1..b2, c1..c3, d1..d6, e1..e3,
-- f1..f4, dead, ff14, ffff, a16NN, ab0NN, be0NN, c1301, ca0NN, ed0NN, d11aNNN and
-- ed7aNNN. b14NN collides with none (0000000000b1 is ...b1, not ...b14NN).
--
-- People (all non-alcoholic Bevs, so nobody needs a birth date):
--   u1 b1401  posts the one feed event; ranks A, J1..J8, W1, W2
--   u2 b1402  ranks A, J1..J8, W1, W2; the Explore viewer (follows u3)
--   u3 b1403  ranks A, J1..J8; follows u1, so u1 is two hops from u2
--   u4 b1404  submits and removes B through the RPCs
--   u5 b1405  ranks J3..J7, then J8 as the 30th juice ranking
--
-- Bevs, picked in `name collate "C", id` order from the seed catalog: A, B the
-- first two `soda`, J1..J8 the first eight `juice`, W1, W2 the first two `water`.
--
-- Every figure below is exact (C = 3, m with at most 3 dp; computed by hand and
-- re-derived with exact rationals):
--   A   m = 5.0 (empty): A = {8.00}               (15 + 8)/4         = 5.75
--   B   m = 5.0:         A = {8.00, 9.00, 6.50}   (15 + 23.5)/6      = 6.41666.. -> 6.42
--   D   m = 5.0:         B = {8.50} (LOVED n=1)   (15 + 8.5)/4       = 5.875     -> 5.88
--   C1  32 rankings, sum 139.50 -> mean 4.359375 -> 4.359; juice 29 x 4.00;
--       soda (A) 3, 23.50/3 -> 7.833; A = (13.077 + 23.5)/6 = 6.09616.. -> 6.10
--   C2  33 rankings, sum 143.50 -> mean 4.348484.. -> 4.348; juice 30 x 4.00 ->
--       prior 4.000; every juice Bev (3*4 + 4n)/(3 + n) = 4.00 exactly;
--       A = (13.044 + 23.5)/6 = 6.09066.. -> 6.09
--   E   m = 4.348 (no refresh after these): W1 = {8.00, 8.00} 29.044/5 = 5.8088,
--       W2 = {8.01, 8.00} 29.054/5 = 5.8108; both print 5.81, W2 ranks first.
begin;
select plan(34);

select is((select count(*)::int from public.rankings), 0, 'precondition: no rankings before the fixture');

-- ---------------------------------------------------------------------------
-- category_stats: the table and its RLS
-- ---------------------------------------------------------------------------

select ok(to_regclass('public.category_stats') is not null, 'category_stats exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.category_stats'::regclass),
  'RLS is enabled on category_stats'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'category_stats'),
  0,
  'category_stats has no policy: no client read or write path'
);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000b1401', 'pgtapsp1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b1402', 'pgtapsp2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b1403', 'pgtapsp3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b1404', 'pgtapsp4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b1405', 'pgtapsp5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- u2 -> u3 -> u1: u1 is two hops from u2 and not followed by u2, so u1's post
-- is in u2's Explore whether D-01's global fallback is on or off.
insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-0000000b1402', '00000000-0000-4000-8000-0000000b1403'),
       ('00000000-0000-4000-8000-0000000b1403', '00000000-0000-4000-8000-0000000b1401');

-- Temp tables are owned by postgres; `authenticated` needs the grant to join them.
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select (array['A', 'B'])[rn], id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'soda' and b.status = 'active') s
 where rn <= 2;
insert into t_bevs (label, id)
select 'J' || rn, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'juice' and b.status = 'active') s
 where rn <= 8;
insert into t_bevs (label, id)
select 'W' || rn, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'water' and b.status = 'active') s
 where rn <= 2;
grant select on t_bevs to authenticated;

create temporary table t_users (label text primary key, id uuid not null) on commit drop;
insert into t_users (label, id)
select 'u' || n, ('00000000-0000-4000-8000-0000000b140' || n)::uuid from generate_series(1, 5) n;

-- ---------------------------------------------------------------------------
-- A. An empty global_stats: the prior is 5.0 on every surface, not 0
-- ---------------------------------------------------------------------------
-- global_stats is a cache the cron fills, so "a ranking exists but the cache
-- says 0" is the real state between a first ranking and the first tick.

insert into public.global_stats (id, mean_score, rating_count, updated_at)
values (true, null, 0, now())
on conflict (id) do update set mean_score = null, rating_count = 0, updated_at = now();
delete from public.category_stats where true;

with r as (
  insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
  values ('00000000-0000-4000-8000-0000000b1401', (select id from t_bevs where label = 'A'),
          3::smallint, 0, 8.00, now())
  returning id, user_id, bev_id
)
insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
select user_id, 'ranked', bev_id, id from r;

select public.refresh_bev_stats(array(select id from t_bevs where label = 'A'));

select is(
  (select s.bayes_score from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'A'),
  5.75::numeric(4,2),
  'refresh_bev_stats writes bayes_score itself, with the 5.0 prior: (15 + 8)/4'
);
select is(
  (select bev_bayes_score from public.bev_of_period_at(now(), true) where period = 'day'),
  5.75::numeric(4,2),
  'bev_of_period_at shrinks toward 5.0, not 0 (which gave 2.00)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1401", "role": "authenticated"}';

select is(
  (select f.bev_bayes_score from public.get_feed(20, null) f
     join t_bevs b on b.id = f.bev_id where b.label = 'A'),
  5.75::numeric,
  'get_feed shrinks toward 5.0, not 0'
);
select is(
  (select f.bev_bayes_score from public.get_user_feed('00000000-0000-4000-8000-0000000b1401', 20, null) f
     join t_bevs b on b.id = f.bev_id where b.label = 'A'),
  5.75::numeric,
  'get_user_feed shrinks toward 5.0, not 0'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1402", "role": "authenticated"}';

select is(
  (select x.bev_bayes_score from public.get_explore(20, null::timestamptz, 0) x
     join t_bevs b on b.id = x.bev_id where b.label = 'A'),
  5.75::numeric,
  'get_explore shrinks toward 5.0, not 0'
);

reset role;

-- ---------------------------------------------------------------------------
-- B. Two decimals on every live surface
-- ---------------------------------------------------------------------------
-- A now has three ratings; (15 + 23.5)/6 = 6.41666..., which the four RPCs
-- returned unrounded before this migration.

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
values ('00000000-0000-4000-8000-0000000b1402', (select id from t_bevs where label = 'A'), 3::smallint, 0, 9.00, now()),
       ('00000000-0000-4000-8000-0000000b1403', (select id from t_bevs where label = 'A'), 2::smallint, 0, 6.50, now());
select public.refresh_bev_stats(array(select id from t_bevs where label = 'A'));

select is(
  (select s.bayes_score from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'A'),
  6.42::numeric(4,2),
  'the stored figure is 6.42'
);
select is(
  (select bev_bayes_score from public.bev_of_period_at(now(), true) where period = 'day'),
  6.42::numeric(4,2),
  'bev_of_period_at returns 6.42'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1401", "role": "authenticated"}';

select is(
  (select f.bev_bayes_score from public.get_feed(20, null) f
     join t_bevs b on b.id = f.bev_id where b.label = 'A'),
  6.42::numeric,
  'get_feed returns 6.42, not 6.4166...'
);
select is(
  (select f.bev_bayes_score from public.get_user_feed('00000000-0000-4000-8000-0000000b1401', 20, null) f
     join t_bevs b on b.id = f.bev_id where b.label = 'A'),
  6.42::numeric,
  'get_user_feed returns 6.42'
);
select is(
  (select l.bayes_score from public.get_bev_leaderboard() l
     join t_bevs b on b.id = l.id where b.label = 'A'),
  6.42::numeric,
  'get_bev_leaderboard returns 6.42'
);
select ok(
  (select bool_and(t.x = round(t.x, 2))
     from (select f.bev_bayes_score as x from public.get_feed(20, null) f
           union all
           select f.bev_bayes_score from public.get_user_feed('00000000-0000-4000-8000-0000000b1401', 20, null) f
           union all
           select l.bayes_score from public.get_bev_leaderboard() l) t),
  'every live figure the caller can see has at most 2 decimals'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1402", "role": "authenticated"}';

select is(
  (select x.bev_bayes_score from public.get_explore(20, null::timestamptz, 0) x
     join t_bevs b on b.id = x.bev_id where b.label = 'A'),
  6.42::numeric,
  'get_explore returns 6.42'
);

-- ---------------------------------------------------------------------------
-- D. The prod bug: a Bev whose last ranking is removed
-- ---------------------------------------------------------------------------
-- Through the RPCs, as the user, with no cron. u4's LOVED bucket is empty, so
-- B lands at LOVED n=1 i=0 = 8.50 (score-from-position.vectors.json).

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1404", "role": "authenticated"}';
select public.submit_ranking((select id from t_bevs where label = 'B'), 3::smallint, 0, 0);
reset role;

select is(
  (select row(s.rating_count, s.bayes_score)::text
     from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'B'),
  row(1, 5.88::numeric(4,2))::text,
  'right after submit_ranking: rating_count 1 and (15 + 8.5)/4 = 5.875 stored as 5.88'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1404", "role": "authenticated"}';
select public.remove_ranking((select id from t_bevs where label = 'B'));
reset role;

select ok(
  (select s.rating_count = 0 and s.bayes_score is null
     from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'B'),
  'after remove_ranking empties B, its bayes_score is null, not the old 5.88'
);

-- ---------------------------------------------------------------------------
-- C. category_stats and the 30-ranking switch
-- ---------------------------------------------------------------------------
-- 29 juice rankings at 4.00, dated two months back so they never enter
-- bev_of_period_at's current day or week: u1, u2, u3 rank J1..J8, u5 ranks
-- J3..J7. u3's FINE bucket already holds A at position 0.

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, 2::smallint,
       (row_number() over (partition by u.id order by b.label) - 1)::int
         + case when u.label = 'u3' then 1 else 0 end,
       4.00, now() - interval '60 days'
  from t_users u
  join t_bevs b on b.label like 'J%'
 where u.label in ('u1', 'u2', 'u3')
    or (u.label = 'u5' and b.label in ('J3', 'J4', 'J5', 'J6', 'J7'));
select public.refresh_bev_stats(array(select id from t_bevs where label like 'J%'));

-- A row written before this migration: B emptied, its old figure still there.
update public.bev_stats set bayes_score = 7.77
 where bev_id = (select id from t_bevs where label = 'B');

select public.refresh_global_stats();

select is(
  (select row(mean_score, rating_count)::text from public.global_stats),
  row(4.359::numeric(5,3), 32)::text,
  'global_stats: 32 rankings, 139.50 / 32 = 4.359375 -> 4.359'
);
select is(
  (select array_agg(row(category_id, rating_count, mean_score)::text order by category_id collate "C")
     from public.category_stats),
  array['(juice,29,4.000)', '(soda,3,7.833)'],
  'category_stats: one row per ranked category, counts and 3-dp means (23.50 / 3 -> 7.833)'
);
select is(
  public.bayes_prior('juice'),
  4.359::numeric,
  'juice at 29 rankings: below BAYES_CATEGORY_PRIOR_MIN, so the global prior'
);
select ok(
  (select s.bayes_score is null from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'B'),
  'refresh_global_stats nulls a stale bayes_score at rating_count = 0'
);
select is(
  (select s.bayes_score from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'A'),
  6.10::numeric(4,2),
  'and rewrites every rated row with the new prior: (13.077 + 23.5)/6 -> 6.10'
);

-- The 30th.
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
values ('00000000-0000-4000-8000-0000000b1405', (select id from t_bevs where label = 'J8'),
        2::smallint, 5, 4.00, now() - interval '60 days');
select public.refresh_bev_stats(array(select id from t_bevs where label = 'J8'));
select public.refresh_global_stats();

select is(
  (select row(rating_count, mean_score)::text from public.category_stats where category_id = 'juice'),
  row(30, 4.000::numeric(5,3))::text,
  'category_stats: juice now has 30 rankings, mean 4.000'
);
select is(
  public.bayes_prior('juice'),
  4.000::numeric,
  'juice at exactly 30 rankings: its own mean (categoryPrior)'
);
select is(
  public.bayes_prior(null),
  4.348::numeric,
  'the global prior: 143.50 / 33 = 4.3484... -> 4.348'
);
select is(
  (select s.bayes_score from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'A'),
  6.09::numeric(4,2),
  'A stored with the new prior: (13.044 + 23.5)/6 -> 6.09'
);

-- ---------------------------------------------------------------------------
-- E. Order is by the unrounded figure; ties break n desc, name, id
-- ---------------------------------------------------------------------------
-- W1 ranks before W2 by name, and W2 has one more cent. No refresh_global_stats
-- after these, so the water board's prior stays 4.348 (water has no
-- category_stats row, so the global branch answers).

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
values ('00000000-0000-4000-8000-0000000b1401', (select id from t_bevs where label = 'W2'), 3::smallint, 1, 8.01, now() - interval '60 days'),
       ('00000000-0000-4000-8000-0000000b1401', (select id from t_bevs where label = 'W1'), 3::smallint, 2, 8.00, now() - interval '60 days'),
       ('00000000-0000-4000-8000-0000000b1402', (select id from t_bevs where label = 'W1'), 3::smallint, 1, 8.00, now() - interval '60 days'),
       ('00000000-0000-4000-8000-0000000b1402', (select id from t_bevs where label = 'W2'), 3::smallint, 2, 8.00, now() - interval '60 days');
select public.refresh_bev_stats(array(select id from t_bevs where label like 'W%'));

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b1401", "role": "authenticated"}';

-- Every juice figure is exactly 4.00, so the order is the tie-break alone:
-- J3..J8 have n = 4, J1 and J2 have n = 3, and within each n the labels are
-- name (collate "C"), then id.
select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard('juice') with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J1', 'J2'],
  'a tie on the rounded and the exact figure still breaks rating_count desc, then name, then id'
);
select is(
  (select count(*)::int from public.get_bev_leaderboard('juice') where bayes_score = 4.00),
  8,
  'and all eight juice Bevs read 4.00 on the juice board'
);
select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard('water') with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['W2', 'W1'],
  'W2 (5.8108) before W1 (5.8088): the order reads the exact figure, not the name tie-break'
);
select is(
  (select array_agg(l.bayes_score) from public.get_bev_leaderboard('water') l),
  array[5.81, 5.81]::numeric[],
  'though both print 5.81'
);
select is(
  (select l.bayes_score from public.get_bev_leaderboard() l
     join t_bevs b on b.id = l.id where b.label = 'A'),
  6.09::numeric,
  'one Bev, one number: A on the overall board equals its stored bev_stats figure'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.category_stats),
  0,
  'a signed-in user reads no category_stats row, though two exist'
);

reset role;

select ok(
  not has_function_privilege('authenticated', 'public.rank_points(integer, integer, integer)', 'execute'),
  'no client may call rank_points'
);

select * from finish();
rollback;
