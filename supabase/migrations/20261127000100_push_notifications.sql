-- T-31, Release 2: push notifications, and the settings that govern them.
--
-- Release 1 (20261126000100) stores an inbox row when someone follows you, or
-- likes or comments on your post. This migration turns those rows, and a fourth
-- kind of event, into pushes on the phone, and gives each user the switches
-- that decide which ones they get.
--
-- WHAT THIS FILE ADDS
--
--   public.notification_settings            table: one row per user who changed
--                                           a switch; no row means the defaults
--   public.post_notification_subscriptions  table: "tell me when X posts", one
--                                           row per (subscriber, person followed)
--   public.push_tokens                      table: Expo push tokens, one device,
--                                           one signed-in account
--   public.push_outbox                      table: the durable push queue
--   public.push_tickets                     table: Expo tickets awaiting a receipt
--
--   RPCs for the app (authenticated):
--     get_notification_settings()
--     update_notification_settings(bool, bool, bool, bool, bool)
--     set_post_notification(uuid, bool)
--     get_post_notification_people(text, int, int)
--     register_push_token(text, text)
--     unregister_push_token(text)
--
--   Worker functions (service_role ONLY, called by the send-push Edge Function):
--     claim_push_batch(int)            finish_push_batch(bigint[], text)
--     record_push_tickets(jsonb)       claim_push_receipts(int)
--     finish_push_receipts(text[])     prune_push_tokens(text[])
--
--   Internal (no role may execute them; definer functions call them):
--     blocked_between(uuid, uuid), user_is_adult(uuid),
--     visible_notifications_for(uuid), notification_settings_of(uuid), the trigger functions, push_poke(text),
--     drain_push_outbox() (pg_cron, every minute)
--
--   Re-created: public.visible_notifications(), Release 1's own internal
--   function, same signature, same result, now a wrapper (section 1).
--
-- THE KINDS. `follow`, `like` and `comment` are the three inbox kinds: a push
-- is queued when an inbox row is INSERTED (a trigger on `notifications`), so a
-- like / unlike / like loop, which Release 1 dedupes into one row, also makes
-- exactly one push, ever. `post` is new: "someone you chose posted a Bev". You
-- choose people one by one, only from people you follow; the choice goes when
-- the follow goes (unfollow, or a block, which deletes the follow). It fires
-- for a NEW ranking only (feed_events.kind = 'ranked'), never a re-rank, and
-- it goes to the phone only: it writes no inbox row.
--
-- ENQUEUE IS DUMB, CLAIM DECIDES. The two writers queue unconditionally and
-- cheaply, inside exception blocks, so a queue failure can never take a like,
-- a comment, a follow or a ranking down with it. EVERYTHING that decides
-- whether a push goes out -- pause, the kind's switch, a device to send to, a
-- block either way, the age gate, and whether what it says is still true -- is
-- decided once, at claim time, in claim_push_batch. A push is sent only when
-- `paused` is false and that kind's switch is on. Pausing never touches the
-- switches, so un-pausing restores exactly what was on.
--
-- VISIBILITY FOR AN ARBITRARY USER. claim_push_batch runs as the service role,
-- where auth.uid() is null, and visible_notifications(), private.is_blocked()
-- and viewer_is_adult() all read auth.uid(). So the Release 1 rule is restated
-- ONCE for an explicit user, visible_notifications_for(p_user), and
-- visible_notifications() becomes `visible_notifications_for(auth.uid())`. The
-- inbox list, the badge, mark-read and the push claim now read one definition.
-- The two-way block test and the 21-and-over test it needs are blocked_between
-- and user_is_adult: the same predicates as private.is_blocked and
-- viewer_is_adult for an explicit pair / user (47_push_notifications.test.sql
-- asserts they agree). They live in `public`, not `private`, because
-- 41_blocks_and_reports.test.sql pins what `private` holds; no client role may
-- execute them, so they are no endpoint and no oracle, and test 41's allowlist
-- of CLIENT-CALLABLE functions that read the blocks table is unchanged.
--
-- THE SENDER. supabase/functions/send-push claims a batch, words the messages,
-- posts them to Expo, records each ticket, and ~15 minutes later fetches the
-- receipts; a DeviceNotRegistered answer either time deletes that token. It is
-- woken two ways, exactly as the icon worker is (20261119185800/185802): a
-- best-effort pg_net POST after each queue insert (statement-level, so a burst
-- pokes once), and a pg_cron drain every minute that pokes only when there is
-- work. Both read the URL and the bearer token from Vault inside guarded
-- blocks, and both do NOTHING until an operator creates the two secrets by
-- hand, OUTSIDE this repo:
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-push',
--                              'push_function_url',
--                              'the send-push Edge Function endpoint');
--   select vault.create_secret('<PUSH_WEBHOOK_SECRET>',
--                              'push_webhook_token',
--                              'the bearer token send-push checks');
--
-- And the function itself sends nothing until PUSH_SENDING_ENABLED is exactly
-- `true` (a kill switch, default off). So until both are done the whole system
-- is inert: rows are queued and judged nowhere, and the drain's housekeeping
-- deletes them after a week, so the queue stays bounded meanwhile.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * No change to notify_on_*, follow_user, like_post, add_comment,
--     block_user, submit_ranking or any other existing function: two new
--     triggers (on notifications and feed_events) and one on follows (AFTER
--     DELETE) do the writing. visible_notifications() is the only function
--     re-created, and its behaviour is identical.
--   * No inbox row for a `post` push, and no push for a re-rank, or for the
--     likes and comments the people you chose receive.
--   * No push to yourself (a check, and both writers skip it).
--   * No email, no SMS, no quiet hours, no per-person mute beyond `post`.
--   * No push about anything older than a day: a row the sender never got to
--     (the kill switch was off, Expo was down) is skipped as `expired` rather
--     than delivered late.

