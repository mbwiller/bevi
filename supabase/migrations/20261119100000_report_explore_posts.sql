-- IS-7 follow-up: a post the caller was shown in Explore can be reported.
--
-- THE BUG. report_content (20261118220000, section 7) decided "may the caller
-- report this post?" with feed_event_visible(), which is the FEED's rule:
-- the caller's own posts and the posts of people they follow. Explore
-- (get_explore, newest definition in 20261118220100 section 4c) exists to
-- show the caller strangers' posts -- people two follows away, or, while the
-- instance has fewer than 20 profiles, everyone (D-01). So Report on an
-- Explore post answered BEVI_NOT_FOUND unless the caller blocked the author
-- first. App Store Review Guideline 1.2 asks that a user can report the
-- content they are shown, and Explore is the one surface that shows strangers.
--
-- WHAT "REPORTABLE" NOW MEANS. Exactly "could this caller be shown it", by
-- any read path, plus the one-directional block exception, and no wider:
--
--   a post     feed_event_visible(post)          -- feed, a profile's posts
--              OR Explore could surface it        -- section "explore" below
--              OR the caller blocked its author   -- Block then Report
--
--   a comment  live, and
--              (feed_event_visible(its post) and not is_blocked(its author))
--              OR the caller blocked its author
--
--   a profile  unchanged: any profile that exists.
--
-- Nothing else shows a feed event: get_feed, get_user_feed, get_comments,
-- like_post, comments and the feed_events_select / post_comments_select
-- policies all go through feed_event_visible(); get_explore is the only other
-- reader. There is no private-account or per-post visibility setting in this
-- schema (nothing on profiles or feed_events narrows who may read a post
-- beyond the rules above), so there is nothing else to honour.
--
-- "Explore could surface it" is get_explore's own predicate with the paging
-- removed: the same `scope` (two hops out through people the caller follows,
-- never through a blocked bridge; or everyone below 20 profiles; never the
-- caller, never someone they follow, never anyone across a block in either
-- direction), the same kinds ('ranked', 'reranked'), the same alcohol gate
-- and the same "the Bev is active" rule. The one deliberate difference is the
-- recency bound (get_explore ranks only the last 14 days behind a cut at most
-- 30 days back): every post passed it when it was new, so "could be shown"
-- includes it, and keeping it would make a report on a post the caller is
-- looking at fail because the clock moved while they typed the note.
--
-- It is written inline rather than as a helper: a helper that takes any post
-- id and answers across a block is an oracle wherever it is callable, and
-- schema private is pinned to is_blocked alone (41_blocks_and_reports).
--
-- THE TWO RULES FROM THE REVIEW OF #254, unchanged:
--   (a) if the AUTHOR blocked the caller, the content stays BEVI_NOT_FOUND:
--       the Explore branch requires `not private.is_blocked(author)` (two-way),
--       as feed_event_visible does, so success versus not-found never says
--       "you were blocked";
--   (b) the exception is one-directional: only `blocker_id = caller`.
--
-- ONE TIGHTENING, for (a). The comment branch used to check only the POST's
-- visibility. A comment by someone who blocked the caller, on a post the
-- caller can see, is hidden from the caller (post_comments_select and every
-- comment read in 20261118220100), yet report_content accepted it -- so a
-- caller holding an old comment id could learn they had been blocked from
-- success versus not-found. The comment's author is now checked too. That
-- narrows acceptance to what is actually shown; it changes no shape.
--
-- COMPATIBILITY (DEVELOPMENT-ARJUN.md §14). Same signature, same return type,
-- same error codes, same grants: `create or replace` of the body only. A
-- client on any contract version sends exactly what it sent before.

set search_path = public, extensions;

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
  v_uid       uuid := auth.uid();
  v_targets   int;
  v_type      text;
  v_subject   uuid;
  -- The post a comment hangs on, for the visibility check only: a comment
  -- report stores comment_id and leaves feed_event_id null (the CHECK).
  v_event     bigint;
  v_note      text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r'), '');
  v_id        bigint;
  -- The one-directional exception: the caller made a block against the
  -- person complained about. Never private.is_blocked(), which is two-way.
  v_i_blocked boolean;
  v_shown     boolean;
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
    v_i_blocked := exists (select 1 from public.user_blocks ub
                            where ub.blocker_id = v_uid and ub.blocked_id = v_subject);

    v_shown := public.feed_event_visible(p_feed_event_id)
      -- explore: could get_explore surface this post to the caller?
      or exists (
        select 1
          from public.feed_events e
          join public.profiles p on p.id = e.actor_id
          left join public.bevs b on b.id = e.bev_id
          left join public.categories c on c.id = b.category_id
         where e.id = p_feed_event_id
           and e.kind in ('ranked', 'reranked')
           -- get_explore's `scope`.
           and e.actor_id <> v_uid
           and not private.is_blocked(e.actor_id)
           and not exists (
             select 1 from public.follows f
              where f.follower_id = v_uid and f.followee_id = e.actor_id
           )
           and (
             -- D-01: below 20 profiles, everyone.
             (select count(*) from public.profiles) < 20
             -- Otherwise two hops: someone the caller follows -- not across a
             -- block, a blocked person is not a bridge -- follows the author.
             -- Depth 1 is excluded above (followed people are the feed), so
             -- depth 2 is all that is left of the walk.
             or exists (
               select 1
                 from public.follows f1
                 join public.follows f2 on f2.follower_id = f1.followee_id
                where f1.follower_id = v_uid
                  and not private.is_blocked(f1.followee_id)
                  and f2.followee_id = e.actor_id
             )
           )
           -- get_explore's row filters: the alcohol gate and the Bev's status.
           and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
           and (b.id is null or b.status = 'active')
      );

    if not v_i_blocked and not v_shown then
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
    v_i_blocked := exists (select 1 from public.user_blocks ub
                            where ub.blocker_id = v_uid and ub.blocked_id = v_subject);
    -- Comments are never shown in Explore (D-15), so the feed's rule is all
    -- of "shown" -- and, as post_comments_select says, not when the comment's
    -- own author is across a block.
    v_shown := public.feed_event_visible(v_event) and not private.is_blocked(v_subject);
    if not v_i_blocked and not v_shown then
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

-- `create or replace` keeps the owner, the grants and the comment; restated
-- so this file alone says what the function's privileges are.
alter function public.report_content(text, bigint, bigint, uuid, text) owner to postgres;
revoke execute on function public.report_content(text, bigint, bigint, uuid, text) from public, anon;
grant execute on function public.report_content(text, bigint, bigint, uuid, text) to authenticated;

comment on function public.report_content(text, bigint, bigint, uuid, text) is
  'IS-7 (App Store Guideline 1.2): file a report about exactly one of a post, a comment or a profile -- one the caller can be shown (feed, a profile, comments or Explore), or whose author the caller blocked. Idempotent per (reporter, content); a repeat returns the existing report id. Does not block or hide anything.';
