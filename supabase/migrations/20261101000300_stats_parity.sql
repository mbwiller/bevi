-- A-14 follow-ups, the read/stats-path half (TASKS.md §3, M-22 item 3).
--
-- Four of the eight items on the board are closed here, plus a helper for the
-- vector tests (3.7) and, outside this file, the contract doc line (3.8,
-- shared/src/types.ts). The streak history (3.1) is be/ranking-events
-- (20261101000200); the comparison-log check (3.6) is not in this PR.
--
-- 3.2  BEV_STATS.BAYES_SCORE GOES STALE AT RATING_COUNT = 0.  Wrong on prod today.
--      Bug: refresh_global_stats (20261011000800:58-61) updated only rows with
--      rating_count > 0, and refresh_bev_stats (20261011000200:114-156) never
--      touched the column. A Bev whose last ranking was removed (remove_ranking,
--      or delete_my_account cascading a user's rankings away) kept its old
--      figure until someone ranked it again, and mapBevSummary passes the column
--      straight through to get_bev, search, starter candidates and the
--      prediction snapshot. The same gap ran the other way: a Bev's first
--      ranking left the column null until the next cron tick, and every later
--      ranking left it up to 15 minutes behind its own rating_count.
--      Fix: refresh_bev_stats writes bayes_score itself -- null when
--      rating_count = 0, else the stored rule below with m = bayes_prior(null)
--      -- so the column is right the moment a submit, re-rank or removal
--      commits. refresh_global_stats rewrites EVERY row with a `case`, so the
--      rows already stale on prod are nulled by the bootstrap call at the end of
--      this file, not one by one as each Bev is next ranked.
--
-- 3.3  THE 0 PRIOR OUTSIDE THE LEADERBOARD.  Latent.
--      Bug: get_feed (20261014000300:244), get_user_feed (20261018000300:75),
--      bev_of_period_at (20261018000100:56) and get_explore (20261019000400:245)
--      read `coalesce((select mean_score from global_stats limit 1), 0)`. With
--      global_stats.rating_count = 0 a single 8.00 showed as (3*0 + 8)/4 = 2.00,
--      where globalPrior() gives (3*5 + 8)/4 = 5.75 and the leaderboard already
--      did (20261019000200). Fix: all four read public.bayes_prior(null), once
--      per call (see get_bev_leaderboard's comment for why that needs a
--      MATERIALIZED CTE rather than a call in the select list). Prod has had a
--      non-empty global_stats since its first cron tick, so no prod figure moves
--      because of this item.
--
-- 3.4  BAYES_PRIOR'S TWO BRANCHES DIFFERED IN FRESHNESS AND PRECISION.  Cosmetic.
--      Bug: the global branch read global_stats.mean_score (numeric(5,3), written
--      by the 15-minute cron); the category branch aggregated `rankings ⋈ bevs`
--      live on every call, exact to 16+ digits, through a join no index serves
--      (bevs_category_idx is partial on status = 'active', and the prior
--      deliberately does not filter status). Fix: a new table,
--      public.category_stats, written by refresh_global_stats in the same
--      transaction as global_stats, and the category branch reads it. Both
--      branches are now 3 dp and refreshed together -- which is what
--      bayesStoredRule's "m with at most 3 dp" already assumes -- and the
--      per-call aggregate is gone: a category board's prior is now one
--      primary-key lookup.
--
-- 3.5  UNROUNDED NUMERIC ON THE LIVE SURFACES.  Cosmetic.
--      Bug: get_bev_leaderboard, get_feed, get_user_feed and get_explore
--      returned the raw quotient (6.4166666666666667) while bev_stats.bayes_score
--      and bev_of_period_at returned numeric(4,2), and the FakeApi rounds to
--      2 dp, so fake and real disagreed in the digits and one Bev could show two
--      numbers. The rule (decided): every live Bayesian figure is rounded to
--      2 dp AT THE RPC BOUNDARY with round(x, 2), which rounds half away from
--      zero exactly as the numeric(4,2) store does, and every declared return
--      type stays as it was (a `numeric` column stays `numeric`), so nothing
--      needs a drop function and no client sees a shape change. On the global
--      prior a live figure now equals bev_stats.bayes_score exactly: same
--      inputs, same rounding, and global_stats only changes inside
--      refresh_global_stats, which rewrites every stored figure in the same
--      transaction.
--      The leaderboard still ORDERS by the unrounded value. leaderboardOrder()
--      sorts on the exact bayes: two Bevs at 5.8108 and 5.8088 both print 5.81,
--      and ordering on the printed figure would hand that pair to the n / name
--      tie-break and disagree with the package. Rounding is display, not order.
--      bev_of_period_at likewise still picks its winner on the unrounded value.
--
-- 3.7 (support). rank_points(int, int, int) is factored out of
--      user_rank_points(), whose body is otherwise verbatim, so
--      20_vectors.test.sql can run rank-points.vectors.json's rankPoints cases
--      against the SQL formula itself. Seeding user_stats/streaks rows instead
--      would not reach three of the five cases: they have bevsRanked = 0, which
--      user_rank_points() filters out (Unranked).
--
-- THE STORED RULE. bayesStoredRule (shared/fixtures/bayesian.vectors.json) is
--   storedCents = floor((2N + 10D) / (20D)),  N = C*m_thousandths + 10*sum_cents,
--   D = C + n,
-- the exact quotient rounded half away from zero, never a rounded float. The
-- existing expression `bayes_score(sum, n, m, 3)::numeric(4,2)` already IS that
-- rule, so it stays; the argument is next to it in refresh_bev_stats below, and
-- 20_vectors.test.sql pins it on the three bayesScoreStored cases (5.925 -> 5.93
-- where the double is 5.92499...).
--
-- Deliberately NOT changed:
--   * get_prediction_snapshot's byCategoryMean stays a live aggregate. That
--     function belongs to be/snapshot-edges-neighbours (20261101000100) and no
--     formula reads the field.
--   * bev_stats.bayes_score keeps the GLOBAL prior, for 20261019000200's
--     reason: it is one number per Bev, read by every BevSummary outside a
--     category board. Only a category board shows the category prior.
--   * touch_streak, submit_ranking and rerank_bev (be/ranking-events,
--     20261101000200) and categories_depth_guard (be/depth-guard-roots). They
--     call refresh_bev_stats, whose signature is unchanged.
--   * The cron job. cron.schedule('refresh-global-stats', ...) in
--     20261011000800 calls the function by name; only the body changed, so it
--     is not re-scheduled.
--   * Privileges. Each re-created function keeps the owner and grants its
--     source migration gave it; they are re-stated below, not changed.
--
-- Constants mirror packages/ranking/src/constants.ts: BAYES_C = 3,
-- BAYES_CATEGORY_PRIOR_MIN = 30, GLOBAL_FALLBACK.mean = 5.0, MIN_RATERS = 2,
-- RANK_POINTS_WEIGHTS 1 / 3 / 2. They stay literals, as in the rest of the
-- schema.
--
-- Push after 20261101000100 and 20261101000200 (timestamp order). Neither
-- re-creates anything this file re-creates.

set search_path = public, extensions;

-- ============================================================================
-- 1. category_stats -- the per-category prior, materialised (3.4)
-- ============================================================================
-- One row per category that has at least one ranking, written only by
-- refresh_global_stats. Like bayes_prior's old live branch it counts every
-- ranking on a Bev in the category, whatever the Bev's status: the prior is a
-- statement about the category's taste, not about what is on the shelf.
--
-- RLS on and no policy, as user_neighbors (20261026000300): nothing on the
-- client reads it. Its one reader is bayes_prior(), which is security invoker
-- but is only ever called inside definers owned by postgres
-- (get_bev_leaderboard, get_feed, get_user_feed, get_explore,
-- get_bev_of_period -> bev_of_period_at, refresh_bev_stats,
-- refresh_global_stats), so it reads this table as its owner. The invoker
-- reasoning from 20261019000200 still holds: an EXECUTE grant added to
-- bayes_prior by mistake would hand a client nothing here, because RLS returns
-- no rows to `authenticated`.
create table public.category_stats (
  category_id  text primary key references public.categories(id) on delete cascade,
  rating_count integer not null,
  mean_score   numeric(5,3),
  updated_at   timestamptz not null default now()
);

comment on table public.category_stats is
  'A-14: per-category ranking count and mean (3 dp, like global_stats.mean_score), written by refresh_global_stats; bayes_prior(category) reads it (BAYES_CATEGORY_PRIOR_MIN = 30). No client access.';

alter table public.category_stats enable row level security;

-- ============================================================================
-- 2. bayes_prior -- the category branch reads category_stats (3.4)
-- ============================================================================
-- Same signature, volatility, security and search_path as 20261019000200; only
-- the category branch's source changed. The global branch is unchanged: the
-- global mean once global_stats has counted a ranking, GLOBAL_FALLBACK.mean =
-- 5.0 before that. With p_category_id null, `c` is empty (no row has a null
-- key), so the global branch answers.
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
    select cs.mean_score, cs.rating_count as n
      from public.category_stats cs
     where cs.category_id = p_category_id
  )
  select case
           when coalesce((select n from c), 0) >= 30
             then (select mean_score from c)
           when coalesce((select rating_count from g), 0) > 0
             then coalesce((select mean_score from g), 5.0)
           else 5.0
         end::numeric;
