-- A-14 follow-ups 3.1 and 3.6 (TASKS.md, M-22's SQL list): an append-only
-- ranking-event log that the streak is computed from, and a server-side check
-- of the comparison log against the insert index (paper Prop. 2.5).
--
-- THE BUG (3.1, wrong on prod today). `touch_streak` (20261011000700:57-110)
-- derives the set of ranking days D_u from `rankings.ranked_at`. But that
-- column does not record when a ranking happened, only when the CURRENT row
-- was written:
--   * `rerank_bev` (20261011000700:261-288) deletes the row and re-inserts it,
--     so `ranked_at` becomes now() and the original day disappears;
--   * `remove_ranking` (:352) deletes the row outright;
--   * `feed_events.ranking_id` cascades on the same delete (20261009000700:18),
--     so the feed does not remember the day either.
-- A day whose only ranking was later moved or removed therefore leaves D_u,
-- and `current_days` / `longest_days` can SHRINK. The specification says the
-- opposite (paper section 9 and implnote impl:streak, DEVELOPMENT-MATT.md
-- section 8.14, `constants.streakEvents` in streak.vectors.json): D_u is the set
-- of days with a ranking EVENT; "re-ranks count (the re-rank day joins D_u and
-- the original day stays); removals never break a streak". Since 1.4.0 two
-- `streakFromTimestamps` vectors are written as events precisely so this
-- engine has a target: a re-ranked day (rows alone would give 2, the answer is
-- 3) and a removed day (rows alone would give 1, the answer is 3).
--
-- THE FIX. `public.ranking_events`: one row per successful `submit_ranking`
-- ('submit') and `rerank_bev` ('rerank'), never updated, never deleted by any
-- code path, and `touch_streak` reads it instead of `rankings`. The day maths
-- moves into `streak_from_days(date[], date)`, a pure function, so pgTAP can
-- pin it to every day-period vector without fabricating users and rows (the
-- file `18_ranking_events.test.sql` does exactly that).
--
-- Table design, column by column:
--   * `user_id ... on delete cascade`: deleting an account deletes its history,
--     which is the only delete this table ever sees.
--   * `bev_id ... on delete set null`, NULLABLE on purpose: the streak needs
--     only (user_id, created_at). A Bev row disappearing (admin merge, catalog
--     clean-up) must not erase a day, which `on delete cascade` would.
--     `bev_id` is kept for diagnostics and for any later "what did they rank
--     that day" feature; no formula reads it.
--   * `kind in ('submit','rerank','backfill')`: what wrote the row.
--   * `created_at default now()`: the transaction's start time, which is also
--     what `rankings.ranked_at`, `comparisons.created_at` and
--     `feed_events.created_at` get inside the same RPC call. The backfill's
--     exact-timestamp de-duplication relies on that.
--
-- WHY `remove_ranking` WRITES NOTHING (and is not re-created here). A removal
-- is not a ranking: it must neither add a day nor take one away. Writing
-- nothing achieves both, because the day the removed ranking was made already
-- has its own 'submit'/'rerank' event, which nothing deletes. Its body is the
-- one in 20261011000700 (it never called `touch_streak` either). Not
-- re-creating it also keeps this migration off a function the sibling
-- stats-parity PR may need.
--
-- WHY NO CLIENT POLICY. Nothing on the client reads this table: the streak
-- reaches the app through `streaks` / `get_profile_stats`, and `touch_streak`
-- is a security definer owned by postgres, which bypasses RLS. So RLS is on
-- with no policy at all (precedent: `user_neighbors`, 20261026000300), and the
-- write privileges Supabase's default privileges hand to anon/authenticated are
-- revoked as belt-and-braces (RLS already rejects an insert; TRUNCATE is not
-- subject to RLS at all, though PostgREST never issues it). SELECT is left in
-- place on purpose, as `user_neighbors` leaves it: a signed-in read returns
-- zero rows rather than raising 42501, which is the behaviour pgTAP pins.
--
-- THE BACKFILL. Idempotent (`where not exists` on (user_id, created_at)),
-- kind 'backfill', from four sources, unioned and de-duplicated on
-- (user_id, created_at):
--   1. every `rankings` row, at `ranked_at` (the day of every live ranking,
--      i.e. what `touch_streak` read until now, so nothing is lost);
--   2. every distinct (user_id, submission_id) in `comparisons`, at
--      min(created_at). Comparison rows survive re-ranks and removals (they
--      cascade only on a Bev or profile delete), so this RECOVERS days the old
--      engine had already lost -- but only for submissions that asked at least
--      one question. The first ranking in an empty bucket asks none;
--   3. every `feed_events` row with kind in ('ranked','reranked'), at
--      `created_at` (actor_id is the user). These cascade with the ranking, so
--      they mostly duplicate source 1; they are cheap and cover any row whose
--      ranking_id was ever null;
--   4. the current run each `streaks` row already records: the days
--      last_ranked_on - current_days + 1 .. last_ranked_on (or last_ranked_on
--      alone when current_days = 0), at local noon in the profile's timezone.
--      Each of those days held a ranking when the old engine last ran, so they
--      are real days, and this is the only source that still knows about a
--      question-less ranking that was later moved or removed. Without it, the
--      recompute below (and the user's next ranking) could shrink a streak
--      that is correct today, which is the bug this migration exists to fix.
--      Local noon keeps the synthesised instant on the intended local date
--      whatever the zone's DST state. A past LONGEST run that is no longer the
--      current one cannot be located in time by any source, so `longest_days`
--      can still drop in one corner case: a run that included a question-less
--      ranking later removed or re-ranked. Accepted and recorded here.
-- Not used: `user_actions` rows with action 'submit_ranking'. They would be an
-- exact log of successful submits (assert_rate's insert rolls back with a
-- failed call), but `assert_rate` is granted to `authenticated`
-- (20261011000100:261), so a client can write such rows for itself at will and
-- they cannot be trusted as history.
-- A same-day duplicate is harmless to a streak (a day counts once), so
-- de-duplicating on the exact timestamp is enough. On an empty database (CI's
-- `supabase db reset`, before seed.sql) every source is empty and the insert
-- and the recompute are no-ops.
--
-- THE PROP. 2.5 CHECK (3.6). Paper section 2, Proposition prop:log: every
-- logged comparison agrees with the final index i*. With `new` = p_bev_id, L =
-- the pre-insert bucket list (the caller's `rankings` rows in p_bucket ordered
-- by position, AFTER `rerank_bev` has deleted the Bev's old row, i.e. exactly
-- the list `p_expected_bucket_size` is checked against) and pos(x) the 0-based
-- position of x in L, each element of p_comparisons must satisfy:
--   * exactly one of winnerBevId / loserBevId is `new`, and the other one (the
--     compared Bev) is in L;
--   * tie = true                     -> p_insert_index =  pos(compared) + 1;
--   * winner = new (NEW_BETTER)      -> p_insert_index <= pos(compared);
--   * loser  = new (EXISTING_BETTER) -> p_insert_index >= pos(compared) + 1.
-- Anything else raises BEVI_VALIDATION (sqlstate 22023, detail 'comparisons'),
-- which packages/api maps to ApiError code 'validation' with
-- detail { field: 'comparisons' }. The check runs after BEVI_BAD_INDEX and
-- before the first row is written, so a rejected call stores nothing (the RPC
-- is one transaction in any case, and in `rerank_bev` the earlier delete of
-- the old row rolls back with it).
--
-- Verified before encoding, as a hard gate: the rule was checked against
-- every case of shared/fixtures/placement.vectors.json (RANKING_VERSION 1.6.0)
-- that produces a result -- 23 `placement` and 25 `anchoredPlacement` cases,
-- 153 comparisons, 5 of them ties, 3 of them re-ranks whose list still holds
-- the Bev (filtered out, as `rerank_bev` deletes it first) -- with 0 failures.
-- No existing pgTAP or live test sends a non-empty p_comparisons.
--
-- Why server-side: the log is a record that other features will read (it is
-- the only pairwise evidence the database holds), and until now a client bug
-- (a stale list, an off-by-one in a future placement variant, a hand-rolled
-- caller) could store a log contradicting the stored order without anything
-- noticing. The package proves the property for its own state machine; the
-- server is the only place that sees every writer. The cost is one indexed
-- read of one bucket per call, which `submit_ranking` already does for the
-- size check. A client-visible consequence worth knowing: a stale cached list
-- of the SAME length but different members or order used to be accepted
-- silently and now surfaces as 'validation', not 'conflict'.
--
-- OBJECTS. New: `ranking_events`, `streak_from_days`,
-- `assert_comparison_log`. Re-created with identical signatures:
-- `touch_streak`, `submit_ranking`, `rerank_bev` (bodies copied verbatim from
-- 20261011000700 plus the two additions, each marked "A-14 3.1" / "A-14 3.6").
-- Deliberately NOT touched: `remove_ranking`, and everything the sibling
-- stats-parity PR re-creates in 20261101000300 (`refresh_bev_stats`,
-- `refresh_global_stats`, `bayes_prior`, the feeds, `bev_of_period_at`,
-- `get_explore`, `get_bev_leaderboard`); this file only calls
-- `refresh_bev_stats`, by its unchanged signature.

-- ============================================================================
-- 1. ranking_events
-- ============================================================================
create table public.ranking_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bev_id      uuid references public.bevs(id) on delete set null,
  kind        text not null check (kind in ('submit','rerank','backfill')),
  created_at  timestamptz not null default now()
);

