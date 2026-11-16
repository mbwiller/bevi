-- A-14 follow-ups: the Bayesian prior, everywhere it is used.
--
-- 20261019000200_leaderboard_parity.sql added public.bayes_prior(p_category_id)
-- -- the SQL twin of globalPrior() / categoryPrior()
-- (packages/ranking/src/bayesian.ts) -- and used it in get_bev_leaderboard
-- only. Its header lists what it deliberately left open; this migration closes
-- the three items from that list that are Arjun's, and nothing else. The
-- formulas are still mirrored from @bevi/ranking, never reimplemented:
-- bayes_score() (20261011000200) is bayesianAverage(), bayes_prior() is
-- globalPrior()/categoryPrior(), and the constants below are the literals from
-- packages/ranking/src/constants.ts (BAYES_C = 3,
-- BAYES_CATEGORY_PRIOR_MIN = 30, GLOBAL_FALLBACK.mean = 5.0).
--
-- 1. THE 0 PRIOR SURVIVED OUTSIDE THE LEADERBOARD.
--    `coalesce((select mean_score from global_stats limit 1), 0)` was still the
--    prior in get_feed (20261014000300), get_user_feed (20261018000300) and
--    bev_of_period_at (20261018000100). Each one's package twin is globalPrior()
--    (FakeApi `bayes()` for the feed card's BevSummary, and the Bev-of-period
--    winner), which falls back to GLOBAL_FALLBACK.mean = 5.0, not 0. All three
--    now call public.bayes_prior(null). Signatures and return shapes are
--    byte-identical, so packages/api and shared/ are unaffected.
--
--    Privileges, verified rather than assumed, because bayes_prior is revoked
--    from public/anon/authenticated and is itself `security invoker`:
--      * get_feed(int, bigint) -- security definer, `alter function ... owner to
--        postgres` at 20261014000300:311 (and 20261014000200:227). Body runs as
--        postgres, which owns bayes_prior, so EXECUTE is held by ownership.
--      * get_user_feed(uuid, int, bigint) -- security definer, owner set to
--        postgres at 20261018000300:135. Same.
--      * bev_of_period_at(timestamptz, boolean) -- SECURITY INVOKER (declared so
--        at 20261018000100:51, owner postgres at :111). This is the one that is
--        not a definer, so the call deserves its own argument: EXECUTE on a
--        function is checked against current_user at call time, and an invoker
--        function does not change current_user. Its only grantee path in is
--        get_bev_of_period(), a security definer owned by postgres (nothing has
--        ever granted bev_of_period_at to anon or authenticated --
--        20261018000100:112 revokes it, and 07_bev_of_period.test.sql asserts
--        the revoke and that a direct call is denied). So inside
--        get_bev_of_period() current_user is postgres and the bayes_prior call
--        resolves by ownership, exactly as it does for the two definers. The
--        other callers are pgTAP (postgres) and, in principle, service_role,
--        which kept EXECUTE on bayes_prior. There is no role that can reach
--        bev_of_period_at and cannot then reach bayes_prior, so the invoker
--        declaration is not in the way. Both functions stay invoker for the
--        reason 20261019000200 gives: a grant added to either by mistake later
--        still reads through RLS instead of with postgres's rights.
--
--    WHAT MOVES IN THE APP. Only while global_stats.rating_count = 0 -- i.e. a
--    system with no rankings at all, or one whose global_stats row has never
--    been refreshed. In that state the prior goes from 0 to 5.0, so a feed
--    card's BevSummary.bayesScore and a Bev-of-period winner's score go from
--    sum/(3 + n) to (15 + sum)/(3 + n). Example: a Bev with one 9.00 reads 2.25
--    today and 6.00 after this migration. Once any ranking exists and the
--    15-minute cron has run, rating_count > 0 and both expressions are the same
--    number, so prod figures do not move. This is the same correction
--    20261019000200 already made to the leaderboard, which is why leaving it out
--    of the other three made an empty system internally inconsistent.
--
-- 2. THE TWO BRANCHES OF bayes_prior HAD DIFFERENT FRESHNESS AND PRECISION.
--    The category branch aggregated `rankings ⋈ bevs` live and exact; the global
--    branch read global_stats.mean_score, a numeric(5,3) written by the
--    15-minute cron (20261011000800). Fixed by materialising category means in
--    the same job, so both branches are numeric(5,3) from the same refresh.
--
--    SHAPE: a new table, public.category_stats, not columns on public.categories.
--    categories is seeded catalog (id, name, sort_order, is_alcoholic, emoji),
--    read by categories.list() and referenced by every Bev; mutable aggregates
--    rewritten every 15 minutes do not belong in it, and A-13 is about to add
--    parent_id/depth there. A sibling of global_stats and user_category_stats
--    (20261009000600/700) instead: same column names, same types, same
--    "aggregate, public read, no write policy" RLS shape, so there is one
--    recognisable pattern for refreshed aggregates rather than two.
--
--    This also removes the per-call aggregate the old category branch ran. No
--    index served it: bevs_category_idx is partial on `status = 'active'` and
--    the prior deliberately does not filter status (see below), so every
--    per-category leaderboard call scanned rankings and bevs. It is now a
--    single-row primary-key lookup.
--
--    SEMANTICS KEPT IDENTICAL: the threshold is still
--    `rating_count >= 30` (BAYES_CATEGORY_PRIOR_MIN, `>=` not `>`), it still
--    counts RANKINGS and not distinct raters, and the aggregate still joins
--    rankings to bevs WITHOUT filtering bevs.status -- matching `byCategoryMean`
--    in get_prediction_snapshot (20261012000600) and the reasoning in
--    20261019000200: a Bev that was hidden or merged after people ranked it
--    still happened, and the prior is a statement about the category's taste,
--    not about what is currently on the shelf.
--
-- 3. THE LEADERBOARD RETURNED AN UNROUNDED numeric.
--    bev_stats.bayes_score is numeric(4,2) (20261009000300:50),
--    bev_of_period_at returns numeric(4,2) (20261018000100:44), and the FakeApi
--    applies round2 to both the leaderboard row and toSummary
--    (app/src/testing/fakeApi/FakeApi.ts:151, :527, :1709). get_bev_leaderboard
--    was the only one of the four that returned full numeric precision, so the
--    fake and the real client disagreed in the digits -- e.g. 7.3333... against
--    7.33 -- for the same Bev. The real side moves, because three of the four
--    places already round and the contract type is `number`: bayes_score is
--    declared numeric(4,2) here. mapBevLeaderboardRow (packages/api/src/
--    mappers.ts:545) types it `number` either way, so packages/api does not
--    change; shared/src/types.ts gets a doc line only.
--
--    The ORDER BY keeps the unrounded value, which is what the package does:
--    leaderboardOrder() sorts on the raw bayesianAverage() and the FakeApi
--    applies round2 only when building the row (FakeApi.ts:1702-1709). Rounding
--    before the sort would merge ties the package keeps apart.
--
-- STILL NOT CLOSED, so this header is not read as a wider claim than it is:
--   * bayes_prior is still a 3-decimal twin of globalPrior()/categoryPrior(),
--     which return an exact mean. That is now true of both branches in the same
--     way and only between cron ticks, which is the parity this item asked for;
--     an exact live global mean would put a full scan of `rankings` on every
--     leaderboard and feed call.
--   * category_stats is readable by `authenticated` under its select policy,
--     like global_stats. 20261019000200 keeps bayes_prior `security invoker` so
--     that an accidental grant could not leak an age-gated category's mean with
--     RLS bypassed; with the mean now in a table that authenticated may read,
--     that argument protects less than it did. It is the same exposure
--     global_stats has had since 20261011000100 -- one aggregate number per
--     category, no Bev and no ranking behind it, and the age gate protects
--     alcoholic *Bevs*, not the existence of a category -- and the brief asked
--     for select-only for authenticated. Noted so it is a decision, not a
--     slip. The revoke on bayes_prior itself stays.
--   * The remaining A-14 follow-ups are Matt's (compareCodePoints, the LaTeX
--     §11 table) or doc-only.