set search_path = public, extensions;

-- ============================================================================
-- 1. Visibility for an explicit user, and visible_notifications() over it
-- ============================================================================

-- private.is_blocked(p) is "a block between auth.uid() and p, either way".
-- This is the same predicate for an explicit pair. KEEP THE TWO IN STEP.
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_a is not null
     and p_b is not null
     and exists (
       select 1 from public.user_blocks ub
        where (ub.blocker_id = p_a and ub.blocked_id = p_b)
           or (ub.blocker_id = p_b and ub.blocked_id = p_a)
     );
$$;

-- viewer_is_adult() for an explicit user: 21 or over by profiles.birth_date,
-- false when unknown. KEEP THE TWO IN STEP.
create or replace function public.user_is_adult(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select pr.birth_date <= (current_date - interval '21 years')::date
       from public.profiles pr where pr.id = p_user),
    false);
$$;

-- Release 1's rule (20261126000100, section 3), word for word, for p_user:
-- the user's rows, no block either way with the actor, the follow / like still
-- there, the comment not deleted, and on an alcoholic Bev's post the user 21
-- or over. A null user has no rows, as auth.uid() null had none.
create or replace function public.visible_notifications_for(p_user uuid)
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
   where p_user is not null
     and n.recipient_id = p_user
     and not public.blocked_between(p_user, n.actor_id)
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
     and (n.kind = 'follow' or b.id is null or not c.is_alcoholic or public.user_is_adult(p_user));
$$;

-- Same signature and result as Release 1's; the body is now the wrapper. Its
-- callers (get_notifications, get_unread_notification_count,
-- mark_notifications_read) are untouched and see the same rows.
create or replace function public.visible_notifications()
returns setof public.notifications
language sql
stable
security definer
set search_path = public, extensions
as $$
  select vn.* from public.visible_notifications_for(auth.uid()) vn;
$$;