-- touch_streak's only read: one user's events (it aggregates the day keys).
create index ranking_events_user_created_idx on public.ranking_events (user_id, created_at);

comment on table public.ranking_events is
  'A-14 3.1: append-only log of ranking events (submit_ranking, rerank_bev; backfill rows from 20261101000200). Never updated or deleted except by the profile cascade; remove_ranking writes nothing. touch_streak computes the streak from it. No client policy.';

alter table public.ranking_events enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on public.ranking_events from anon, authenticated;

-- ============================================================================
-- 2. streak_from_days -- the day maths of touch_streak, pure
-- ============================================================================
-- packages/ranking/src/streak.ts computeStreak() for period 'day':
--   * days after p_today are ignored ("keys after today are ignored"; with
--     events from now() they cannot occur, so this changes nothing in
--     touch_streak and only pins the vector), and so are null elements;
--   * longest = the longest run of consecutive days;
--   * current = the run ending on the last day, if that day is today or
--     yesterday, else 0 (the same as walking back from today, or from
--     yesterday when today is absent, because no day exceeds today);
--   * last_ranked_on = the latest day on or before today;
--   * no days -> (0, 0, null).
create or replace function public.streak_from_days(p_days date[], p_today date)
returns table (current_days integer, longest_days integer, last_ranked_on date)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_days    date[];
  v_longest integer := 0;
  v_run     integer := 0;
  v_prev    date;
  d         date;
