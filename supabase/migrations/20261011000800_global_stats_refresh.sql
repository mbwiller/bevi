-- global_stats refresh job: populates the Bayesian-prior singleton row and
-- bev_stats.bayes_score, neither of which anything has ever written before
-- this migration.
--
-- Bug being fixed: get_bev_leaderboard() (20261011000300_content_rpcs.sql)
-- already reads `coalesce((select mean_score from public.global_stats
-- limit 1), 0)` as its Bayesian prior `m` at query time -- but with
-- global_stats always empty, that prior has always been 0, which makes
-- every Bev's live bayes_score on the leaderboard degenerate toward
-- sum/(3+n) instead of real shrinkage toward the catalog's actual mean.
-- Separately, mapBevSummary (packages/api/src/mappers.ts) reads
-- bayesScore directly off bev_stats.bayes_score (not computed live) for
-- every BevSummary outside the leaderboard -- search results, Bev detail,
-- starter candidates -- so that column needs to actually be populated too,
-- not just global_stats.
--
-- Scope -- global mean only, not the full per-category design: DEVELOPMENT-
-- ARJUN.md describes a richer prior (global mean, or a category's own mean
-- once that category has >= 30 ratings). Building that correctly needs
-- user_category_stats / category-level aggregation decisions beyond this
-- ticket. This migration deliberately uses the single global mean as the
-- prior for every Bev regardless of category. Follow-up: once category-
-- level aggregation is designed, refresh_global_stats (or a sibling
-- function) should blend in each category's own mean for categories with
-- enough ratings, per DEVELOPMENT-ARJUN.md. Flagging this here so it's a
-- documented follow-up, not a silent omission.

-- ============================================================================
-- 1. refresh_global_stats -- recompute global_stats + bev_stats.bayes_score
-- ============================================================================
create or replace function public.refresh_global_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mean  numeric(5,3);
  v_count integer;
begin
  select avg(score)::numeric(5,3), count(*)
    into v_mean, v_count
  from public.rankings;

  insert into public.global_stats (id, mean_score, rating_count, updated_at)
  values (true, v_mean, v_count, now())
  on conflict (id) do update set
    mean_score   = excluded.mean_score,
    rating_count = excluded.rating_count,
    updated_at   = excluded.updated_at;

  -- `C = 3` matches the literal constant already used inline by
  -- get_bev_leaderboard (20261011000300_content_rpcs.sql) and
  -- packages/ranking/src/constants.ts BAYES_C. Bevs with zero ratings keep
  -- bayes_score = null, same as before this job existed -- bayes_score()
  -- would just return the prior `m` for them, which isn't a meaningful
  -- per-Bev figure to store.
  update public.bev_stats
  set bayes_score = public.bayes_score(sum_score, rating_count, v_mean, 3)::numeric(4,2),
      updated_at  = now()
  where rating_count > 0;
end;
$$;
alter function public.refresh_global_stats() owner to postgres;

-- Stricter than the usual RPC pattern: a full-catalog recompute has no
-- reason to be triggered on demand by any client role, only by the cron
-- job below running as postgres.
revoke execute on function public.refresh_global_stats() from public, anon, authenticated;

-- ============================================================================
-- 2. Schedule it with pg_cron
-- ============================================================================
-- Every 15 minutes is a reasonable cadence at this app's current scale
-- (~20 users): rankings don't change often enough to need near-real-time
-- prior updates, and a full scan of `rankings` + `bev_stats` is cheap at
-- this size. Easy to change later -- just edit the schedule string and
-- re-run `cron.schedule('refresh-global-stats', ...)`.
--
-- Re-apply safety: verified against the pg_cron README and changelog that
-- cron.schedule(job_name, schedule, command) has upserted by job name
-- (update in place, same job_id, no duplicate row) since pg_cron 1.4
-- (pg_cron--1.3--1.4.sql). Supabase's Postgres 17 image bundles pg_cron
-- 1.6.4, well past that version, so calling cron.schedule again here with
-- the same job name is safe if this migration file is ever re-applied and
-- will not create a second, duplicate job. No separate unschedule-first
-- guard is needed.
select cron.schedule(
  'refresh-global-stats',
  '*/15 * * * *',
  $$ select public.refresh_global_stats(); $$
);

-- ============================================================================
-- 3. Bootstrap call -- don't leave global_stats/bayes_score empty/null
--    until the first cron tick
-- ============================================================================
-- On a fresh database there's seed catalog data (380 Bevs,
-- data/catalog/bevs.csv) but no rankings yet, so this will likely just set
-- mean_score to null and touch zero bev_stats rows (rating_count > 0 never
-- matches). That's fine and expected -- the point is global_stats stops
-- being a row that has literally never been written.
select public.refresh_global_stats();
