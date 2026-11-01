-- A-14 3.1 + 3.6 (20261101000200): the append-only ranking_events log, the
-- streak computed from it, and the Prop. 2.5 check of the comparison log.
--
-- In order: (1) the table's shape, RLS and the internal functions' grants;
-- (2) the RPCs: submit_ranking and rerank_bev each write exactly one event,
-- remove_ranking writes and deletes nothing, and the comparison log is checked
-- against the index (valid calls pass, inconsistent ones raise BEVI_VALIDATION
-- and change nothing); (3) the two `streakFromTimestamps` vectors written as
-- events, replayed on real rows with real timestamps: a re-ranked day and a
-- removed day both still count; (4) `streak_from_days` and the day-key
-- conversion against every day-period case of streak.vectors.json.
--
-- Section 4 was TRANSCRIBED BY HAND from shared/fixtures/streak.vectors.json
-- at RANKING_VERSION 1.6.0 (31 cases: localDayKey x11, streakFromTimestamps
-- x13, computeStreak x7). Each assertion is named after the vector's `name`.
-- Refresh this section whenever the fixture changes. Skipped, because SQL
-- implements period 'day' only (streakPeriod = 'day'):
--   * streakFromTimestamps "weekly: three ISO weeks across the new year"
--   * computeStreak        "weekly: W53 to W01"
-- So 29 vector assertions.
--
-- The backfill in the migration runs once, on whatever the database holds at
-- migration time (nothing, under `supabase db reset`), so it is not exercised
-- here; it is desk-checked in the migration header.
--
-- Fixture uuid prefix: ...0000000a14NN ("a14" for A-14). Checked against every
-- other file in supabase/tests/: the earlier files use a1, b1..b2, c1..c3,
-- d1..d6, e1..e3, f1..f4, ff14, ffff, dead, fffffff; 09 uses ab001..ab013;
-- 11 uses ed0NN; 12 uses be0NN and c1301; 14 uses d11aNNN and ed7aNNN; 15
-- uses ca0NN; 16 uses a16NN. a14NN collides with none.
--
-- The people (all in America/Los_Angeles, set explicitly):
--   a1401  ranks through the RPCs (sections 1-2)
--   a1402  the re-ranked-day scenario (section 3)
--   a1403  the removed-day scenario (section 3)
begin;
select plan(57);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000a1401', 'pgtapre1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000a1402', 'pgtapre2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000a1403', 'pgtapre3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

update public.profiles set timezone = 'America/Los_Angeles'
 where id in ('00000000-0000-4000-8000-0000000a1401', '00000000-0000-4000-8000-0000000a1402',
              '00000000-0000-4000-8000-0000000a1403');

-- Five seeded non-alcoholic Bevs, in a stable order.
create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select 'b' || (off + 1), (select b.id from public.bevs b
                           where b.category_id = 'soda' and b.source = 'seed' and b.status = 'active'
                           order by b.name collate "C", b.id offset off limit 1)
  from generate_series(0, 4) as g(off);
grant select on t_bevs to authenticated;

-- A comparison triple as the app sends it.
create function pg_temp.cmp(p_winner text, p_loser text, p_tie boolean default false) returns jsonb
language sql stable as $fn$
  select jsonb_build_object('winnerBevId', (select id from t_bevs where label = p_winner),
                            'loserBevId',  (select id from t_bevs where label = p_loser),
                            'tie',         p_tie)
$fn$;
grant execute on function pg_temp.cmp(text, text, boolean) to authenticated;

-- Local noon p_days_ago days before today, in p_tz.
create function pg_temp.local_noon(p_days_ago int, p_tz text) returns timestamptz
language sql stable as $fn$
  select ((now() at time zone p_tz)::date - p_days_ago + time '12:00') at time zone p_tz
$fn$;