begin
  select array_agg(distinct u.dk order by u.dk)
    into v_days
  from unnest(p_days) as u(dk)
  where u.dk is not null and u.dk <= p_today;

  if v_days is not null then
    foreach d in array v_days loop
      v_run := case when v_prev is not null and d = v_prev + 1 then v_run + 1 else 1 end;
      v_longest := greatest(v_longest, v_run);
      v_prev := d;
    end loop;
  end if;

  -- The loop ends at the latest day, so v_run is the run ending there.
  current_days   := case when v_prev is not null and v_prev >= p_today - 1 then v_run else 0 end;
  longest_days   := v_longest;
  last_ranked_on := v_prev;
  return next;
end;
$$;

comment on function public.streak_from_days(date[], date) is
  'A-14 3.1: computeStreak (streak.ts, period day) over a set of local day keys as of p_today. Pure; pinned to streak.vectors.json by 18_ranking_events.test.sql. Internal.';

alter function public.streak_from_days(date[], date) owner to postgres;
revoke execute on function public.streak_from_days(date[], date) from public, anon, authenticated;

-- ============================================================================
-- 3. touch_streak -- same signature, now reads ranking_events
-- ============================================================================
-- Still a full recompute on every call (20261011000700's reasons stand: cheap
-- at this scale, and a timezone change is correct for free), but of the event
-- days, not the surviving rows' days.
create or replace function public.touch_streak(p_uid uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_today date;
  v_days  date[];
begin
  select timezone into v_tz from public.profiles where id = p_uid;
  if v_tz is null then
    return; -- no profile (shouldn't happen for an authenticated caller)
  end if;
  v_today := (now() at time zone v_tz)::date;

  select array_agg(distinct (e.created_at at time zone v_tz)::date
                   order by (e.created_at at time zone v_tz)::date)
    into v_days
  from public.ranking_events e
  where e.user_id = p_uid;

  insert into public.streaks (user_id, current_days, longest_days, last_ranked_on, updated_at)
  select p_uid, s.current_days, s.longest_days, s.last_ranked_on, now()
  from public.streak_from_days(v_days, v_today) s
  on conflict (user_id) do update
    set current_days   = excluded.current_days,
        longest_days   = excluded.longest_days,
        last_ranked_on = excluded.last_ranked_on,
        updated_at     = now();
end;
$$;

alter function public.touch_streak(uuid) owner to postgres;
revoke execute on function public.touch_streak(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. assert_comparison_log -- Prop. 2.5 (A-14 3.6)
-- ============================================================================
-- One definition for both RPCs. Invoker rights: it only ever runs inside the
-- two definer RPCs (as their owner), and EXECUTE is revoked from clients.
-- Volatile (the default) on purpose: it must read the bucket as the calling
-- RPC has just left it (in rerank_bev, after the delete), and a volatile
-- function takes a fresh snapshot per statement, so there is nothing to argue.
-- The bucket list is numbered with row_number() rather than read from
-- `position`, so the rule holds even if positions were ever sparse.
create or replace function public.assert_comparison_log(
  p_uid          uuid,
  p_bucket       smallint,
  p_bev_id       uuid,
  p_insert_index integer,
  p_comparisons  jsonb
) returns void
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_comparisons, '[]'::jsonb)) as e(elem)
    cross join lateral (
      select (e.elem ->> 'winnerBevId')::uuid                  as winner,
             (e.elem ->> 'loserBevId')::uuid                   as loser,
             coalesce((e.elem ->> 'tie')::boolean, false)      as tie
    ) c
    left join lateral (
      select l.pos
      from (
        select r.bev_id, (row_number() over (order by r.position) - 1)::integer as pos
        from public.rankings r
        where r.user_id = p_uid and r.bucket = p_bucket
      ) l
      where l.bev_id = case when c.winner = p_bev_id then c.loser else c.winner end
    ) m on true
    where coalesce(c.winner = p_bev_id, false) = coalesce(c.loser = p_bev_id, false)
       or m.pos is null
       or not (case
                 when c.tie                then p_insert_index =  m.pos + 1
                 when c.winner = p_bev_id  then p_insert_index <= m.pos
                 else                           p_insert_index >= m.pos + 1
               end)
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'comparisons';
  end if;
end;
$$;

comment on function public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb) is
  'A-14 3.6: raises BEVI_VALIDATION (detail comparisons) unless every comparison agrees with p_insert_index on the caller''s current p_bucket list (paper Prop. 2.5). Called by submit_ranking and rerank_bev before they write. Internal.';

