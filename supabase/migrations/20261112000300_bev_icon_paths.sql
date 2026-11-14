-- Every Bev a read returns carries its icon path (20261112000300): contract
-- 2.13.0, additive only.
--
-- WHAT. BevSummary gains `iconUrl`: the Bev's authored icon (drawn art, not a
-- photo), null when it has none. 20261112000200 created `public.bev_icons`
-- (one row per Bev that has an icon; `path` is the object key in the public
-- `bev-icons` bucket). This migration makes every read path that returns a
-- Bev's image also return that path, so packages/api can map it to a public
-- URL and the app can stop resolving icons from its bundled lookup. A Bev's
-- image stays photo > icon > category art; that order is the app's
-- (`bevImageProps`), not SQL's, so the photo columns are untouched.
--
-- WHY HERE AND NOT IN THE APP. The app's bundled lookup (bevIcons.generated.ts)
-- needs an app deploy for every new icon. Reading the path from the database
-- means a published icon reaches every client on its next read.
--
-- THE COLUMN. Appended as the LAST column of each `returns table`, so no
-- existing column moves:
--   * `icon_path text` where the function returns the Bev's own columns
--     (`photo_path`, `thumb_path`);
--   * `bev_icon_path text` where the columns are prefixed (`bev_thumb_path`,
--     `bev_photo_path`);
--   * in get_prediction_snapshot's jsonb, a 14th element on each `bevs`
--     tuple, after `bayes_score`, so every existing index (`b ->> 8` is
--     is_alcoholic, ...) keeps its meaning.
-- The value is a scalar subquery on bev_icons' primary key, in the outermost
-- select wherever the Bev's id is in scope there:
--     (select bi.path from public.bev_icons bi where bi.bev_id = <the Bev>)
-- null when the Bev has no row. Every function here but one is security
-- definer owned by postgres, so bev_icons' RLS does not apply inside it;
-- which Bevs a caller sees is decided, as before, by the function's own Bev
-- filter, and the icon adds no row. The one, bev_of_period_at, is security
-- invoker, but its only caller is get_bev_of_period, a definer owned by
-- postgres, so it runs as postgres too.
--
-- WHAT THIS FILE RE-CREATES, each from its newest definition, VERBATIM except
-- the new column, its select expression and the `drop` (a `returns table`
-- cannot be changed by `create or replace`):
--
--   bev_of_period_at(timestamptz, boolean)   from 20261101000300   + bev_icon_path
--   get_bev_of_period()                      from 20261018000100   + bev_icon_path (select * threads it)
--   get_bev(uuid)                            from 20261102000100   + icon_path
--   get_bev_leaderboard(text, int)           from 20261101000300   + icon_path
--   get_feed(int, bigint)                    from 20261111000100   + bev_icon_path
--   get_user_feed(uuid, int, bigint)         from 20261111000100   + bev_icon_path
--   get_explore(int, timestamptz, int)       from 20261101000300   + bev_icon_path
--   get_featured()                           from 20261012000700   + bev_icon_path
--   get_similar_bevs(uuid, int)              from 20261019000500   + icon_path
--   search_bevs(text, text, int)             from 20261102000200   + icon_path
--   venue_detail(uuid)                       from 20261102000400   + bev_icon_path
--   get_prediction_snapshot()                from 20261110000100   + bevs[i][13], via its `visible` CTE
--                                            (returns jsonb: create or replace, no drop)
--
-- A drop loses the owner, the grants and the comment, so each function is
-- followed by the state the migrations left it in: the owner, revoke and grant
-- statements of its newest definition or of a later migration, and its
-- `comment on function` where it had one (get_explore, get_similar_bevs).
-- Where the newest definition never stated an owner (get_bev_of_period,
-- get_bev, get_featured, search_bevs), `owner to postgres` is stated now: it is
-- the role every migration runs as, so it is the owner they already have.
-- Nothing depends on these functions: no view, policy or trigger calls them,
-- and the one function that calls another (get_bev_of_period ->
-- bev_of_period_at) is `language sql` without `begin atomic`, so Postgres
-- records no dependency; it is dropped first and re-created last anyway.
--
-- WHAT DOES NOT CHANGE:
--   * No table, index, policy, trigger, grant to a new role, or bucket.
--   * Which rows any function returns, their order, and every existing column.
--   * find_similar_bevs is NOT re-created here: open PR #197 re-creates it in
--     20261112000100, and two migrations re-creating one function silently
--     revert each other. packages/api maps its missing column to a null
--     iconUrl until a follow-up adds it.
--   * rankings.list*, wantToTry.list and bevs.getStarterCandidates read Bevs
--     through PostgREST (`bevs(*, bev_stats(*))`); they gain an embedded
--     `bev_icons(path)` in packages/api and need no SQL.
--   * create_bev, submit_ranking, rerank_bev, list_bucket_bevs,
--     get_bev_similarities and merge_bev return no BevSummary.
--
-- ORDER OF DEPLOYMENT. An older client ignores a column it does not know, so
-- this is safe to push before the app that reads it. packages/api reads every
-- new RPC column as optional, so its RPC reads are safe against a database
-- without this migration too. Its three PostgREST embeds are not: they name
-- `bev_icons`, so 20261112000200 must be on the database before the client
-- that embeds it is deployed.
--
-- `set search_path` for the session, as 20261102000200 does: search_bevs'
-- body uses unaccent(), similarity() and `%` unqualified, and a `language sql`
-- body is checked at create time.