$$;

revoke execute on function public.bayes_prior(text) from public, anon, authenticated;

-- ============================================================================
-- 3. refresh_bev_stats -- also writes bayes_score (3.2)
-- ============================================================================
-- The upsert is 20261011000200's, plus one column. bayes_score is null with no
-- rankings and otherwise the stored rule with the global prior, the same m
-- refresh_global_stats uses, so a write leaves the column exactly where the
-- next cron tick would put it.
--
-- WHY `bayes_score(...)::numeric(4,2)` IS bayesStoredRule, exactly:
--   * m has at most 3 dp: bayes_prior(null) is global_stats.mean_score
--     (numeric(5,3)) or the literal 5.0. sum is a sum of numeric(4,2) scores,
--     so 2 dp. numeric + and * are exact, so C*m + sum = N/1000 with N the
--     rule's integer, and D = C + n is an integer.
--   * numeric division rounds the exact quotient q = N/(1000 D) to at least 16
--     significant digits (select_div_scale), i.e. an error under 1e-14 for any
--     q in [0, 10].
--   * If q sits exactly on a half-cent it has at most 3 dp, so the division
--     returns it exactly. Otherwise its distance to the nearest half-cent is
--     |N - 5D(2k+1)| / (1000 D) >= 1/(1000 D), which exceeds 1e-14 for every
--     D an integer rating_count allows (D < 2^31 + 3). So the 16-digit
--     quotient always lands on the same side of every half-cent as q.
--   * The cast to numeric(4,2) rounds half away from zero (round_var), which
--     for q >= 0 is floor((2N + 10D) / (20D)).
-- Never a float anywhere, so 5.925 stays 5.925 and stores as 5.93 (the double
-- is 5.92499..., which is the case bayesScoreStored exists to catch).
--
-- One race, accepted: if refresh_global_stats commits between this function
-- reading the prior and its upsert landing, the row keeps the previous prior
-- until the next tick (the other order is fine: the cron's UPDATE re-reads a
-- row a concurrent upsert changed). The error is one cron interval's drift in a
-- 3-dp mean, the same staleness every row had before this migration.
create or replace function public.refresh_bev_stats(p_bev_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m numeric;
begin
  if p_bev_ids is null or array_length(p_bev_ids, 1) is null then
    return;
  end if;

  -- Once per call, not per row: bayes_prior is stable, not immutable.
  v_m := public.bayes_prior(null);

  insert into public.bev_stats (bev_id, rating_count, sum_score, avg_score, score_stddev, bayes_score, last_ranked_at, updated_at)
  select
    ids.bev_id,
    coalesce(agg.rating_count, 0),
    coalesce(agg.sum_score, 0),
    agg.avg_score,
    agg.score_stddev,
    case
      when coalesce(agg.rating_count, 0) = 0 then null
      else public.bayes_score(agg.sum_score, agg.rating_count::integer, v_m, 3)::numeric(4,2)
    end,
    agg.last_ranked_at,
    now()
  from (select distinct bev_id from unnest(p_bev_ids) as u(bev_id)) as ids
  left join (
    select
      bev_id,
      count(*)          as rating_count,
      sum(score)        as sum_score,
      avg(score)        as avg_score,
      stddev_pop(score) as score_stddev,
      max(ranked_at)    as last_ranked_at
    from public.rankings
    where bev_id = any(p_bev_ids)
    group by bev_id
  ) agg on agg.bev_id = ids.bev_id
  on conflict (bev_id) do update set
    rating_count   = excluded.rating_count,
    sum_score      = excluded.sum_score,
    avg_score      = excluded.avg_score,
    score_stddev   = excluded.score_stddev,
    bayes_score    = excluded.bayes_score,
    last_ranked_at = excluded.last_ranked_at,
    updated_at     = excluded.updated_at;
end;
$$;
alter function public.refresh_bev_stats(uuid[]) owner to postgres;
revoke execute on function public.refresh_bev_stats(uuid[]) from public, anon;

-- ============================================================================
-- 4. refresh_global_stats -- category_stats, and every bayes_score (3.2, 3.4)
-- ============================================================================
-- Same signature and privileges as 20261011000800. In order:
--   1. global_stats, unchanged.
--   2. category_stats: drop the rows of categories with no ranking left, then
--      upsert one row per category that has any. The delete goes first so the
--      two statements never touch the same row.
--   3. every bev_stats row: null at rating_count = 0 (the stale-row fix), else
--      the stored rule with the prior just written. `where true` because
--      pg_safeupdate refuses an unqualified UPDATE for PostgREST's roles
--      (20261025000100); cron and migrations run as postgres and would not
--      hit it, but the clause costs nothing and keeps the body safe to call
--      from anywhere.
-- bayes_prior(null) is read AFTER step 1, so it sees this call's global_stats.
create or replace function public.refresh_global_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mean  numeric(5,3);
  v_count integer;
  v_m     numeric;
begin
  select avg(score)::numeric(5,3), count(*)::integer
    into v_mean, v_count
  from public.rankings;

  insert into public.global_stats (id, mean_score, rating_count, updated_at)
  values (true, v_mean, v_count, now())
  on conflict (id) do update set
    mean_score   = excluded.mean_score,
    rating_count = excluded.rating_count,
    updated_at   = excluded.updated_at;

  delete from public.category_stats cs
   where not exists (
     select 1
       from public.rankings r
       join public.bevs b on b.id = r.bev_id
      where b.category_id = cs.category_id
   );

  insert into public.category_stats (category_id, rating_count, mean_score, updated_at)
  select b.category_id, count(*)::integer, avg(r.score)::numeric(5,3), now()
    from public.rankings r
    join public.bevs b on b.id = r.bev_id
   group by b.category_id
  on conflict (category_id) do update set
    rating_count = excluded.rating_count,
    mean_score   = excluded.mean_score,
    updated_at   = excluded.updated_at;

  v_m := public.bayes_prior(null);

  -- `C = 3` is BAYES_C. The cast is the exact stored rule (see refresh_bev_stats).
  update public.bev_stats
     set bayes_score = case
                         when rating_count = 0 then null
                         else public.bayes_score(sum_score, rating_count, v_m, 3)::numeric(4,2)
                       end,
         updated_at  = now()
   where true;
end;
$$;
alter function public.refresh_global_stats() owner to postgres;
revoke execute on function public.refresh_global_stats() from public, anon, authenticated;

-- ============================================================================
-- 5. get_bev_leaderboard -- the returned figure is rounded; the order is not (3.5)
-- ============================================================================
-- 20261019000200's definition verbatim except the select list's bayes_score,
-- which is now round(..., 2). The ORDER BY keeps the unrounded expression.
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
         -- Rounded for display only (A-14 3.5); the order below is unrounded.
         round(public.bayes_score(s.sum_score, s.rating_count, p.m, 3), 2)::numeric
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

alter function public.get_bev_leaderboard(text, int) owner to postgres;
revoke execute on function public.get_bev_leaderboard(text, int) from public, anon;
grant execute on function public.get_bev_leaderboard(text, int) to authenticated;

-- ============================================================================
-- 6. get_feed -- bayes_prior(null), rounded (3.3, 3.5)
-- ============================================================================
-- 20261014000300's definition verbatim except the prior (a materialised CTE,
-- cross-joined) and round(..., 2). `create or replace` rather than that file's
-- drop-and-create: the return columns are unchanged, so it can, and the grants
-- survive. 07_user_feed and 10_explore compare get_feed's result type with
-- get_user_feed's and get_explore's, which this keeps equal.
create or replace function public.get_feed(p_limit int default 20, p_before_id bigint default null)
returns table (
  id                   bigint,
  kind                 text,
  created_at           timestamptz,
  actor_id             uuid,
  actor_handle         text,
  actor_display_name   text,
  actor_avatar_path    text,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_status           text,
  bev_rating_count     integer,
  bev_bayes_score      numeric,
  ranking_id           uuid,
  score                numeric(4,2),
  bucket               smallint,
  note                 text,
  target_user_id       uuid,
  in_my_want_to_try    boolean,
  like_count           integer,
  liked_by_me          boolean,
  comment_count        integer,
  comments             jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Once per call; see get_bev_leaderboard for why it must be MATERIALIZED.
  with prior as materialized (select public.bayes_prior(null) as m)
  select e.id, e.kind, e.created_at,
         e.actor_id, p.handle, p.display_name, p.avatar_path,
         e.bev_id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
         b.price_tier, b.price_estimated, b.status,
         s.rating_count,
         round(public.bayes_score(s.sum_score, s.rating_count, bp.m, 3), 2)::numeric,
         e.ranking_id, r.score, r.bucket, r.note,
         e.target_user_id,
         exists (
           select 1 from public.want_to_try w
            where w.user_id = auth.uid() and w.bev_id = e.bev_id
         ),
         (select count(*) from public.post_likes pl
           where pl.feed_event_id = e.id)::integer,
         exists (
           select 1 from public.post_likes pl
            where pl.user_id = auth.uid() and pl.feed_event_id = e.id
         ),
         (select count(*) from public.post_comments pc
           where pc.feed_event_id = e.id and pc.deleted_at is null)::integer,
         coalesce(ic.items, '[]'::jsonb)
    from public.feed_events e
    join public.profiles p on p.id = e.actor_id
    left join public.bevs b on b.id = e.bev_id
    left join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
    left join public.rankings r on r.id = e.ranking_id
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id', t.id,
                 'body', t.body,
                 'created_at', t.created_at,
                 'author_id', t.user_id,
                 'author_handle', t.handle,
                 'author_display_name', t.display_name,
                 'author_avatar_path', t.avatar_path,
                 'author_timezone', t.timezone,
                 'author_onboarded', t.onboarded,
                 'author_created_at', t.author_created_at
               )
               order by t.id
             ) as items
        from (
          select cm.id, cm.body, cm.created_at, cm.user_id,
                 cp.handle, cp.display_name, cp.avatar_path,
                 cp.timezone, cp.onboarded, cp.created_at as author_created_at
            from public.post_comments cm
            join public.profiles cp on cp.id = cm.user_id
           where cm.feed_event_id = e.id and cm.deleted_at is null
           order by cm.id
           limit 7
        ) t
    ) ic on true
   cross join prior bp
   where e.kind in ('ranked', 'reranked')
     and (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
     and (p_before_id is null or e.id < p_before_id)
   order by e.id desc
   limit p_limit;
$$;

alter function public.get_feed(int, bigint) owner to postgres;
revoke execute on function public.get_feed(int, bigint) from public, anon;
grant execute on function public.get_feed(int, bigint) to authenticated;

-- ============================================================================
-- 7. get_user_feed -- the same two changes (3.3, 3.5)
-- ============================================================================
-- 20261018000300's definition verbatim except the prior and round(..., 2); its
-- select list is still get_feed's.
create or replace function public.get_user_feed(
  p_user_id   uuid,
  p_limit     int    default 20,
  p_before_id bigint default null
)
returns table (
  id                   bigint,
  kind                 text,
  created_at           timestamptz,
  actor_id             uuid,
  actor_handle         text,
  actor_display_name   text,
  actor_avatar_path    text,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_status           text,
  bev_rating_count     integer,
  bev_bayes_score      numeric,
  ranking_id           uuid,
  score                numeric(4,2),
  bucket               smallint,
  note                 text,
  target_user_id       uuid,
  in_my_want_to_try    boolean,
  like_count           integer,
  liked_by_me          boolean,
  comment_count        integer,
  comments             jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    -- Once per call; see get_bev_leaderboard for why it must be MATERIALIZED.
    with prior as materialized (select public.bayes_prior(null) as m)
    select e.id, e.kind, e.created_at,
           e.actor_id, p.handle, p.display_name, p.avatar_path,
           e.bev_id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
           b.price_tier, b.price_estimated, b.status,
           s.rating_count,
           round(public.bayes_score(s.sum_score, s.rating_count, bp.m, 3), 2)::numeric,
           e.ranking_id, r.score, r.bucket, r.note,
           e.target_user_id,
           exists (
             select 1 from public.want_to_try w
              where w.user_id = auth.uid() and w.bev_id = e.bev_id
           ),
           (select count(*) from public.post_likes pl
             where pl.feed_event_id = e.id)::integer,
           exists (
             select 1 from public.post_likes pl
              where pl.user_id = auth.uid() and pl.feed_event_id = e.id
           ),
           (select count(*) from public.post_comments pc
             where pc.feed_event_id = e.id and pc.deleted_at is null)::integer,
           coalesce(ic.items, '[]'::jsonb)
      from public.feed_events e
      join public.profiles p on p.id = e.actor_id
      left join public.bevs b on b.id = e.bev_id
      left join public.categories c on c.id = b.category_id
      left join public.bev_stats s on s.bev_id = b.id
      left join public.rankings r on r.id = e.ranking_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'id', t.id,
                   'body', t.body,
                   'created_at', t.created_at,
                   'author_id', t.user_id,
                   'author_handle', t.handle,
                   'author_display_name', t.display_name,
                   'author_avatar_path', t.avatar_path,
                   'author_timezone', t.timezone,
                   'author_onboarded', t.onboarded,
                   'author_created_at', t.author_created_at
                 )
                 order by t.id
               ) as items
          from (
            select cm.id, cm.body, cm.created_at, cm.user_id,
                   cp.handle, cp.display_name, cp.avatar_path,
                   cp.timezone, cp.onboarded, cp.created_at as author_created_at
              from public.post_comments cm
              join public.profiles cp on cp.id = cm.user_id
             where cm.feed_event_id = e.id and cm.deleted_at is null
             order by cm.id
             limit 7
          ) t
      ) ic on true
      cross join prior bp
     where e.actor_id = p_user_id
       and e.kind in ('ranked', 'reranked')
       and public.feed_event_visible(e.id)
       and (p_before_id is null or e.id < p_before_id)
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