-- streak_from_days over the day keys of the given instants in p_tz, as of
-- p_now; rendered with the day keys so periodKeys is checked too.
create function pg_temp.streak_at(p_ts timestamptz[], p_tz text, p_now timestamptz) returns text
language sql stable as $fn$
  select row(d.days, s.current_days, s.longest_days, s.last_ranked_on)::text
  from (select array(select distinct (u.t at time zone p_tz)::date
                       from unnest(p_ts) as u(t) order by 1) as days) d
  cross join lateral public.streak_from_days(d.days, (p_now at time zone p_tz)::date) s
$fn$;

-- streak_from_days over day keys given directly.
create function pg_temp.streak_keys(p_days date[], p_today date) returns text
language sql stable as $fn$
  select row(s.current_days, s.longest_days, s.last_ranked_on)::text
  from public.streak_from_days(p_days, p_today) s
$fn$;

-- What the OLD engine would say: the current streak from the surviving rows.
create function pg_temp.rows_current(p_uid uuid) returns integer
language sql stable as $fn$
  select s.current_days
  from public.streak_from_days(
    array(select (r.ranked_at at time zone 'America/Los_Angeles')::date
            from public.rankings r where r.user_id = p_uid),
    (now() at time zone 'America/Los_Angeles')::date) s
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
select ok(to_regclass('public.ranking_events') is not null, 'ranking_events exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ranking_events'::regclass),
  'RLS is enabled on ranking_events'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'ranking_events'),
  0,
  'ranking_events has no policy at all: nothing on the client reads or writes it'
);

select ok(
  to_regprocedure('public.streak_from_days(date[], date)') is not null
  and to_regprocedure('public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb)') is not null
  and to_regprocedure('public.touch_streak(uuid)') is not null,
  'streak_from_days, assert_comparison_log and touch_streak exist with the expected signatures'
);

select ok(
  not has_function_privilege('authenticated', 'public.streak_from_days(date[], date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.touch_streak(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.streak_from_days(date[], date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb)', 'EXECUTE'),
  'the three internal functions are not executable by anon or authenticated'
);

-- ---------------------------------------------------------------------------
-- 2. The RPCs (a1401, bucket LOVED = 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1401", "role": "authenticated"}';

-- Empty bucket: no question asked, no comparison.
select public.submit_ranking((select id from t_bevs where label = 'b1'), 3::smallint, 0, 0);

select is(
  (select count(*)::int from public.ranking_events),
  0,
  'a signed-in user reads zero rows, not even their own event, and no error'
);

select throws_ok(
  $$ insert into public.ranking_events (user_id, bev_id, kind)
     values ('00000000-0000-4000-8000-0000000a1401', (select id from t_bevs where label = 'b1'), 'submit') $$,
  '42501',
  null,
  'a signed-in user cannot write an event, even their own'
);

reset role;
select is(
  (select array_agg(e.kind order by e.id) from public.ranking_events e
    where e.user_id = '00000000-0000-4000-8000-0000000a1401'
      and e.bev_id = (select id from t_bevs where label = 'b1')),
  array['submit'],
  'submit_ranking writes one submit event for (user, bev)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1401", "role": "authenticated"}';

-- List [b1]. b2 asked about b1 (position 0), b1 better -> index 1.
select lives_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b2'), 3::smallint, 1, 1,
                                  jsonb_build_array(pg_temp.cmp('b1', 'b2'))) $$,
  'Prop. 2.5: EXISTING_BETTER against position 0 with index 1 is accepted'
);

