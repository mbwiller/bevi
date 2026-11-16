-- A-14 follow-ups (20261025000300): the Bayesian prior everywhere it is used.
--
-- Expects a database with no rankings (test 1). Locally, run `supabase db reset`
-- first if the live vitest suite has already written rankings to the same stack.
--
-- The `...0ca7__` prefix is this file's alone; every other file in
-- supabase/tests/ was checked for it. Users are ...0ca701..706, the Bevs this
-- file inserts are ...0ca711..715.
--
-- Three things are under test, in three parts, and the order matters because
-- part 1 needs global_stats to say the system is empty while rankings exist:
--
--   1. get_feed, get_user_feed and bev_of_period_at shrink toward
--      GLOBAL_FALLBACK.mean = 5.0 on an empty system, not toward 0.
--   2. refresh_global_stats materialises per-category means into
--      category_stats, and bayes_prior reads them with the
--      BAYES_CATEGORY_PRIOR_MIN = 30 semantics unchanged.
--   3. get_bev_leaderboard returns numeric(4,2), agreeing with
--      bev_stats.bayes_score, bev_of_period_at and the FakeApi's round2 -- while
--      still ORDERING on the unrounded figure, as leaderboardOrder() does.
--
-- The fixture, by category, so every figure below is exact:
--
--   W0   water,  1 ranking  @ 2.00 (bucket 1)          -- part 1
--   S1-5 soda,  30 rankings @ 8.00 (bucket 3)          -- mean 8.000, at the threshold
--   R1   energy, 6 rankings @ 6.00 (bucket 2)          -- sum 36.00
--   R2   energy, 5 @ 6.00 + 1 @ 6.01                   -- sum 36.01
--   F1-3 energy, 6 rankings @ 6.00 each                -- sum 36.00, name sorts last
--
-- energy therefore holds 30 rankings summing to 180.01, whose mean is
-- 6.000333..., which is 6.000 as a numeric(5,3) -- so the energy prior is
-- exactly 6.000 whatever the global mean happens to be, and the part-3 figures
-- do not move if the fixture above ever grows. With that prior R1 and the three
-- fillers score exactly (18 + 36.00)/9 = 6.000000 and R2 scores
-- (18 + 36.01)/9 = 6.001111...: five rows that all round to 6.00, where only
-- the unrounded value can put R2 first. One Bev per bucket group keeps the
-- deferred `unique (user_id, bucket, position)` honest across the staged
-- inserts.
--
-- Each part uses one bucket of its own (1, 3, 2) so the staged inserts never
-- collide on `unique (user_id, bucket, position)`, and the scores sit inside
-- their bucket's band (DISLIKED [0,4), FINE [4,7), LOVED [7,10]).

begin;
select plan(28);

select is((select count(*)::int from public.rankings), 0, 'precondition: no rankings before the fixture');

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000ca701', 'pgtapprior1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca702', 'pgtapprior2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca703', 'pgtapprior3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca704', 'pgtapprior4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca705', 'pgtapprior5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ca706', 'pgtapprior6@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id::text like '00000000-0000-4000-8000-0000000ca70_';
set local bevi.rpc_bypass = 'false';

create temporary table t_users (idx int primary key, id uuid not null) on commit drop;
insert into t_users (idx, id)
select n, ('00000000-0000-4000-8000-0000000ca70' || n)::uuid from generate_series(1, 6) n;

-- `source = 'seed'` is what lets an active Bev have no photo
-- (bevs_active_needs_photo, 20261012000200), and it is also what keeps
-- bevs_embed_after_insert (20261023000100, `when new.source = 'user'`) from
-- queueing a pg_net row. bevs_natural_uq is on (category_id, lower(brand),
-- lower(name), lower(flavor)), and the five names differ, so one brand is fine.
--
-- The names are asserted constants, not something the fixture rederives: 'AA'
-- and 'BB' sort before 'ZZ' under `collate "C"`, so if the board ever fell
-- through to the name tie-break R1 would precede R2 and the order assertion
-- would fail.
insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-0000000ca711', 'AA pgTAP Rounding', 'pgTAP', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ca712', 'BB pgTAP Rounding', 'pgTAP', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ca713', 'ZZ pgTAP Filler 1', 'pgTAP', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ca714', 'ZZ pgTAP Filler 2', 'pgTAP', null,
        'energy', 2, 'active', 'seed'),
       ('00000000-0000-4000-8000-0000000ca715', 'ZZ pgTAP Filler 3', 'pgTAP', null,
        'energy', 2, 'active', 'seed');

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;