alter function public.blocked_between(uuid, uuid) owner to postgres;
alter function public.user_is_adult(uuid) owner to postgres;
alter function public.visible_notifications_for(uuid) owner to postgres;
alter function public.visible_notifications() owner to postgres;
-- Internal: called only by other definer functions owned by postgres, which
-- need no EXECUTE. `anon`, `authenticated` and `service_role` are named because
-- Supabase's default privileges grant them directly, which a revoke from PUBLIC
-- does not touch.
revoke execute on function public.blocked_between(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.user_is_adult(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.visible_notifications_for(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.visible_notifications() from public, anon, authenticated;

comment on function public.blocked_between(uuid, uuid) is
  'T-31, internal: a block between the two users in either direction. private.is_blocked for an explicit pair (that one reads auth.uid()); keep the two in step. No role may execute it.';
comment on function public.user_is_adult(uuid) is
  'T-31, internal: the user is 21 or over by profiles.birth_date (false when unknown). viewer_is_adult for an explicit user; keep the two in step. No role may execute it.';
comment on function public.visible_notifications_for(uuid) is
  'T-31, internal: the user''s notifications that are still true (not blocked either way, the follow / like still there, the comment not deleted, the age gate). The one definition: visible_notifications() is this for auth.uid(), and claim_push_batch reads it for a push''s recipient. No role may execute it.';
comment on function public.visible_notifications() is
  'T-31, internal: visible_notifications_for(auth.uid()). Read by get_notifications, get_unread_notification_count and mark_notifications_read so they never disagree. No client role may execute it.';

-- ============================================================================
-- 2. notification_settings
-- ============================================================================
-- One row per user who has ever saved their settings. No row means the
-- defaults, and a read never writes one. `paused` is independent of the four
-- switches: pausing leaves them as they are, so un-pausing restores them.

create table public.notification_settings (
  user_id    uuid        primary key references public.profiles(id) on delete cascade,
  paused     boolean     not null default false,
  follows    boolean     not null default true,
  likes      boolean     not null default true,
  comments   boolean     not null default true,
  posts      boolean     not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;
-- No policy: read and written only through the definer RPCs below. Supabase's
-- default privileges grant every verb (TRUNCATE included, which RLS cannot
-- deny) to the client roles; 42_table_privileges.test.sql fails a table that
-- keeps them.
revoke all on table public.notification_settings from anon, authenticated;

comment on table public.notification_settings is
  'T-31: a user''s push switches. No row means the defaults (not paused; follows, likes, comments on; posts off). A push is sent only when paused is false and its kind''s switch is on. Read and written only by get_notification_settings / update_notification_settings; read by claim_push_batch.';

-- The defaults, stated once for every reader. The table's column defaults say
-- the same for a row that is inserted; KEEP THE TWO IN STEP.
create or replace function public.notification_settings_of(p_user uuid)
returns table (paused boolean, follows boolean, likes boolean, comments boolean, posts boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(s.paused, false),
         coalesce(s.follows, true),
         coalesce(s.likes, true),
         coalesce(s.comments, true),
         coalesce(s.posts, false)
    from (select 1) one
    left join public.notification_settings s on s.user_id = p_user;
$$;

alter function public.notification_settings_of(uuid) owner to postgres;
revoke execute on function public.notification_settings_of(uuid) from public, anon, authenticated, service_role;

comment on function public.notification_settings_of(uuid) is
  'T-31, internal: the user''s settings, or the defaults when they have no row. Read by get_notification_settings and claim_push_batch. No role may execute it.';

create or replace function public.get_notification_settings()
returns table (paused boolean, follows boolean, likes boolean, comments boolean, posts boolean)
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
    select st.paused, st.follows, st.likes, st.comments, st.posts
      from public.notification_settings_of(v_uid) st;
end;
$$;

-- The whole object, every time: the app owns the toggle rules (what turning
-- one switch does to another), the backend stores the five booleans it is
-- given. A null is the caller's bug, never "leave it as it was".
--
-- No assert_rate: it writes one row, the caller's own, and a runaway client
-- costs an upsert of the same row.
create or replace function public.update_notification_settings(
  p_paused   boolean,
  p_follows  boolean,
  p_likes    boolean,
  p_comments boolean,
  p_posts    boolean
)
returns table (paused boolean, follows boolean, likes boolean, comments boolean, posts boolean)
language plpgsql
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
  if p_paused is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'paused';
  end if;
  if p_follows is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'follows';
  end if;
  if p_likes is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'likes';
  end if;
  if p_comments is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'comments';
  end if;
  if p_posts is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'posts';
  end if;

  insert into public.notification_settings as s
         (user_id, paused, follows, likes, comments, posts, updated_at)
  values (v_uid, p_paused, p_follows, p_likes, p_comments, p_posts, now())
  on conflict (user_id) do update
     set paused     = excluded.paused,
         follows    = excluded.follows,
         likes      = excluded.likes,
         comments   = excluded.comments,
         posts      = excluded.posts,
         updated_at = excluded.updated_at;

  return query
    select s.paused, s.follows, s.likes, s.comments, s.posts
      from public.notification_settings s
     where s.user_id = v_uid;
end;
$$;

alter function public.get_notification_settings() owner to postgres;
alter function public.update_notification_settings(boolean, boolean, boolean, boolean, boolean) owner to postgres;
revoke execute on function public.get_notification_settings() from public, anon;
revoke execute on function public.update_notification_settings(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_notification_settings() to authenticated;
grant execute on function public.update_notification_settings(boolean, boolean, boolean, boolean, boolean) to authenticated;

comment on function public.get_notification_settings() is
  'T-31: the caller''s push settings as one row; the defaults when they never saved any (a read never writes).';
comment on function public.update_notification_settings(boolean, boolean, boolean, boolean, boolean) is
  'T-31: stores the caller''s five push switches (all required; a null is BEVI_VALIDATION naming it) and returns them as stored.';

-- ============================================================================
-- 3. post_notification_subscriptions -- "tell me when X posts"
-- ============================================================================
-- One row per (subscriber, person they follow). Turned on one person at a
-- time, only for someone the subscriber follows, and removed the moment that
-- follow goes (section 3c), so a re-follow starts with it off.

create table public.post_notification_subscriptions (
  subscriber_id uuid        not null references public.profiles(id) on delete cascade,
  target_id     uuid        not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (subscriber_id, target_id),
  constraint post_notification_subscriptions_no_self check (subscriber_id <> target_id)
);

-- The fan-out (who wants a push when target_id posts) and the target's cascade.
-- The primary key serves the subscriber's side.
create index post_notification_subscriptions_target_idx
  on public.post_notification_subscriptions (target_id);

alter table public.post_notification_subscriptions enable row level security;
revoke all on table public.post_notification_subscriptions from anon, authenticated;

comment on table public.post_notification_subscriptions is
  'T-31: the people a user asked to be pushed about when they post a Bev. Only people the subscriber follows (set_post_notification checks; drop_post_notification_on_unfollow removes the row with the follow). Read by get_post_notification_people and the feed_events trigger that queues post pushes.';

-- ----------------------------------------------------------------------------
-- 3a. set_post_notification
-- ----------------------------------------------------------------------------
-- On: the caller must follow them. With no follow edge the answer is always
-- BEVI_VALIDATION 'not following' -- for a person who does not exist, for the
-- caller themselves, and for someone across a block (a block deletes the
-- follow both ways and follow_user refuses across one) -- so the answer never
-- tells "blocked or absent" from "exists". BEVI_NOT_FOUND is left only for a
-- follow edge that stands beside a block, which no client path can produce.
-- Off: always resolves, never rate-limited. Idempotent both ways.
--
-- THE RACE WITH AN UNFOLLOW. The follow row is read `for key share`, which a
-- concurrent DELETE of it must wait for. So either the unfollow committed
-- first (no row: 'not following'), or it waits for this transaction and its
-- AFTER DELETE trigger then removes the subscription inserted here. Without
-- the lock both could commit and leave a subscription with no follow, which a
-- later re-follow would bring back.
--
-- Turning ON is rate-limited like follow_user's neighbours: 200 a day is far
-- past any real use of a settings screen and still caps a runaway client.

create or replace function public.set_post_notification(p_user_id uuid, p_on boolean)
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
  if p_on is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'on';
  end if;

  if not p_on then
    delete from public.post_notification_subscriptions s
     where s.subscriber_id = v_uid and s.target_id = p_user_id;
    return;
  end if;

  perform public.assert_rate('set_post_notification', 200, interval '1 day');

  perform 1
     from public.follows f
    where f.follower_id = v_uid and f.followee_id = p_user_id
      for key share;
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'not following';
  end if;

  if private.is_blocked(p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.post_notification_subscriptions (subscriber_id, target_id)
  values (v_uid, p_user_id)
  on conflict (subscriber_id, target_id) do nothing;
end;
$$;

alter function public.set_post_notification(uuid, boolean) owner to postgres;
revoke execute on function public.set_post_notification(uuid, boolean) from public, anon;
grant execute on function public.set_post_notification(uuid, boolean) to authenticated;

comment on function public.set_post_notification(uuid, boolean) is
  'T-31: turns "push me when this person posts" on or off. On requires that the caller follows them (BEVI_VALIDATION not following, whatever else is true of the id) and is rate-limited; off always resolves. Idempotent both ways.';

-- ----------------------------------------------------------------------------
-- 3b. get_post_notification_people
-- ----------------------------------------------------------------------------
-- The people the caller follows, never one across a block, each embedded as
-- list_blocked_users embeds a person, plus whether a post push is on for them.
-- Subscribed first, then by handle in code-point order (collate "C", as the
-- FakeApi's compareCodePoints sorts). Optional `p_q`: a case-insensitive
-- substring of the handle or the display name, matched with strpos rather
-- than LIKE so the query has no wildcards to escape; a leading '@' is dropped,
-- since people type handles with one. Offset paging as list_blocked_users.

create or replace function public.get_post_notification_people(
  p_q      text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  user_id      uuid,
  handle       text,
  display_name text,
  avatar_path  text,
  timezone     text,
  onboarded    boolean,
  created_at   timestamptz,
  subscribed   boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q   text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if char_length(coalesce(p_q, '')) > 80 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'q';
  end if;

  v_q := nullif(lower(ltrim(btrim(coalesce(p_q, '')), '@')), '');

  return query
    select p.id, p.handle, p.display_name, p.avatar_path,
           p.timezone, p.onboarded, p.created_at,
           (s.subscriber_id is not null)
      from public.follows f
      join public.profiles p on p.id = f.followee_id
      left join public.post_notification_subscriptions s
        on s.subscriber_id = v_uid and s.target_id = f.followee_id
     where f.follower_id = v_uid
       and not private.is_blocked(f.followee_id)
       and (v_q is null
            or strpos(lower(p.handle), v_q) > 0
            or strpos(lower(p.display_name), v_q) > 0)
     order by (s.subscriber_id is not null) desc, p.handle collate "C" asc, p.id asc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

alter function public.get_post_notification_people(text, int, int) owner to postgres;
revoke execute on function public.get_post_notification_people(text, int, int) from public, anon;
grant execute on function public.get_post_notification_people(text, int, int) to authenticated;

comment on function public.get_post_notification_people(text, int, int) is
  'T-31: the people the caller follows (never one across a block), with whether a post push is on for each; subscribed first, then by handle. Optional case-insensitive match on handle or display name. Offset-paged.';

-- ----------------------------------------------------------------------------
-- 3c. A follow that goes takes its subscription with it
-- ----------------------------------------------------------------------------
-- AFTER DELETE on follows catches every way a follow ends: unfollow_user, the
-- client's own direct delete (follows_delete), block_user's two deletes, and
-- an account deletion's cascade. Exception-wrapped like the Release 1
-- triggers: whatever goes wrong, the unfollow stands.

create or replace function public.drop_post_notification_on_unfollow()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    delete from public.post_notification_subscriptions s
     where s.subscriber_id = old.follower_id
       and s.target_id = old.followee_id;
  exception when others then
    raise warning 'drop_post_notification_on_unfollow: subscription % -> % kept (%: %)',
      old.follower_id, old.followee_id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

alter function public.drop_post_notification_on_unfollow() owner to postgres;
revoke execute on function public.drop_post_notification_on_unfollow() from public, anon, authenticated, service_role;

create trigger drop_post_notification_on_unfollow
  after delete on public.follows
  for each row execute function public.drop_post_notification_on_unfollow();

-- ============================================================================
-- 4. push_tokens
-- ============================================================================
-- An Expo push token per device. The token is the key, so one device belongs
-- to one signed-in account: registering a token another account held moves it
-- (the phone changed hands, or someone signed out and in as somebody else).
-- At most 10 per user, the most recently seen kept, so nobody can grow the
-- table without bound.

create table public.push_tokens (
  token        text        primary key
               check (char_length(token) <= 200
                      and token ~ '^Expo(nent)?PushToken\[[!-~]{1,180}\]$'),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  platform     text        not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id, last_seen_at desc);

alter table public.push_tokens enable row level security;
revoke all on table public.push_tokens from anon, authenticated;

comment on table public.push_tokens is
  'T-31: Expo push tokens, one row per device, owned by the account last signed in on it. Written by register_push_token / unregister_push_token (at most 10 per user), read by claim_push_batch, pruned by prune_push_tokens when Expo says DeviceNotRegistered.';

create or replace function public.register_push_token(p_token text, p_platform text default 'ios')
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
  if p_token is null or char_length(p_token) > 200
     or p_token !~ '^Expo(nent)?PushToken\[[!-~]{1,180}\]$' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'platform';
  end if;

  -- An app registers at every launch; 60 an hour is far past that.
  perform public.assert_rate('register_push_token', 60, interval '1 hour');

  insert into public.push_tokens as t (token, user_id, platform, created_at, last_seen_at)
  values (p_token, v_uid, p_platform, now(), now())
  on conflict (token) do update
     set user_id      = excluded.user_id,
         platform     = excluded.platform,
         last_seen_at = excluded.last_seen_at;

  -- The cap: this token, plus the nine others seen most recently.
  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.token <> p_token
     and t.token not in (
       select k.token
         from public.push_tokens k
        where k.user_id = v_uid and k.token <> p_token
        order by k.last_seen_at desc, k.token desc
        limit 9
     );
end;
$$;

-- Only the caller's own token: someone else's, or one that is nobody's, is a
-- no-op, so signing out twice is safe and a token cannot be used to probe.
create or replace function public.unregister_push_token(p_token text)
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

  delete from public.push_tokens t
   where t.token = p_token and t.user_id = v_uid;
end;
$$;

alter function public.register_push_token(text, text) owner to postgres;
alter function public.unregister_push_token(text) owner to postgres;
revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

comment on function public.register_push_token(text, text) is
  'T-31: records this device''s Expo push token for the caller (moving it from another account if it was theirs) and bumps last_seen_at. Keeps the caller''s 10 most recently seen tokens. Rate-limited.';
comment on function public.unregister_push_token(text) is
  'T-31: forgets this device''s token if it is the caller''s; otherwise a no-op. Idempotent.';

-- ============================================================================
-- 5. push_outbox -- the queue -- and push_tickets
-- ============================================================================
-- One row per push to send. `sent_at` is set when it is finished, whether it
-- was sent or skipped (`last_error` says 'skipped: <reason>' then).
-- `attempts` counts CLAIMS, not failures: every lease raises it, so a sender
-- that dies after Expo took a message but before it reported back cannot make
-- the row go out again more than five times in all. A failed send keeps the
-- row unsent with its error and the lease dropped. `claimed_at` is the lease:
-- a claim older than five minutes may be taken again (the Edge Function's
-- wall time is far below that).
--
-- Everything referenced cascades: a push about a post, a comment or a person
-- that is gone has nothing to say.

create table public.push_outbox (
  id            bigint      generated always as identity primary key,
  recipient_id  uuid        not null references public.profiles(id) on delete cascade,
  actor_id      uuid        not null references public.profiles(id) on delete cascade,
  kind          text        not null check (kind in ('follow', 'like', 'comment', 'post')),
  feed_event_id bigint      references public.feed_events(id) on delete cascade,
  comment_id    bigint      references public.post_comments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  attempts      integer     not null default 0,
  last_error    text,
  constraint push_outbox_no_self check (recipient_id <> actor_id),
  constraint push_outbox_shape check (
    (kind = 'follow'     and feed_event_id is null     and comment_id is null)
    or (kind = 'like'    and feed_event_id is not null and comment_id is null)
    or (kind = 'comment' and feed_event_id is not null and comment_id is not null)
    or (kind = 'post'    and feed_event_id is not null and comment_id is null)
  )
);

-- The claim and the drain's "is there work" probe: unsent rows, oldest first.
create index push_outbox_pending_idx on public.push_outbox (id) where sent_at is null;
-- Housekeeping: everything queued more than a week ago.
create index push_outbox_created_idx on public.push_outbox (created_at);
-- The cascades.
create index push_outbox_recipient_idx on public.push_outbox (recipient_id);
create index push_outbox_actor_idx on public.push_outbox (actor_id);
create index push_outbox_feed_event_idx on public.push_outbox (feed_event_id) where feed_event_id is not null;
create index push_outbox_comment_idx on public.push_outbox (comment_id) where comment_id is not null;

alter table public.push_outbox enable row level security;
revoke all on table public.push_outbox from anon, authenticated;

comment on table public.push_outbox is
  'T-31: the push queue. Written by the triggers on notifications (follow / like / comment) and feed_events (post, for a new ranking only); claimed, judged and finished only by the service-role worker functions. sent_at is set when a row is done, sent or skipped (last_error ''skipped: <reason>'').';

-- Expo answers each message with a ticket; about 15 minutes later its receipt
-- says whether the device took it. Kept only for that check, and two days.
create table public.push_tickets (
  ticket_id  text        primary key check (char_length(ticket_id) between 1 and 200),
  token      text        not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

-- The receipt claim and the drain's probe; and housekeeping by age.
create index push_tickets_unchecked_idx on public.push_tickets (created_at) where checked_at is null;
create index push_tickets_created_idx on public.push_tickets (created_at);

alter table public.push_tickets enable row level security;
revoke all on table public.push_tickets from anon, authenticated;

comment on table public.push_tickets is
  'T-31: Expo push tickets awaiting their receipt. Written by record_push_tickets, read by claim_push_receipts ~15 minutes later, marked by finish_push_receipts, deleted after two days by drain_push_outbox.';

-- ----------------------------------------------------------------------------
-- 5a. The poke: wake the sender now rather than within the minute
-- ----------------------------------------------------------------------------
-- The icon worker's shape (20261119185800, enqueue_bev_icon_job): the suspend
-- GUC first, so bulk work decrypts nothing; the Vault read in its own handler
-- (20261031000100: a Vault read can throw); nothing at all when either secret
-- is missing or blank; and the POST itself best-effort. pg_net queues it and
-- sends it after commit, so a rolled-back like pokes nobody.

create or replace function public.push_poke(p_source text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text;
  v_token text;
begin
  -- `set local bevi.push_suspend = 'true';` in bulk work (an import, a
  -- backfill) keeps it from poking once per statement; the drain still runs.
  if coalesce(current_setting('bevi.push_suspend', true), '') = 'true' then
    return;
  end if;

  begin
    select nullif(s.decrypted_secret, '') into v_url
      from vault.decrypted_secrets s where s.name = 'push_function_url';
    select nullif(s.decrypted_secret, '') into v_token
      from vault.decrypted_secrets s where s.name = 'push_webhook_token';
  exception when others then
    raise warning 'push_poke: could not read the push config from Vault (%: %)', sqlstate, sqlerrm;
    return;
  end;

  -- Unconfigured: local stacks, CI, and production until an operator turns it on.
  if v_url is null or v_token is null then
    return;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('source', p_source),
      headers := jsonb_build_object('Content-Type',  'application/json',
                                    'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'push_poke: could not queue the poke (%: %)', sqlstate, sqlerrm;
  end;
end;
$$;

alter function public.push_poke(text) owner to postgres;
-- Nobody may make the database POST the bearer token by hand.
revoke execute on function public.push_poke(text) from public, anon, authenticated, service_role;

comment on function public.push_poke(text) is
  'T-31, internal: best-effort pg_net POST that wakes send-push. A no-op under bevi.push_suspend = true and unless the Vault secrets push_function_url and push_webhook_token both exist. Never raises.';

-- Statement-level, so an INSERT ... SELECT that queues a post push for every
-- subscriber pokes once, and a statement that queued nothing pokes nobody.
create or replace function public.poke_push_sender()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    if exists (select 1 from new_rows) then
      perform public.push_poke('outbox');
    end if;
  exception when others then
    raise warning 'poke_push_sender: no poke (%: %)', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

alter function public.poke_push_sender() owner to postgres;
revoke execute on function public.poke_push_sender() from public, anon, authenticated, service_role;

create trigger poke_push_sender
  after insert on public.push_outbox
  referencing new table as new_rows
  for each statement execute function public.poke_push_sender();

-- ----------------------------------------------------------------------------
-- 5b. The writers
-- ----------------------------------------------------------------------------
-- A new inbox row is a push to queue. AFTER INSERT on notifications rather
-- than on follows / post_likes / post_comments, because the inbox's partial
-- unique indexes have already decided whether this is a NEW thing: a re-like
-- after an unlike inserts nothing there, so it queues nothing here.
--
-- This runs inside the notify_on_* trigger's own exception block. If it raised,
-- that block would swallow it and lose the INBOX row too -- hence its own
-- handler, which loses only the push.

create or replace function public.enqueue_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    if new.recipient_id is distinct from new.actor_id then
      insert into public.push_outbox (recipient_id, actor_id, kind, feed_event_id, comment_id)
      values (new.recipient_id, new.actor_id, new.kind, new.feed_event_id, new.comment_id);
    end if;
  exception when others then
    raise warning 'enqueue_push_on_notification: no push for notification % (%: %)',
      new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- A NEW ranking, to everyone who asked for this person's posts. Only
-- kind = 'ranked' (the trigger's WHEN); a re-rank is 'reranked' and pushes
-- nobody. Whether each subscriber still follows, is still not blocked, may see
-- the Bev and has `posts` on is the claim's question, not this one's.

create or replace function public.enqueue_push_on_post()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    insert into public.push_outbox (recipient_id, actor_id, kind, feed_event_id)
    select s.subscriber_id, new.actor_id, 'post', new.id
      from public.post_notification_subscriptions s
     where s.target_id = new.actor_id
       and s.subscriber_id <> new.actor_id;
  exception when others then
    raise warning 'enqueue_push_on_post: no post pushes for feed event % (%: %)',
      new.id, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

alter function public.enqueue_push_on_notification() owner to postgres;
alter function public.enqueue_push_on_post() owner to postgres;
revoke execute on function public.enqueue_push_on_notification() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_push_on_post() from public, anon, authenticated, service_role;

create trigger enqueue_push_on_notification
  after insert on public.notifications
  for each row execute function public.enqueue_push_on_notification();

create trigger enqueue_push_on_post
  after insert on public.feed_events
  for each row
  when (new.kind = 'ranked')
  execute function public.enqueue_push_on_post();

-- ============================================================================
-- 6. The worker functions (service_role only)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6a. claim_push_batch -- the one place a push is judged
-- ----------------------------------------------------------------------------
-- Takes up to p_limit (1..500) rows that are unsent and unclaimed or hold a
-- lease older than five minutes, oldest first, `for update skip locked` so two
-- senders take disjoint sets (a row locked by the other is simply left for the
-- next claim). Each row is then judged, and a row that must not go out is
-- FINISHED in the same statement (sent_at = now(), last_error =
-- 'skipped: <reason>'), first reason wins:
--
--   attempts   already claimed five times: whatever happened to those five
--              sends (a crash after Expo took it, five failures), never a sixth
--   expired    queued more than a day ago: late news is no news
--   paused     the recipient paused pushes
--   kind off   the recipient turned this kind off (posts are off by default)
--   no tokens  the recipient has no device registered
--   blocked    a block stands between recipient and actor, either way
--   age gate   it is about an alcoholic Bev and the recipient is under 21
--   not true   what it says is no longer so: for follow / like / comment the
--              inbox row is no longer visible (visible_notifications_for: the
--              unfollow, the unlike, the deleted comment); for a post, the
--              subscription or the follow is gone
--
-- The rest are leased (claimed_at = now(), attempts + 1) and returned with
-- everything the sender needs to word them: the actor's handle, the Bev's name / brand /
-- flavor (get_feed's fields), the comment's body, every token of the
-- recipient (most recently seen first) and `badge`, the recipient's unread
-- displayed-row count as the app's badge shows it.
--
-- COST. visible_notifications_for is a definer set-returning function, so it
-- is not inlined: it runs once per DISTINCT recipient in the batch (`vis`),
-- and both the still-true test and the badge read that one result. The badge
-- is get_unread_notification_count's grouping (20261126000100, section 5)
-- over it; KEEP THE TWO IN STEP.

create or replace function public.claim_push_batch(p_limit int default 100)
returns table (
  id            bigint,
  kind          text,
  recipient_id  uuid,
  tokens        text[],
  actor_id      uuid,
  actor_handle  text,
  feed_event_id bigint,
  bev_name      text,
  bev_brand     text,
  bev_flavor    text,
  comment_id    bigint,
  comment_body  text,
  badge         integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return query
  with picked as (
    select o.id as o_id
      from public.push_outbox o
     where o.sent_at is null
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.id
     limit v_limit
       for update of o skip locked
  ),
  recips as materialized (
    select distinct o.recipient_id as r_id
      from picked pk
      join public.push_outbox o on o.id = pk.o_id
  ),
  -- Each recipient's visible inbox, computed once.
  vis as materialized (
    select r.r_id as v_recipient, vn.id as v_id, vn.kind as v_kind, vn.actor_id as v_actor,
           vn.feed_event_id as v_event, vn.comment_id as v_comment, vn.read_at as v_read
      from recips r
      cross join lateral public.visible_notifications_for(r.r_id) vn
  ),
  -- The badge per recipient: displayed rows with anything unread.
  badges as materialized (
    select r.r_id as b_recipient,
           (select count(*)::integer
              from (
                select 1
                  from vis v
                 where v.v_recipient = r.r_id
                 group by v.v_kind,
                          case when v.v_kind = 'like' then v.v_event end,
                          case when v.v_kind = 'like' then null else v.v_id end
                having bool_or(v.v_read is null)
              ) unread_rows) as b_count
      from recips r
  ),
  facts as materialized (
    select o.id            as j_id,
           o.kind          as j_kind,
           o.recipient_id  as j_recipient,
           o.actor_id      as j_actor,
           o.feed_event_id as j_event,
           o.comment_id    as j_comment,
           o.created_at    as j_created,
           o.attempts      as j_attempts,
           st.paused       as j_paused,
           case o.kind
             when 'follow'  then st.follows
             when 'like'    then st.likes
             when 'comment' then st.comments
             when 'post'    then st.posts
             else false
           end             as j_kind_on,
           tk.toks         as j_tokens,
           public.blocked_between(o.recipient_id, o.actor_id) as j_blocked,
           (o.kind <> 'follow'
             and coalesce(c.is_alcoholic, false)
             and not public.user_is_adult(o.recipient_id))    as j_age_gated,
           case
             when o.kind = 'post' then
               e.id is not null
               and exists (
                 select 1 from public.post_notification_subscriptions s
                  where s.subscriber_id = o.recipient_id and s.target_id = o.actor_id)
               and exists (
                 select 1 from public.follows f
                  where f.follower_id = o.recipient_id and f.followee_id = o.actor_id)
             else exists (
               select 1 from vis v
                where v.v_recipient = o.recipient_id
                  and v.v_kind = o.kind
                  and v.v_actor = o.actor_id
                  and v.v_event is not distinct from o.feed_event_id
                  and v.v_comment is not distinct from o.comment_id)
           end             as j_true,
           ap.handle       as j_handle,
           b.name          as j_bev_name,
           b.brand         as j_bev_brand,
           b.flavor        as j_bev_flavor,
           pc.body         as j_comment_body
      from picked pk
      join public.push_outbox o on o.id = pk.o_id
      cross join lateral public.notification_settings_of(o.recipient_id) st
      left join lateral (
        select array_agg(t.token order by t.last_seen_at desc, t.token) as toks
          from public.push_tokens t
         where t.user_id = o.recipient_id
      ) tk on true
      left join public.profiles ap on ap.id = o.actor_id
      left join public.feed_events e on e.id = o.feed_event_id
      left join public.bevs b on b.id = e.bev_id
      left join public.categories c on c.id = b.category_id
      left join public.post_comments pc on pc.id = o.comment_id
  ),
  judged as materialized (
    select fx.*,
           case
             when fx.j_attempts >= 5                      then 'attempts'
             when fx.j_created < now() - interval '1 day' then 'expired'
             when fx.j_paused                             then 'paused'
             when not coalesce(fx.j_kind_on, false)       then 'kind off'
             when fx.j_tokens is null                     then 'no tokens'
             when fx.j_blocked                            then 'blocked'
             when fx.j_age_gated                          then 'age gate'
             when not fx.j_true                           then 'not true'
           end as j_skip
      from facts fx
  ),
  skipped as (
    update public.push_outbox o
       set sent_at = now(),
           claimed_at = now(),
           last_error = 'skipped: ' || jd.j_skip
      from judged jd
     where o.id = jd.j_id and jd.j_skip is not null
    returning o.id
  ),
  leased as (
    update public.push_outbox o
       set claimed_at = now(),
           attempts = o.attempts + 1
      from judged jd
     where o.id = jd.j_id and jd.j_skip is null
    returning o.id as l_id
  )
  select jd.j_id, jd.j_kind, jd.j_recipient, jd.j_tokens, jd.j_actor, jd.j_handle,
         jd.j_event, jd.j_bev_name, jd.j_bev_brand, jd.j_bev_flavor,
         jd.j_comment, jd.j_comment_body,
         coalesce(bg.b_count, 0)
    from judged jd
    join leased l on l.l_id = jd.j_id
    left join badges bg on bg.b_recipient = jd.j_recipient
   order by jd.j_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6b. finish_push_batch -- the worker's way out
-- ----------------------------------------------------------------------------
-- No error: sent. An error: the error kept and the lease dropped, so the next
-- drain claims it again -- and that claim is what counts the attempt, so five
-- claims in all, however each one ended. Only unsent rows are touched, so a
-- late or repeated call cannot undo a finish. Returns how many rows it changed.

create or replace function public.finish_push_batch(p_ids bigint[], p_error text default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if p_error is null then
    update public.push_outbox o
       set sent_at = now(), last_error = null
     where o.id = any(p_ids) and o.sent_at is null;
  else
    update public.push_outbox o
       set last_error = left(p_error, 500),
           claimed_at = null
     where o.id = any(p_ids) and o.sent_at is null;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6c. Tickets, receipts and dead tokens
-- ----------------------------------------------------------------------------

-- p_tickets: [{"ticket_id": "...", "token": "ExponentPushToken[...]"}, ...].
-- A ticket seen twice keeps its first row. Returns how many were new.
create or replace function public.record_push_tickets(p_tickets jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if p_tickets is null or jsonb_typeof(p_tickets) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'tickets';
  end if;

  insert into public.push_tickets (ticket_id, token)
  select x ->> 'ticket_id', x ->> 'token'
    from jsonb_array_elements(p_tickets) x
   where jsonb_typeof(x) = 'object'
     and char_length(coalesce(x ->> 'ticket_id', '')) between 1 and 200
     and coalesce(x ->> 'token', '') <> ''
  on conflict (ticket_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Tickets old enough to have a receipt (15 minutes) and young enough for Expo
-- to still hold one (a day), unchecked, oldest first, at most 1000 (Expo's
-- getReceipts cap). Not leased: asking Expo twice for a receipt is harmless,
-- and a run that fails simply leaves them for the next.
create or replace function public.claim_push_receipts(p_limit int default 1000)
returns table (ticket_id text, token text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  return query
    select t.ticket_id, t.token
      from public.push_tickets t
     where t.checked_at is null
       and t.created_at < now() - interval '15 minutes'
       and t.created_at > now() - interval '1 day'
     order by t.created_at, t.ticket_id
     limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

create or replace function public.finish_push_receipts(p_ticket_ids text[])
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update public.push_tickets t
     set checked_at = now()
   where t.ticket_id = any(p_ticket_ids) and t.checked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Expo said DeviceNotRegistered (the app was uninstalled, or notifications were
-- turned off for it): the token is dead. Returns how many were deleted.
create or replace function public.prune_push_tokens(p_tokens text[])
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  delete from public.push_tokens t where t.token = any(p_tokens);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.claim_push_batch(int) owner to postgres;
alter function public.finish_push_batch(bigint[], text) owner to postgres;
alter function public.record_push_tickets(jsonb) owner to postgres;
alter function public.claim_push_receipts(int) owner to postgres;
alter function public.finish_push_receipts(text[]) owner to postgres;
alter function public.prune_push_tokens(text[]) owner to postgres;

revoke execute on function public.claim_push_batch(int) from public, anon, authenticated;
revoke execute on function public.finish_push_batch(bigint[], text) from public, anon, authenticated;
revoke execute on function public.record_push_tickets(jsonb) from public, anon, authenticated;
revoke execute on function public.claim_push_receipts(int) from public, anon, authenticated;
revoke execute on function public.finish_push_receipts(text[]) from public, anon, authenticated;
revoke execute on function public.prune_push_tokens(text[]) from public, anon, authenticated;

grant execute on function public.claim_push_batch(int) to service_role;
grant execute on function public.finish_push_batch(bigint[], text) to service_role;
grant execute on function public.record_push_tickets(jsonb) to service_role;
grant execute on function public.claim_push_receipts(int) to service_role;
grant execute on function public.finish_push_receipts(text[]) to service_role;
grant execute on function public.prune_push_tokens(text[]) to service_role;

comment on function public.claim_push_batch(int) is
  'T-31, service role only: leases up to p_limit (1..500) unsent pushes (FOR UPDATE SKIP LOCKED; a lease older than 5 minutes may be taken again; each lease counts an attempt), finishes the ones that must not go out as ''skipped: <reason>'' (attempts after five claims, expired, paused, kind off, no tokens, blocked, age gate, not true) and returns the rest with the recipient''s tokens and badge.';
comment on function public.finish_push_batch(bigint[], text) is
  'T-31, service role only: marks leased pushes sent (p_error null) or failed (error kept, lease dropped, claimed again by the next drain; the claim counts the attempt). Touches only unsent rows.';
comment on function public.record_push_tickets(jsonb) is
  'T-31, service role only: stores Expo push tickets [{ticket_id, token}] for the receipt check.';
comment on function public.claim_push_receipts(int) is
  'T-31, service role only: unchecked tickets between 15 minutes and a day old, oldest first, at most 1000.';
comment on function public.finish_push_receipts(text[]) is
  'T-31, service role only: marks tickets checked.';
comment on function public.prune_push_tokens(text[]) is
  'T-31, service role only: deletes tokens Expo reported as DeviceNotRegistered.';

-- ============================================================================
-- 7. The drain (pg_cron, every minute)
-- ============================================================================
-- The guarantee, as drain_bev_icon_jobs is the icon worker's: a queued push is
-- picked up within the minute whether or not the poke arrived. It pokes only
-- when there is work -- a claimable push, or a ticket due for its receipt --
-- and it does the housekeeping first, every minute, configured or not:
-- pushes queued or finished more than a week ago (sent, skipped, out of
-- attempts, or never claimed because push is not configured), and tickets
-- older than two days.

create or replace function public.drain_push_outbox()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    -- Anything queued over a week ago, sent or not (sent_at >= created_at, so
    -- this covers every finished row too): an unsent one would only be skipped
    -- as 'expired', and while push is not configured nothing is ever claimed,
    -- so without this the queue would grow with every like. At most 5000 rows
    -- a minute, by index, so the first run after a long outage is not one
    -- giant delete; the next minutes take the rest.
    delete from public.push_outbox o
     where o.id in (
       select x.id from public.push_outbox x
        where x.created_at < now() - interval '7 days'
        order by x.created_at
        limit 5000);
    delete from public.push_tickets t
     where t.ticket_id in (
       select x.ticket_id from public.push_tickets x
        where x.created_at < now() - interval '2 days'
        order by x.created_at
        limit 5000);
  exception when others then
    raise warning 'drain_push_outbox: housekeeping failed (%: %)', sqlstate, sqlerrm;
  end;

  if exists (
       -- push_outbox_pending_idx (partial on sent_at is null).
       select 1 from public.push_outbox o
        where o.sent_at is null
          and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes'))
     or exists (
       -- push_tickets_unchecked_idx (partial on checked_at is null).
       select 1 from public.push_tickets t
        where t.checked_at is null
          and t.created_at < now() - interval '15 minutes'
          and t.created_at > now() - interval '1 day')
  then
    perform public.push_poke('cron');
  end if;
end;
$$;

alter function public.drain_push_outbox() owner to postgres;
revoke execute on function public.drain_push_outbox() from public, anon, authenticated, service_role;

comment on function public.drain_push_outbox() is
  'T-31: every minute from pg_cron. Deletes pushes queued or finished more than a week ago and tickets older than two days, then pokes send-push when a push is claimable or a ticket is due for its receipt. A no-op poke without the Vault secrets.';

-- Upserts by job name (pg_cron >= 1.4, 20261011000800), so a re-run re-points
-- the job rather than adding a second.
select cron.schedule(
  'drain-push-outbox',
  '* * * * *',
  $cron$ select public.drain_push_outbox(); $cron$
);
