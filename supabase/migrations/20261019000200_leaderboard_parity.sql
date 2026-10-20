-- A-14: SQL <-> TypeScript parity for the Bev leaderboard.
--
-- `get_bev_leaderboard` (20261011000300_content_rpcs.sql) diverges from
-- packages/ranking/src/bayesian.ts in three ways. All three are fixed here;
-- nothing else about the function changes.
--
-- 1. THE PRIOR IS ALWAYS GLOBAL. The SQL passes the single global mean as `m`
--    for every call, including a per-category board. `categoryPrior()` uses
--    the category's own mean once that category has BAYES_CATEGORY_PRIOR_MIN
--    (30) rankings, and only falls back to the global mean below that. This
--    was a documented follow-up in 20261011000800_global_stats_refresh.sql,
--    deferred there because it needed category-level aggregation.
--
-- 2. THE EMPTY-SYSTEM FALLBACK IS WRONG. The SQL reads
--    `coalesce((select mean_score from global_stats limit 1), 0)`, so a system
--    with no rankings at all gets a prior of 0. `globalPrior()` falls back to
--    GLOBAL_FALLBACK.mean = 5.0. A prior of 0 drags every early Bev's
--    leaderboard figure toward zero, which is exactly the shrinkage the
--    Bayesian average exists to avoid.
--
-- 3. THE ORDER IS NOT TOTAL. The SQL orders by `bayes desc` alone.
--    `leaderboardOrder()` specifies `bayes desc, n desc, name asc (code
--    points), bevId asc`. Without the tail, ties come back in whatever order
--    the planner produces, which also makes the keyset pagination that
--    20261011000400_contract_v1_rpc_fixes.sql left for later unimplementable.
--
-- The third divergence A-14 lists, `affinity_z` having no writer, was closed
-- by A-11 (20261019000100_taste_profile.sql). Nothing here touches it.
--
-- WHAT THIS DOES NOT CLOSE, so the header is not read as a wider claim than it
-- is. Both are A-14 follow-ups on the board:
--
--   * Divergence 2 is closed FOR THE LEADERBOARD ONLY. The same
--     `coalesce((select mean_score from global_stats limit 1), 0)` is still
--     live in get_feed (20261014000300:244), get_user_feed (20261018000300:75)
--     and bev_of_period_at (20261018000100:55), whose package twin is also
--     globalPrior() (FakeApi toSummary, and bev of period). All three could
--     call public.bayes_prior(null) — each runs inside a definer owned by
--     postgres, so the revoke is not in the way — but they are the live feed's
--     hot path and changing the figure they display is not what A-14 asked
--     for. Until then an empty system shrinks the leaderboard toward 5.0 and
--     the feed card toward 0. It needs global_stats.rating_count = 0 to be
--     observable at all, so prod never sees it.
--   * The two branches below do not have the same freshness or precision. The
--     category branch is live off `rankings` and exact; the global branch
--     reads global_stats.mean_score, which is numeric(5,3) written by a
--     15-minute cron (20261011000800). globalPrior() returns an exact mean, so
--     bayes_prior(null) is its twin only to 3 decimals and only just after the
--     cron. Making the global branch live would put a full scan of `rankings`
--     on every leaderboard call; the better fix is to materialise category
--     means in refresh_global_stats, which also removes the per-call aggregate
--     below. Deferred deliberately, as a follow-up.
--
-- Deliberately NOT changed:
--   * `bev_stats.bayes_score`, written by refresh_global_stats. That column is
--     one number per Bev, read by mapBevSummary for every BevSummary outside
--     the leaderboard, so the global prior is the right prior for it. Only a
--     per-category board gets the category prior, which is what the package
--     says and why the two figures can differ for the same Bev.
--   * `bev_of_period_at` (20261018000100), which computes its own prior from
--     global_stats and already has a total tie-break. A day's or a week's
--     board is not a category board.
--
-- Constants mirror packages/ranking/src/constants.ts:
--   BAYES_C = 3, BAYES_CATEGORY_PRIOR_MIN = 30, GLOBAL_FALLBACK.mean = 5.0,
--   MIN_RATERS = 2. They stay literals here, as the rest of the schema does,
--   until a `ranking_constants` table exists.

set search_path = public, extensions;