-- List [b1, b2]. Every call below is inconsistent and must change nothing.
select throws_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b3'), 3::smallint, 0, 2,
                                  jsonb_build_array(pg_temp.cmp('b1', 'b3'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5: EXISTING_BETTER against position 0 with index 0 raises BEVI_VALIDATION'
);

select throws_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b3'), 3::smallint, 1, 2,
                                  jsonb_build_array(pg_temp.cmp('b3', 'b1'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5: NEW_BETTER against position 0 with index 1 raises BEVI_VALIDATION'
);

select throws_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b3'), 3::smallint, 0, 2,
                                  jsonb_build_array(pg_temp.cmp('b3', 'b4'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5: a comparison against a Bev outside the bucket raises BEVI_VALIDATION'
);

select throws_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b3'), 3::smallint, 0, 2,
                                  jsonb_build_array(pg_temp.cmp('b1', 'b2'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5: a comparison that does not involve the new Bev raises BEVI_VALIDATION'
);

reset role;
select is(
  (select row(
     (select count(*) from public.ranking_events where user_id = '00000000-0000-4000-8000-0000000a1401'),
     (select count(*) from public.rankings      where user_id = '00000000-0000-4000-8000-0000000a1401'),
     (select count(*) from public.comparisons   where user_id = '00000000-0000-4000-8000-0000000a1401'))::text),
  '(2,2,1)',
  'the rejected submits stored nothing: 2 events, 2 rankings, 1 comparison'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1401", "role": "authenticated"}';

-- List [b1, b2]: the search asks b2 (position 1); a tie lands directly below it.
select lives_ok(
  $$ select public.submit_ranking((select id from t_bevs where label = 'b3'), 3::smallint, 2, 2,
                                  jsonb_build_array(pg_temp.cmp('b2', 'b3', true))) $$,
  'Prop. 2.5: a tie against position 1 with index 2 is accepted'
);

-- Re-rank b1. Its row is deleted first, so the list searched is [b2, b3].
select throws_ok(
  $$ select public.rerank_bev((select id from t_bevs where label = 'b1'), 3::smallint, 0, 2,
                              jsonb_build_array(pg_temp.cmp('b3', 'b1'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5 on rerank_bev: EXISTING_BETTER against position 1 with index 0 raises BEVI_VALIDATION'
);

select throws_ok(
  $$ select public.rerank_bev((select id from t_bevs where label = 'b1'), 3::smallint, 2, 2,
                              jsonb_build_array(pg_temp.cmp('b1', 'b4'))) $$,
  '22023',
  'BEVI_VALIDATION',
  'Prop. 2.5 on rerank_bev: a comparison against a Bev outside the bucket raises BEVI_VALIDATION'
);

reset role;
select is(
  (select row(r.position,
              (select count(*) from public.ranking_events
                where user_id = '00000000-0000-4000-8000-0000000a1401'))::text
     from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000a1401'
      and r.bev_id = (select id from t_bevs where label = 'b1')),
  '(0,3)',
  'the rejected re-ranks changed nothing: b1 still at position 0, still 3 events'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1401", "role": "authenticated"}';

-- [b2, b3]: the search asks b3 (position 1), b3 better -> index 2.
select lives_ok(
  $$ select public.rerank_bev((select id from t_bevs where label = 'b1'), 3::smallint, 2, 2,
                              jsonb_build_array(pg_temp.cmp('b3', 'b1'))) $$,
  'Prop. 2.5 on rerank_bev: EXISTING_BETTER against position 1 with index 2 is accepted'
);

reset role;
select is(
  (select array_agg(e.kind order by e.id) from public.ranking_events e
    where e.user_id = '00000000-0000-4000-8000-0000000a1401'
      and e.bev_id = (select id from t_bevs where label = 'b1')),
  array['submit', 'rerank'],
  'rerank_bev writes one rerank event, and the original submit event stays'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1401", "role": "authenticated"}';
select public.remove_ranking((select id from t_bevs where label = 'b2'));
reset role;

select is(
  (select count(*)::int from public.ranking_events
    where user_id = '00000000-0000-4000-8000-0000000a1401'),
  4,
  'remove_ranking writes no event (still 4: three submits and a rerank)'
);

select is(
  (select array_agg(e.kind order by e.id) from public.ranking_events e
    where e.user_id = '00000000-0000-4000-8000-0000000a1401'
      and e.bev_id = (select id from t_bevs where label = 'b2')),
  array['submit'],
  'and deletes none: the removed Bev''s submit event is still there'
);

select is(
  (select row(current_days, longest_days, last_ranked_on)::text from public.streaks
    where user_id = '00000000-0000-4000-8000-0000000a1401'),
  row(1, 1, (now() at time zone 'America/Los_Angeles')::date)::text,
  'the RPC path keeps the streak: every event today, so one day'
);

-- ---------------------------------------------------------------------------
-- 3. The vectors' event scenarios on real rows (UTC in the fixture; here the
--    same shape on the last three local days in Los Angeles)
-- ---------------------------------------------------------------------------
-- streakFromTimestamps "events: the 9th's only ranking is re-ranked on the
-- 11th": submit b1 two days ago, submit b2 yesterday, re-rank b1 today. The
-- rows a re-rank leaves: b1 ranked_at today, b2 yesterday.
insert into public.ranking_events (user_id, bev_id, kind, created_at)
values ('00000000-0000-4000-8000-0000000a1402', (select id from t_bevs where label = 'b1'), 'submit',
        pg_temp.local_noon(2, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1402', (select id from t_bevs where label = 'b2'), 'submit',
        pg_temp.local_noon(1, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1402', (select id from t_bevs where label = 'b1'), 'rerank',
        now());
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
values ('00000000-0000-4000-8000-0000000a1402', (select id from t_bevs where label = 'b1'), 3, 0, 8.50, now()),
       ('00000000-0000-4000-8000-0000000a1402', (select id from t_bevs where label = 'b2'), 3, 1, 7.75,
        pg_temp.local_noon(1, 'America/Los_Angeles'));

select is(
  pg_temp.rows_current('00000000-0000-4000-8000-0000000a1402'),
  2,
  're-ranked day: the surviving rows alone give 2 (the old engine''s answer)'
);

select public.touch_streak('00000000-0000-4000-8000-0000000a1402');
select is(
  (select row(current_days, longest_days, last_ranked_on)::text from public.streaks
    where user_id = '00000000-0000-4000-8000-0000000a1402'),
  row(3, 3, (now() at time zone 'America/Los_Angeles')::date)::text,
  'events: the 9th''s only ranking is re-ranked on the 11th, and the 9th still counts (3)'
);

-- streakFromTimestamps "events: the 10th's only ranking is removed on the
-- 11th": submit b1 two days ago, b3 yesterday, b2 today; then b3 is removed
-- through the real RPC.
insert into public.ranking_events (user_id, bev_id, kind, created_at)
values ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b1'), 'submit',
        pg_temp.local_noon(2, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b3'), 'submit',
        pg_temp.local_noon(1, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b2'), 'submit',
        now());
insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
values ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b1'), 3, 0, 9.25,
        pg_temp.local_noon(2, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b3'), 3, 1, 8.50,
        pg_temp.local_noon(1, 'America/Los_Angeles')),
       ('00000000-0000-4000-8000-0000000a1403', (select id from t_bevs where label = 'b2'), 3, 2, 7.75, now());

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000a1403", "role": "authenticated"}';
select public.remove_ranking((select id from t_bevs where label = 'b3'));
reset role;

select is(
  (select count(*)::int from public.ranking_events
    where user_id = '00000000-0000-4000-8000-0000000a1403'),
  3,
  'removed day: remove_ranking left all three events in place'
);

select is(
  pg_temp.rows_current('00000000-0000-4000-8000-0000000a1403'),
  1,
  'removed day: the surviving rows alone give 1 (the old engine''s answer)'
);

select public.touch_streak('00000000-0000-4000-8000-0000000a1403');
select is(
  (select row(current_days, longest_days, last_ranked_on)::text from public.streaks
    where user_id = '00000000-0000-4000-8000-0000000a1403'),
  row(3, 3, (now() at time zone 'America/Los_Angeles')::date)::text,
  'events: the 10th''s only ranking is removed on the 11th; the 10th still counts (3)'
);

-- ---------------------------------------------------------------------------
-- 4. streak.vectors.json (RANKING_VERSION 1.6.0), every day-period case
-- ---------------------------------------------------------------------------
-- localDayKey: (isoTimestamp AT TIME ZONE timeZone)::date = expected.
select is(('2026-10-11T06:59:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-10-10'::date,
          'LA 23:59 PDT stays on the local day');
select is(('2026-10-11T07:00:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-10-11'::date,
          'LA 00:00 PDT starts the next day');
select is(('2026-03-08T07:59:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-03-07'::date,
          'LA 23:59 PST the night clocks spring forward');
select is(('2026-03-09T06:59:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-03-08'::date,
          'LA 23:59 PDT on the 23-hour day');
select is(('2026-11-01T08:30:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-11-01'::date,
          'LA 01:30 PDT before the fall-back repeat');
select is(('2026-11-01T09:30:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-11-01'::date,
          'LA 01:30 PST after the fall-back repeat');
select is(('2026-11-02T07:59:00Z'::timestamptz at time zone 'America/Los_Angeles')::date, '2026-11-01'::date,
          'LA 23:59 PST on the 25-hour day');
select is(('2026-10-10T23:59:59Z'::timestamptz at time zone 'UTC')::date, '2026-10-10'::date,
          'UTC 23:59:59');
select is(('2026-10-11T00:00:00Z'::timestamptz at time zone 'UTC')::date, '2026-10-11'::date,
          'UTC midnight');
select is(('2026-10-10T18:29:00Z'::timestamptz at time zone 'Asia/Kolkata')::date, '2026-10-10'::date,
          'Kolkata 23:59 IST (UTC+05:30)');
select is(('2026-10-10T18:30:00Z'::timestamptz at time zone 'Asia/Kolkata')::date, '2026-10-11'::date,
          'Kolkata 00:00 IST');

-- streakFromTimestamps (period 'day'): (periodKeys, current, longest, lastKey).
select is(
  pg_temp.streak_at(array['2026-03-07T07:30:00Z', '2026-03-08T07:30:00Z', '2026-03-09T06:30:00Z',
                          '2026-03-10T06:30:00Z']::timestamptz[],
                    'America/Los_Angeles', '2026-03-10T06:45:00Z'),
  row(array['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']::date[], 4, 4, '2026-03-09'::date)::text,
  'LA: four nights at 23:30 across the spring-forward change, ranked today');
select is(
  pg_temp.streak_at(array['2026-10-31T19:00:00Z', '2026-11-01T07:30:00Z', '2026-11-02T07:30:00Z']::timestamptz[],
                    'America/Los_Angeles', '2026-11-02T18:00:00Z'),
  row(array['2026-10-31', '2026-11-01']::date[], 2, 2, '2026-11-01'::date)::text,
  'LA: the 25-hour fall-back day, two rankings, alive from yesterday');
select is(
  pg_temp.streak_at(array['2026-10-09T18:00:00Z', '2026-10-11T06:59:00Z', '2026-10-11T07:01:00Z']::timestamptz[],
                    'America/Los_Angeles', '2026-10-11T20:00:00Z'),
  row(array['2026-10-09', '2026-10-10', '2026-10-11']::date[], 3, 3, '2026-10-11'::date)::text,
  'LA: a ranking at 23:59 local keeps the streak, the next one at 00:01 extends it');
select is(
  pg_temp.streak_at(array['2026-10-09T18:00:00Z', '2026-10-11T06:59:00Z', '2026-10-11T07:01:00Z']::timestamptz[],
                    'UTC', '2026-10-11T20:00:00Z'),
  row(array['2026-10-09', '2026-10-11']::date[], 1, 1, '2026-10-11'::date)::text,
  'UTC: the same instants as the previous case');
select is(
  pg_temp.streak_at(array['2026-10-10T08:00:00Z', '2026-10-10T21:00:00Z', '2026-10-11T09:00:00Z']::timestamptz[],
                    'UTC', '2026-10-11T23:00:00Z'),
  row(array['2026-10-10', '2026-10-11']::date[], 2, 2, '2026-10-11'::date)::text,
  'UTC: two rankings in one day count once');
select is(
  pg_temp.streak_at(array['2026-10-08T12:00:00Z', '2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z']::timestamptz[],
                    'UTC', '2026-10-11T12:00:00Z'),
  row(array['2026-10-08', '2026-10-09', '2026-10-10']::date[], 3, 3, '2026-10-10'::date)::text,
  'UTC: alive but not extended yet');
select is(
  pg_temp.streak_at(array['2026-10-01T12:00:00Z', '2026-10-02T12:00:00Z', '2026-10-03T12:00:00Z',
                          '2026-10-09T12:00:00Z']::timestamptz[],
                    'UTC', '2026-10-11T12:00:00Z'),
  row(array['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-09']::date[], 0, 3, '2026-10-09'::date)::text,
  'UTC: broken two days ago, longest kept');
select is(
  pg_temp.streak_at(array['2026-10-10T18:29:00Z', '2026-10-10T18:31:00Z']::timestamptz[],
                    'Asia/Kolkata', '2026-10-11T05:00:00Z'),
  row(array['2026-10-10', '2026-10-11']::date[], 2, 2, '2026-10-11'::date)::text,
  'Kolkata: 23:59 IST and 00:01 IST are two days');
select is(
  pg_temp.streak_at(array['2026-10-11T03:00:00Z']::timestamptz[],
                    'Asia/Kolkata', '2026-10-11T18:29:00Z'),
  row(array['2026-10-11']::date[], 1, 1, '2026-10-11'::date)::text,
  'Kolkata: ranked today only');
select is(
  pg_temp.streak_at(array[]::timestamptz[], 'UTC', '2026-10-11T12:00:00Z'),
  row(array[]::date[], 0, 0, null::date)::text,
  'no rankings');
-- The two cases written as events: timestamps = events.map(at).
select is(
  pg_temp.streak_at(array['2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z', '2026-10-11T09:00:00Z']::timestamptz[],
                    'UTC', '2026-10-11T20:00:00Z'),
  row(array['2026-10-09', '2026-10-10', '2026-10-11']::date[], 3, 3, '2026-10-11'::date)::text,
  'events: the 9th''s only ranking is re-ranked on the 11th, and the 9th still counts (rows alone would give 2)');
select is(
  pg_temp.streak_at(array['2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z', '2026-10-11T12:00:00Z']::timestamptz[],
                    'UTC', '2026-10-11T20:00:00Z'),
  row(array['2026-10-09', '2026-10-10', '2026-10-11']::date[], 3, 3, '2026-10-11'::date)::text,
  'events: the 10th''s only ranking is removed on the 11th; the removal adds nothing and the 10th still counts (rows alone would give 1)');

-- computeStreak (period 'day'): (current, longest, lastKey).
select is(pg_temp.streak_keys(array[]::date[], '2026-10-11'),
          row(0, 0, null::date)::text, 'empty');
select is(pg_temp.streak_keys(array['2026-10-11']::date[], '2026-10-11'),
          row(1, 1, '2026-10-11'::date)::text, 'today only');
select is(pg_temp.streak_keys(array['2026-10-10', '2026-10-11', '2026-10-11']::date[], '2026-10-11'),
          row(2, 2, '2026-10-11'::date)::text, 'duplicates count once');
select is(pg_temp.streak_keys(array['2028-02-28', '2028-02-29', '2028-03-01']::date[], '2028-03-01'),
          row(3, 3, '2028-03-01'::date)::text, 'across a month end and a leap day');
select is(pg_temp.streak_keys(array['2026-09-01', '2026-09-02', '2026-09-03', '2026-10-10', '2026-10-11']::date[],
                              '2026-10-11'),
          row(2, 3, '2026-10-11'::date)::text, 'longest run earlier than the current one');
select is(pg_temp.streak_keys(array['2026-10-11', '2026-10-12']::date[], '2026-10-11'),
          row(1, 1, '2026-10-11'::date)::text, 'keys after today are ignored');

select * from finish();
rollback;
