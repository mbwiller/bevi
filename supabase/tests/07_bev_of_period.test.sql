-- A-05 (20261018000100): Bev of the day / Bev of the week.
--
-- Rankings are inserted directly with fixed ranked_at values and the clock is
-- pinned through bev_of_period_at(p_now, p_adult). Prior m = 5, C = 3, so
-- bayes = (15 + sum) / (3 + n):
--
--   Bev  rankings (UTC)                                   n  bayes
--   A    u1 9 @ Wed 10-21 15:00                            1  6.00
--   B    u1 10 @ Wed 10-21 03:30 (= Tue 23:30 in NY),       2  7.00
--        u2 10 @ Mon 10-19 05:00 (= Mon 01:00 in NY)
--   C    u1,u2,u3 10 @ Mon 10-19 03:00 (= Sun 23:00 in NY) 3  7.50
--   X    u1,u2,u3 10 @ Wed 10-21 14:00 (alcoholic)         3  7.50
--   D    u1 8 @ Wed 10-07 15:00, u2 8 @ 10-07 15:30         2  6.20
--   E    u1 8 @ Wed 10-07 15:00, u2 8 @ Thu 10-01 15:00     2  6.20
--   F, G u3 8 @ Thu 10-08 15:00 each (F's name sorts first) 1  5.75
--
-- A UTC day would let B win Wednesday and a UTC week would let C win the
-- week of 10-19; New York time excludes both.
begin;
select plan(25);

select is((select count(*)::int from public.rankings), 0, 'precondition: no rankings before the fixture');

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000d1', 'pgtapbop1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d2', 'pgtapbop2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d3', 'pgtapbop3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d4', 'pgtapbop4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns silently pins birth_date unless the trusted-RPC
-- bypass flag is on. d1-d3 are adults, d4 is 16.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2',
              '00000000-0000-4000-8000-0000000000d3');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000d4';
set local bevi.rpc_bypass = 'false';

-- Seven non-alcoholic seed Bevs in code-point name order (so F's name sorts
-- before G's), plus one alcoholic one.
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select (array['A','B','C','D','E','F','G'])[rn], id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b join public.categories c on c.id = b.category_id
         where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic) s
 where rn <= 7;
insert into t_bevs (label, id)
select 'X', b.id from public.bevs b join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
 order by b.name collate "C", b.id limit 1;

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u::uuid, (select id from t_bevs where label = l), 1, pos, sc, at::timestamptz
  from (values
    ('00000000-0000-4000-8000-0000000000d1', 'A', 0,  9, '2026-10-21 15:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d1', 'B', 1, 10, '2026-10-21 03:30:00+00'),
    ('00000000-0000-4000-8000-0000000000d1', 'C', 2, 10, '2026-10-19 03:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d1', 'X', 3, 10, '2026-10-21 14:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d1', 'D', 4,  8, '2026-10-07 15:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d1', 'E', 5,  8, '2026-10-07 15:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d2', 'B', 0, 10, '2026-10-19 05:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d2', 'C', 1, 10, '2026-10-19 03:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d2', 'X', 2, 10, '2026-10-21 14:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d2', 'D', 3,  8, '2026-10-07 15:30:00+00'),
    ('00000000-0000-4000-8000-0000000000d2', 'E', 4,  8, '2026-10-01 15:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d3', 'C', 0, 10, '2026-10-19 03:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d3', 'X', 1, 10, '2026-10-21 14:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d3', 'F', 2,  8, '2026-10-08 15:00:00+00'),
    ('00000000-0000-4000-8000-0000000000d3', 'G', 3,  8, '2026-10-08 15:00:00+00')
  ) as v(u, l, pos, sc, at);

select public.refresh_bev_stats(array(select id from t_bevs));
insert into public.global_stats (id, mean_score, rating_count, updated_at)
values (true, 5, 15, now())
on conflict (id) do update set mean_score = excluded.mean_score, rating_count = excluded.rating_count;

-- ---------------------------------------------------------------------------
-- Wednesday 2026-10-21, noon in New York.
-- ---------------------------------------------------------------------------

select is(
  (select bev_id from public.bev_of_period_at('2026-10-21 16:00:00+00', true) where period = 'day'),
  (select id from t_bevs where label = 'X'),
  'adult, day: the alcoholic Bev with the best score wins'
);
select is(
  (select row(period_start, is_current, rankings_in_period, bev_bayes_score)::text
     from public.bev_of_period_at('2026-10-21 16:00:00+00', true) where period = 'day'),
  row('2026-10-21'::date, true, 3, 7.50::numeric(4,2))::text,
  'adult, day: period start, current, rankings in period, score'
);
select is(
  (select bev_id from public.bev_of_period_at('2026-10-21 16:00:00+00', true) where period = 'week'),
  (select id from t_bevs where label = 'X'),
  'adult, week: X wins too'
);
select is(
  (select bev_id from public.bev_of_period_at('2026-10-21 16:00:00+00', false) where period = 'day'),
  (select id from t_bevs where label = 'A'),
  'under 21, day: no alcoholic winner, and B (ranked 23:30 Tuesday in NY) is not today'
);
select is(
  (select bev_bayes_score from public.bev_of_period_at('2026-10-21 16:00:00+00', false) where period = 'day'),
  6.00::numeric(4,2),
  'a Bev with one rating can win, with its Bayesian score'
);
select is(
  (select bev_id from public.bev_of_period_at('2026-10-21 16:00:00+00', false) where period = 'week'),
  (select id from t_bevs where label = 'B'),
  'under 21, week: B; C (ranked Sunday 23:00 in NY) belongs to the previous ISO week'
);
select is(
  (select row(period_start, is_current, rankings_in_period)::text
     from public.bev_of_period_at('2026-10-21 16:00:00+00', false) where period = 'week'),
  row('2026-10-19'::date, true, 2)::text,
  'week starts on Monday 2026-10-19 and counts B''s two rankings'
);

