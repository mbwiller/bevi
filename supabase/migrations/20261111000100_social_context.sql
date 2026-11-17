-- Social context (20261111000100): contract 2.12.0, additive only.
--
-- Three things the redesigned Feed, Leaderboard and Find-people screens show,
-- none of which the backend could answer in one bounded call:
--
--   1. "Also Bev'd by ana, ben and 2 others" on a post
--        FeedItem.alsoBevdBy / alsoBevdCount
--        -> one new column, `also_bevd`, on get_feed and get_user_feed.
--   2. A leaderboard among friends
--        leaderboard.friends()
--        -> a new RPC, get_friends_leaderboard.
--   3. "Followed by cat and 2 others" on a suggested person
--        follows.suggested() -> SuggestedProfile.followedBy / followedByCount
--        -> a new RPC, get_followed_by.
--
-- WHAT THIS FILE CREATES AND RE-CREATES
--
--   feed_also_bevd(uuid, uuid)          NEW, internal (no client role may call it)
--   get_feed(int, bigint)               RE-CREATED from 20261101000300, + 1 column
--   get_user_feed(uuid, int, bigint)    RE-CREATED from 20261101000300, + 1 column
--   get_friends_leaderboard(int, int)   NEW
--   get_followed_by(uuid[])             NEW
--
-- No table, index, policy or trigger changes. get_explore is NOT touched: an
-- ExplorePost does not carry the new fields (shared/src/types.ts), and
-- 10_explore.test.sql's "get_explore's columns are a prefix of get_feed's"
-- still holds because the new column is appended at the end.
--
-- THERE IS NO `suggested` SQL FUNCTION TO RE-CREATE. follows.suggested() picks
-- its people in packages/api (the 50 highest user_stats.rating_count, minus
-- the caller and the people they follow, first 10). That selection and its
-- order are unchanged by this PR; get_followed_by only decorates the ids it
-- is handed.
--
-- NOTHING NEW BECOMES VISIBLE. Every fact these functions return is one the
-- caller can already read:
--   * who follows whom: follows_select is `using (true)` for authenticated;
--   * who ranked what, and their score and bucket: rankings_select, any
--     signed-in user, gated on the Bev's category being non-alcoholic or the
--     VIEWER being 21+. feed_also_bevd applies that same predicate itself
--     rather than relying on its callers (which already hide the whole post
--     from an under-21 caller);
--   * a profile's handle, display name, avatar, timezone, onboarded flag and
--     created_at: the columns profiles_view shows for anyone. No birth_date,
--     and no can_see_alcohol for anyone but the caller (get_user_leaderboard's
--     own expression, copied).
--   * rank points: get_user_leaderboard already lists every ranked user's.
--
-- SECURITY MODEL. As everywhere since 20261011000100: security definer, owned
-- by postgres, a pinned search_path, auth.uid() as the only notion of "the
-- caller", nothing for public or anon, execute for authenticated on the RPCs
-- only. The two re-created functions keep their language, volatility,
-- search_path, owner and grants exactly as 20261101000300 left them.

set search_path = public, extensions;

