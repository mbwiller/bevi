-- A-04 + S-04 (20261019000300): Explore, a read-only popularity surface.
--
-- get_explore returns RANKING posts by users up to two follows away from the
-- caller whom the caller does NOT already follow (so every Explore post is a
-- stranger's), never the caller's own, ordered by a time-decayed like count.
--
-- Decisions this encodes:
--   D-01 (2026-10-19): two hops, and a global fallback while Bevi has fewer
--     than 20 users -- a two-hop graph of six people is empty, and an empty
--     Explore tab is worse than a wide one. The fallback still excludes the
--     caller and everyone they follow, so the tab never repeats the feed.
--   D-15 (2026-10-19): Explore posts are READ-ONLY. The returned rows carry
--     no like or comment data at all: no like_count, liked_by_me,
--     comment_count and no inline comments. Like counts are used only inside
--     the ORDER BY, and never leave the function (not even folded into a
--     returned score or a cursor -- see "Paging" below). feed_event_visible
--     is NOT touched, so likes and comments stay follower-only everywhere:
--     like_post on an Explore post is still BEVI_NOT_FOUND, by design.
--
-- The row shape is get_feed's (20261014000300) minus those four columns, in
-- the same order, so the app's feed mapper can be reused. in_my_want_to_try
-- stays: it is the caller's own bookmark, not another user's engagement.
--
-- Visibility deliberately does NOT go through feed_event_visible(): that
-- helper answers "do I follow this actor?", which is false for every Explore
-- post. The alcohol half of it is reproduced exactly as get_feed spells it
-- (`b.id is null or not c.is_alcoholic or viewer_is_adult()`), so an under-21
-- caller never sees an alcoholic Bev here either.
--
-- No new table, so no new RLS policy. post_likes is read inside a security
-- definer function owned by postgres, which is what lets the ordering count
-- likes on posts the caller cannot see individually.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. explore_hotness: the one place the decay constants live
-- ---------------------------------------------------------------------------
-- docs/bevi-ranking-math.tex §10.4, eq. (hot):
--
--     hot(p, t) = (likes_p + 1) / (h + 2)^gamma_hot,   gamma_hot = 1.5
--
-- with h the post's age in hours. The gravity 1.5 and the +2 softening
-- appear here and nowhere else in the schema, so they cannot drift from the
-- paper; get_explore (and any later get_popular_bevs) must call this.
--
-- No `set search_path` on purpose: the body touches no tables, `power` and
-- the arithmetic operators resolve from pg_catalog, which always precedes the
-- search path, and leaving the SET off keeps the function inlinable by the
-- planner (it is evaluated once per candidate post).

create or replace function public.explore_hotness(
  p_like_count bigint,
  p_age_hours  numeric
)
returns numeric
language sql
immutable
parallel safe
as $$
  select (coalesce(p_like_count, 0) + 1)::numeric
           / pg_catalog.power(greatest(coalesce(p_age_hours, 0), 0::numeric) + 2, 1.5);
$$;

comment on function public.explore_hotness(bigint, numeric) is
  'Time-decayed post popularity, docs/bevi-ranking-math.tex 10.4: (likes + 1) / (age_hours + 2)^1.5. The only copy of gamma_hot and the +2.';

-- ---------------------------------------------------------------------------
-- 2. get_explore
-- ---------------------------------------------------------------------------
-- Paging: OFFSET paging, over an ordering frozen per request.
--
-- A decaying score reorders rows between calls, so a keyset cursor on the
-- score is not an option -- and it would have to carry a like-derived number
-- out of the function, which D-15 forbids. Instead the caller passes the
-- request's own clock back in as `p_before`:
--
--   * `p_before` is the snapshot instant. Ages are measured from it and only
--     posts created at or before it are candidates, so pages 2..n see exactly
--     the ordering page 1 was built from. Null means "now". The client sends
--     its own clock, so a few minutes ahead of the server is accepted as
--     ordinary skew (nothing is created in the future, so a slightly future
--     snapshot only shifts every age by the same amount); further ahead than
--     that is clamped, which costs the caller nothing but its own ordering.
--   * `p_offset` is how many rows of that frozen ordering to skip.
--
-- The cursor is therefore a timestamp and an integer and leaks nothing: no
-- like counts, no scores, no other user's rows. (packages/api packs the two
-- into its opaque base64 cursor.)
--
-- Known and accepted: freezing the clock removes the continuous drift that
-- would otherwise reshuffle every row between pages, but a like arriving
-- mid-paging can still nudge two adjacent posts past each other, repeating or
-- skipping one row. For a discovery tab that is a fair trade against leaking
-- a like-derived cursor.

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
  v_now    timestamptz;
  v_limit  int  := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  -- D-01: below this many profiles the two-hop scope widens to everyone.
  v_global boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  v_now := least(coalesce(p_before, now()), now() + interval '5 minutes');
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
             public.bayes_score(
               s.sum_score, s.rating_count,
               coalesce((select gs.mean_score from public.global_stats gs limit 1), 0),
               3
             )::numeric            as bev_bayes_score,
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
               (extract(epoch from (v_now - e.created_at)) / 3600.0)::numeric
             )                     as hot
        from public.feed_events e
        join scope sc on sc.user_id = e.actor_id
        join public.profiles p on p.id = e.actor_id
        left join public.bevs b on b.id = e.bev_id
        left join public.categories c2 on c2.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
        left join public.rankings r on r.id = e.ranking_id
       where e.kind in ('ranked', 'reranked')
         and e.created_at <= v_now
         and (b.id is null or not c2.is_alcoholic or public.viewer_is_adult())
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

comment on function public.get_explore(int, timestamptz, int) is
  'Explore (A-04): read-only RANKING posts by users two follows away whom the caller does not follow, hottest first. No like or comment fields (D-15).';

-- get_popular_bevs(p_days) is listed as optional in A-04 and nothing consumes
-- it yet (the Bev-level "most liked" list has no screen and no contract
-- method), so it is deliberately NOT built here: it would need its own row
-- shape, grants, tests and a second answer to "may a stranger's likes be
-- summarised to you?". When a surface wants it, it calls explore_hotness()
-- above and sums it per Bev over the window -- §10.4's pop_W(b). Likewise
-- get_popular_venues is not built: venues are P2 and the table does not exist.

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
-- explore_hotness is an internal helper: it is called from inside
-- get_explore, where the current user is the owner, so `authenticated` needs
-- no privilege on it.

alter function public.explore_hotness(bigint, numeric) owner to postgres;
alter function public.get_explore(int, timestamptz, int) owner to postgres;

revoke execute on function
  public.explore_hotness(bigint, numeric),
  public.get_explore(int, timestamptz, int)
from public, anon;

grant execute on function public.get_explore(int, timestamptz, int) to authenticated;