insert into t_bevs (label, id)
select 'W0', id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'water' and b.status = 'active') s
 where rn = 1;

insert into t_bevs (label, id)
select 'S' || rn, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'soda' and b.status = 'active') s
 where rn <= 5;

insert into t_bevs (label, id) values
  ('R1', '00000000-0000-4000-8000-0000000ca711'),
  ('R2', '00000000-0000-4000-8000-0000000ca712'),
  ('F1', '00000000-0000-4000-8000-0000000ca713'),
  ('F2', '00000000-0000-4000-8000-0000000ca714'),
  ('F3', '00000000-0000-4000-8000-0000000ca715');

-- ===========================================================================
-- Part 1 -- the 0 prior outside the leaderboard (A-14 follow-up 1)
-- ===========================================================================
-- "Empty system" is global_stats.rating_count = 0, which is the only state in
-- which the old `coalesce((select mean_score from global_stats limit 1), 0)`
-- differed from bayes_prior(null) at all. It is pinned rather than assumed:
-- refresh_global_stats is deliberately NOT called in this part, so the row stays
-- where 20261011000800's bootstrap left it on a fresh database.
insert into public.global_stats (id, mean_score, rating_count, updated_at)
values (true, null, 0, now())
on conflict (id) do update set
  mean_score = null, rating_count = 0, updated_at = now();

select is(public.bayes_prior(null), 5.0::numeric,
          'with global_stats.rating_count = 0 the prior is GLOBAL_FALLBACK.mean = 5.0, not 0');

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, 1::smallint, 0, 2.00, now()
  from t_users u join t_bevs b on b.label = 'W0'
 where u.idx = 1;

select public.refresh_bev_stats(array(select id from t_bevs where label = 'W0'));

insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
select r.user_id, 'ranked', r.bev_id, r.id
  from public.rankings r join t_bevs b on b.id = r.bev_id
 where b.label = 'W0';

-- bayes_score(2.00, 1, 5.0, 3) = (3*5.0 + 2.00) / (3 + 1) = 4.25.
-- With the old 0 prior it was 2.00 / 4 = 0.50.
select is(
  (select bev_bayes_score from public.bev_of_period_at(now(), true) where period = 'day'),
  4.25::numeric,
  'bev_of_period_at shrinks the day winner toward 5.0 (4.25), not toward 0 (0.50)'
);

grant select on t_bevs to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca701", "role": "authenticated"}';

select is(
  (select round(f.bev_bayes_score, 2) from public.get_feed(20, null) f
    join t_bevs b on b.id = f.bev_id where b.label = 'W0'),
  4.25::numeric,
  'get_feed''s card score shrinks toward 5.0, not toward 0'
);

select is(
  (select round(f.bev_bayes_score, 2)
     from public.get_user_feed('00000000-0000-4000-8000-0000000ca701', 20, null) f
     join t_bevs b on b.id = f.bev_id where b.label = 'W0'),
  4.25::numeric,
  'get_user_feed agrees with get_feed, as 07_user_feed requires of their shapes'
);

-- The privilege chain that matters: bayes_prior is revoked from authenticated
-- and bev_of_period_at is `security invoker`, so this only works because
-- get_bev_of_period() is a definer owned by postgres and current_user is
-- postgres by the time bayes_prior is reached.
select is(
  (select bev_bayes_score from public.get_bev_of_period() where period = 'day'),
  4.25::numeric,
  'get_bev_of_period reaches bayes_prior through an invoker function without a grant'
);

reset role;