-- ============================================================================
-- 1. feed_also_bevd -- who else, among the people the caller follows, ranked it
-- ============================================================================
-- One definition for both feed functions (the reason feed_event_visible is a
-- function, 20261014000200). Returns ONE jsonb value so each feed function
-- gains one select-list expression and one column:
--
--   {"count": 4,
--    "items": [{"user_id": ..., "handle": ..., "display_name": ...,
--               "avatar_path": ..., "timezone": ..., "onboarded": ...,
--               "created_at": ..., "score": 8.20, "bucket": 3}, ...]}
--
-- WHO IS IN IT: the caller's followees who have a ranking of `p_bev_id`,
-- except the post's actor. The caller is never in it: follows has
-- `check (follower_id <> followee_id)`, and the predicate says so again in
-- case that check is ever relaxed.
--
-- `count` is all of them; `items` is the first three in
-- `ranked_at desc, user_id asc`. ranked_at is "most recently ranked": a
-- re-rank deletes and re-inserts the row (20261018000100's note), so it is
-- the time of the ranking that stands. The user_id makes the order total.
-- Both come from one pass over one row set (count(*) and a filtered
-- jsonb_agg over the same subquery), so they cannot disagree.
--
-- `created_at` is the PROFILE's, as in the inline comments' author_created_at.
-- The profile keys are the ones get_followed_by uses, so packages/api maps
-- both with one function.
--
-- THE AGE GATE is rankings_select's predicate, word for word: the Bev's
-- category is not alcoholic, or the viewer is 21+. Both feed functions already
-- drop an alcoholic Bev's post for an under-21 caller before this is ever
-- evaluated for it; the predicate is here so the function is right on its own.
--
-- COST. Driven from follows' primary key (follower_id = the caller), then one
-- probe of rankings' unique (user_id, bev_id) per followee -- or, if the
-- planner prefers, from rankings_bev_idx with a probe of the follows key per
-- ranking. Either way it is index probes bounded by the smaller of "people I
-- follow" and "people who ranked this Bev". It is a select-list expression,
-- like the like and comment counts beside it, rather than another lateral
-- join: Postgres postpones an expensive select-list expression past an
-- ORDER BY ... LIMIT (since 9.6), so in a plan that sorts it should run once
-- per returned post rather than once per candidate post. Not measured: this
-- migration was written on a machine with no local database, so CI's pgTAP
-- run is its first execution and nobody has looked at a plan yet.
--
-- A null `p_bev_id` (a feed row whose Bev is gone) matches nothing and gives
-- {"count": 0, "items": []}, as does a caller with no session.
--
-- `stable`, definer, and revoked from every client role: called directly it
-- would answer for any (Bev, actor) pair, which is nothing rankings_select
-- does not already allow, but no client has a reason to.
create function public.feed_also_bevd(p_bev_id uuid, p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
           'count', count(*),
           'items', coalesce(
                      jsonb_agg(
                        jsonb_build_object(
                          'user_id', t.user_id,
                          'handle', t.handle,
                          'display_name', t.display_name,
                          'avatar_path', t.avatar_path,
                          'timezone', t.timezone,
                          'onboarded', t.onboarded,
                          'created_at', t.created_at,
                          'score', t.score,
                          'bucket', t.bucket
                        )
                        order by t.rn
                      ) filter (where t.rn <= 3),
                      '[]'::jsonb
                    )
         )
    from (
      select r.user_id, r.score, r.bucket,
             fp.handle, fp.display_name, fp.avatar_path, fp.timezone, fp.onboarded, fp.created_at,
             row_number() over (order by r.ranked_at desc, r.user_id asc) as rn
        from public.follows f
        join public.rankings r on r.user_id = f.followee_id and r.bev_id = p_bev_id
        join public.bevs b on b.id = r.bev_id
        join public.categories c on c.id = b.category_id
        join public.profiles fp on fp.id = r.user_id
       where f.follower_id = auth.uid()
         and f.followee_id <> auth.uid()
         and f.followee_id is distinct from p_actor_id
         and (not c.is_alcoholic or public.viewer_is_adult())
    ) t;
$$;

alter function public.feed_also_bevd(uuid, uuid) owner to postgres;
revoke execute on function public.feed_also_bevd(uuid, uuid) from public, anon, authenticated;

comment on function public.feed_also_bevd(uuid, uuid) is
  'Contract 2.12.0, internal: {"count", "items"} of the caller''s followees, other than p_actor_id, who ranked p_bev_id; items are the 3 most recently ranked. Age-gated like rankings_select. Called by get_feed and get_user_feed only.';

-- ============================================================================
-- 2. get_feed gains also_bevd
-- ============================================================================
-- 20261101000300's definition (section 6 of that file, the newest: nothing
-- after it re-creates get_feed) VERBATIM, with exactly two additions:
--   * `also_bevd jsonb` appended to the returned columns, after `comments`;
--   * `public.feed_also_bevd(e.bev_id, e.actor_id)` appended to the select
--     list, after the inline comments.
-- Nothing in the FROM, the WHERE, the ORDER BY or the LIMIT moves.
--
-- A `returns table` cannot be changed by `create or replace`, so this is a
-- drop and a create, as 20261014000200 and 20261014000300 did it -- which
-- loses the owner and the grants, hence the three statements after the body.
-- They are 20261101000300's, unchanged.
--
-- An older client (contract <= 2.11.0) ignores a column it does not know, so
-- this migration is safe to push BEFORE the app that reads it is deployed.
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
  also_bevd            jsonb
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
         public.feed_also_bevd(e.bev_id, e.actor_id)
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
-- 3. get_user_feed gains the same column
-- ============================================================================
-- 20261101000300's definition (section 7 of that file, the newest) VERBATIM,
-- with the same two additions and nothing else. 20261018000300's rule stands:
-- "a change to get_feed's columns must be repeated here", and
-- 07_user_feed.test.sql still checks the two result types are equal.
--
-- `also_bevd` is relative to the CALLER, not to `p_user_id`: on ana's profile
-- it is still "who that I follow has also ranked this", minus ana.
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
  also_bevd            jsonb
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
           public.feed_also_bevd(e.bev_id, e.actor_id)
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
-- 4. get_friends_leaderboard -- the user board among the caller and followees
-- ============================================================================
-- THE SET: the caller, plus everyone the caller follows.
--
-- THE POINTS are user_rank_points()'s, the function get_user_leaderboard reads
-- (20261101000300, section 10): this calls it rather than repeating its body,
-- so the two boards cannot drift apart when the formula or the definition of
-- `bevs_created` next changes. That function scores every ranked profile
-- before this filters to the set, which is the cost get_user_leaderboard and
-- get_profile_stats already pay on every call. If the user table outgrows
-- that, the fix belongs in user_rank_points() for all three callers at once.
--
-- UNRANKED PEOPLE HAVE NO ROW, the caller included. user_rank_points() keeps
-- `bevs_ranked > 0` only (rankUsers in @bevi/ranking: "users with bevsRanked =
-- 0 are Unranked: left out and not counted"), and this board follows the same
-- rule instead of inventing points for someone the global board has none for.
-- So a caller with no rankings and no ranked followees gets an empty page.
--
-- THE RANK is `rank() over (order by points desc)` WITHIN THE SET: the same
-- window get_user_leaderboard's bevi_rank comes from, over fewer rows. Ties
-- share a rank and the next rank skips (1, 2, 2, 4). It is computed over the
-- whole set before LIMIT/OFFSET, so it is not the position on the page.
--
-- THE ORDER is get_user_leaderboard's ORDER BY, copied: points desc, then
-- bevs ranked desc, then the older account, then id. So the friends board is
-- the global board with the other rows removed and the ranks recounted.
--
-- Columns are the ones packages/api's mapUserLeaderboardRow reads, with
-- `friend_rank` where the global function has `bevi_rank` -- a different
-- name on purpose, because it is a different number. `can_see_alcohol` is
-- get_user_leaderboard's expression: the caller's own flag, false for
-- everyone else.
--
-- Paged by offset (the set is bounded by how many people one user follows).
-- p_limit is clamped to 1..100 and a negative p_offset is 0, as get_explore
-- clamps rather than raises.
create function public.get_friends_leaderboard(p_limit int default 50, p_offset int default 0)
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
  friend_rank          integer,
  rating_count         integer,
  current_streak_days  integer
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    with members as (
      select v_uid as member_id
      union
      select f.followee_id
        from public.follows f
       where f.follower_id = v_uid
    ),
    board as (
      select rp.user_id      as member_id,
             rp.points       as member_points,
             rp.bevs_ranked  as member_bevs_ranked,
             rp.current_streak as member_streak,
             rank() over (order by rp.points desc)::integer as member_rank
        from public.user_rank_points() rp
       where rp.user_id in (select m.member_id from members m)
    )
    select p.id, p.handle, p.display_name, p.avatar_path, p.timezone, p.created_at, p.onboarded,
           case
             when p.id = v_uid then coalesce(p.birth_date <= (current_date - interval '21 years')::date, false)
             else false
           end,
           b.member_points,
           b.member_rank,
           b.member_bevs_ranked,
           b.member_streak
      from board b
      join public.profiles p on p.id = b.member_id
     -- get_user_leaderboard's order, so a tie breaks the same way on both boards.
     order by b.member_points desc, b.member_bevs_ranked desc, p.created_at asc, p.id asc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

alter function public.get_friends_leaderboard(int, int) owner to postgres;
revoke execute on function public.get_friends_leaderboard(int, int) from public, anon;
grant execute on function public.get_friends_leaderboard(int, int) to authenticated;

comment on function public.get_friends_leaderboard(int, int) is
  'Contract 2.12.0, leaderboard.friends(): the caller and the people they follow, by user_rank_points() points in get_user_leaderboard''s order; friend_rank is the competition rank within that set. Unranked people (no rankings) have no row.';

-- ============================================================================
-- 5. get_followed_by -- "followed by cat and 2 others", for a list of people
-- ============================================================================
-- For each id asked about: the people THE CALLER FOLLOWS who follow that
-- person. `followed_by_count` is all of them; `followed_by` is the first two,
-- the one who followed that person most recently first, then by id so the
-- order is total. As in feed_also_bevd, the count and the items come from one
-- pass over one row set.
--
-- The profile keys are feed_also_bevd's (user_id, handle, display_name,
-- avatar_path, timezone, onboarded, created_at).
--
-- One row per distinct id asked about, in id order, including an id with
-- nobody (count 0, an empty array) and an id that is no user at all (the
-- same): the caller asked, and "nobody you follow follows them" is the
-- answer. Neither the caller nor the person asked about can be in their own
-- row: follows forbids following yourself.
--
-- COST. For each id: the caller's follows by primary key (follower_id), then
-- one primary-key probe of follows (follower_id, followee_id) per followee.
-- Bounded by ids x "people I follow"; the id list is capped at 50 (suggested()
-- sends at most 10) and more is the caller's bug, reported as BEVI_VALIDATION
-- the way get_bev_leaves reports it.
--
-- Everything read here is public to a signed-in user (follows_select is
-- `using (true)`; the profile columns are profiles_view's), so definer buys
-- nothing but the project's one convention and a pinned search_path.
create function public.get_followed_by(p_user_ids uuid[])
returns table (
  user_id            uuid,
  followed_by_count  integer,
  followed_by        jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_max constant int := 50;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_user_ids), 0) > v_max then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'userIds';
  end if;

  return query
    select want.asked_id, fb.total, fb.items
      from (
        select distinct w.asked_id
          from unnest(coalesce(p_user_ids, '{}'::uuid[])) as w(asked_id)
         where w.asked_id is not null
      ) want
     cross join lateral (
        select count(*)::integer as total,
               coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'user_id', m.mutual_id,
                     'handle', m.mutual_handle,
                     'display_name', m.mutual_display_name,
                     'avatar_path', m.mutual_avatar_path,
                     'timezone', m.mutual_timezone,
                     'onboarded', m.mutual_onboarded,
                     'created_at', m.mutual_created_at
                   )
                   order by m.rn
                 ) filter (where m.rn <= 2),
                 '[]'::jsonb
               ) as items
          from (
            select fp.id           as mutual_id,
                   fp.handle       as mutual_handle,
                   fp.display_name as mutual_display_name,
                   fp.avatar_path  as mutual_avatar_path,
                   fp.timezone     as mutual_timezone,
                   fp.onboarded    as mutual_onboarded,
                   fp.created_at   as mutual_created_at,
                   row_number() over (order by theirs.created_at desc, fp.id asc) as rn
              from public.follows mine
              join public.follows theirs
                on theirs.follower_id = mine.followee_id
               and theirs.followee_id = want.asked_id
              join public.profiles fp on fp.id = theirs.follower_id
             where mine.follower_id = v_uid
          ) m
     ) fb
     order by want.asked_id;
end;
$$;

alter function public.get_followed_by(uuid[]) owner to postgres;
revoke execute on function public.get_followed_by(uuid[]) from public, anon;
grant execute on function public.get_followed_by(uuid[]) to authenticated;

comment on function public.get_followed_by(uuid[]) is
  'Contract 2.12.0, follows.suggested(): per requested user id, how many of the caller''s followees follow them (followed_by_count) and the 2 who did so most recently (followed_by). At most 50 ids.';