set search_path = public, extensions;

-- ============================================================================
-- 1. category_stats -- per-category aggregates, refreshed with global_stats
-- ============================================================================
-- Column names and types are global_stats' (20261009000700:64), so bayes_prior
-- reads the same two fields from either side. rating_count is NOT NULL with a
-- default of 0 because the refresh writes a row for every category, including
-- ones with no rankings; mean_score stays nullable for exactly those (avg() of
-- nothing is null), the same way global_stats.mean_score is null before the
-- first ranking.
create table public.category_stats (
  category_id   text primary key references public.categories(id) on delete cascade,
  rating_count  integer not null default 0,
  mean_score    numeric(5,3),
  updated_at    timestamptz not null default now()
);

comment on table public.category_stats is
  'Per-category ranking aggregates, rewritten by refresh_global_stats() every 15 minutes. Read by bayes_prior() for the categoryPrior() branch. Counts rankings (not distinct raters) and does not filter bevs.status.';

-- RLS in the same migration that creates the table, per supabase/CLAUDE.md.
alter table public.category_stats enable row level security;

-- An aggregate, not sensitive: public read, and no write policy at all. Writes
-- come only from refresh_global_stats(), a security definer owned by postgres
-- that is revoked from every client role. This is global_stats_select
-- (20261011000100:217) with the table name changed.
create policy category_stats_select on public.category_stats
  for select to authenticated using (true);

