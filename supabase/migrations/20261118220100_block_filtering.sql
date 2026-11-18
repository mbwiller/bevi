-- IS-7 / IA-8, part 2 of 2: a block actually hides things.
--
-- Part 1 (20261118220000) added `user_blocks`, `content_reports` and the RPCs
-- that write them, and changed no read path at all. This file is the half App
-- Store Review Guideline 1.2 calls "filtering": every place a signed-in user
-- can reach another user's content now asks `public.is_blocked()` -- which is
-- true when EITHER of them blocked the other -- and drops the row.
--
-- WHAT THIS FILE CHANGES. Eight RLS policies, one view and twelve functions:
--
--   RLS      profiles_select           a blocked person's profile row
--   RLS      follows_select            follow edges either side of a block
--   RLS      follows_insert            no new edge across a block (the direct
--                                      write path that bypasses follow_user)
--   RLS      rankings_select           their rankings AND ranking notes
--   RLS      user_stats_select         their counters (and the suggestion pool)
--   RLS      feed_events_select        their posts
--   RLS      post_comments_select      their comments
--   RLS      post_likes_select         who liked a post
--   view     profiles_view             user search, follower/following lists,
--                                      suggestions, friend scores on a Bev
--   fn       feed_event_visible        the chokepoint: get_user_feed,
--                                      get_comments, add_comment, like_post,
--                                      unlike_post and two of the policies above
--   fn       get_feed                  the home feed and its inline comments
--   fn       get_user_feed             a person's posts
--   fn       get_explore               two-hop discovery
--   fn       get_comments              a thread
--   fn       feed_also_bevd            "also Bev'd by ..."
--   fn       get_followed_by           "followed by ..."
--   fn       get_friends_leaderboard   the friends board
--   fn       get_user_leaderboard      the global board
--   fn       get_profile_stats         a person's counters
--   fn       get_taste_profile         a person's category affinities
--   fn       follow_user               refuses across a block
--
-- WHY BOTH THE POLICIES AND THE FUNCTIONS. The security-definer RPCs run as
-- postgres and bypass RLS, so a policy alone would leave every feed unfiltered;
-- and packages/api reads `profiles_view`, `follows`, `rankings` and
-- `user_stats` straight through PostgREST, so a filter in the RPCs alone would
-- leave user search, follower lists and someone's ranked list unfiltered. Both
-- halves are needed and neither is redundant.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CHANGE, and why:
--
--   * `like_count` on get_feed / get_user_feed. A like carries no identity in
--     the contract (D-15: Explore has no like fields at all, and nothing shows
--     WHO liked a post), so a blocked person's like is a number, not content.
--     It is also the hottest expression in the feed, evaluated once per
--     candidate post. `post_likes_select` IS filtered, so the one path that
--     could name a liker -- a direct PostgREST read -- is closed.
--   * The catalog: `bevs`, `search_bevs`, `find_similar_bevs`, `get_bev`,
--     `get_bev_leaderboard`, `get_featured`, `get_bev_of_period`,
--     `get_similar_bevs`, `list_bucket_bevs`, `get_prediction_snapshot`,
--     venues and the Bev graph. A Bev is shared catalog data, not one person's
--     post; hiding Tim Hortons from you because you blocked the person who
--     first added it would make the catalog personal and the leaderboards
--     disagree between viewers. `get_bev.created_by_handle` is the one place
--     a blocked person's handle can still surface, as the catalog attribution
--     of a Bev everybody can see. Noted, not filtered.
--   * `streaks_select` and `user_category_stats_select`: numbers with no
--     handle, no avatar and no text attached, reachable only with a user id
--     the caller got from somewhere already filtered. `get_taste_profile`,
--     the RPC that reads user_category_stats for a NAMED user, is guarded.
--   * `bev_reports`, `bug_reports`, `comparisons`, `want_to_try`,
--     `user_bev_predictions`: own-row or admin-only already.
--   * The ranking maths. A blocked person's rankings still count towards a
--     Bev's rating_count and Bayesian score, and towards the global rank
--     numbers on the leaderboard. Those are facts about the catalog and about
--     the whole instance; recomputing them per viewer is not what "block"
--     means and would make `bev_stats` meaningless.
--
-- COST. `is_blocked()` is an EXISTS over user_blocks' primary key and the
-- (blocked_id) index -- two index probes, and for almost every caller the
-- table is empty. In a policy it runs once per candidate row; inside the feed
-- functions it is one probe per post plus one per inline comment. No new
-- index is needed beyond part 1's.
--
-- ORDER OF DEPLOYMENT. Nothing here changes a signature or a column, so an
-- older client is unaffected: contract, packages/api and app follow in their
-- own PRs. A database with part 1 but not part 2 records blocks that hide
-- nothing, which is why the two migrations ship together.