set search_path = public, extensions;

-- ============================================================================
-- 1. bev_of_period_at and get_bev_of_period -- Bev of the day / week
-- ============================================================================
-- bev_of_period_at: 20261101000300 section 9 (the newest), with
-- bev_icon_path appended and its value read for the winner in the final
-- select (at most two rows). get_bev_of_period: 20261018000100 (never
-- re-created since), with the same column appended to its `returns table`;
-- its `select *` carries the new column through unchanged.
--
-- State restored: bev_of_period_at as 20261101000300 left it (owner postgres,
-- no client role may execute it); get_bev_of_period as 20261018000100 left it
-- (not public or anon, authenticated yes). Neither has a comment.
drop function if exists public.get_bev_of_period();
drop function if exists public.bev_of_period_at(timestamptz, boolean);

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
  bev_bayes_score      numeric(4,2),
  bev_icon_path        text
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
         r.price_tier, r.price_estimated, r.rating_count, round(r.bayes, 2)::numeric(4,2),
         (select bi.path from public.bev_icons bi where bi.bev_id = r.bev_id)
    from ranked r
   where r.rn = 1
   order by r.period;
$$;

alter function public.bev_of_period_at(timestamptz, boolean) owner to postgres;
revoke execute on function public.bev_of_period_at(timestamptz, boolean) from public, anon, authenticated;

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
  bev_bayes_score      numeric(4,2),
  bev_icon_path        text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select * from public.bev_of_period_at(now(), public.viewer_is_adult());
$$;

alter function public.get_bev_of_period() owner to postgres;
revoke execute on function public.get_bev_of_period() from public, anon;
grant execute on function public.get_bev_of_period() to authenticated;

-- ============================================================================
-- 2. get_bev -- the Bev detail
-- ============================================================================
-- 20261102000100 section 3 (the newest), with icon_path appended: read into
-- v_row with the rest of the Bev and returned last. State restored:
-- 20261102000100's revoke and grant. No comment.
drop function if exists public.get_bev(uuid);

