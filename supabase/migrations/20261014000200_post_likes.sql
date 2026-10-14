-- A-02: likes on posts.
--
-- TASKS.md decision 2: a heart on every post, the count beside it, in the
-- Bevi grape. Likes are on posts, never on comments (D-01).
--
-- No INSERT/UPDATE/DELETE policy for authenticated on post_likes
-- (supabase/CLAUDE.md): writes go through like_post/unlike_post, which are
-- security definer and check visibility before touching anything.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. post_likes
-- ---------------------------------------------------------------------------
-- The PK is (user_id, feed_event_id), so one like per person per post is a
-- structural guarantee rather than something the RPC has to enforce. Deleting
-- a feed event takes its likes with it, and feed_events already cascades from
-- rankings, so removing a ranking cleans up the whole chain.

create table public.post_likes (
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  feed_event_id bigint not null references public.feed_events(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, feed_event_id)
);

-- The PK already covers (user_id, ...) lookups; this one serves the count and
-- the "who liked this" direction.
create index post_likes_event_idx on public.post_likes (feed_event_id);

alter table public.post_likes enable row level security;

-- Counts are public inside the app, same as rankings and user_stats. Reads of
-- a like whose post the viewer cannot see are harmless: the post itself is
-- already filtered out of get_feed, and a feed_event_id leaks nothing.
create policy post_likes_select on public.post_likes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. feed_event_visible
-- ---------------------------------------------------------------------------
-- The one place that answers "may the caller see this post?". Until now the
-- predicate was inlined in get_feed; A-02 and A-03 add four more callers, so
-- it becomes a function instead of a fifth copy.
--
-- DEVELOPMENT-ARJUN.md §4.1 wanted the alcohol half of this to live in a
-- `bev_cards` view that was never built (the only mention in supabase/ is a
-- comment in 20261011000300). This helper is the narrower version of that
-- idea: one definition, no view, no rewrite of the existing RPCs.
--
-- Returns false rather than raising, so callers choose their own error.

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
       and (e.actor_id = auth.uid()
            or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
       and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. like_post / unlike_post
-- ---------------------------------------------------------------------------
-- Both idempotent, so the app's optimistic heart never needs to reconcile a
-- double tap. An invisible post is BEVI_NOT_FOUND, not BEVI_UNAUTHORIZED: the
-- server does not confirm that a post it won't show you exists.

create or replace function public.like_post(p_event_id bigint)
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
  if not public.feed_event_visible(p_event_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.assert_rate('like_post', 300, interval '1 hour');

  insert into public.post_likes (user_id, feed_event_id)
  values (v_uid, p_event_id)
  on conflict (user_id, feed_event_id) do nothing;
end;
$$;

create or replace function public.unlike_post(p_event_id bigint)
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
  if not public.feed_event_visible(p_event_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.assert_rate('unlike_post', 300, interval '1 hour');

  delete from public.post_likes
   where user_id = v_uid and feed_event_id = p_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_feed gains like_count and liked_by_me
-- ---------------------------------------------------------------------------
-- A `returns table` cannot be changed by `create or replace`, so this is a
-- drop and recreate -- which loses the grants, hence the revoke/grant block
-- at the end. Everything above the two new columns is 20261014000100's
-- definition unchanged.

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
  liked_by_me          boolean
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
           coalesce((select mean_score from public.global_stats limit 1), 0),
           3
         )::numeric,
         e.ranking_id, r.score, r.bucket, r.note,
         e.target_user_id,
         exists (
           select 1 from public.want_to_try w
            where w.user_id = auth.uid() and w.bev_id = e.bev_id
         ),
         coalesce(l.n, 0)::integer,
         exists (
           select 1 from public.post_likes pl
            where pl.user_id = auth.uid() and pl.feed_event_id = e.id
         )
    from public.feed_events e
    join public.profiles p on p.id = e.actor_id
    left join public.bevs b on b.id = e.bev_id
    left join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
    left join public.rankings r on r.id = e.ranking_id
    left join (
      select feed_event_id, count(*) as n
        from public.post_likes
       group by feed_event_id
    ) l on l.feed_event_id = e.id
   where e.kind in ('ranked', 'reranked')
     and (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
     and (p_before_id is null or e.id < p_before_id)
   order by e.id desc
   limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

alter function public.feed_event_visible(bigint) owner to postgres;
alter function public.like_post(bigint) owner to postgres;
alter function public.unlike_post(bigint) owner to postgres;
alter function public.get_feed(int, bigint) owner to postgres;

revoke execute on function
  public.feed_event_visible(bigint),
  public.like_post(bigint),
  public.unlike_post(bigint),
  public.get_feed(int, bigint)
from public, anon;

grant execute on function
  public.feed_event_visible(bigint),
  public.like_post(bigint),
  public.unlike_post(bigint),
  public.get_feed(int, bigint)
to authenticated;