set search_path = public, extensions;

-- ============================================================================
-- 1. The RLS policies
-- ============================================================================
-- A policy cannot be altered in place the way a function can be replaced, so
-- each is dropped and re-created. Each one below is its original predicate
-- (20261011000100 sections 5, 20261014000200 and 20261014000300) with one
-- conjunct added; nothing else moves.

-- profiles: was `using (true)`. This is what closes a direct
-- `from('profiles')` read, which `profiles_view` (section 2) cannot, since the
-- view runs with its owner's rights and never consults a policy.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (not public.is_blocked(profiles.id));

-- follows: was `using (true)` -- "the follow graph is not private". It stays
-- public except across a block, in either direction and at either end, so a
-- blocked person is neither a follower nor a followee anybody can read.
-- block_user already deletes both edges, so in practice this matters for an
-- edge created before the block in a concurrent transaction.
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows
  for select to authenticated using (
    not public.is_blocked(follows.follower_id) and not public.is_blocked(follows.followee_id)
  );

-- rankings: the age gate, plus the block. `rankings.note` is free text a user
-- wrote, and rankings.list(userId) reads this table straight through
-- PostgREST for a profile screen, so without this a blocked person's notes
-- stay one request away.
drop policy if exists rankings_select on public.rankings;
create policy rankings_select on public.rankings
  for select to authenticated using (
    not public.is_blocked(rankings.user_id)
    and exists (
      select 1 from public.bevs b
      join public.categories c on c.id = b.category_id
      where b.id = rankings.bev_id and (not c.is_alcoholic or public.viewer_is_adult())
    )
  );

-- user_stats: was `using (true)`. Filtering it does two things: it keeps a
-- blocked person's counters out of reach, and it takes them out of
-- follows.suggested(), which picks the 50 highest rating_count rows from this
-- table in packages/api. Without this a blocked person could occupy one of
-- the ten suggestion slots and merely render blank.
drop policy if exists user_stats_select on public.user_stats;
create policy user_stats_select on public.user_stats
  for select to authenticated using (not public.is_blocked(user_stats.user_id));

-- feed_events: actor-or-followee, and never across a block.
drop policy if exists feed_events_select on public.feed_events;
create policy feed_events_select on public.feed_events
  for select to authenticated using (
    not public.is_blocked(feed_events.actor_id)
    and (
      actor_id = auth.uid()
      or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = feed_events.actor_id)
    )
  );

-- post_comments: the author's own comment, or a visible post -- and never a
-- blocked person's comment. feed_event_visible() (section 3) already hides the
-- blocked person's OWN posts; this conjunct is what hides their comment on
-- somebody else's post, which the post's visibility says nothing about.
drop policy if exists post_comments_select on public.post_comments;
create policy post_comments_select on public.post_comments
  for select to authenticated using (
    deleted_at is null
    and not public.is_blocked(post_comments.user_id)
    and (user_id = auth.uid() or public.feed_event_visible(feed_event_id))
  );

-- post_likes: same shape. This is the one path that can name who liked a
-- post, which is why it is filtered although the like COUNT is not.
drop policy if exists post_likes_select on public.post_likes;
create policy post_likes_select on public.post_likes
  for select to authenticated using (
    not public.is_blocked(post_likes.user_id)
    and (user_id = auth.uid() or public.feed_event_visible(feed_event_id))
  );