-- ============================================================================
-- 2. refresh_global_stats -- also write category_stats
-- ============================================================================
-- 20261011000800's body unchanged, plus the per-category upsert. The driving
-- table is `categories`, so every category gets a row and a category whose last
-- ranking was deleted falls back to 0 / null instead of keeping a stale mean.
-- One extra pass over `rankings ⋈ bevs` per tick, in a job that already scans
-- all of `rankings` and `bev_stats`.
--
-- 20261011000800's own header left "blend in each category's own mean for
-- categories with enough ratings" as a follow-up; the blend itself landed in
-- bayes_prior (20261019000200), and this is the aggregation half it was
-- waiting for.
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

  -- No filter on b.status: the prior is a statement about the category's taste,
  -- not about what is currently on the shelf (20261019000200), and
  -- get_prediction_snapshot's byCategoryMean aggregates the same way.
  -- count(r.bev_id) rather than count(*) so a category with no rankings scores
  -- 0 across the left join instead of 1.
  insert into public.category_stats (category_id, rating_count, mean_score, updated_at)
  select c.id, count(r.bev_id), avg(r.score)::numeric(5,3), now()
    from public.categories c
    left join public.bevs b on b.category_id = c.id
    left join public.rankings r on r.bev_id = b.id
   group by c.id
  on conflict (category_id) do update set
    rating_count = excluded.rating_count,
    mean_score   = excluded.mean_score,
    updated_at   = excluded.updated_at;

  -- `C = 3` matches packages/ranking/src/constants.ts BAYES_C. Bevs with zero
  -- ratings keep bayes_score = null. The prior here is the GLOBAL mean on
  -- purpose: bev_stats.bayes_score is one number per Bev, read by mapBevSummary
  -- everywhere outside a category board (20261019000200), so a category's own
  -- mean would be the wrong prior for it.
  update public.bev_stats
  set bayes_score = public.bayes_score(sum_score, rating_count, v_mean, 3)::numeric(4,2),
      updated_at  = now()
  where rating_count > 0;
end;
$$;
alter function public.refresh_global_stats() owner to postgres;
revoke execute on function public.refresh_global_stats() from public, anon, authenticated;

