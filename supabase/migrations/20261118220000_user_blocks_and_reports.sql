-- IS-7 / IA-8, part 1 of 2: blocking and content reporting, the storage and
-- the write paths. Part 2 (20261118220100_block_filtering.sql) is the half
-- that makes a block actually hide things.
--
-- WHY THIS EXISTS. App Store Review Guideline 1.2 ("User-Generated Content")
-- asks an app that shows other people's content for four things: a method for
-- filtering objectionable material, a mechanism to report it, a mechanism to
-- block abusive users, and published developer contact. Bevi shows other
-- people's posts, ranking notes, comments, handles and avatars and has none of
-- the first three. `bev_reports` (20261009000700) is CATALOG moderation --
-- "this Bev is a duplicate / the photo is wrong" -- keyed on a Bev, not on a
-- person or a post, so it answers none of it. DEVELOPMENT-ARJUN-IOS.md IA-8
-- calls this the single most likely cause of a rejected submission.
--
-- WHAT THIS FILE ADDS
--
--   public.user_blocks                 table: A blocked B
--   public.content_reports             table: A reported a post / comment / profile
--   public.is_blocked(uuid)            is there a block, EITHER WAY, between
--                                      the caller and this user?
--   public.blocked_user_ids()          set form of the same question
--   public.block_user(uuid)            RPC
--   public.unblock_user(uuid)          RPC
--   public.list_blocked_users(int,int) RPC -- the "Blocked accounts" screen
--   public.report_content(...)         RPC
--   public.resolve_content_report(...) operator-only, service_role
--
-- It changes no existing function, policy or view. Everything that READS is in
-- part 2, so this migration is inert on its own: installing it alone adds two
-- empty tables and some RPCs nobody calls yet.
--
-- THE SHAPE OF A BLOCK. One row per ordered pair, `blocker_id` -> `blocked_id`.
-- The INTENT is one-directional (A decided; B is never told, and B's own block
-- list does not grow), but the EFFECT has to be mutual, or blocking an abuser
-- just makes you invisible to yourself while they keep reading you. So every
-- read predicate in part 2 asks `is_blocked()`, which looks in both
-- directions. That is why the table is a plain ordered pair rather than an
-- unordered one: the list screen must show exactly the people the caller
-- chose, and `(least, greatest)` would lose that.
--
-- THE SHAPE OF A REPORT. One row per (reporter, piece of content). The content
-- is one of three things and the column that is set says which, with a CHECK
-- keeping `content_type` honest. Typed FK columns rather than a `(type, text
-- id)` pair so the database can cascade and so an operator can join. A fourth
-- kind -- a Bev in the catalog -- already has `bev_reports` and is deliberately
-- left there.
--
-- SECURITY MODEL, as everywhere since 20261011000100: RLS on both tables, no
-- INSERT/UPDATE/DELETE policy for `authenticated` on either (writes go through
-- the security-definer RPCs below), `auth.uid()` as the only notion of "the
-- caller", a pinned search_path, nothing for `public` or `anon`. Supabase's
-- default privileges hand EXECUTE on every new function in `public` to anon,
-- authenticated and service_role, so each function below states its own
-- revoke/grant explicitly rather than trusting the default (20261019000500 and
-- 20261023000100 learned this the hard way).
--
-- THE OPERATOR PATH is the service role and only the service role:
-- `resolve_content_report` is revoked from every client role, and nothing a
-- client can call moves a report's status. An admin (`is_admin()`) may READ
-- the queue, as they may read `bev_reports`, but may not act on it from a
-- client session.

set search_path = public, extensions;

-- ============================================================================
-- 1. user_blocks
-- ============================================================================
-- The PK is (blocker_id, blocked_id), so "block twice" is a structural no-op
-- rather than something block_user has to check; the CHECK makes self-blocking
-- impossible even if a future RPC forgets. Both FKs cascade from profiles,
-- which is itself cascaded from auth.users, so delete_my_account() takes the
-- blocks a user made AND the blocks made against them with it.
--
-- The second index serves the other direction: `is_blocked()` asks both ways
-- and the PK only covers blocker-first.