-- ---------------------------------------------------------------------------
-- Ties.
-- ---------------------------------------------------------------------------

select is(
  (select bev_id from public.bev_of_period_at('2026-10-07 16:00:00+00', false) where period = 'day'),
  (select id from t_bevs where label = 'D'),
  'equal scores: more rankings in the period wins (D 2, E 1)'
);
select is(
  (select bev_id from public.bev_of_period_at('2026-10-08 16:00:00+00', false) where period = 'day'),
  (select id from t_bevs where label = 'F'),
  'equal on everything else: name in code-point order wins'
);
select is(
  (select is_current from public.bev_of_period_at('2026-10-08 16:00:00+00', false) where period = 'day'),
  true,
  'and that day is current'
);

-- ---------------------------------------------------------------------------
-- Fallback to the latest non-empty period.
-- ---------------------------------------------------------------------------

select is(
  (select row(bev_id, period_start, is_current)::text
     from public.bev_of_period_at('2026-10-10 16:00:00+00', false) where period = 'day'),
  row((select id from t_bevs where label = 'F'), '2026-10-08'::date, false)::text,
  'an empty Saturday falls back to Thursday 10-08, not current'
);
select is(
  (select row(bev_id, period_start, is_current)::text
     from public.bev_of_period_at('2026-10-10 16:00:00+00', false) where period = 'week'),
  row((select id from t_bevs where label = 'D'), '2026-10-05'::date, true)::text,
  'the same Saturday''s week (from 10-05) is current: D'
);
select is(
  (select row(bev_id, period_start, is_current)::text
     from public.bev_of_period_at('2026-10-16 16:00:00+00', false) where period = 'week'),
  row((select id from t_bevs where label = 'D'), '2026-10-05'::date, false)::text,
  'an empty week falls back to the week of 10-05'
);
select is(
  (select row(bev_id, period_start, is_current)::text
     from public.bev_of_period_at('2026-10-16 16:00:00+00', false) where period = 'day'),
  row((select id from t_bevs where label = 'F'), '2026-10-08'::date, false)::text,
  'and its day falls back to 10-08'
);
select is(
  (select count(*)::int from public.bev_of_period_at('2026-10-16 16:00:00+00', false)),
  2,
  'one row per period'
);
select is(
  (select count(*)::int from public.bev_of_period_at('2026-09-01 00:00:00+00', true)),
  0,
  'before any ranking: no rows'
);
select is(
  (select count(*)::int from public.bev_of_period_at('2026-10-21 16:00:00+00', false)
    where bev_id = (select id from t_bevs where label = 'X')),
  0,
  'under 21: the alcoholic Bev never appears'
);

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.bev_of_period_at(timestamptz, boolean)', 'execute'),
  'authenticated cannot call bev_of_period_at (no client-chosen clock or age)'
);
select ok(
  not has_function_privilege('anon', 'public.bev_of_period_at(timestamptz, boolean)', 'execute'),
  'nor can anon'
);
select ok(
  has_function_privilege('authenticated', 'public.get_bev_of_period()', 'execute'),
  'authenticated can call get_bev_of_period'
);
select ok(
  not has_function_privilege('anon', 'public.get_bev_of_period()', 'execute'),
  'anon cannot'
);

-- ---------------------------------------------------------------------------
-- The public RPC is bev_of_period_at(now(), the caller's own age gate).
-- ---------------------------------------------------------------------------

create temporary table t_expect (who text, period text, bev_id uuid) on commit drop;
insert into t_expect select 'adult', period, bev_id from public.bev_of_period_at(now(), true);
insert into t_expect select 'minor', period, bev_id from public.bev_of_period_at(now(), false);
grant select on t_expect to authenticated;

set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';
select results_eq(
  $$ select period, bev_id from public.get_bev_of_period() order by period $$,
  $$ select period, bev_id from t_expect where who = 'adult' order by period $$,
  'as an adult, get_bev_of_period() = bev_of_period_at(now(), true)'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d4", "role": "authenticated"}';
select results_eq(
  $$ select period, bev_id from public.get_bev_of_period() order by period $$,
  $$ select period, bev_id from t_expect where who = 'minor' order by period $$,
  'under 21, get_bev_of_period() = bev_of_period_at(now(), false)'
);

select throws_ok(
  $$ select * from public.bev_of_period_at(now(), true) $$,
  '42501',
  'permission denied for function bev_of_period_at',
  'calling bev_of_period_at directly is denied'
);

select * from finish();
rollback;