alter function public.get_user_feed(uuid, int, bigint) owner to postgres;
revoke execute on function public.get_user_feed(uuid, int, bigint) from public, anon;
grant execute on function public.get_user_feed(uuid, int, bigint) to authenticated;

-- ============================================================================
-- 8. get_explore -- the same two changes (3.3, 3.5)
-- ============================================================================
-- 20261019000400's definition verbatim except a `prior` CTE cross-joined into
-- `scored`, and round(..., 2). The ordering (hot desc, id desc) never read the
-- Bayesian figure. Its `comment on function` survives create or replace.
create or replace function public.get_explore(
  p_limit  int         default 20,
  p_before timestamptz default null,
  p_offset int         default 0
)
returns table (
  id                   bigint,
  kind                 text,
  created_at           timestamptz,
  actor_id             uuid,
  actor_handle         text,
  actor_display_name   text,
  actor_avatar_path    text,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_status           text,
  bev_rating_count     integer,
  bev_bayes_score      numeric,
  ranking_id           uuid,
  score                numeric(4,2),
  bucket               smallint,
  note                 text,
  target_user_id       uuid,
  in_my_want_to_try    boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  -- The paging cut (client-settable, clamped both ways) and the decay clock
  -- (server-side, coarse). They are separate on purpose: see the note above.
  v_cut    timestamptz;
  v_snap   timestamptz;
  v_limit  int  := least(greatest(coalesce(p_limit, 20), 1), 50);
  -- Capped above as well as below: nodeLimit passes `offset + count` as the
  -- sort bound, so an unbounded offset defeats the bounded top-N heapsort and
  -- forces a full sort of the candidate set on every request.
  v_offset int  := least(greatest(coalesce(p_offset, 0), 0), 1000);
  -- D-01: below this many profiles the two-hop scope widens to everyone.
  v_global boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  v_cut  := least(
              greatest(coalesce(p_before, now()), now() - interval '30 days'),
              now() + interval '5 minutes'
            );
  -- Server-side, and never derived from a parameter. That is the whole fix:
  -- the caller cannot move it, so it cannot sweep it. Plain now() rather than
  -- a truncated clock on purpose -- quantising to the hour would make a post's
  -- rank depend on where in the hour the query runs, which is both surprising
  -- and a source of flapping tests, and it does not close the residual below
  -- (real time moves the ages on its own either way).
  v_snap := now();
  v_global := (select count(*) from public.profiles) < 20;

  return query
    with recursive hops as (
      -- Depth 1: who the caller follows. They are dropped from `scope` below
      -- (their posts are the feed), but they are the only way to depth 2.
      select f.followee_id as user_id, 1 as depth
        from public.follows f
       where f.follower_id = v_uid
      union
      select f.followee_id, h.depth + 1
        from hops h
        join public.follows f on f.follower_id = h.user_id
       where h.depth < 2
    ),
    candidates as (
      select h.user_id
        from hops h
       where not v_global
      union
      -- D-01's fallback. Both branches are then narrowed by `scope`.
      select pr.id
        from public.profiles pr
       where v_global
    ),
    scope as (
      select c.user_id
        from candidates c
       where c.user_id <> v_uid
         and not exists (
           select 1 from public.follows f
            where f.follower_id = v_uid and f.followee_id = c.user_id
         )
    ),
    -- Once per call; see get_bev_leaderboard for why it must be MATERIALIZED.
    prior as materialized (
      select public.bayes_prior(null) as m
    ),
    scored as (
      select e.id                  as id,
             e.kind                as kind,
             e.created_at          as created_at,
             e.actor_id            as actor_id,
             p.handle              as actor_handle,
             p.display_name        as actor_display_name,
             p.avatar_path         as actor_avatar_path,
             e.bev_id              as bev_id,
             b.name                as bev_name,
             b.brand               as bev_brand,
             b.flavor              as bev_flavor,
             b.category_id         as bev_category_id,
             b.thumb_path          as bev_thumb_path,
             b.price_tier          as bev_price_tier,
             b.price_estimated     as bev_price_estimated,
             b.status              as bev_status,
             s.rating_count        as bev_rating_count,
             round(public.bayes_score(s.sum_score, s.rating_count, bp.m, 3), 2)::numeric
                                   as bev_bayes_score,
             e.ranking_id          as ranking_id,
             r.score               as score,
             r.bucket              as bucket,
             r.note                as note,
             e.target_user_id      as target_user_id,
             exists (
               select 1 from public.want_to_try w
                where w.user_id = v_uid and w.bev_id = e.bev_id
             )                     as in_my_want_to_try,
             -- Ordering only: the like count never reaches the result (D-15).
             public.explore_hotness(
               (select count(*) from public.post_likes pl where pl.feed_event_id = e.id),
               (extract(epoch from (v_snap - e.created_at)) / 3600.0)::numeric
             )                     as hot
        from public.feed_events e
        join scope sc on sc.user_id = e.actor_id
        join public.profiles p on p.id = e.actor_id
        left join public.bevs b on b.id = e.bev_id
        left join public.categories c2 on c2.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
        left join public.rankings r on r.id = e.ranking_id
        cross join prior bp
       where e.kind in ('ranked', 'reranked')
         and e.created_at <= v_cut
         -- A post older than this can never reach a page under (h+2)^-1.5, and
         -- bounding it keeps the candidate set from growing without limit as
         -- feed_events does. Served by feed_events_created_idx below.
         and e.created_at > v_cut - interval '14 days'
         and (b.id is null or not c2.is_alcoholic or public.viewer_is_adult())
         -- The status half of bevs_select (20261011000100), which the alcohol
         -- predicate above reproduces but this originally did not. Without it
         -- a user can create_bev with no photo (status 'pending_photo', which
         -- only its creator may see), rank it, and push 80 characters of free
         -- text in each of name/brand/flavor to every stranger two hops out --
         -- or, under D-01's fallback, to the whole instance. It also keeps
         -- Explore from broadcasting a Bev that moderation has hidden.
         and (b.id is null or b.status = 'active')
    )
    select sc2.id, sc2.kind, sc2.created_at,
           sc2.actor_id, sc2.actor_handle, sc2.actor_display_name, sc2.actor_avatar_path,
           sc2.bev_id, sc2.bev_name, sc2.bev_brand, sc2.bev_flavor,
           sc2.bev_category_id, sc2.bev_thumb_path,
           sc2.bev_price_tier, sc2.bev_price_estimated, sc2.bev_status,
           sc2.bev_rating_count, sc2.bev_bayes_score,
           sc2.ranking_id, sc2.score, sc2.bucket, sc2.note,
           sc2.target_user_id, sc2.in_my_want_to_try
      from scored sc2
     -- id desc is the tie-break that makes the order total (and so pageable).
     order by sc2.hot desc, sc2.id desc
     offset v_offset
     limit v_limit;
end;
$$;

alter function public.get_explore(int, timestamptz, int) owner to postgres;
revoke execute on function public.get_explore(int, timestamptz, int) from public, anon;
grant execute on function public.get_explore(int, timestamptz, int) to authenticated;

-- ============================================================================
-- 9. bev_of_period_at -- bayes_prior(null) (3.3)
-- ============================================================================
-- 20261018000100's definition verbatim except: `params` now reads the prior
-- from bayes_prior(null) and is marked MATERIALIZED (it is referenced twice, so
-- Postgres materialises it anyway; the keyword says the once-per-call
-- evaluation is intended), and the returned figure is round(bayes, 2) cast to
-- its declared numeric(4,2) -- the same value the bare cast gave, written the
-- way every other surface now writes it. The winner is still picked on the
-- unrounded `bayes`. Still security invoker: get_bev_of_period() is its only
-- caller and a definer owned by postgres, so bayes_prior runs as postgres too.
create or replace function public.bev_of_period_at(p_now timestamptz, p_adult boolean)
returns table (
  period               text,
  period_start         date,
  is_current           boolean,
  rankings_in_period   integer,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_rating_count     integer,
  bev_bayes_score      numeric(4,2)
)
language sql
stable
-- Invoker on purpose: its only caller, get_bev_of_period(), is a definer owned
-- by postgres, so this already runs as postgres there. A grant added to it by
-- mistake later cannot hand a client a chosen clock and age flag with elevated rights.
security invoker
set search_path = public, extensions
as $$
  with params as materialized (
    select (p_now at time zone 'America/New_York') as local_now,
           public.bayes_prior(null) as m
  ),
  -- Rankings up to p_now of Bevs the caller may see, stamped in New York time.
  eligible as (
    select r.bev_id, (r.ranked_at at time zone 'America/New_York') as local_at
      from public.rankings r
      join public.bevs b on b.id = r.bev_id
      join public.categories c on c.id = b.category_id
     where r.ranked_at <= p_now
       and b.status = 'active'
       and (not c.is_alcoholic or p_adult)
  ),
  -- date_trunc('week', …) on a timestamp is the ISO week's Monday.
  units (period) as (values ('day'), ('week')),
  -- Every eligible ranking is at or before p_now, so the latest non-empty
  -- period is the current one whenever the current one has a ranking.
  chosen as (
    select u.period,
           (select max(date_trunc(u.period, e.local_at)) from eligible e) as start_local,
           date_trunc(u.period, p.local_now) as current_local
      from units u cross join params p
  ),
  counts as (
    select ch.period, ch.start_local, ch.current_local, e.bev_id, count(*)::int as n_period
      from chosen ch
      join eligible e on date_trunc(ch.period, e.local_at) = ch.start_local
     group by ch.period, ch.start_local, ch.current_local, e.bev_id
  ),
  scored as (
    select k.*, b.name, b.brand, b.flavor, b.category_id,
           coalesce(b.thumb_path, b.photo_path) as thumb_path,
           b.price_tier, b.price_estimated,
           coalesce(s.rating_count, 0) as rating_count,
           public.bayes_score(s.sum_score, s.rating_count, p.m, 3) as bayes
      from counts k
      join public.bevs b on b.id = k.bev_id
      left join public.bev_stats s on s.bev_id = k.bev_id
      cross join params p
  ),
  ranked as (
    select sc.*,
           row_number() over (
             partition by sc.period
             order by sc.bayes desc, sc.n_period desc, sc.rating_count desc,
                      sc.name collate "C" asc, sc.bev_id asc
           ) as rn
      from scored sc
  )
  select r.period, r.start_local::date, r.start_local = r.current_local, r.n_period,
         r.bev_id, r.name, r.brand, r.flavor, r.category_id, r.thumb_path,
         r.price_tier, r.price_estimated, r.rating_count, round(r.bayes, 2)::numeric(4,2)
    from ranked r
   where r.rn = 1
   order by r.period;
$$;
alter function public.bev_of_period_at(timestamptz, boolean) owner to postgres;
revoke execute on function public.bev_of_period_at(timestamptz, boolean) from public, anon, authenticated;

-- ============================================================================
-- 10. rank_points -- the rank-points formula in one immutable place (3.7)
-- ============================================================================
-- rank.ts / RANK_POINTS_WEIGHTS: 1*bevsRanked + 3*currentStreak + 2*bevsCreated.
-- No `set search_path`, so the planner can inline it (explore_hotness,
-- 20261019000400, makes the same choice). Every operator here is int4 * int4 or
-- int4 + int4 on int4 literals, an exact match in pg_catalog, which is searched
-- first, so nothing created on a search path can capture it.
create or replace function public.rank_points(
  p_bevs_ranked    integer,
  p_current_streak integer,
  p_bevs_created   integer
)
returns integer
language sql
immutable
parallel safe
as $$
  select p_bevs_ranked * 1 + p_current_streak * 3 + p_bevs_created * 2;
$$;

comment on function public.rank_points(integer, integer, integer) is
  'rank on Bevi points, packages/ranking rankPoints(): 1*bevsRanked + 3*currentStreak + 2*bevsCreated. Pinned by 20_vectors.test.sql.';

alter function public.rank_points(integer, integer, integer) owner to postgres;
revoke execute on function public.rank_points(integer, integer, integer) from public, anon, authenticated;

-- 20261012000500's user_rank_points() verbatim except `points`, which now calls
-- rank_points(). Same columns and types (every argument is already integer).
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
    select *, public.rank_points(bevs_ranked, current_streak, bevs_created) as points
    from u
    where bevs_ranked > 0
  )
  select id, bevs_ranked, current_streak, bevs_created, points,
         rank() over (order by points desc)::integer
  from scored;
$$;

alter function public.user_rank_points() owner to postgres;
revoke execute on function public.user_rank_points() from public, anon, authenticated;

-- ============================================================================
-- 11. Bootstrap
-- ============================================================================
-- As 20261011000800 did: fill category_stats now and fix every stale
-- bev_stats.bayes_score on prod immediately, rather than at the first cron
-- tick. On an empty database (CI's `supabase db reset`) there are no rankings:
-- global_stats becomes (null, 0), category_stats stays empty, and the update
-- has no bev_stats row to touch (refresh_bev_stats creates them, and nothing
-- has called it yet); any row it did find would have rating_count = 0 and
-- stay null.
select public.refresh_global_stats();
