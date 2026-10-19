-- S-12 + A-11 (20261019000100): Taste Profile data.
--
-- user_category_stats has existed since 20261009000600, but nothing wrote it:
-- refresh_user_stats (20261011000700) only fills user_stats, and affinity_z
-- has no writer. This adds the writer, keeps it fresh, backfills it, and
-- exposes it as get_taste_profile(p_user_id): your average score per category
-- (TASKS.md decision 23), plus the affinity the recommendation engine uses.
--
-- The maths is packages/ranking/src/stats.ts (LaTeX §4.3), stored per
-- (user, category):
--   rating_count, mean_score, stddev_score  the category's own population stats
--   affinity_z = Σ z / (n + K_AFF), K_AFF = 2, where z is each score against
--     the user's OVERALL effective stats (per-category z would make every
--     affinity 0 by construction):
--       n_user >= MIN_N_USER (3): the user's own mean and stddev_pop,
--                                 stddev floored at SIGMA_FLOOR (1.0);
--       otherwise:                the global mean and stddev_pop over every
--                                 stored score, live, as get_prediction_snapshot
--                                 computes them, stddev floored at 1.0;
--       no rankings at all:       GLOBAL_FALLBACK (5.0, 2.5).
-- The constants are inlined from packages/ranking/src/constants.ts; a change
-- there needs a new migration here.
--
-- Freshness: submit_ranking, rerank_bev and remove_ranking (latest in
-- 20261011000700) all call refresh_user_stats(v_uid) after their write, so
-- refresh_user_stats is re-created below with its body unchanged plus one
-- call. Those three RPCs are not touched. A user below MIN_N_USER is scored
-- against the live global stats, which move when anyone else ranks, so a
-- nightly job refreshes everyone too (there is no refresh_all_stats to join;
-- it is its own pg_cron job).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. refresh_user_category_stats(p_uid): recompute one user's rows.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_user_category_stats(p_uid uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n        integer;
  v_mean     numeric;
  v_sd       numeric;
  v_eff_mean numeric;
  v_eff_sd   numeric;
begin
  select count(*), avg(score), stddev_pop(score)
    into v_n, v_mean, v_sd
    from public.rankings
   where user_id = p_uid;

  if v_n >= 3 then                                   -- MIN_N_USER
    v_eff_mean := v_mean;
    v_eff_sd   := greatest(v_sd, 1.0);               -- SIGMA_FLOOR
  else
    select avg(score), stddev_pop(score)
      into v_eff_mean, v_eff_sd
      from public.rankings;
    if v_eff_mean is null then                       -- no rankings anywhere
      v_eff_mean := 5.0;                             -- GLOBAL_FALLBACK.mean
      v_eff_sd   := 2.5;                             -- max(GLOBAL_FALLBACK.stddev, SIGMA_FLOOR)
    else
      v_eff_sd   := greatest(v_eff_sd, 1.0);
    end if;
  end if;

  delete from public.user_category_stats where user_id = p_uid;

  insert into public.user_category_stats
    (user_id, category_id, rating_count, mean_score, stddev_score, affinity_z, updated_at)
  select p_uid,
         b.category_id,
         count(*)::int,
         avg(r.score),
         stddev_pop(r.score),
         sum((r.score - v_eff_mean) / v_eff_sd) / (count(*) + 2),   -- K_AFF
         now()
    from public.rankings r
    join public.bevs b on b.id = r.bev_id
   where r.user_id = p_uid
   group by b.category_id;
end;
$$;

alter function public.refresh_user_category_stats(uuid) owner to postgres;
revoke execute on function public.refresh_user_category_stats(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. refresh_user_stats: 20261011000700's body, unchanged, plus the category
--    refresh. Same signature, return type, language, security and
--    search_path, so the three ranking RPCs that call it are untouched.
-- ---------------------------------------------------------------------------
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

  perform public.refresh_user_category_stats(p_uid);
end;
$$;

revoke execute on function public.refresh_user_stats(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Everyone, nightly, and once now as the backfill.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_all_user_category_stats() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  for v_uid in select id from public.profiles loop
    perform public.refresh_user_category_stats(v_uid);
  end loop;
end;
$$;

alter function public.refresh_all_user_category_stats() owner to postgres;
revoke execute on function public.refresh_all_user_category_stats() from public, anon, authenticated;

-- cron.schedule upserts by job name (pg_cron >= 1.4; see 20261011000800), so
-- re-applying this is safe. 04:20 UTC is overnight in New York.
select cron.schedule(
  'refresh-user-category-stats',
  '20 4 * * *',
  $$ select public.refresh_all_user_category_stats(); $$
);

select public.refresh_all_user_category_stats();

-- ---------------------------------------------------------------------------
-- 4. get_taste_profile(p_user_id): any signed-in caller, any user.
-- ---------------------------------------------------------------------------
-- Means are not sensitive (birth dates stay private). Alcoholic categories are
-- left out when the CALLER is under 21, and for an owner under 21 (who cannot
-- rank alcohol in the first place, so that only hides bad data). Highest mean
-- first; ties by the category's sort order.
create or replace function public.get_taste_profile(p_user_id uuid)
returns table (
  category_id   text,
  rating_count  integer,
  mean_score    numeric,
  affinity_z    numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_owner_adult boolean;
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(pr.birth_date <= (current_date - interval '21 years')::date, false)
    into v_owner_adult
    from public.profiles pr
   where pr.id = p_user_id;
  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select s.category_id, s.rating_count, s.mean_score, s.affinity_z
      from public.user_category_stats s
      join public.categories c on c.id = s.category_id
     where s.user_id = p_user_id
       and s.rating_count > 0
       and (not c.is_alcoholic or (public.viewer_is_adult() and v_owner_adult))
     order by s.mean_score desc, c.sort_order, c.id;
end;
$$;

alter function public.get_taste_profile(uuid) owner to postgres;

revoke execute on function public.get_taste_profile(uuid) from public, anon;
grant execute on function public.get_taste_profile(uuid) to authenticated;
