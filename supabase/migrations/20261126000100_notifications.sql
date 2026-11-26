-- T-31: the notifications inbox. Who followed you, and who liked or commented
-- on your posts, stored as it happens and read back by the app.
--
-- WHAT THIS FILE ADDS
--
--   public.notifications                  table, one row per event, RLS on with
--                                         no policy: nothing reads or writes it
--                                         but the definer functions below
--   public.notify_on_follow()             trigger on follows      AFTER INSERT
--   public.notify_on_like()               trigger on post_likes   AFTER INSERT
--   public.notify_on_comment()            trigger on post_comments AFTER INSERT
--   public.visible_notifications()        internal: the caller's rows that are
--                                         still true (revoked from every client)
--   public.get_notifications(int, bigint) RPC, the inbox, one row per displayed
--                                         notification (likes on a post grouped)
--   public.get_unread_notification_count() RPC, the badge
--   public.mark_notifications_read(bigint) RPC
--   public.get_post(bigint)               RPC, one feed post: what a
--                                         notification opens
--
-- WHY TRIGGERS AND NOT A LINE IN EACH RPC. follow_user, like_post and
-- add_comment are live, and re-creating any of them to add an insert would
-- copy a body that the next migration to touch it has to remember. A trigger
-- on the table catches every writer -- those RPCs, a test fixture, an operator
-- script -- and leaves the RPCs exactly as they are. Each trigger body is
-- wrapped in its own exception block: a notification that fails to save must
-- never take the follow, the like or the comment down with it (the reasoning
-- of enqueue_bev_icon_job, 20261119192921).
--
-- WHY NO DELETE TRIGGERS. An unfollow, an unlike and a deleted comment do not
-- delete anything here. A notification is SHOWN only while what it says is
-- still true, and that is decided at read time, in one place
-- (visible_notifications below), which the list, the count and mark-read all
-- read, so the three can never disagree:
--
--   * it is the caller's (recipient_id = auth.uid());
--   * no block stands between the caller and the actor, in either direction
--     (private.is_blocked, the one definition of that);
--   * a follow: the follow edge still exists;
--   * a like: the like still exists;
--   * a comment: the comment is not soft-deleted;
--   * a like or a comment on an alcoholic Bev's post: the caller is 21 or
--     over (feed_event_visible's join shape).
--
-- Keeping the row is also what stops badge spam: follow, unfollow, follow
-- again (or like, unlike, like again) finds the first row still there, the
-- partial unique indexes make the second insert a no-op, and the old row
-- simply becomes visible again with its old date and its old read state. A
-- post that is gone is the one case that does delete: a removed or re-ranked
-- ranking deletes its feed event, and `on delete cascade` takes the
-- notifications about it, as it takes the likes and comments.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * No push notifications, no email: this is the in-app inbox only.
--   * No notification for a mention, a want-to-try, or "a friend ranked a Bev
--     you ranked". Three kinds; a fourth widens the check on `kind`.
--   * No retention job. Rows accumulate; the inbox reads one user's rows,
--     which the (recipient_id, id) index serves. A cap belongs in its own
--     migration when it is needed.
--   * No change to follow_user, like_post, unlike_post, add_comment,
--     delete_comment, block_user or any other existing function. Additive
--     only: one table, three triggers, five new functions.
--
-- `get_post` is a copy of get_user_feed's select (20261118220100, section 4b)
-- for one post id, with get_feed's columns in get_feed's order, so
-- packages/api maps it through the same FeedRpcRow path. THE THREE MUST
-- CHANGE TOGETHER: a column added to get_feed is added here too.

set search_path = public, extensions;

-- ============================================================================
-- 1. notifications
-- ============================================================================
-- One row per event. `kind` decides which reference columns are set, and the
-- shape check keeps them honest. Both people cascade from profiles, so an
-- account deletion takes every notification it is on either side of. The post
-- and the comment cascade too: a notification about something that is gone has
-- nothing to show.
--
-- read_at is null while unread. It is the recipient's, set only by
-- mark_notifications_read.

create table public.notifications (
  id            bigint generated always as identity primary key,
  recipient_id  uuid        not null references public.profiles(id) on delete cascade,
  actor_id      uuid        not null references public.profiles(id) on delete cascade,
  kind          text        not null check (kind in ('follow', 'like', 'comment')),
  feed_event_id bigint      references public.feed_events(id) on delete cascade,
  comment_id    bigint      references public.post_comments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  constraint notifications_no_self check (recipient_id <> actor_id),
  constraint notifications_shape check (
    (kind = 'follow'     and feed_event_id is null     and comment_id is null)
    or (kind = 'like'    and feed_event_id is not null and comment_id is null)
    or (kind = 'comment' and feed_event_id is not null and comment_id is not null)
  )
);

-- ONE ROW PER THING THAT HAPPENED, however often it is undone and redone.
-- Partial, because the key differs per kind; the triggers name each predicate
-- in `on conflict (...) where ...` so the index is inferred.
create unique index notifications_follow_uniq
  on public.notifications (recipient_id, actor_id) where kind = 'follow';
create unique index notifications_like_uniq
  on public.notifications (recipient_id, actor_id, feed_event_id) where kind = 'like';
create unique index notifications_comment_uniq
  on public.notifications (comment_id) where kind = 'comment';

-- The reads: one user's inbox, newest first, and the unread ones.
create index notifications_recipient_idx on public.notifications (recipient_id, id desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- The cascades. Deleting a feed event, a comment or a profile looks up the
-- rows that reference it; without these each would scan the table.
-- (notifications_comment_uniq is partial on `kind`, which a lookup by
-- comment_id alone cannot use, hence its own index.)
create index notifications_feed_event_idx on public.notifications (feed_event_id) where feed_event_id is not null;
create index notifications_comment_idx on public.notifications (comment_id) where comment_id is not null;
create index notifications_actor_idx on public.notifications (actor_id);

alter table public.notifications enable row level security;

-- No policy for anyone: every read is a definer RPC below, which applies the
-- read-time rules a direct `select` policy would have to restate. Supabase's
-- default privileges grant every verb on a new table to the client roles, and
-- TRUNCATE is not subject to RLS (20261119152455, section 2;
-- 42_table_privileges.test.sql fails a table that skips this).
revoke all on table public.notifications from anon, authenticated;

comment on table public.notifications is
  'T-31: one row per follow / like / comment someone else made on the recipient. Written only by the notify_on_* triggers, deduplicated by the partial unique indexes, read only through get_notifications / get_unread_notification_count / mark_notifications_read, which show a row only while it is still true (visible_notifications).';

-- ============================================================================
-- 2. The writers: three AFTER INSERT triggers
-- ============================================================================
-- security definer: the insert into follows / post_likes / post_comments runs
-- as whoever made it (a definer RPC, a test as postgres, a cascade), and
-- `notifications` has no client privilege at all. Owned by postgres, pinned
-- search_path, no EXECUTE for any client role (a trigger function is called by
-- the trigger, never as an RPC).
--
-- Self-notification is skipped here (you liking your own post), and the check
-- constraint would refuse it anyway. `on conflict do nothing` is the dedupe.
-- The exception block is the whole body: whatever goes wrong, the write that
-- fired the trigger stands, and a WARNING is left in the log.

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    if new.follower_id is distinct from new.followee_id then
      insert into public.notifications (recipient_id, actor_id, kind)
      values (new.followee_id, new.follower_id, 'follow')
      on conflict (recipient_id, actor_id) where kind = 'follow' do nothing;
    end if;
  exception when others then
    raise warning 'notify_on_follow: no notification for % -> % (%: %)',
      new.follower_id, new.followee_id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_recipient uuid;
begin
  begin
    select e.actor_id into v_recipient
      from public.feed_events e
     where e.id = new.feed_event_id;

    if v_recipient is not null and v_recipient is distinct from new.user_id then
      insert into public.notifications (recipient_id, actor_id, kind, feed_event_id)
      values (v_recipient, new.user_id, 'like', new.feed_event_id)
      on conflict (recipient_id, actor_id, feed_event_id) where kind = 'like' do nothing;
    end if;
  exception when others then
    raise warning 'notify_on_like: no notification for % on post % (%: %)',
      new.user_id, new.feed_event_id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_recipient uuid;
begin
  begin
    select e.actor_id into v_recipient
      from public.feed_events e
     where e.id = new.feed_event_id;

    if v_recipient is not null and v_recipient is distinct from new.user_id then
      insert into public.notifications (recipient_id, actor_id, kind, feed_event_id, comment_id)
      values (v_recipient, new.user_id, 'comment', new.feed_event_id, new.id)
      on conflict (comment_id) where kind = 'comment' do nothing;
    end if;
  exception when others then
    raise warning 'notify_on_comment: no notification for comment % (%: %)',
      new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

alter function public.notify_on_follow() owner to postgres;
alter function public.notify_on_like() owner to postgres;
alter function public.notify_on_comment() owner to postgres;
revoke execute on function public.notify_on_follow() from public, anon, authenticated;
revoke execute on function public.notify_on_like() from public, anon, authenticated;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;

create trigger notify_on_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

create trigger notify_on_like
  after insert on public.post_likes
  for each row execute function public.notify_on_like();

create trigger notify_on_comment
  after insert on public.post_comments
  for each row execute function public.notify_on_comment();

-- ============================================================================
-- 3. visible_notifications -- the one definition of "still true"
-- ============================================================================
-- The caller's notifications that may be shown now; the rules are in this
-- file's header. Every RPC below reads this and nothing else, so the list, the
-- badge and mark-read apply exactly the same rules.
--
-- In `public`, not `private`: 41_blocks_and_reports.test.sql pins what
-- `private` holds. It is no endpoint all the same -- EXECUTE is revoked from
-- every client role, so PostgREST answers /rpc/visible_notifications with a
-- permission error -- and it only ever returns the CALLER's own rows. It asks
-- private.is_blocked rather than reading the blocks table itself, so the
-- block rule keeps its one definition.
--
-- The post's own visibility (feed_event_visible) is deliberately NOT asked:
-- the post is the recipient's own, so actor-or-followee is always true, and
-- the two parts of it that can still hide it -- a block and the age gate --
-- are applied here to the actor and the Bev directly.

create or replace function public.visible_notifications()
returns setof public.notifications
language sql
stable
security definer
set search_path = public, extensions
as $$
  select n.*
    from public.notifications n
    left join public.feed_events e on e.id = n.feed_event_id
    left join public.bevs b on b.id = e.bev_id
    left join public.categories c on c.id = b.category_id
   where auth.uid() is not null
     and n.recipient_id = auth.uid()
     and not private.is_blocked(n.actor_id)
     and case n.kind
           when 'follow' then exists (
             select 1 from public.follows f
              where f.follower_id = n.actor_id and f.followee_id = n.recipient_id)
           when 'like' then exists (
             select 1 from public.post_likes pl
              where pl.user_id = n.actor_id and pl.feed_event_id = n.feed_event_id)
           when 'comment' then exists (
             select 1 from public.post_comments pc
              where pc.id = n.comment_id and pc.deleted_at is null)
           else false
         end
     and (n.kind = 'follow' or b.id is null or not c.is_alcoholic or public.viewer_is_adult());
$$;

alter function public.visible_notifications() owner to postgres;
revoke execute on function public.visible_notifications() from public, anon, authenticated;

comment on function public.visible_notifications() is
  'T-31, internal: the caller''s notifications that are still true (not blocked either way, the follow / like still there, the comment not deleted, the age gate). Read by get_notifications, get_unread_notification_count and mark_notifications_read so they never disagree. No client role may execute it.';

-- ============================================================================
-- 4. get_notifications -- the inbox
-- ============================================================================
-- One output row per DISPLAYED notification. A follow and a comment are a row
-- each; every visible like on one post is ONE row.
--
--   id            the newest notification in the row. It orders the rows and
--                 is the keyset cursor: p_before_id means "rows whose id is
--                 below this". A row's key is computed over its visible members
--                 before paging, so a row is on exactly one page; a new like on
--                 an old post raises that row's key and moves it to the top,
--                 which is the behaviour wanted (a reader paging down meanwhile
--                 simply does not meet it again below).
--   created_at    that newest notification's
--   unread        any member unread
--   actor_count   distinct actors in the row (1 for a follow or a comment)
--   actors        up to two, newest first, as get_followed_by embeds a person
--                 (user_id, handle, display_name, avatar_path, timezone,
--                 onboarded, created_at) plus is_following: whether the CALLER
--                 follows them
--   feed_event_id the post; null for a follow
--   bev_*         the post's Bev, get_feed's twelve Bev columns under the same
--                 names and with the same expressions, so packages/api builds
--                 the BevSummary the feed builds; null for a follow
--   comment_*     the comment; null unless kind = 'comment'
--
-- Limit 20 by default, clamped to 1..50, as get_user_feed does.

create or replace function public.get_notifications(p_limit int default 20, p_before_id bigint default null)
returns table (
  id                   bigint,
  kind                 text,
  created_at           timestamptz,
  unread               boolean,
  actor_count          integer,
  actors               jsonb,
  feed_event_id        bigint,
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
  bev_icon_path        text,
  comment_id           bigint,
  comment_body         text
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
    with v as materialized (
      -- g_post / g_self together are the row a notification is displayed in:
      -- (post, null) for a like, (null, its own id) for the others.
      select vn.id            as n_id,
             vn.kind          as n_kind,
             vn.actor_id      as n_actor,
             vn.feed_event_id as n_event,
             vn.comment_id    as n_comment,
             vn.created_at    as n_created,
             vn.read_at       as n_read,
             case when vn.kind = 'like' then vn.feed_event_id end as g_post,
             case when vn.kind = 'like' then null else vn.id end  as g_self
        from public.visible_notifications() vn
    ),
    grp as (
      select max(v.n_id)                    as g_id,
             bool_or(v.n_read is null)      as g_unread,
             count(distinct v.n_actor)::int as g_actor_count
        from v
       group by v.n_kind, v.g_post, v.g_self
    ),
    pg as (
      select grp.g_id, grp.g_unread, grp.g_actor_count
        from grp
       where p_before_id is null or grp.g_id < p_before_id
       order by grp.g_id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ),
    -- Once per call; see get_bev_leaderboard for why it must be MATERIALIZED.
    prior as materialized (select public.bayes_prior(null) as m)
    select pg.g_id,
           h.n_kind,
           h.n_created,
           pg.g_unread,
           pg.g_actor_count,
           coalesce(ac.items, '[]'::jsonb),
           h.n_event,
           b.id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
           b.price_tier, b.price_estimated, b.status,
           s.rating_count,
           case when b.id is null then null
                else round(public.bayes_score(s.sum_score, s.rating_count, bp.m, 3), 2)::numeric
           end,
           (select bi.path from public.bev_icons bi where bi.bev_id = b.id),
           h.n_comment,
           pc.body
      from pg
      -- The head: the row's newest notification.
      join v h on h.n_id = pg.g_id
      left join lateral (
        select jsonb_agg(
                 jsonb_build_object(
                   'user_id', ap.id,
                   'handle', ap.handle,
                   'display_name', ap.display_name,
                   'avatar_path', ap.avatar_path,
                   'timezone', ap.timezone,
                   'onboarded', ap.onboarded,
                   'created_at', ap.created_at,
                   'is_following', exists (
                     select 1 from public.follows f
                      where f.follower_id = v_uid and f.followee_id = ap.id)
                 )
                 order by m.n_id desc
               ) as items
          from (
            select v2.n_id, v2.n_actor
              from v v2
             where v2.n_kind = h.n_kind
               and v2.g_post is not distinct from h.g_post
               and v2.g_self is not distinct from h.g_self
             order by v2.n_id desc
             limit 2
          ) m
          join public.profiles ap on ap.id = m.n_actor
      ) ac on true
      left join public.feed_events e on e.id = h.n_event
      left join public.bevs b on b.id = e.bev_id
      left join public.bev_stats s on s.bev_id = b.id
      left join public.post_comments pc on pc.id = h.n_comment
     cross join prior bp
     order by pg.g_id desc;
end;
$$;

alter function public.get_notifications(int, bigint) owner to postgres;
revoke execute on function public.get_notifications(int, bigint) from public, anon, authenticated;
grant execute on function public.get_notifications(int, bigint) to authenticated;

comment on function public.get_notifications(int, bigint) is
  'T-31: the caller''s inbox, newest first, keyset-paged on id (the newest notification in each row). Likes on one post are one row with actor_count and the two newest actors; follows and comments are a row each. Only what visible_notifications says is still true.';

-- ============================================================================
-- 5. get_unread_notification_count -- the badge
-- ============================================================================
-- The number of DISPLAYED rows with anything unread: a row of three unread
-- likes is 1, as it is one row on the screen. The same grouping as
-- get_notifications, over the same visible_notifications().

create or replace function public.get_unread_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
    from (
      select 1
        from public.visible_notifications() vn
       group by vn.kind,
                case when vn.kind = 'like' then vn.feed_event_id end,
                case when vn.kind = 'like' then null else vn.id end
      having bool_or(vn.read_at is null)
    ) unread_rows;

  return v_count;
end;
$$;

alter function public.get_unread_notification_count() owner to postgres;
revoke execute on function public.get_unread_notification_count() from public, anon, authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;

comment on function public.get_unread_notification_count() is
  'T-31: how many rows of get_notifications have anything unread (a row of likes counts once).';

-- ============================================================================
-- 6. mark_notifications_read
-- ============================================================================
-- Every unread notification of the caller's with id <= p_up_to_id (all of them
-- when it is null) is marked read. Only the VISIBLE ones, as the list and the
-- count see them: a notification hidden by an unfollow or a block was never on
-- the screen, so if it becomes true again it comes back unread. Idempotent:
-- an already-read row is left with its first read_at.
--
-- No assert_rate. It is called once when the inbox opens, it touches only the
-- caller's own rows, and an already-read row makes it a no-op, so a runaway
-- client costs a query each time and writes nothing.

create or replace function public.mark_notifications_read(p_up_to_id bigint default null)
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

  update public.notifications n
     set read_at = now()
   where n.recipient_id = v_uid
     and n.read_at is null
     and (p_up_to_id is null or n.id <= p_up_to_id)
     and n.id in (select vn.id from public.visible_notifications() vn);
end;
$$;

alter function public.mark_notifications_read(bigint) owner to postgres;
revoke execute on function public.mark_notifications_read(bigint) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(bigint) to authenticated;

comment on function public.mark_notifications_read(bigint) is
  'T-31: marks the caller''s visible unread notifications with id <= p_up_to_id (all when null) read. Idempotent.';

-- ============================================================================
-- 7. get_post -- one post, in get_feed's shape
-- ============================================================================
-- What a notification opens. get_user_feed's select (20261118220100, 4b) for a
-- single id, so it returns get_feed's columns, in get_feed's order, with the
-- same expressions: the inline comments and comment_count filtered by a block
-- as the feed is, like_count deliberately not (D-15), also_bevd relative to
-- the caller. Gated by feed_event_visible, the feed's own rule (actor or
-- followee, no block either way, the age gate). Not visible and not there are
-- the same BEVI_NOT_FOUND, as like_post answers them.
--
-- KEEP IN STEP WITH get_feed AND get_user_feed: packages/api maps all three
-- with one FeedRpcRow mapper.

create or replace function public.get_post(p_event_id bigint)
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
               and not private.is_blocked(pc.user_id))::integer,
           coalesce(ic.items, '[]'::jsonb),
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
               and not private.is_blocked(cm.user_id)
             order by cm.id
             limit 7
          ) t
      ) ic on true
      cross join prior bp
     where e.id = p_event_id
       and e.kind in ('ranked', 'reranked')
       and public.feed_event_visible(e.id);

  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

alter function public.get_post(bigint) owner to postgres;
revoke execute on function public.get_post(bigint) from public, anon, authenticated;
grant execute on function public.get_post(bigint) to authenticated;

comment on function public.get_post(bigint) is
  'T-31: one feed post in get_feed''s columns, for the post a notification opens. BEVI_NOT_FOUND when it does not exist or the caller may not see it (feed_event_visible). Must change together with get_feed and get_user_feed.';