-- ============================================================================
-- 3. bayes_prior -- the category branch now reads category_stats
-- ============================================================================
-- Same signature, same result type, same thresholds and the same fallback
-- ladder as 20261019000200; only the source of the category figure changes, from
-- a live `rankings ⋈ bevs` aggregate to the materialised row. Both branches are
-- now numeric(5,3) as of the last cron tick, which is the point.
--
-- A category with no row in category_stats (possible only between `insert into
-- categories` and the next refresh) coalesces to 0 rankings and so falls back to
-- the global branch, which is what a brand-new category should do anyway.
--
-- Still `security invoker`, still revoked: see the header.
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
     where p_category_id is not null
       and cs.category_id = p_category_id
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
-- 4. get_feed -- bayes_prior(null) instead of the 0 fallback
-- ============================================================================
-- 20261014000300's definition with one expression replaced. Everything else,
-- including `set search_path = public, extensions` and the absent p_limit clamp,
-- is byte-identical: `returns table` is unchanged, so `create or replace` is
-- enough and the ACL survives. Restated below anyway, as 20261019000200 does.
--
-- `(select public.bayes_prior(null))` is a scalar sub-SELECT with no outer
-- reference, so the planner makes it an InitPlan and evaluates it once per call
-- -- not once per returned row. bayes_prior cannot be inlined (it has a CTE and
-- a SET clause) and is stable rather than immutable, so it is never folded to a
-- constant either; the sub-SELECT is what pins the evaluation count, exactly as
-- the old `(select mean_score from global_stats limit 1)` did. Writing
-- `public.bayes_prior(null)` bare in the select list would cost one call per
-- row.
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
  select e.id, e.kind, e.created_at,
         e.actor_id, p.handle, p.display_name, p.avatar_path,
         e.bev_id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
         b.price_tier, b.price_estimated, b.status,
         s.rating_count,
         public.bayes_score(
           s.sum_score, s.rating_count,
           (select public.bayes_prior(null)),
           3
         )::numeric,
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
-- 5. get_user_feed -- the same one expression
-- ============================================================================
-- 20261018000300's definition with the same replacement. That migration's rule
-- still holds: "The select list is get_feed's unchanged; only the WHERE
-- differs", and 07_user_feed.test.sql asserts the two return shapes stay equal,
-- so the prior expression is written the same way on both sides rather than
-- hoisted into a plpgsql variable here.
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
    select e.id, e.kind, e.created_at,
           e.actor_id, p.handle, p.display_name, p.avatar_path,
           e.bev_id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
           b.price_tier, b.price_estimated, b.status,
           s.rating_count,
           public.bayes_score(
             s.sum_score, s.rating_count,
             (select public.bayes_prior(null)),
             3
           )::numeric,
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
-- 6. bev_of_period_at -- the same one expression
-- ============================================================================
-- 20261018000100's definition with `m` taken from bayes_prior(null). The
-- `params` CTE is referenced twice (by `chosen` and by `scored`), so Postgres
-- already declines to inline it and evaluates it once; `as materialized` says so
-- out loud rather than leaving the evaluation count to that rule.
--
-- bev_of_period_at stays `security invoker` and ungranted, and so does its
-- public wrapper's behaviour: see the privilege argument in the header.
-- get_bev_of_period() is not touched.
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
         r.price_tier, r.price_estimated, r.rating_count, r.bayes::numeric(4,2)
    from ranked r
   where r.rn = 1
   order by r.period;
$$;

alter function public.bev_of_period_at(timestamptz, boolean) owner to postgres;
revoke execute on function public.bev_of_period_at(timestamptz, boolean) from public, anon, authenticated;

-- ============================================================================
-- 7. get_bev_leaderboard -- bayes_score as numeric(4,2)
-- ============================================================================
-- 20261019000200's definition with the returned column narrowed to
-- numeric(4,2), so it agrees with bev_stats.bayes_score, bev_of_period_at and
-- the FakeApi's round2. `returns table` cannot change in place, which is why
-- this is a drop-and-recreate and why the owner/revoke/grant block below is
-- mandatory rather than defensive (the same reason 20261014000300 gives for
-- get_feed). Nothing else about the function changes: same arguments, same
-- eligibility (rating_count >= 2 = MIN_RATERS), same age gate, same order.
drop function if exists public.get_bev_leaderboard(text, int);

create function public.get_bev_leaderboard(p_category_id text default null, p_limit int default 50)
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
  bayes_score   numeric(4,2)
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
  -- instead of once per call.
  with prior as materialized (select public.bayes_prior(p_category_id) as m)
  select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
         b.price_tier, s.rating_count, s.avg_score,
         public.bayes_score(s.sum_score, s.rating_count, p.m, 3)::numeric(4,2)
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
   -- break a name tie the same way. The sort key is the UNROUNDED score, as in
   -- the package: leaderboardOrder() sorts on bayesianAverage()'s own output and
   -- the FakeApi rounds only when it builds the row.
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
-- 8. Bootstrap -- don't leave category_stats empty until the first cron tick
-- ============================================================================
-- The 'refresh-global-stats' cron job (20261011000800) runs the function above,
-- so the schedule needs no change. Without this call every category would read
-- as 0 rankings -- and so take the global prior -- for up to 15 minutes after
-- this migration applies, which would silently move every per-category
-- leaderboard in that window.
select public.refresh_global_stats();