-- ============================================================================
-- 2. profiles_view
-- ============================================================================
-- 20261012000400's definition, verbatim, with one WHERE clause. This single
-- line is what removes a blocked person from:
--   * search for people  (profile.search(): ilike on handle and display_name)
--   * the followers and following lists (follows.followers/following)
--   * follows.suggested()
--   * the friend scores on a Bev page (bevs.get -> FriendScore)
--   * the want-to-try "via" people
-- -- none of which goes through an RPC, so none of which could be filtered
-- anywhere else. packages/api already drops a row whose profile does not come
-- back (fetchProfileRows and the FriendScore mapper both filter on it), so a
-- missing row renders as an absent person rather than an error.
--
-- The caller's own row is never filtered: user_blocks forbids a self-block.
--
-- `security_invoker = false` is restated because `create or replace view`
-- keeps the option but the value is worth seeing next to the predicate: the
-- view runs as its owner and therefore does NOT get profiles_select's filter,
-- which is why the predicate has to be written here too.

create or replace view public.profiles_view
  with (security_invoker = false) as
select
  id, handle, display_name, avatar_path,
  case when id = auth.uid() then birth_date else null end as birth_date,
  age_attested_at, timezone, role, bevi_rank, handle_changed_at, onboarded,
  created_at, updated_at,
  case
    when id = auth.uid() then coalesce(birth_date <= (current_date - interval '21 years')::date, false)
    else false
  end as can_see_alcohol
from public.profiles
where not public.is_blocked(id);

-- The grants 20261012000400 left: a drop is not involved, but restating them
-- costs nothing and makes this file self-describing.
revoke all on public.profiles_view from public, anon, authenticated;
grant select on public.profiles_view to authenticated;

-- ============================================================================
-- 3. feed_event_visible -- the chokepoint
-- ============================================================================
-- 20261014000200's definition with one conjunct. Five callers inherit the
-- filter from this one line: get_user_feed, get_comments, add_comment,
-- like_post and unlike_post, plus post_comments_select and post_likes_select
-- above. A blocked person's post is now "not found" to the caller, exactly as
-- a stranger's post already is -- which is also what makes like_post and
-- add_comment refuse on it, with the same BEVI_NOT_FOUND they already raise
-- rather than a new error the app would have to learn.

create or replace function public.feed_event_visible(p_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.feed_events e
      left join public.bevs b on b.id = e.bev_id
      left join public.categories c on c.id = b.category_id
     where e.id = p_event_id
       and not public.is_blocked(e.actor_id)
       and (e.actor_id = auth.uid()
            or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
       and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
  );
$$;

comment on function public.feed_event_visible(bigint) is
  'May the caller see this post? Actor-or-followee, the alcohol age gate, and (IS-7) no block in either direction.';

-- ============================================================================
-- 4. The feed functions
-- ============================================================================
-- get_feed, get_user_feed and get_explore are 20261112000300's definitions
-- (sections 4 and 5, the newest) VERBATIM, with only these additions:
--
--   get_feed       WHERE  + `and not public.is_blocked(e.actor_id)`
--                  inline comments  + `and not public.is_blocked(cm.user_id)`
--                  comment_count    + `and not public.is_blocked(pc.user_id)`
--   get_user_feed  a BEVI_NOT_FOUND guard beside the existing one, so a
--                  blocked person's profile feed is indistinguishable from a
--                  user who does not exist; the same two comment filters.
--                  Its WHERE already calls feed_event_visible().
--   get_explore    the two-hop walk does not cross a blocked person, and a
--                  blocked person is never in `scope` (which also covers the
--                  D-01 "everyone" fallback).
--
-- comment_count is filtered where like_count is not, because the count has to
-- agree with the seven inline comments beside it: a post showing "3 comments"
-- and listing two would be a visible bug, and `comments.list()` would page a
-- thread that disagrees with its own header.
--
-- Nothing else moves: not a column, not the order, not the limit, not a
-- signature.
--
-- Each is a DROP and a CREATE rather than a `create or replace`, as
-- 20261112000300 and 20261111000100 did it. Not because the columns changed --
-- they did not -- but because that is how these three functions are written in
-- this repository, and a drop loses the owner, the grants and the comment, so
-- each block below is followed by the state the migrations left it in: the
-- `alter ... owner`, `revoke`, `grant` and, for get_explore, the
-- `comment on function`. Nothing depends on them (no view, policy or trigger
-- calls them), so the drop is safe.

-- ---------------------------------------------------------------------------
-- 4a. get_feed
-- ---------------------------------------------------------------------------
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
         -- IS-7: agrees with the inline `comments` below, which is filtered.
         (select count(*) from public.post_comments pc
           where pc.feed_event_id = e.id and pc.deleted_at is null
             and not public.is_blocked(pc.user_id))::integer,
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
             -- IS-7: a blocked person's comment on a post the caller can
             -- otherwise see. The post's own visibility says nothing about it.
             and not public.is_blocked(cm.user_id)
           order by cm.id
           limit 7
        ) t
    ) ic on true
   cross join prior bp
   where e.kind in ('ranked', 'reranked')
     -- IS-7, and load-bearing rather than belt-and-braces: `follows` has a
     -- direct INSERT policy (20261011000100), so a client can create a follow
     -- edge through PostgREST without going near follow_user. Section 5 closes
     -- that policy too, but this feed must be right on its own.
     and not public.is_blocked(e.actor_id)
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