create function public.get_bev(p_bev_id uuid)
returns table (
  id                   uuid,
  name                 text,
  brand                text,
  flavor               text,
  category_id          text,
  photo_path           text,
  nutrition_label_path text,
  price_tier           smallint,
  price_estimated      boolean,
  status               text,
  is_starter           boolean,
  created_at           timestamptz,
  created_by_id        uuid,
  created_by_handle    text,
  rating_count         integer,
  avg_score            numeric(4,2),
  score_stddev         numeric(4,2),
  bayes_score          numeric(4,2),
  icon_path            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  -- 20261101000500 walked `merged_into` inline here. The walk is now
  -- `resolve_bev_id`, so the write RPCs below follow a merge the same way.
  v_id  uuid := public.resolve_bev_id(p_bev_id);
begin
  select b.id, b.name, b.brand, b.flavor, b.category_id,
         b.photo_path, b.nutrition_label_path, b.price_tier, b.price_estimated,
         b.status, b.is_starter, b.created_at,
         p.id as creator_id, p.handle as creator_handle,
         c.is_alcoholic,
         coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score,
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id) as icon_path
    into v_row
  from public.bevs b
  join public.categories c on c.id = b.category_id
  left join public.profiles p on p.id = b.created_by
  left join public.bev_stats s on s.bev_id = b.id
  where b.id = v_id
    and (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = auth.uid()) or public.is_admin());

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  return query select
    v_row.id, v_row.name, v_row.brand, v_row.flavor, v_row.category_id,
    v_row.photo_path, v_row.nutrition_label_path, v_row.price_tier, v_row.price_estimated,
    v_row.status, v_row.is_starter, v_row.created_at,
    v_row.creator_id, v_row.creator_handle,
    v_row.rating_count, v_row.avg_score, v_row.score_stddev, v_row.bayes_score,
    v_row.icon_path;
end;
$$;

alter function public.get_bev(uuid) owner to postgres;
revoke execute on function public.get_bev(uuid) from public, anon;
grant execute on function public.get_bev(uuid) to authenticated;

-- ============================================================================
-- 3. get_bev_leaderboard -- the Bev board
-- ============================================================================
-- 20261101000300 section 5 (the newest), with icon_path appended. The ORDER
-- BY and the materialised prior are untouched. State restored: 20261101000300's
-- owner, revoke and grant. No comment.
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
  bayes_score   numeric,
  icon_path     text
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
         round(public.bayes_score(s.sum_score, s.rating_count, p.m, 3), 2)::numeric,
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
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
-- 4. get_feed and get_user_feed
-- ============================================================================
-- 20261111000100 sections 2 and 3 (the newest), with bev_icon_path appended
-- after also_bevd. `b.id` rather than `e.bev_id`, so a post whose Bev is gone
-- reads null like every other bev_* column. get_user_feed keeps returning
-- exactly get_feed's columns (07_user_feed). State restored: 20261111000100's
-- owner, revoke and grant for each. Neither has a comment.
drop function if exists public.get_feed(int, bigint);

create function public.get_feed(p_limit int default 20, p_before_id bigint default null)
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
  comments             jsonb,
  also_bevd            jsonb,
  bev_icon_path        text
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
         coalesce(ic.items, '[]'::jsonb),
         -- 2.12.0: the one added column. See feed_also_bevd above.
         public.feed_also_bevd(e.bev_id, e.actor_id),
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
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

drop function if exists public.get_user_feed(uuid, int, bigint);