create table public.user_blocks (
  blocker_id uuid        not null references public.profiles(id) on delete cascade,
  blocked_id uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- A caller reads the blocks THEY made, and nothing else. Deliberately not
-- `blocker_id = auth.uid() or blocked_id = auth.uid()`: a blocked person must
-- not be able to discover that they were blocked, which is the whole reason a
-- block is quieter than a mute. No admin read either -- a block is a private
-- decision, not moderation evidence; a report is the thing an operator reads.
-- No write policy: block_user/unblock_user below.
create policy user_blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());

comment on table public.user_blocks is
  'IS-7: blocker_id has blocked blocked_id. One-directional in intent, mutual in effect -- see public.is_blocked().';

-- ============================================================================
-- 2. content_reports
-- ============================================================================
-- `content_type` and the three target columns are kept in step by
-- content_reports_target: exactly one of feed_event_id / comment_id is set for
-- a post / comment report, and neither for a profile report.
--
-- `reported_user_id` is ALWAYS the person being complained about -- the post's
-- actor, the comment's author, or the profile itself -- so the operator queue
-- can be grouped by person without three joins, and so a report survives being
-- the only record that someone was reported for the same thing twice.
--
-- NOT NULL on reported_user_id with `on delete cascade`: if the account is
-- deleted, there is nobody left to action and the report goes with it. The
-- content FKs cascade for the same reason -- a deleted post cannot be
-- moderated. That is a deliberate trade: this table is an operator queue, not
-- a legal archive. If retention is ever needed it wants its own append-only
-- ledger, not a loosened FK here.
--
-- STATUS is the operator's, and only the service role may move it.

create table public.content_reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid   not null references public.profiles(id) on delete cascade,
  content_type     text   not null check (content_type in ('post', 'comment', 'profile')),
  feed_event_id    bigint references public.feed_events(id) on delete cascade,
  comment_id       bigint references public.post_comments(id) on delete cascade,
  reported_user_id uuid   not null references public.profiles(id) on delete cascade,
  reason           text   not null check (reason in (
                     'spam', 'harassment', 'hate', 'violence', 'sexual',
                     'self_harm', 'illegal', 'misinformation', 'other')),
  -- The reporter's own words. Capped like bev_reports.note.
  note             text   check (char_length(note) <= 500),
  status           text   not null default 'open'
                     check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolved_by      uuid   references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint content_reports_no_self check (reporter_id <> reported_user_id),
  constraint content_reports_target check (
    (content_type = 'post'    and feed_event_id is not null and comment_id is null)
    or (content_type = 'comment' and comment_id is not null and feed_event_id is null)
    or (content_type = 'profile' and feed_event_id is null and comment_id is null)
  )
);

-- The operator queue: oldest open report first is the way a queue is worked.
create index content_reports_open_idx on public.content_reports (created_at) where status = 'open';
-- "everything reported about this person", the other way an operator looks.
create index content_reports_subject_idx on public.content_reports (reported_user_id, created_at desc);

-- ONE REPORT PER (REPORTER, PIECE OF CONTENT). Three partial unique indexes
-- rather than one constraint, because the target lives in a different column
-- per kind and a plain `unique (reporter_id, feed_event_id, comment_id,
-- reported_user_id)` would treat two profile reports as distinct (NULLs never
-- collide). report_content() turns a collision into "here is the report you
-- already filed", so filing again is idempotent rather than an error.
create unique index content_reports_post_uniq
  on public.content_reports (reporter_id, feed_event_id) where feed_event_id is not null;
create unique index content_reports_comment_uniq
  on public.content_reports (reporter_id, comment_id) where comment_id is not null;
create unique index content_reports_profile_uniq
  on public.content_reports (reporter_id, reported_user_id) where content_type = 'profile';

alter table public.content_reports enable row level security;

-- Read your own reports (so the app can say "you reported this"), and an admin
-- reads the queue -- bev_reports_select's rule, word for word. No write policy
-- for authenticated: report_content() files, resolve_content_report() moves.
create policy content_reports_select on public.content_reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());

comment on table public.content_reports is
  'IS-7 (App Store Guideline 1.2): one row per (reporter, reported post/comment/profile). Status is the operator''s; only the service role may move it.';