-- ---------------------------------------------------------------------------
-- 4b. get_user_feed
-- ---------------------------------------------------------------------------
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
  -- IS-7: the same error as "no such user", on purpose. The caller learns
  -- nothing about whether they were blocked or whether the account exists, and
  -- the app needs no new error code to handle it. Returning an empty page
  -- instead would leave a profile screen with a working header and no posts.
  if public.is_blocked(p_user_id) then
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
           -- IS-7, as get_feed.
           (select count(*) from public.post_comments pc
             where pc.feed_event_id = e.id and pc.deleted_at is null
               and not public.is_blocked(pc.user_id))::integer,
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
               -- IS-7, as get_feed.
               and not public.is_blocked(cm.user_id)
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

-- ---------------------------------------------------------------------------
-- 4c. get_explore
-- ---------------------------------------------------------------------------
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
         -- IS-7: a blocked person is not a BRIDGE either. Without this, the
         -- people they follow would still be recommended to the caller as
         -- "two hops away", which is discovery flowing through the wall.
         and not public.is_blocked(f.followee_id)
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
         -- IS-7. This is the one that matters: it narrows BOTH branches of
         -- `candidates`, so it covers D-01's "the instance is small, show
         -- everyone" fallback, where the two-hop walk above is bypassed
         -- entirely and every profile is a candidate.
         and not public.is_blocked(c.user_id)
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
-- 5. The remaining read paths, and follow_user
-- ============================================================================
-- Each of these is its newest definition VERBATIM with one added predicate or
-- one added guard, and each is a `create or replace` -- the signature and the
-- returned columns are untouched, so no drop is involved and every owner,
-- grant and comment survives. The three that were written as a bare `create`
-- (feed_also_bevd, get_followed_by, get_friends_leaderboard, all
-- 20261111000100) become `create or replace` here for that reason; nothing
-- else about them changes.
--
-- Source of each: get_comments 20261014000300; feed_also_bevd,
-- get_followed_by and get_friends_leaderboard 20261111000100;
-- get_user_leaderboard and get_profile_stats 20261012000500;
-- get_taste_profile 20261019000100; follow_user 20261014000100.

