-- Rank on Bevi and streaks that stay true over time.
--
-- Before this:
--   * stats.getMine/getUser read profiles.bevi_rank, which nothing writes,
--     so every profile said "Unranked" (rankPoints 0) while the People
--     leaderboard computed ranks live: the two disagreed.
--   * streaks.current_days is only recomputed when the user ranks
--     (touch_streak), so a lapsed streak kept showing (and kept earning
--     3 points a day on the leaderboard) until the next ranking.
--   * get_user_leaderboard reported every user's can_see_alcohol, i.e.
--     whether they are over 21.
--
-- Now:
--   * effective_streak() applies touch_streak's own rule at read time: the
--     streak is alive only if the last ranking day is today or yesterday in
--     the user's timezone, else 0.
--   * user_rank_points() is the one place the points formula lives
--     (rank.ts: 1*bevsRanked + 3*currentStreak + 2*bevsCreated, competition
--     ranking, users with no rankings unranked), with the effective streak.
--   * get_user_leaderboard reads it (same columns as 20261011000700) and
--     reports can_see_alcohol only for the caller.
--   * get_profile_stats(user) returns everything ProfileStats needs in one
--     call, with rank and points from the same helper.

set search_path = public, extensions;

create or replace function public.effective_streak(p_current integer, p_last_ranked_on date, p_timezone text)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when p_last_ranked_on is not null
     and p_last_ranked_on >= (now() at time zone coalesce(p_timezone, 'UTC'))::date - 1
    then coalesce(p_current, 0)
    else 0
  end;
$$;

grant execute on function public.effective_streak(integer, date, text) to authenticated;

-- Internal: every ranked user's points and rank. Not callable by clients
-- (it lists every user); the two RPCs below expose what they need.
create or replace function public.user_rank_points()
returns table (user_id uuid, bevs_ranked integer, current_streak integer, bevs_created integer, points integer, bevi_rank integer)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with u as (
    select
      p.id,
      coalesce(us.rating_count, 0) as bevs_ranked,
      public.effective_streak(st.current_days, st.last_ranked_on, p.timezone) as current_streak,
      -- rank.ts: "bevsCreated counts only Bevs ranked by another user".
      (
        select count(distinct b.id)::integer
        from public.bevs b
        where b.created_by = p.id
          and exists (select 1 from public.rankings r2 where r2.bev_id = b.id and r2.user_id <> p.id)
      ) as bevs_created
    from public.profiles p
    left join public.user_stats us on us.user_id = p.id
    left join public.streaks st on st.user_id = p.id
  ),
  scored as (
    select *, (bevs_ranked * 1 + current_streak * 3 + bevs_created * 2) as points
    from u
    where bevs_ranked > 0
  )
  select id, bevs_ranked, current_streak, bevs_created, points,
         rank() over (order by points desc)::integer
  from scored;
$$;

revoke execute on function public.user_rank_points() from public, anon, authenticated;

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
  select
    p.id, p.handle, p.display_name, p.avatar_path, p.timezone, p.created_at, p.onboarded,
    case
      when p.id = auth.uid() then coalesce(p.birth_date <= (current_date - interval '21 years')::date, false)
      else false
    end,
    rp.points,
    rp.bevi_rank,
    rp.bevs_ranked,
    coalesce(us.want_count, 0),
    coalesce(us.follower_count, 0),
    coalesce(us.following_count, 0),
    rp.current_streak,
    coalesce(st.longest_days, 0)
  from public.user_rank_points() rp
  join public.profiles p on p.id = rp.user_id
  left join public.user_stats us on us.user_id = p.id
  left join public.streaks st on st.user_id = p.id
  -- Display order breaks points ties the same way rank.ts's rankUsers does.
  order by rp.points desc, rp.bevs_ranked desc, p.created_at asc, p.id asc
  limit p_limit;
$$;

revoke execute on function public.get_user_leaderboard(int) from public, anon;
grant execute on function public.get_user_leaderboard(int) to authenticated;

create or replace function public.get_profile_stats(p_user_id uuid)
returns table (
  followers           integer,
  following           integer,
  bevd_count          integer,
  want_count          integer,
  rank_on_bevi        integer,
  rank_points         integer,
  current_streak      integer,
  longest_streak      integer,
  streak_alive_today  boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  select timezone into v_tz from public.profiles where id = p_user_id;
  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(us.follower_count, 0),
    coalesce(us.following_count, 0),
    coalesce(us.rating_count, 0),
    coalesce(us.want_count, 0),
    rp.bevi_rank,
    coalesce(rp.points, 0),
    public.effective_streak(st.current_days, st.last_ranked_on, v_tz),
    coalesce(st.longest_days, 0),
    coalesce(st.last_ranked_on = (now() at time zone v_tz)::date, false)
  from (select p_user_id as id) me
  left join public.user_stats us on us.user_id = me.id
  left join public.streaks st on st.user_id = me.id
  left join public.user_rank_points() rp on rp.user_id = me.id;
end;
$$;

revoke execute on function public.get_profile_stats(uuid) from public, anon;
grant execute on function public.get_profile_stats(uuid) to authenticated;