-- ============================================================================
-- 3. is_blocked / blocked_user_ids -- the one definition of "hidden by a block"
-- ============================================================================
-- EITHER DIRECTION. `is_blocked(x)` is "the caller and x cannot see each
-- other", not "the caller blocked x". A block A made must hide A from B as
-- well as B from A; otherwise the abuser keeps the feed and the victim loses
-- it. Every predicate in part 2 is this function, so the rule has exactly one
-- definition -- the reason feed_event_visible() is a function (20261014000200).
--
-- Returns false, never null, for a null argument or a caller with no session,
-- so it is safe to drop into an AND without a coalesce.
--
-- SECURITY DEFINER because it is called from RLS policies on profiles,
-- follows, rankings, feed_events, post_comments and post_likes: reading
-- user_blocks as the caller would re-enter user_blocks_select, which only
-- shows the caller's own side, and the other direction would silently stop
-- working. Definer reads both sides and is the only way this is correct.
--
-- EXECUTE for `authenticated` is required, not optional: a function used in a
-- policy expression runs as the querying role. It discloses nothing new -- the
-- caller already knows who they blocked, and a block they are on the receiving
-- end of is indistinguishable from the other person having no content.

create or replace function public.is_blocked(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
     and auth.uid() is not null
     and exists (
       select 1 from public.user_blocks ub
        where (ub.blocker_id = auth.uid() and ub.blocked_id = p_user_id)
           or (ub.blocker_id = p_user_id and ub.blocked_id = auth.uid())
     );
$$;

alter function public.is_blocked(uuid) owner to postgres;
revoke execute on function public.is_blocked(uuid) from public, anon;
grant execute on function public.is_blocked(uuid) to authenticated;

comment on function public.is_blocked(uuid) is
  'IS-7: true when a block exists between auth.uid() and p_user_id in EITHER direction. The one definition of "hidden by a block"; used by every read path and by several RLS policies.';

-- The set form, for a filter that wants an anti-join rather than a per-row
-- probe (get_explore's candidate set). Same answer, both directions.
create or replace function public.blocked_user_ids() returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select ub.blocked_id from public.user_blocks ub where ub.blocker_id = auth.uid()
  union
  select ub.blocker_id from public.user_blocks ub where ub.blocked_id = auth.uid();
$$;

alter function public.blocked_user_ids() owner to postgres;
revoke execute on function public.blocked_user_ids() from public, anon;
grant execute on function public.blocked_user_ids() to authenticated;

comment on function public.blocked_user_ids() is
  'IS-7: every user id hidden from the caller by a block, in either direction. The set form of is_blocked().';

-- ============================================================================
-- 4. block_user
-- ============================================================================
-- Blocking also UNFOLLOWS, both ways, and repairs the two follower/following
-- counters the same way follow_user does. Two reasons: a follow edge that
-- survives a block keeps feeding `get_friends_leaderboard`, `feed_also_bevd`
-- and `get_followed_by` from the other side of a wall the user just put up;
-- and if the block is ever lifted, silently restoring a follow the user did
-- not re-grant would be worse than making them follow again.
--
-- Idempotent: blocking someone already blocked touches nothing and does not
-- raise, so a double tap on the sheet is safe.
--
-- Self-block is BEVI_VALIDATION (the caller's bug, and the CHECK would
-- otherwise surface as a raw 23514); an unknown user is BEVI_NOT_FOUND.
-- Rate-limited like follow_user: 100 a day is far past any real use and still
-- caps a runaway client.

create or replace function public.block_user(p_user_id uuid) returns void
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
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'cannot block self';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.assert_rate('block_user', 100, interval '1 day');

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_uid, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.follows
   where (follower_id = v_uid and followee_id = p_user_id)
      or (follower_id = p_user_id and followee_id = v_uid);

  -- follow_user's counter repair, for both people, since either edge may have
  -- gone. Counting rather than decrementing keeps the number right even if a
  -- previous crash left it stale.
  update public.user_stats s
     set follower_count  = (select count(*) from public.follows f where f.followee_id = s.user_id),
         following_count = (select count(*) from public.follows f where f.follower_id = s.user_id),
         updated_at      = now()
   where s.user_id in (v_uid, p_user_id);
end;
$$;

alter function public.block_user(uuid) owner to postgres;
revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

comment on function public.block_user(uuid) is
  'IS-7: the caller blocks p_user_id and both follow edges are removed. Idempotent. Self-block is BEVI_VALIDATION.';

-- ============================================================================
-- 5. unblock_user
-- ============================================================================
-- Idempotent, and it does NOT restore the follows block_user removed: see
-- above. Unblocking someone who was never blocked is a no-op rather than
-- BEVI_NOT_FOUND -- the end state the caller asked for is the state they get.

create or replace function public.unblock_user(p_user_id uuid) returns void
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

  delete from public.user_blocks
   where blocker_id = v_uid and blocked_id = p_user_id;
end;
$$;

alter function public.unblock_user(uuid) owner to postgres;
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

comment on function public.unblock_user(uuid) is
  'IS-7: the caller lifts their own block on p_user_id. Idempotent; does not restore the follows block_user removed.';

-- ============================================================================
-- 6. list_blocked_users -- the Blocked accounts screen
-- ============================================================================
-- ONE DIRECTION, on purpose: the people the caller chose to block, newest
-- first. Not the people who blocked them -- that is the one fact a block must
-- never disclose.
--
-- Reads public.profiles directly (definer), not profiles_view: part 2 teaches
-- profiles_view to hide blocked people, which would make the unblock list
-- empty. The columns are the ones every other profile-bearing RPC returns
-- (get_followed_by's set), plus `blocked_at`. `can_see_alcohol` is not among
-- them: this list shows other people, and that flag is false for anyone but
-- the caller everywhere it appears.
--
-- Paged by offset; the set is bounded by how many people one user blocks.

create or replace function public.list_blocked_users(p_limit int default 50, p_offset int default 0)
returns table (
  user_id      uuid,
  handle       text,
  display_name text,
  avatar_path  text,
  timezone     text,
  onboarded    boolean,
  created_at   timestamptz,
  blocked_at   timestamptz
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
    select p.id, p.handle, p.display_name, p.avatar_path,
           p.timezone, p.onboarded, p.created_at, ub.created_at
      from public.user_blocks ub
      join public.profiles p on p.id = ub.blocked_id
     where ub.blocker_id = v_uid
     order by ub.created_at desc, p.id asc
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

alter function public.list_blocked_users(int, int) owner to postgres;
revoke execute on function public.list_blocked_users(int, int) from public, anon;
grant execute on function public.list_blocked_users(int, int) to authenticated;

comment on function public.list_blocked_users(int, int) is
  'IS-7: the people the CALLER blocked, newest first, for the Blocked accounts screen. Never the people who blocked the caller.';

-- ============================================================================
-- 7. report_content
-- ============================================================================
-- Exactly one of p_feed_event_id / p_comment_id / p_user_id is given, and that
-- decides `content_type`. Named arguments with defaults rather than a
-- `(type text, id text)` pair, so PostgREST sends what the column needs and
-- nothing is parsed out of a string.
--
-- RETURNS the report's id -- the new one, or, when this reporter already
-- reported this exact piece of content, the one that already exists. Filing
-- twice is a no-op with the same answer, which is what makes a retried tap
-- safe and stops one person flooding the queue about one post. A SECOND
-- reason for the same content with a different note does not create a row
-- either: the queue wants one complaint per person per thing.
--
-- VISIBILITY. The caller must be able to see the thing, or have blocked the
-- person who made it. The second half matters because the sheet offers Block
-- and Report side by side (IM-13) and a user who blocks first must still be
-- able to report: after the block, feed_event_visible() correctly says no.
--
-- Reporting your own content is BEVI_VALIDATION (and the CHECK says so again).
-- Rate-limited at 30 a day: a real person reports a handful; a script does not.
--
-- A report does NOT block, hide anything, or notify anyone. Hiding is the
-- block's job and the operator's; this RPC only records the complaint.

create or replace function public.report_content(
  p_reason        text,
  p_feed_event_id bigint default null,
  p_comment_id    bigint default null,
  p_user_id       uuid   default null,
  p_note          text   default null
) returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_targets int;
  v_type    text;
  v_subject uuid;
  -- The post a comment hangs on, for the visibility check only: a comment
  -- report stores comment_id and leaves feed_event_id null (the CHECK).
  v_event   bigint;
  v_note    text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r'), '');
  v_id      bigint;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  v_targets := (case when p_feed_event_id is not null then 1 else 0 end)
             + (case when p_comment_id    is not null then 1 else 0 end)
             + (case when p_user_id       is not null then 1 else 0 end);
  if v_targets <> 1 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'target';
  end if;
  if p_reason is null or p_reason not in (
       'spam', 'harassment', 'hate', 'violence', 'sexual',
       'self_harm', 'illegal', 'misinformation', 'other') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'reason';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  if p_feed_event_id is not null then
    v_type := 'post';
    select e.actor_id into v_subject from public.feed_events e where e.id = p_feed_event_id;
    if v_subject is null then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not public.feed_event_visible(p_feed_event_id) and not public.is_blocked(v_subject) then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;

  elsif p_comment_id is not null then
    v_type := 'comment';
    select cm.user_id, cm.feed_event_id into v_subject, v_event
      from public.post_comments cm
     where cm.id = p_comment_id and cm.deleted_at is null;
    if v_subject is null then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not public.feed_event_visible(v_event) and not public.is_blocked(v_subject) then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;

  else
    v_type := 'profile';
    select pr.id into v_subject from public.profiles pr where pr.id = p_user_id;
    if v_subject is null then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if v_subject = v_uid then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'cannot report own content';
  end if;

  perform public.assert_rate('report_content', 30, interval '1 day');

  insert into public.content_reports
    (reporter_id, content_type, feed_event_id, comment_id, reported_user_id, reason, note)
  values
    (v_uid, v_type, p_feed_event_id, p_comment_id, v_subject, p_reason, v_note)
  on conflict do nothing
  returning content_reports.id into v_id;

  if v_id is null then
    -- Already reported by this caller. Hand back the existing id rather than
    -- raising: the user's intent ("I have reported this") is already true.
    select cr.id into v_id
      from public.content_reports cr
     where cr.reporter_id = v_uid
       and case v_type
             when 'post'    then cr.feed_event_id is not distinct from p_feed_event_id
             when 'comment' then cr.comment_id    is not distinct from p_comment_id
             else cr.content_type = 'profile' and cr.reported_user_id = v_subject
           end
     limit 1;
  end if;

  return v_id;
end;
$$;

alter function public.report_content(text, bigint, bigint, uuid, text) owner to postgres;
revoke execute on function public.report_content(text, bigint, bigint, uuid, text) from public, anon;
grant execute on function public.report_content(text, bigint, bigint, uuid, text) to authenticated;

comment on function public.report_content(text, bigint, bigint, uuid, text) is
  'IS-7 (App Store Guideline 1.2): file a report about exactly one of a post, a comment or a profile. Idempotent per (reporter, content) -- a repeat returns the existing report id. Does not block or hide anything.';

-- ============================================================================
-- 8. resolve_content_report -- the operator path, service_role only
-- ============================================================================
-- The only way a report's status moves. Revoked from every client role, so an
-- admin session in the app cannot action a queue it can merely read; the
-- operator works through the service key, as merge_bev (20261101000500) does.
-- `p_actor` is who to record as having decided, since service_role has no
-- auth.uid().

create or replace function public.resolve_content_report(
  p_id     bigint,
  p_status text,
  p_actor  uuid default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_status not in ('open', 'reviewing', 'actioned', 'dismissed') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'status';
  end if;

  update public.content_reports
     set status      = p_status,
         resolved_by = case when p_status in ('actioned', 'dismissed') then p_actor else null end,
         resolved_at = case when p_status in ('actioned', 'dismissed') then now() else null end
   where id = p_id;

  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

alter function public.resolve_content_report(bigint, text, uuid) owner to postgres;
revoke execute on function public.resolve_content_report(bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_content_report(bigint, text, uuid) to service_role;

comment on function public.resolve_content_report(bigint, text, uuid) is
  'IS-7: move a content report''s status. postgres/service_role only -- no client session, admin included, may call it.';
