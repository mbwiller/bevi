-- S-20 (20261018000300): get_user_feed, one user's posts in get_feed's shape.
--
-- Profile › Activity renders a user's rankings as FeedPosts, but from
-- rankings.listUser, which carries no feed-event id, like or comment fields,
-- so a profile's posts have no hearts and no comments. This returns the same
-- rows get_feed does, filtered to one actor.
--
-- Visibility is feed_event_visible exactly as A-02 defined it: the caller's
-- own posts and followed users' posts, age-gated. For anyone else the page is
-- empty, not an error. Their Activity keeps using rankings.listUser, whose
-- rankings_select policy is wider (any signed-in user, age-gated); that
-- difference is deliberate (Matt, 2026-10-18: the hybrid, no policy change).
--
-- The select list is get_feed's (20261014000300) unchanged; only the WHERE
-- differs. get_feed is not touched. A change to get_feed's columns must be
-- repeated here, and 07_user_feed.test.sql checks the two stay equal.

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
             coalesce((select gs.mean_score from public.global_stats gs limit 1), 0),
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