-- ===========================================================================
-- Part 2 -- materialised category means (A-14 follow-up 2)
-- ===========================================================================
-- 29 soda rankings: every (user, soda) pair except (user 6, S5). One below
-- BAYES_CATEGORY_PRIOR_MIN.
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, 3::smallint,
       (row_number() over (partition by u.id order by b.id) - 1)::int,
       8.00, now()
  from t_users u join t_bevs b on b.label like 'S_'
 where not (u.idx = 6 and b.label = 'S5');

select public.refresh_bev_stats(array(select id from t_bevs));
select public.refresh_global_stats();

select is(
  (select count(*)::int from public.category_stats),
  (select count(*)::int from public.categories),
  'refresh_global_stats writes a category_stats row for every category'
);

-- The materialised figures against the live `rankings ⋈ bevs` aggregate the old
-- bayes_prior ran per call -- no status filter, counting rankings. A full join
-- so a missing row on either side is a mismatch too.
select is(
  (select count(*)::int
     from public.category_stats cs
     full join (
       select b.category_id, count(*) as n, avg(r.score)::numeric(5,3) as mean
         from public.rankings r
         join public.bevs b on b.id = r.bev_id
        group by b.category_id
     ) live on live.category_id = cs.category_id
    where cs.rating_count is distinct from coalesce(live.n, 0)
       or cs.mean_score   is distinct from live.mean),
  0,
  'every category_stats row equals a live rankings ⋈ bevs aggregate'
);

select is(
  (select rating_count from public.category_stats where category_id = 'soda'),
  29,
  'soda sits at 29 rankings, one below BAYES_CATEGORY_PRIOR_MIN'
);

select is(
  public.bayes_prior('soda'), public.bayes_prior(null),
  'at 29 the category prior is still the global one (categoryPrior falls back)'
);

-- 30 rankings from 6 raters: an implementation counting distinct raters would
-- read 6 and never cross the threshold.
select is(
  (select count(distinct r.user_id)::int from public.rankings r
     join public.bevs b on b.id = r.bev_id where b.category_id = 'soda'),
  6,
  'the soda rankings come from 6 raters, so the threshold counts rankings not raters'
);

-- The 30th.
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, 3::smallint,
       coalesce((select max(r.position) from public.rankings r
                  where r.user_id = u.id and r.bucket = 3), -1) + 1,
       8.00, now()
  from t_users u join t_bevs b on b.label = 'S5'
 where u.idx = 6;

select public.refresh_bev_stats(array(select id from t_bevs));
select public.refresh_global_stats();

select is(
  (select rating_count from public.category_stats where category_id = 'soda'),
  30,
  'soda now sits at exactly BAYES_CATEGORY_PRIOR_MIN'
);

select is(
  public.bayes_prior('soda'), 8.000::numeric,
  'at exactly 30 the category''s own mean becomes the prior (>= 30, not > 30)'
);

select isnt(
  public.bayes_prior('soda'), public.bayes_prior(null),
  'and that is a different number from the global prior, so the flip is observable'
);

-- The prior deliberately does not filter bevs.status: a Bev hidden after people
-- ranked it still happened. This is also why bevs_category_idx (partial on
-- status = 'active') never served the old per-call aggregate.
update public.bevs set status = 'hidden'
 where id = (select id from t_bevs where label = 'S5');

select public.refresh_global_stats();

select is(
  (select rating_count from public.category_stats where category_id = 'soda'),
  30,
  'hiding a ranked Bev does not change the category count: the prior ignores status'
);

select is(
  public.bayes_prior('soda'), 8.000::numeric,
  'so the soda prior is still its own mean after the Bev is hidden'
);

-- ===========================================================================
-- Part 3 -- the leaderboard's rounding (A-14 follow-up 3)
-- ===========================================================================
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, 2::smallint,
       (row_number() over (partition by u.id order by b.id) - 1)::int,
       case when u.idx = 1 and b.label = 'R2' then 6.01 else 6.00 end,
       now()
  from t_users u join t_bevs b on b.label in ('R1', 'R2', 'F1', 'F2', 'F3');

select public.refresh_bev_stats(array(select id from t_bevs));
select public.refresh_global_stats();

