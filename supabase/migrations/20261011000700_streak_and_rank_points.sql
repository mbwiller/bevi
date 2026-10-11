-- Wires #37's packages/ranking streak/rank-points formulas (RANKING_VERSION
-- 1.1.0) into SQL: a touch_streak RPC matching streak.vectors.json, called
-- from submit_ranking/rerank_bev (never remove_ranking -- removals must
-- never break a streak, per packages/ranking/src/streak.ts's own comment
-- and DEVELOPMENT-ARJUN.md §5.10), and the real points formula in
-- get_user_leaderboard (rank.ts: points = bevsRanked + 3*currentStreak +
-- 2*bevsCreated, unranked users excluded, competition ranking).
--
-- Decided (2026-10-11, confirmed against PR #37's review): exploration
-- slot positions 4/9/14 (packages/ranking's formula, not the doc's 4/9/15)
-- and bevsRanked = 0 users are excluded from the user leaderboard.
--
-- Also fixes a gap this PR's own live test caught: submit_ranking never
-- updated user_stats.rating_count/mean_score/stddev_score at all, so
-- ProfileStats.bevdCount stayed 0 forever. Added refresh_user_stats,
-- mirroring the existing refresh_bev_stats pattern, called from
-- submit_ranking, rerank_bev and remove_ranking (unlike the streak, a
-- removal must decrease rating_count -- nothing says otherwise).

-- ============================================================================
-- 0. refresh_user_stats -- recompute from rankings, not incremented, same
-- "recomputed, not maintained incrementally" pattern as refresh_bev_stats.
-- ============================================================================
create or replace function public.refresh_user_stats(p_uid uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_stats
     set rating_count = (select count(*) from public.rankings where user_id = p_uid),
         mean_score   = (select avg(score) from public.rankings where user_id = p_uid),
         stddev_score = (select stddev_pop(score) from public.rankings where user_id = p_uid),
         updated_at   = now()
   where user_id = p_uid;
end;
$$;

revoke execute on function public.refresh_user_stats(uuid) from public, anon, authenticated;

-- ============================================================================
-- 1. touch_streak -- full recompute from rankings.ranked_at, not an
-- incremental counter. Recomputing from the raw history on every call is
-- cheap at this app's scale and is what makes a profile timezone change
-- correct for free (DEVELOPMENT-ARJUN.md's "a timezone change recomputes
-- the streak" requirement) -- the next touch_streak call just re-derives
-- local day keys under whatever timezone is current now, with no stored
-- incremental state to go stale.
--
-- Mirrors packages/ranking/src/streak.ts computeStreak() for period='day':
-- longest = longest run of consecutive calendar days with >= 1 ranking;
-- current = the run ending on today's local date, but only if that run
-- actually reaches today or yesterday (local time in profile.timezone),
-- else 0. Verified against streak.vectors.json's streakFromTimestamps
-- cases (not run automatically here -- no pgTAP vector test exists yet).
-- ============================================================================
create or replace function public.touch_streak(p_uid uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_today   date;
  v_days    date[];
  v_longest integer := 0;
  v_run     integer := 0;
  v_prev    date;
  v_last    date;
  v_current integer := 0;
  d         date;
begin
  select timezone into v_tz from public.profiles where id = p_uid;
  if v_tz is null then
    return; -- no profile (shouldn't happen for an authenticated caller)
  end if;
  v_today := (now() at time zone v_tz)::date;

  select array_agg(distinct (ranked_at at time zone v_tz)::date order by (ranked_at at time zone v_tz)::date)
    into v_days
  from public.rankings
  where user_id = p_uid;

  if v_days is null then
    insert into public.streaks (user_id, current_days, longest_days, last_ranked_on, updated_at)
    values (p_uid, 0, 0, null, now())
    on conflict (user_id) do update
      set current_days = 0, longest_days = 0, last_ranked_on = null, updated_at = now();
    return;
  end if;

  foreach d in array v_days loop
    v_run := case when v_prev is not null and d = v_prev + 1 then v_run + 1 else 1 end;
    v_longest := greatest(v_longest, v_run);
    v_prev := d;
  end loop;
  -- The loop ends at the latest day in v_days, so v_run is already the
  -- length of the run ending there.
  v_last := v_days[array_length(v_days, 1)];
  v_current := case when v_last >= v_today - 1 then v_run else 0 end;

  insert into public.streaks (user_id, current_days, longest_days, last_ranked_on, updated_at)
  values (p_uid, v_current, v_longest, v_last, now())
  on conflict (user_id) do update
    set current_days = excluded.current_days,
        longest_days = excluded.longest_days,
        last_ranked_on = excluded.last_ranked_on,
        updated_at = now();
end;
$$;

-- Internal-only (called from other security-definer functions below, which
-- run as their owner and need no grant of their own); never exposed to a
-- client directly, same as respace_bucket/refresh_bev_stats.
revoke execute on function public.touch_streak(uuid) from public, anon, authenticated;

-- ============================================================================
-- 2. submit_ranking / rerank_bev: call touch_streak. Same signatures as
-- 20261011000400_contract_v1_rpc_fixes.sql -- body-only change via create
-- or replace, no drop needed. remove_ranking is untouched on purpose.
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
  -- count"); the new row's ranked_at defaults to now(), so today is what
  -- touch_streak sees either way.
  perform public.touch_streak(v_uid);

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'reranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_new_count + 1;
end;
$$;
alter function public.rerank_bev(uuid, smallint, integer, integer, jsonb, text) owner to postgres;

-- remove_ranking: never touches the streak, on purpose, but it must still
-- refresh user_stats -- bevdCount has to drop when a ranking is removed.
-- Same body as 20261011000200_ranking_rpcs.sql, just the one added call.
create or replace function public.remove_ranking(p_bev_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     public.rankings;
  v_bev_ids uuid[];
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
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

  perform public.respace_bucket(v_uid, v_old.bucket);

  select coalesce(array_agg(bev_id), array[]::uuid[]) into v_bev_ids
  from public.rankings
  where user_id = v_uid and bucket = v_old.bucket;

  -- Refresh every Bev still in the bucket (respacing just changed their scores)
  -- plus the removed Bev itself (its stats must drop by this one rating).
  perform public.refresh_bev_stats(v_bev_ids || v_old.bev_id);

  perform public.refresh_user_stats(v_uid);
end;
$$;
alter function public.remove_ranking(uuid) owner to postgres;

-- ============================================================================
-- 3. get_user_leaderboard: the real points formula (rank.ts), competition
-- ranking, and bevsRanked = 0 excluded (decided per #37's review).
-- Superseded here rather than at 20261011000600 since that migration is
-- already merged -- drop first, the output column set is changing again.
-- ============================================================================
drop function if exists public.get_user_leaderboard(int);

create or replace function public.get_user_leaderboard(p_limit int default 50)
returns table (
  user_id              uuid,
  handle               text,
  display_name         text,
  avatar_path          text,
  timezone             text,
  created_at           timestamptz,
  onboarded            boolean,
  can_see_alcohol      boolean,
  points               integer,
  bevi_rank            integer,
  rating_count         integer,
  want_count           integer,
  follower_count       integer,
  following_count      integer,
  current_streak_days  integer,
  longest_streak_days  integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with u as (
    select
      p.id, p.handle, p.display_name, p.avatar_path, p.timezone, p.created_at, p.onboarded,
      coalesce(p.birth_date <= (current_date - interval '21 years')::date, false) as can_see_alcohol,
      coalesce(us.rating_count, 0)    as bevs_ranked,
      coalesce(us.want_count, 0)      as want_count,
      coalesce(us.follower_count, 0)  as follower_count,
      coalesce(us.following_count, 0) as following_count,
      coalesce(st.current_days, 0)    as current_streak,
      coalesce(st.longest_days, 0)    as longest_streak_days,
      -- rank.ts: "bevsCreated counts only Bevs ranked by another user".
      (
        select count(distinct b.id)
        from public.bevs b
        where b.created_by = p.id
          and exists (select 1 from public.rankings r2 where r2.bev_id = b.id and r2.user_id <> p.id)
      ) as bevs_created
    from public.profiles p
    left join public.user_stats us on us.user_id = p.id
    left join public.streaks st on st.user_id = p.id
  ),
  -- rank.ts RANK_POINTS_WEIGHTS: 1*bevsRanked + 3*currentStreak + 2*bevsCreated.
  scored as (
    select *, (bevs_ranked * 1 + current_streak * 3 + bevs_created * 2) as points
    from u
    where bevs_ranked > 0 -- "Unranked" users don't count toward anyone's rank.
  )
  select
    id, handle, display_name, avatar_path, timezone, created_at, onboarded, can_see_alcohol,
    points,
    rank() over (order by points desc)::integer as bevi_rank,
    bevs_ranked, want_count, follower_count, following_count,
    current_streak, longest_streak_days
  from scored
  -- Display order breaks points ties the same way rank.ts's rankUsers does;
  -- rank() above only needs the points ordering to compute the rank value.
  order by points desc, bevs_ranked desc, created_at asc, id asc
  limit p_limit;
$$;

revoke execute on function public.get_user_leaderboard(int) from public, anon;
grant execute on function public.get_user_leaderboard(int) to authenticated;