create function public.get_user_feed(
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
  comments             jsonb,
  also_bevd            jsonb,
  bev_icon_path        text
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
           coalesce(ic.items, '[]'::jsonb),
           -- 2.12.0: the one added column. See feed_also_bevd above.
           public.feed_also_bevd(e.bev_id, e.actor_id),
           (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
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
-- 5. get_explore
-- ============================================================================
-- 20261101000300 section 8 (the newest), with bev_icon_path appended after
-- in_my_want_to_try and read in the final select, after the page is cut.
-- Its columns are no longer a strict prefix of get_feed's: both now end in
-- bev_icon_path, and 10_explore / 31_social_context compare them with that
-- last column set aside. State restored: 20261101000300's owner, revoke and
-- grant, and 20261019000400's comment (nothing since replaced it).
drop function if exists public.get_explore(int, timestamptz, int);

create function public.get_explore(
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
  in_my_want_to_try    boolean,
  bev_icon_path        text
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
           sc2.target_user_id, sc2.in_my_want_to_try,
           (select bi.path from public.bev_icons bi where bi.bev_id = sc2.bev_id)
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
comment on function public.get_explore(int, timestamptz, int) is
  'Explore (A-04): read-only RANKING posts by users two follows away whom the caller does not follow, hottest first. No like or comment fields (D-15).';

-- ============================================================================
-- 6. get_featured
-- ============================================================================
-- 20261012000700 (the newest), with bev_icon_path appended. State restored:
-- 20261012000700's revoke and grant. No comment.
drop function if exists public.get_featured();

create function public.get_featured()
returns table (
  id                   uuid,
  title                text,
  blurb                text,
  image_path           text,
  sort_order           smallint,
  starts_at            timestamptz,
  ends_at              timestamptz,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_rating_count     integer,
  bev_bayes_score      numeric(4,2),
  bev_icon_path        text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select f.id, f.title, f.blurb, f.image_path, f.sort_order, f.starts_at, f.ends_at,
         b.id, b.name, b.brand, b.flavor, b.category_id, coalesce(b.thumb_path, b.photo_path),
         b.price_tier, b.price_estimated, coalesce(s.rating_count, 0), s.bayes_score,
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
    from public.featured_bevs f
    join public.bevs b on b.id = f.bev_id
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where now() between f.starts_at and coalesce(f.ends_at, 'infinity'::timestamptz)
     and b.status = 'active'
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by f.sort_order, f.starts_at desc;
$$;

alter function public.get_featured() owner to postgres;
revoke execute on function public.get_featured() from public, anon;
grant execute on function public.get_featured() to authenticated;

-- ============================================================================
-- 7. get_similar_bevs -- "Bevs like this"
-- ============================================================================
-- 20261019000500 section 6 (never re-created since), with icon_path appended;
-- its columns stay search_bevs' columns, in the same order, so packages/api
-- still maps both with one function. State restored: 20261019000500 section
-- 8's owner, revoke and grant (service_role keeps the EXECUTE Supabase's
-- default privileges give it, as before), and its comment.
drop function if exists public.get_similar_bevs(uuid, int);

create function public.get_similar_bevs(
  p_bev_id uuid,
  p_limit  int default 10
)
returns table (
  id              uuid,
  name            text,
  brand           text,
  flavor          text,
  category_id     text,
  photo_path      text,
  thumb_path      text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  avg_score       numeric(4,2),
  bayes_score     numeric(4,2),
  icon_path       text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- Clamped like get_explore's. 50 rather than EDGE_TOP_K (20): the sync keeps
  -- each Bev's top 20, but an unordered pair survives if EITHER end wants it,
  -- so a popular Bev legitimately has more than 20 incident edges and capping
  -- at 20 would silently truncate real rows.
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    with anchor as (
      select b.id
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where b.id = p_bev_id
         and b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    ),
    -- Both stored orientations, flattened to (neighbour, weight). Each branch
    -- is a bounded scan of one of section 3's two indexes.
    neighbours as (
      select e.dst_bev_id as bev_id, e.weight
        from anchor a
        join public.bev_edges e on e.src_bev_id = a.id
      union all
      select e.src_bev_id as bev_id, e.weight
        from anchor a
        join public.bev_edges e on e.dst_bev_id = a.id
    )
    select b.id, b.name, b.brand, b.flavor, b.category_id,
           b.photo_path, b.thumb_path, b.price_tier, b.price_estimated,
           coalesce(s.rating_count, 0) as rating_count,
           s.avg_score,
           s.bayes_score,
           (select bi.path from public.bev_icons bi where bi.bev_id = b.id) as icon_path
      from neighbours n
      join public.bevs b on b.id = n.bev_id
      join public.categories c on c.id = b.category_id
      left join public.bev_stats s on s.bev_id = b.id
     where b.status = 'active'
       and (not c.is_alcoholic or public.viewer_is_adult())
     order by n.weight desc, b.id
     limit v_limit;
end;
$$;

alter function public.get_similar_bevs(uuid, int) owner to postgres;
revoke execute on function public.get_similar_bevs(uuid, int) from public, anon;
grant execute on function public.get_similar_bevs(uuid, int) to authenticated;
comment on function public.get_similar_bevs(uuid, int) is
  'S-14: the heaviest bev_edges neighbours of p_bev_id (A-16) as search_bevs'' BevSummary columns, active and age-filtered. Empty until the sync job lands.';

-- ============================================================================
-- 8. search_bevs
-- ============================================================================
-- 20261102000200 (the newest), with icon_path appended and read in the final
-- select, for the returned page only. State restored: 20261102000200's revoke
-- and grant. No comment.
drop function if exists public.search_bevs(text, text, int);

create function public.search_bevs(
  p_query text,
  p_category_id text default null,
  p_limit int default 20
)
returns table (
  id              uuid,
  name            text,
  brand           text,
  flavor          text,
  category_id     text,
  photo_path      text,
  thumb_path      text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  avg_score       numeric(4,2),
  bayes_score     numeric(4,2),
  icon_path       text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select x.text,
           array(select tok
                   from regexp_split_to_table(x.text, '\s+') as tok
                  where tok <> '') as toks
      from (select lower(unaccent(p_query)) as text) x
  ),
  m as (
    select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
           b.price_tier, b.price_estimated,
           coalesce(s.rating_count, 0) as rating_count,
           s.avg_score,
           s.bayes_score,
           not exists (select 1 from unnest(q.toks) as t(tok)
                        where strpos(' ' || h.hay, ' ' || t.tok) = 0) as word_hit,
           not exists (select 1 from unnest(q.toks) as t(tok)
                        where strpos(h.hay, t.tok) = 0) as tok_hit,
           (unaccent(b.search_text) % q.text
            or exists (select 1 from public.bev_aliases a
                        where a.bev_id = b.id and a.alias % q.text)) as trgm_hit,
           greatest(
             similarity(q.text, unaccent(b.search_text)),
             coalesce((select max(similarity(q.text, a2.alias))
                         from public.bev_aliases a2 where a2.bev_id = b.id), 0)
           ) as sim
      from public.bevs b
      cross join q
      join public.categories c on c.id = b.category_id
      left join public.bev_stats s on s.bev_id = b.id
      cross join lateral (
        select string_agg(a3.alias, ' ') as aliases
          from public.bev_aliases a3
         where a3.bev_id = b.id
      ) al
      cross join lateral (
        select regexp_replace(
                 lower(unaccent(b.search_text || ' ' || c.name || ' ' || coalesce(al.aliases, ''))),
                 '\s+', ' ', 'g') as hay
      ) h
     where b.status = 'active'
       and (p_category_id is null or b.category_id = p_category_id)
       and (not c.is_alcoholic or public.viewer_is_adult())
       and cardinality(q.toks) > 0
  ),
  r as (
    select m.*,
           case when m.word_hit then 0 when m.tok_hit then 1 else 2 end as tier
      from m
     where m.tok_hit
        or (m.trgm_hit and not exists (select 1 from m as m2 where m2.tok_hit))
  )
  select r.id, r.name, r.brand, r.flavor, r.category_id, r.photo_path, r.thumb_path,
         r.price_tier, r.price_estimated, r.rating_count, r.avg_score, r.bayes_score,
         (select bi.path from public.bev_icons bi where bi.bev_id = r.id)
    from r
   order by r.tier,
            case when r.tier = 2 then r.sim end desc nulls last,
            r.rating_count desc,
            r.sim desc,
            r.name collate "C",
            r.id
   limit p_limit;
$$;

alter function public.search_bevs(text, text, int) owner to postgres;
revoke execute on function public.search_bevs(text, text, int) from public, anon;
grant execute on function public.search_bevs(text, text, int) to authenticated;

-- ============================================================================
-- 9. venue_detail
-- ============================================================================
-- 20261102000400 section 4 (the newest), with bev_icon_path appended. State
-- restored: 20261102000400's owner, revoke and grant. No comment.
drop function if exists public.venue_detail(uuid);

create function public.venue_detail(p_venue_id uuid)
returns table (
  venue_id      uuid,
  name          text,
  kind          text,
  lat           double precision,
  lng           double precision,
  address       text,
  neighborhood  text,
  borough       text,
  hours_osm     text,
  hours_known   boolean,
  website       text,
  open_now      boolean,
  bev_id        uuid,
  bev_name      text,
  bev_brand     text,
  bev_flavor    text,
  bev_category_id text,
  bev_photo_path  text,
  bev_price_tier  smallint,
  bev_price_estimated boolean,
  bev_rating_count integer,
  bev_bayes_score  numeric(4,2),
  bev_icon_path    text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.venues;
  v_now timestamptz := now();
  v_n   integer;
  v_adult boolean;
  v_open  boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  v_adult := public.viewer_is_adult();

  select * into v_row from public.venues v
   where v.id = p_venue_id and v.status = 'active';

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) into v_n
    from public.venue_bevs vb
    join public.bevs b on b.id = vb.bev_id and b.status = 'active'
    join public.categories c on c.id = b.category_id
   where vb.venue_id = p_venue_id
     and (not c.is_alcoholic or v_adult);

  if v_n = 0 then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- As in venues_in_view: `hours_known` is what the evaluator understood, so
  -- it is true exactly when `open_now` is not null.
  v_open := case when v_row.hours_known then public.venue_open_at(v_row.hours_osm, v_now) end;

  return query
  select v_row.id, v_row.name, v_row.kind, v_row.lat, v_row.lng, v_row.address,
         v_row.neighborhood, v_row.borough, v_row.hours_osm, v_open is not null, v_row.website,
         v_open,
         b.id, b.name, b.brand, b.flavor, b.category_id,
         coalesce(b.thumb_path, b.photo_path),
         b.price_tier, b.price_estimated,
         coalesce(s.rating_count, 0), s.bayes_score,
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
    from public.venue_bevs vb
    join public.bevs b on b.id = vb.bev_id and b.status = 'active'
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where vb.venue_id = p_venue_id
     and (not c.is_alcoholic or v_adult)
   order by s.bayes_score desc nulls last, b.name collate "C" asc, b.id asc;
end;
$$;

alter function public.venue_detail(uuid) owner to postgres;
revoke execute on function public.venue_detail(uuid) from public, anon;
grant execute on function public.venue_detail(uuid) to authenticated;

-- ============================================================================
-- 10. get_prediction_snapshot -- one more element per `bevs` tuple
-- ============================================================================
-- 20261110000100 section 4 (the newest), with `icon_path` added to the
-- `visible` CTE and appended to each `bevs` tuple, which becomes
--   [id, name, brand, flavor, category_id, price_tier, price_estimated,
--    photo_path, is_alcoholic, rating_count, avg_score, score_stddev,
--    bayes_score, icon_path]
-- It returns jsonb, so `create or replace` keeps the owner and the grants;
-- they are restated as 20261110000100 states them.
create or replace function public.get_prediction_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_adult boolean;
  v_tz    text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  select timezone into v_tz from public.profiles where id = v_uid;
  v_adult := public.viewer_is_adult();

  return (
    with ranked as (
      select r.user_id, r.bev_id, r.score::float8 as score, b.category_id, c.is_alcoholic
        from public.rankings r
        join public.bevs b on b.id = r.bev_id
        join public.categories c on c.id = b.category_id
    ),
    raters as (
      select distinct user_id from ranked
      union
      select v_uid
    ),
    aliases as (
      select user_id,
             case when user_id = v_uid then user_id::text
                  else 'u' || row_number() over (order by user_id) end as alias
        from raters
    ),
    visible as (
      select b.id, b.name, b.brand, b.flavor, b.category_id, b.price_tier, b.price_estimated,
             coalesce(b.thumb_path, b.photo_path) as photo_path, c.is_alcoholic,
             coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score,
             (select bi.path from public.bev_icons bi where bi.bev_id = b.id) as icon_path
        from public.bevs b
        join public.categories c on c.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
       where b.status = 'active'
         and (v_adult or not c.is_alcoholic)
    )
    select jsonb_build_object(
      'generatedAt', now(),
      'viewer', jsonb_build_object(
        'id', v_uid,
        'timezone', v_tz,
        'canSeeAlcohol', v_adult,
        'rankingCount', (select count(*) from ranked where user_id = v_uid)
      ),
      'global', jsonb_build_object(
        'n', (select count(*) from ranked),
        'mean', (select avg(score) from ranked),
        'stddev', (select stddev_pop(score) from ranked),
        'byCategoryMean', coalesce((
          select jsonb_object_agg(category_id, m)
            from (select category_id, avg(score) as m from ranked
                   where v_adult or not is_alcoholic group by category_id) x
        ), '{}'::jsonb)
      ),
      'users', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.n, x.mean, x.sd))
          from (select user_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked group by user_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'categoryStats', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.category_id, x.n, x.mean, x.sd))
          from (select user_id, category_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked where v_adult or not is_alcoholic group by user_id, category_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'bevs', coalesce((
        select jsonb_agg(jsonb_build_array(
                 id, name, brand, flavor, category_id, price_tier, price_estimated, photo_path,
                 is_alcoholic, rating_count, avg_score, score_stddev, bayes_score, icon_path))
          from visible
      ), '[]'::jsonb),
      'rankings', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, r.bev_id, r.score))
          from ranked r
          join aliases a on a.user_id = r.user_id
         where exists (select 1 from visible v where v.id = r.bev_id)
      ), '[]'::jsonb),
      -- S-21: every stored edge touching a Bev the caller ranked, both ends
      -- visible, all rows, in a fixed order.
      'edges', coalesce((
        select jsonb_agg(jsonb_build_array(e.src_bev_id, e.dst_bev_id, e.weight)
                         order by e.src_bev_id, e.dst_bev_id)
          from public.bev_edges e
         where (e.src_bev_id in (select bev_id from ranked where user_id = v_uid)
                or e.dst_bev_id in (select bev_id from ranked where user_id = v_uid))
           and exists (select 1 from visible v where v.id = e.src_bev_id)
           and exists (select 1 from visible v where v.id = e.dst_bev_id)
      ), '[]'::jsonb),
      -- Stage 4: the viewer's stored taste neighbours, aliased exactly as in
      -- `users` and `rankings`; no version filter (see the header).
      'userNeighbors', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, n.sim, n.common)
                         order by n.sim desc, n.neighbor_id)
          from public.user_neighbors n
          join aliases a on a.user_id = n.neighbor_id
         where n.user_id = v_uid
      ), '[]'::jsonb),
      -- A-16 (4): each visible Bev's graph signals as
      -- [bev_id, community_id, pagerank, bridge], in bev_id order; rounded to
      -- keep the payload small, no version filter (see the header).
      'bevGraph', coalesce((
        select jsonb_agg(jsonb_build_array(g.bev_id, g.community_id,
                                           round(g.pagerank::numeric, 8)::float8,
                                           round(g.bridge::numeric, 4)::float8)
                         order by g.bev_id)
          from public.bev_graph_stats g
         where exists (select 1 from visible v where v.id = g.bev_id)
      ), '[]'::jsonb)
    )
  );
end;
$$;

alter function public.get_prediction_snapshot() owner to postgres;
revoke execute on function public.get_prediction_snapshot() from public, anon;
grant execute on function public.get_prediction_snapshot() to authenticated;