-- ---------------------------------------------------------------------------
-- 5a. get_comments -- a thread
-- ---------------------------------------------------------------------------
create or replace function public.get_comments(
  p_event_id bigint,
  p_limit    int    default 20,
  p_before_id bigint default null
)
returns table (
  id                  bigint,
  created_at          timestamptz,
  body                text,
  author_id           uuid,
  author_handle       text,
  author_display_name text,
  author_avatar_path  text,
  author_timezone     text,
  author_onboarded    boolean,
  author_created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if not public.feed_event_visible(p_event_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select cm.id, cm.created_at, cm.body,
           cm.user_id, p.handle, p.display_name, p.avatar_path,
           p.timezone, p.onboarded, p.created_at
      from public.post_comments cm
      join public.profiles p on p.id = cm.user_id
     where cm.feed_event_id = p_event_id
       and cm.deleted_at is null
       -- IS-7, the same conjunct the inline comments in get_feed get: this
       -- pages the full thread, so a blocked person's comment must be absent
       -- here too or "View all N comments" would reintroduce it.
       and not public.is_blocked(cm.user_id)
       and (p_before_id is null or cm.id < p_before_id)
     order by cm.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b. feed_also_bevd -- "also Bev'd by ..."
-- ---------------------------------------------------------------------------
create or replace function public.feed_also_bevd(p_bev_id uuid, p_actor_id uuid)
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
         -- IS-7: block_user unfollows both ways, so a blocked person should
         -- not be a followee at all; stated here because `follows` has a
         -- direct INSERT policy and because this function is documented as
         -- being right on its own.
         and not public.is_blocked(f.followee_id)
         and (not c.is_alcoholic or public.viewer_is_adult())
    ) t;
$$;

-- ---------------------------------------------------------------------------
-- 5c. get_followed_by -- "followed by ..."
-- ---------------------------------------------------------------------------
create or replace function public.get_followed_by(p_user_ids uuid[])
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
               -- IS-7: never name a blocked person as the reason to follow
               -- somebody. An id the caller asks about that is itself blocked
               -- still gets a row, with count 0 and an empty array -- the
               -- "one row per distinct id asked about" contract is unchanged,
               -- and nothing reaches this function's input list that
               -- profiles_view and user_stats_select have not already
               -- filtered.
               and not public.is_blocked(theirs.follower_id)
          ) m
     ) fb
     order by want.asked_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5d. get_friends_leaderboard -- the friends board
-- ---------------------------------------------------------------------------
create or replace function public.get_friends_leaderboard(p_limit int default 50, p_offset int default 0)
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
         -- IS-7: a blocked person is not a friend. block_user already removed
         -- the edge; `follows` has a direct INSERT policy, so say it here.
         and not public.is_blocked(f.followee_id)
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