-- ============================================================================
-- 1. bayes_prior -- SQL twin of globalPrior() / categoryPrior()
-- ============================================================================
-- Returns the prior mean `m` for a board. With p_category_id null, or a
-- category below BAYES_CATEGORY_PRIOR_MIN rankings, that is the global mean;
-- at or above it, the category's own mean.
--
-- The category mean counts every ranking on a Bev in that category, matching
-- `byCategoryMean` in get_prediction_snapshot (20261012000600), which joins
-- rankings to bevs without filtering on status. A Bev that was hidden or
-- merged after people ranked it still happened, and the prior is a statement
-- about the category's taste, not about what is currently on the shelf.
--
-- Internal: no client role needs it, and the revoke below says so.
--
-- Invoker on purpose, as bev_of_period_at (20261018000100) is and for the same
-- reason: its only caller, get_bev_leaderboard(), is a definer owned by
-- postgres, so this already runs as postgres there. A grant added to it by
-- mistake later cannot then hand a client the mean score of an age-gated
-- category with RLS bypassed; it would read through rankings_select instead.
create or replace function public.bayes_prior(p_category_id text default null)
returns numeric
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with g as (
    select mean_score, rating_count from public.global_stats limit 1
  ),
  c as (
    select avg(r.score) as mean_score, count(*) as n
      from public.rankings r
      join public.bevs b on b.id = r.bev_id
     where p_category_id is not null
       and b.category_id = p_category_id
  )
  select case
           when coalesce((select n from c), 0) >= 30
             then (select mean_score from c)
           when coalesce((select rating_count from g), 0) > 0
             then coalesce((select mean_score from g), 5.0)
           else 5.0
         end::numeric;
$$;

-- `from public` strips the implicit grant every new function gets; anon and
-- authenticated are named separately because Supabase's default privileges
-- grant to them explicitly, which a revoke from PUBLIC would not touch.
-- service_role keeps it, as every other internal helper here does.
revoke execute on function public.bayes_prior(text) from public, anon, authenticated;

-- ============================================================================
-- 2. get_bev_leaderboard -- the prior above, and the package's total order
-- ============================================================================
-- Signature, return columns, eligibility (rating_count >= 2 = MIN_RATERS) and
-- the age gate are unchanged from 20261011000300_content_rpcs.sql.
create or replace function public.get_bev_leaderboard(p_category_id text default null, p_limit int default 50)
returns table (
  id            uuid,
  name          text,
  brand         text,
  flavor        text,
  category_id   text,
  photo_path    text,
  thumb_path    text,
  price_tier    smallint,
  rating_count  integer,
  avg_score     numeric(4,2),
  bayes_score   numeric
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  -- `materialized` is load-bearing. Without it the CTE is inlined, then pulled
  -- up into the cross join, and bayes_prior() — which cannot itself be inlined
  -- (it has a CTE and a SET clause) and is stable rather than immutable, so it
  -- is never folded to a constant — ends up evaluated once per candidate row
  -- instead of once per call. The old code was safe by accident, because a
  -- scalar sub-SELECT becomes an InitPlan.
  with prior as materialized (select public.bayes_prior(p_category_id) as m)
  select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
         b.price_tier, s.rating_count, s.avg_score,
         public.bayes_score(s.sum_score, s.rating_count, p.m, 3)::numeric
    from public.bevs b
    join public.bev_stats s on s.bev_id = b.id
    join public.categories c on c.id = b.category_id
   cross join prior p
   where b.status = 'active'
     and s.rating_count >= 2
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
   -- leaderboardOrder(): bayes desc, n desc, name asc, bevId asc. `collate "C"`
   -- is the code-point order compareCodePoints() uses, so JS and Postgres
   -- break a name tie the same way.
   order by public.bayes_score(s.sum_score, s.rating_count, p.m, 3) desc,
            s.rating_count desc,
            b.name collate "C" asc,
            b.id asc
   limit p_limit;
$$;

-- `create or replace` keeps the owner and the ACL 20261011000300 set. Both are
-- re-stated anyway: a definer that is ever dropped and recreated by a different
-- role would silently change whose rights its body runs with.
alter function public.get_bev_leaderboard(text, int) owner to postgres;
revoke execute on function public.get_bev_leaderboard(text, int) from public, anon;
grant execute on function public.get_bev_leaderboard(text, int) to authenticated;
