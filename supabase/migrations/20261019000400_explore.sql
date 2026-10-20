-- A-04 + S-04 (20261019000400): Explore, a read-only popularity surface.
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
-- No `set search_path` on purpose: the body touches no tables, and leaving the
-- SET off keeps the function inlinable by the planner (a SQL function with a
-- SET clause never is, and this is evaluated once per candidate post).
--
-- That means operator resolution matters, and the rule is narrower than
-- "pg_catalog wins". pg_catalog is searched first for a *name*, but an
-- operator is resolved by preferring an exact argument-type match over schema
-- order. So every literal below is cast so its operator pair exists in
-- pg_catalog exactly: `+ 2::numeric` is `numeric + numeric`, not
-- `numeric + integer`, for which pg_catalog has no operator at all (it gets
-- there by implicit cast) and which a user-created
-- `operator +(numeric, integer)` on the search path would therefore win. That
-- would matter because get_explore calls this as a definer owned by postgres.
-- `power` is written pg_catalog.power for the same reason.

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
           / pg_catalog.power(
               greatest(coalesce(p_age_hours, 0::numeric), 0::numeric) + 2::numeric,
               1.5::numeric
             );
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
-- out of the function, which D-15 forbids. So the candidate set is frozen by a
-- timestamp the caller sends, and the rows are skipped by offset:
--
--   * `p_before` is the paging CUT only: posts created after it are not
--     candidates, so pages 2..n see the same set page 1 was built from. Null
--     means "now". It is clamped on BOTH sides -- a few minutes of forward
--     clock skew is ordinary, and 30 days back is further than any page needs.
--   * `p_offset` is how many rows to skip, capped at 1000 (20 pages).
--
-- `p_before` is deliberately NOT the decay clock. An earlier revision of this
-- function used it for both, and that leaks the exact like counts the schema
-- withholds. The decay is non-linear, so moving the clock does not shift the
-- order uniformly: two posts P and Q swap exactly when
--
--     (L_P + 1) / (L_Q + 1) = ((h_P + 2) / (h_Q + 2)) ^ 1.5
--
-- The caller knows both `created_at` values (they are returned columns) and,
-- if it also chose the clock, knows both ages exactly -- so binary-searching
-- `p_before` for the swap point reads off the like-count RATIO of two
-- strangers' posts, and anchoring on any post with no likes turns the ratios
-- into exact counts. `post_likes_select` (20261014000200) gates on
-- feed_event_visible, which is false for every Explore post, so that is data
-- the caller cannot read a single row of. Hence:
--
--   * the decay clock is `now()`, read inside the function. There is no knob,
--     so there is nothing to sweep and the equation above has no free variable
--     the caller controls.
--
-- Residual, and a product decision rather than a bug: ANY like-ordered
-- surface discloses the partial order of like counts, so one page still
-- bounds the ratios even with a fixed clock. Tightening that means ranking
-- off a cron-materialised dense rank, or bucketing `hot` into coarse tiers
-- and shuffling within a tier. Not this PR.
--
-- Known and accepted: a like arriving mid-paging can still nudge two adjacent
-- posts past each other, repeating or skipping one row.

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
               (extract(epoch from (v_snap - e.created_at)) / 3600.0)::numeric
             )                     as hot
        from public.feed_events e
        join scope sc on sc.user_id = e.actor_id
        join public.profiles p on p.id = e.actor_id
        left join public.bevs b on b.id = e.bev_id
        left join public.categories c2 on c2.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
        left join public.rankings r on r.id = e.ranking_id
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
-- 3. The index the recency bound needs
-- ---------------------------------------------------------------------------
-- feed_events had no index on created_at at all: the only one is
-- feed_events_actor_idx (actor_id, id desc) from 20261009000700, which serves
-- get_feed's `actor_id in (...) order by id desc` and is no use to Explore,
-- whose scope is a two-hop set and whose order is not indexable.
--
-- Not partial on `kind`: feed_events_kind_check (20261014000100) already
-- restricts kind to ('ranked','reranked'), so every row qualifies and the
-- predicate would only cost the planner a proof.
create index if not exists feed_events_created_idx
  on public.feed_events (created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- explore_hotness is an internal helper: it is called from inside
-- get_explore, where the current user is the owner, so `authenticated` needs
-- no privilege on it.
--
-- `from public` strips Postgres's implicit grant to PUBLIC; anon, authenticated
-- and service_role are named separately because Supabase's default privileges
-- lay down *direct* grants to all three on every new function in this schema,
-- which a revoke from PUBLIC does not touch. Without naming them the comment
-- above would be false -- authenticated would keep EXECUTE -- and the pgTAP
-- assertion below would be testing only the half that already passed.

alter function public.explore_hotness(bigint, numeric) owner to postgres;
alter function public.get_explore(int, timestamptz, int) owner to postgres;

revoke execute on function public.explore_hotness(bigint, numeric)
  from public, anon, authenticated, service_role;

revoke execute on function public.get_explore(int, timestamptz, int)
  from public, anon;

grant execute on function public.get_explore(int, timestamptz, int) to authenticated;