alter function public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb) owner to postgres;
revoke execute on function public.assert_comparison_log(uuid, smallint, uuid, integer, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- 5. submit_ranking / rerank_bev -- same signatures as 20261011000700, bodies
-- copied verbatim plus the check (3.6) and the event (3.1).
-- ============================================================================
create or replace function public.submit_ranking(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null,
  p_photo_path           text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_category_id  text;
  v_is_alcoholic boolean;
  v_count        integer;
  v_row          public.rankings;
  v_submission   uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));
  perform public.assert_rate('submit_ranking', 60, interval '1 hour');

  select b.category_id, c.is_alcoholic
    into v_category_id, v_is_alcoholic
  from public.bevs b
  join public.categories c on c.id = b.category_id
  where b.id = p_bev_id;

  if v_category_id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  if exists (select 1 from public.rankings where user_id = v_uid and bev_id = p_bev_id) then
    raise exception 'BEVI_ALREADY_RANKED' using errcode = '23505';
  end if;

  select count(*) into v_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  -- A-14 3.6: the log must agree with the index, on the list just counted.
  perform public.assert_comparison_log(v_uid, p_bucket, p_bev_id, p_insert_index, p_comparisons);

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, p_note, p_photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, p_bucket);

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(select bev_id from public.rankings where user_id = v_uid and bucket = p_bucket)
  );

  delete from public.want_to_try where user_id = v_uid and bev_id = p_bev_id;
  update public.user_stats
  set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
      updated_at = now()
  where user_id = v_uid;

  perform public.refresh_user_stats(v_uid);

  -- A-14 3.1: the event the streak is computed from; never deleted.
  insert into public.ranking_events (user_id, bev_id, kind)
  values (v_uid, p_bev_id, 'submit');

  perform public.touch_streak(v_uid);

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'ranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_count + 1;
end;
$$;
alter function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) owner to postgres;

