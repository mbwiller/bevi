-- A-03: comments on posts.
--
-- TASKS.md decision 3: a comment button in line with the heart, opening a
-- clean multi-user comment section. The first comments show inline on the
-- post; above seven the app collapses to "View all N comments" -- that rule
-- is the app's, so the server supplies the first seven plus the count (a post
-- with seven or fewer renders entirely from get_feed, no second call), and
-- comments.list() for the rest.
--
-- No likes on comments (D-01). No comment reports here either: bev_reports is
-- keyed (reporter_id, bev_id, reason) with bev_id not null, so reporting a
-- comment needs either a loosened live constraint or its own table. Neither
-- is in this task's definition of done -- be/comment-reports later.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. post_comments
-- ---------------------------------------------------------------------------
-- Soft delete: deleted_at rather than a real delete, so an id already handed
-- to a client stays resolvable and a thread's shape is auditable. Everything
-- that reads filters on `deleted_at is null`.
--
-- The index is (feed_event_id, id desc) because every read is one post's
-- comments newest-first, keyset-paged on id -- the same cursor style as
-- get_feed.

create table public.post_comments (
  id            bigint generated always as identity primary key,
  feed_event_id bigint not null references public.feed_events(id) on delete cascade,
  user_id       uuid   not null references public.profiles(id) on delete cascade,
  body          text   not null check (char_length(body) between 1 and 280),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index post_comments_event_idx on public.post_comments (feed_event_id, id desc);

alter table public.post_comments enable row level security;

-- Unlike a like, a comment body is content: it is readable exactly where its
-- post is (feed_event_visible -- actor-or-followee plus the alcohol age gate),
-- so a direct `from('post_comments')` read cannot reach comments on posts the
-- caller is not shown.
create policy post_comments_select on public.post_comments
  for select to authenticated
  using (deleted_at is null and public.feed_event_visible(feed_event_id));

-- ---------------------------------------------------------------------------
-- 2. add_comment / delete_comment / get_comments
-- ---------------------------------------------------------------------------
-- Visibility reuses feed_event_visible() from 20261014000200, so the
-- actor-or-followee plus age-gate rule has exactly one definition.

-- Returns the same column set as get_comments, author join included, so the
-- app can render the new comment from one call instead of fetching the
-- author separately.
create or replace function public.add_comment(p_event_id bigint, p_body text)
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
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
  -- btrim's default strips only spaces; a newline- or tab-only body must not
  -- count as a comment.
  v_body text := btrim(coalesce(p_body, ''), E' \t\n\r');
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if not public.feed_event_visible(p_event_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Checked here rather than left to the column constraint so an empty or
  -- over-long body comes back as BEVI_VALIDATION instead of a raw 23514.
  if char_length(v_body) < 1 or char_length(v_body) > 280 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'body';
  end if;

  perform public.assert_rate('add_comment', 60, interval '1 hour');

  insert into public.post_comments (feed_event_id, user_id, body)
  values (p_event_id, v_uid, v_body)
  returning post_comments.id into v_id;

  return query
    select cm.id, cm.created_at, cm.body,
           cm.user_id, p.handle, p.display_name, p.avatar_path,
           p.timezone, p.onboarded, p.created_at
      from public.post_comments cm
      join public.profiles p on p.id = cm.user_id
     where cm.id = v_id;
end;
$$;

-- Own comments only. Someone else's is BEVI_NOT_FOUND, not
-- BEVI_UNAUTHORIZED: the caller learns nothing about whether it exists.
-- Idempotent -- deleting an already-deleted comment is a no-op, so a retry
-- after a dropped response does not raise.
create or replace function public.delete_comment(p_id bigint)
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

  update public.post_comments
     set deleted_at = now()
   where id = p_id and user_id = v_uid and deleted_at is null;

  if not found and not exists (
    select 1 from public.post_comments where id = p_id and user_id = v_uid
  ) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

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
       and (p_before_id is null or cm.id < p_before_id)
     order by cm.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_feed gains comment_count and comments
-- ---------------------------------------------------------------------------
-- Third drop-and-recreate of this function (20261011000400 shape, A-01's
-- kind filter, A-02's like columns, now these two). `returns table` cannot
-- change in place, so the revoke/grant block at the end is mandatory.
--
-- `comments` is the first seven, OLDEST first -- that is the reading order
-- under a post. get_comments pages newest-first for the full thread, which is
-- the opposite order on purpose: a thread opens at the newest.

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
         ),
         coalesce(cc.n, 0)::integer,
         coalesce(first3.items, '[]'::jsonb)
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
    left join (
      select feed_event_id, count(*) as n
        from public.post_comments
       where deleted_at is null
       group by feed_event_id
    ) cc on cc.feed_event_id = e.id
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
    ) first3 on true
   where e.kind in ('ranked', 'reranked')
     and (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
     and (p_before_id is null or e.id < p_before_id)
   order by e.id desc
   limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

alter function public.add_comment(bigint, text) owner to postgres;
alter function public.delete_comment(bigint) owner to postgres;
alter function public.get_comments(bigint, int, bigint) owner to postgres;
alter function public.get_feed(int, bigint) owner to postgres;

revoke execute on function
  public.add_comment(bigint, text),
  public.delete_comment(bigint),
  public.get_comments(bigint, int, bigint),
  public.get_feed(int, bigint)
from public, anon;

grant execute on function
  public.add_comment(bigint, text),
  public.delete_comment(bigint),
  public.get_comments(bigint, int, bigint),
  public.get_feed(int, bigint)
to authenticated;