-- ---------------------------------------------------------------------------
-- 5e. get_user_leaderboard -- the global board
-- ---------------------------------------------------------------------------
create or replace function public.get_user_leaderboard(p_limit int default 50)
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
  bevi_rank            integer,
  rating_count         integer,
  want_count           integer,
  follower_count       integer,
  following_count      integer,
  current_streak_days  integer,
  longest_streak_days  integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.handle, p.display_name, p.avatar_path, p.timezone, p.created_at, p.onboarded,
    case
      when p.id = auth.uid() then coalesce(p.birth_date <= (current_date - interval '21 years')::date, false)
      else false
    end,
    rp.points,
    rp.bevi_rank,
    rp.bevs_ranked,
    coalesce(us.want_count, 0),
    coalesce(us.follower_count, 0),
    coalesce(us.following_count, 0),
    rp.current_streak,
    coalesce(st.longest_days, 0)
  from public.user_rank_points() rp
  join public.profiles p on p.id = rp.user_id
  left join public.user_stats us on us.user_id = p.id
  left join public.streaks st on st.user_id = p.id
  -- IS-7. `bevi_rank` deliberately stays the GLOBAL rank from
  -- user_rank_points(): removing a row does not renumber the others, so a
  -- caller who has blocked the person at rank 3 sees 1, 2, 4 rather than a
  -- board that silently disagrees with everyone else's. The friends board is
  -- where ranks are recounted within a set, and it says so.
  where not public.is_blocked(rp.user_id)
  -- Display order breaks points ties the same way rank.ts's rankUsers does.
  order by rp.points desc, rp.bevs_ranked desc, p.created_at asc, p.id asc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 5f. get_profile_stats -- a person's counters
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_stats(p_user_id uuid)
returns table (
  followers           integer,
  following           integer,
  bevd_count          integer,
  want_count          integer,
  rank_on_bevi        integer,
  rank_points         integer,
  current_streak      integer,
  longest_streak      integer,
  streak_alive_today  boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  select timezone into v_tz from public.profiles where id = p_user_id;
  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- IS-7: a blocked person's profile is "not found", the same answer
  -- get_user_feed now gives, so the whole profile screen fails as one rather
  -- than rendering a header with an empty feed under it.
  if public.is_blocked(p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(us.follower_count, 0),
    coalesce(us.following_count, 0),
    coalesce(us.rating_count, 0),
    coalesce(us.want_count, 0),
    rp.bevi_rank,
    coalesce(rp.points, 0),
    public.effective_streak(st.current_days, st.last_ranked_on, v_tz),
    coalesce(st.longest_days, 0),
    coalesce(st.last_ranked_on = (now() at time zone v_tz)::date, false)
  from (select p_user_id as id) me
  left join public.user_stats us on us.user_id = me.id
  left join public.streaks st on st.user_id = me.id
  left join public.user_rank_points() rp on rp.user_id = me.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5g. get_taste_profile -- a person's category affinities
-- ---------------------------------------------------------------------------
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
  -- IS-7, as get_profile_stats. user_category_stats itself is left on
  -- `using (true)`: it is numbers with no handle or text attached, and this
  -- is the one RPC that reads it for a named user.
  if public.is_blocked(p_user_id) then
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

-- ---------------------------------------------------------------------------
-- 5h. follow_user, and the direct INSERT policy on follows
-- ---------------------------------------------------------------------------
create or replace function public.follow_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'cannot follow self';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- IS-7: you cannot follow across a block, in either direction, and the
  -- answer does not say which. BEVI_NOT_FOUND matches what every read path
  -- now says about that person.
  if public.is_blocked(p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.assert_rate('follow', 100, interval '1 day');

  insert into public.follows (follower_id, followee_id)
  values (v_uid, p_user_id)
  on conflict (follower_id, followee_id) do nothing;

  update public.user_stats
     set follower_count = (select count(*) from public.follows where followee_id = p_user_id),
         updated_at = now()
   where user_id = p_user_id;
  update public.user_stats
     set following_count = (select count(*) from public.follows where follower_id = v_uid),
         updated_at = now()
   where user_id = v_uid;
end;
$$;

-- follows_insert (20261011000100) is one of the few direct write policies in
-- this schema -- "a user's own small tables may reasonably get own-row
-- policies" (supabase/CLAUDE.md) -- which means a client can create a follow
-- edge through PostgREST without calling follow_user at all, and so without
-- the guard above. Close it with the same predicate. `not is_blocked` rather
-- than naming a direction: neither party may follow the other.
--
-- follows_delete is left alone: unfollowing across a block is harmless and
-- block_user does exactly that on the caller's behalf.
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked(followee_id));

-- ============================================================================
-- 6. What is NOT here
-- ============================================================================
-- Spelled out so a reviewer can tell a decision from an oversight. The
-- reasoning is in this file's header; this is the index.
--
--   like_count on get_feed / get_user_feed  -- aggregate, no identity (D-15)
--   streaks_select, user_category_stats_select -- numbers, no identity
--   bevs, bev_stats, bev_aliases, categories, featured_bevs -- shared catalog
--   search_bevs, find_similar_bevs, get_bev, get_bev_leaderboard,
--     get_featured, get_bev_of_period, get_similar_bevs, list_bucket_bevs,
--     get_bev_similarities, get_prediction_snapshot -- shared catalog
--   get_bev.created_by_handle -- catalog attribution; the one place a blocked
--     person's handle can still appear
--   venues_in_view, venue_detail, venue_neighborhoods -- places, not people
--   get_category_tree, get_category_progress, get_bev_leaves -- the caller's own
--   bev_reports, bug_reports, comparisons, want_to_try,
--     user_bev_predictions -- own-row or admin-only already
--   bev_stats / global_stats / bevi_rank maths -- instance-wide facts
--
-- ONE KNOWN COSMETIC INCONSISTENCY, stated so it is not discovered as a bug:
-- the aggregate counters in `user_stats` are instance-wide, while the lists
-- beside them are now per-viewer. If pal follows vil and the caller has
-- blocked vil, pal's profile reads "following 2" above a list of one. The
-- counters are not recomputed per viewer on purpose -- that would mean a
-- correlated count against user_blocks on every profile read, and the number
-- would still disagree with pal's own view of their own profile. The app half
-- can either derive the count from the list it received or leave the
-- discrepancy; it is a decision for IM-13, not for SQL.
--
-- STILL TO COME, and not in this PR: the `CONTRACT_VERSION` bump with
-- BlocksApi / ReportsApi on the contract, the packages/api implementation of
-- them, and the report-and-block sheet (IM-13). This migration pair is the
-- database half of IS-7 and nothing else.