select ok(
  pg_get_function_result('public.get_bev_leaderboard(text, int)'::regprocedure)
    like '%bayes_score numeric(4,2)%',
  'get_bev_leaderboard declares bayes_score as numeric(4,2), like bev_stats and bev_of_period_at'
);

select is(
  public.bayes_prior('energy'), 6.000::numeric,
  'energy holds 30 rankings whose mean is 6.000 as a numeric(5,3), so its prior is exact'
);

-- The raw figure for S1 against the numeric(4,2) refresh_global_stats stored:
-- they differ, so the match in the next assertion is a rounding and not a
-- coincidence of a figure that happened to need two decimals.
select isnt(
  (select public.bayes_score(s.sum_score, s.rating_count, public.bayes_prior(null), 3)
     from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'S1'),
  (select s.bayes_score
     from public.bev_stats s join t_bevs b on b.id = s.bev_id where b.label = 'S1'),
  'S1''s raw Bayesian figure has more than two decimals, so rounding is observable'
);

create temporary table t_expect (label text primary key, bayes numeric) on commit drop;
insert into t_expect (label, bayes)
select b.label, s.bayes_score
  from t_bevs b join public.bev_stats s on s.bev_id = b.id;
grant select on t_expect to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca701", "role": "authenticated"}';

select is(
  (select l.bayes_score from public.get_bev_leaderboard() l
     join t_bevs b on b.id = l.id where b.label = 'S1'),
  (select bayes from t_expect where label = 'S1'),
  'the overall board returns bev_stats.bayes_score''s digits exactly (FakeApi round2)'
);

select is(
  (select array[count(*)::int, count(distinct l.bayes_score)::int]
     from public.get_bev_leaderboard('energy') l join t_bevs b on b.id = l.id),
  array[5, 1],
  'all five energy Bevs come back and every one of them rounds to the same score'
);

-- With the rounded scores identical and rating_count equal at 6, nothing but the
-- unrounded figure can put R2 first; a sort on the rounded value would fall
-- through to `name collate "C"` and start with R1.
select is(
  (select array_agg(b.label order by l.ord)
     from public.get_bev_leaderboard('energy') with ordinality
          as l(id, name, brand, flavor, category_id, photo_path, thumb_path,
               price_tier, rating_count, avg_score, bayes_score, ord)
     join t_bevs b on b.id = l.id),
  array['R2', 'R1', 'F1', 'F2', 'F3'],
  'the board still orders by the UNROUNDED score, as leaderboardOrder() does'
);

reset role;

-- ===========================================================================
-- Part 4 -- RLS and grants on category_stats
-- ===========================================================================

select ok(
  (select relrowsecurity from pg_class where oid = 'public.category_stats'::regclass),
  'category_stats has RLS enabled'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'category_stats'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on category_stats'
);

select is(
  (select array_agg(cmd || ':' || array_to_string(roles, ',') order by cmd)
     from pg_policies where schemaname = 'public' and tablename = 'category_stats'),
  array['SELECT:authenticated'],
  'category_stats has exactly one policy: select for authenticated, and none for anon'
);

-- Modelled on global_stats, so the table privileges Supabase's default
-- privileges lay down must be the same on both.
select is(
  (select array_agg(distinct privilege_type order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'category_stats' and grantee = 'authenticated'),
  (select array_agg(distinct privilege_type order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'global_stats' and grantee = 'authenticated'),
  'category_stats carries exactly global_stats'' table grants for authenticated'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ca701", "role": "authenticated"}';

select is(
  (select count(*)::int from public.category_stats),
  (select count(*)::int from public.categories),
  'authenticated can read every category_stats row through category_stats_select'
);

-- 'soda' already exists, and RLS's WITH CHECK is evaluated before the primary
-- key, so this is denied for the policy and not for the conflict.
select throws_ok(
  $$ insert into public.category_stats (category_id, rating_count) values ('soda', 1) $$,
  '42501'::text, null::text,
  'authenticated cannot write category_stats: no write policy, only the definer refresh'
);

reset role;

select * from finish();
rollback;
