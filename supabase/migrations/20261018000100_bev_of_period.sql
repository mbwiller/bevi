-- A-05 (S-05): Bev of the day and Bev of the week.
--
-- Definition: LaTeX docs/bevi-ranking-math.tex §10.3 and D-02 (accepted
-- 2026-10-18). For a period P (an America/New_York calendar day, or an ISO
-- week starting Monday) the candidates are the Bevs with at least one ranking
-- created in P. The winner has the highest *current* Bayesian score, the same
-- figure get_bev_leaderboard computes (global prior from global_stats, C = 3);
-- ties go to more rankings in P, then more raters overall, then name in code
-- point order (collate "C", as @bevi/ranking's leaderboardOrder), then id.
--
-- No MIN_RATERS gate: the paper defines the winner over every Bev ranked in P
-- ("lets a single ranking today surface a Bev while the prior still tempers
-- it"), so a Bev with one rating can win. Its bayes_score is returned so the
-- card can show the number it won with.
--
-- Fallback (D-02): when nothing the caller may see was ranked in the current
-- period, return the winner of the latest period that had a ranking, with
-- is_current = false.
--
-- "Created in P" is rankings.ranked_at. A re-rank deletes and re-inserts the
-- row (rerank_bev), so it counts as a ranking on the day it happened.
--
-- Computed live: at ~20 users this is a scan of rankings. Cache in a table
-- only if the feed call gets slow (TASKS.md A-05).

-- The clock and the age gate are parameters so pgTAP can pin them. Never
-- granted to a client role: get_bev_of_period() below is the only way in, and
-- it passes now() and the caller's own viewer_is_adult().
create function public.bev_of_period_at(p_now timestamptz, p_adult boolean)
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
security definer
set search_path = public, extensions
as $$
  with params as (
    select (p_now at time zone 'America/New_York') as local_now,
           coalesce((select mean_score from public.global_stats limit 1), 0) as m
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
         r.price_tier, r.price_estimated, r.rating_count, r.bayes::numeric(4,2)
    from ranked r
   where r.rn = 1
   order by r.period;
$$;
alter function public.bev_of_period_at(timestamptz, boolean) owner to postgres;
revoke execute on function public.bev_of_period_at(timestamptz, boolean) from public, anon, authenticated;

-- Zero, one or two rows: 'day' and/or 'week'. A missing row means nothing the
-- caller may see has ever been ranked.
create function public.get_bev_of_period()
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
security definer
set search_path = public, extensions
as $$
  select * from public.bev_of_period_at(now(), public.viewer_is_adult());
$$;
revoke execute on function public.get_bev_of_period() from public, anon;
grant execute on function public.get_bev_of_period() to authenticated;