create or replace function public.rerank_bev(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.rankings;
  v_new_count  integer;
  v_row        public.rankings;
  v_submission uuid := gen_random_uuid();
  v_note       text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  select count(*) into v_new_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_new_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_new_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  -- A-14 3.6: the log must agree with the index, on the list the Bev was
  -- searched in (its own row is already deleted, as the package filters it).
  perform public.assert_comparison_log(v_uid, p_bucket, p_bev_id, p_insert_index, p_comparisons);

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  v_note := coalesce(p_note, v_old.note);

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, v_note, v_old.photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, v_old.bucket);
  if p_bucket <> v_old.bucket then
    perform public.respace_bucket(v_uid, p_bucket);
  end if;

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(
      select distinct bev_id from public.rankings
      where user_id = v_uid and bucket in (v_old.bucket, p_bucket)
    )
  );

  -- rating_count is unchanged by a rerank, but mean/stddev can shift if
  -- the score did.
  perform public.refresh_user_stats(v_uid);

  -- Re-ranks count towards the streak (packages/ranking's own doc: "Re-ranks
  -- count"). A-14 3.1: the re-rank is its own event; the original submit's
  -- event (and so its day) stays, although the row above was re-inserted.
  insert into public.ranking_events (user_id, bev_id, kind)
  values (v_uid, p_bev_id, 'rerank');

  perform public.touch_streak(v_uid);

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'reranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_new_count + 1;
end;
$$;
alter function public.rerank_bev(uuid, smallint, integer, integer, jsonb, text) owner to postgres;

-- ============================================================================
-- 6. Backfill (see the header for the four sources) and a one-off recompute
-- ============================================================================
insert into public.ranking_events (user_id, bev_id, kind, created_at)
select s.user_id, s.bev_id, 'backfill', s.created_at
from (
  select distinct on (u.user_id, u.created_at) u.user_id, u.bev_id, u.created_at
  from (
    -- 1. live rankings
    select r.user_id, r.bev_id, r.ranked_at as created_at, 1 as src
    from public.rankings r
    union all
    -- 2. one event per comparison submission; survives re-ranks and removals
    select c.user_id, null::uuid, min(c.created_at), 2
    from public.comparisons c
    group by c.user_id, c.submission_id
    union all
    -- 3. ranking feed events
    select f.actor_id, f.bev_id, f.created_at, 3
    from public.feed_events f
    where f.kind in ('ranked', 'reranked')
    union all
    -- 4. the current run the old engine recorded, at local noon
    select st.user_id, null::uuid,
           ((st.last_ranked_on - g.k) + time '12:00') at time zone p.timezone, 4
    from public.streaks st
    join public.profiles p on p.id = st.user_id
    cross join lateral generate_series(0, greatest(st.current_days - 1, 0)) as g(k)
    where st.last_ranked_on is not null
  ) u
  order by u.user_id, u.created_at, u.src
) s
where not exists (
  select 1 from public.ranking_events e
  where e.user_id = s.user_id and e.created_at = s.created_at
);

-- Bring every stored streak in line with the event history now, rather than
-- at each user's next ranking. Same function the RPCs call; idempotent.
select public.touch_streak(x.user_id)
from (select distinct user_id from public.ranking_events) x;
