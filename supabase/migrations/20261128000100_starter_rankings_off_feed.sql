-- =====================================================================
-- 20261128000100 · starter rankings stay off the feed (DELIVERABLE-44)
-- =====================================================================
-- A new account ranks about ten "starter" Bevs on the onboarding screen
-- (app/src/features/onboarding/starter/) before it reaches the feed. Each of
-- those went through `submit_ranking`, and `submit_ranking` ends by writing a
-- `feed_events` row, so every sign-up put some ten posts of the same popular
-- Bevs in front of every follower: `get_feed`, `get_user_feed` and
-- `get_explore` all read `feed_events`.
--
-- THE RULE: `submit_ranking` writes its 'ranked' feed event only when the
-- caller's `profiles.onboarded` is true. That column (20261011000400,
-- `boolean not null default false`) is what the starter screen's
-- `updateMe({ onboarded: true })` flips at the end, so it is exactly the line
-- between "still onboarding" and "using the app". The test is made on the
-- server, in the same transaction as the ranking, so no client flag and no
-- contract change is needed and an installed build gets the new behaviour
-- without an update.
--
-- EVERYTHING ELSE `submit_ranking` DOES STILL HAPPENS for a starter ranking:
-- the `rankings` row, the re-spaced bucket, the `comparisons`,
-- `refresh_bev_stats`, the `want_to_try` cleanup, `refresh_user_stats`, the
-- `ranking_events` row and `touch_streak`. The starter rankings stay in the
-- user's own Bev'd list, stats and streak (the streak is computed from
-- `ranking_events`, 20261101000200, not from the feed); they are just never
-- posts. A profile row that does not exist reads as not onboarded, which
-- cannot happen for a real account (`handle_new_user` makes the row).
--
-- The body below is 20261102000100's, verbatim, except the last insert,
-- which is now inside `if exists (... onboarded)`. 20261102000100 is the
-- newest definition: no later migration re-creates, alters or re-grants
-- `submit_ranking`. `create or replace` keeps the signature, return type,
-- `security definer`, `set search_path = public` and the ACL; the owner and
-- the grants of 20261011000400 (revoked from public and anon, granted to
-- authenticated) are restated at the end so they read in one place.
--
-- WHAT DOES NOT CHANGE, deliberately:
--   * `submit_ranking_with_location` (20261119193100) is not re-created. It
--     calls `submit_ranking`, so it follows the new rule on its own -- which
--     is what that migration's section 5 says the next re-creation will do.
--   * `rerank_bev` still posts its 'reranked' event whatever `onboarded`
--     says. A re-rank is a deliberate act on a Bev already in the list, and
--     the starter screen never calls it, so it cannot be reached before
--     onboarding ends in the app.
--   * Feed rows already written by past sign-ups are left alone: no delete,
--     no backfill.
--   * No table, column, view, return shape or other function changes.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- submit_ranking: no feed event before onboarding ends
-- ---------------------------------------------------------------------------
create or replace function public.submit_ranking(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null,
  p_photo_path           text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_category_id  text;
  v_is_alcoholic boolean;
  v_count        integer;
  v_row          public.rankings;
  v_submission   uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- A-12 follow-up: a stale client may still hold a merged Bev's id.
  p_bev_id := public.resolve_bev_id(p_bev_id);

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));
  perform public.assert_rate('submit_ranking', 60, interval '1 hour');

  select b.category_id, c.is_alcoholic
    into v_category_id, v_is_alcoholic
  from public.bevs b
  join public.categories c on c.id = b.category_id
  where b.id = p_bev_id;

  if v_category_id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  if exists (select 1 from public.rankings where user_id = v_uid and bev_id = p_bev_id) then
    raise exception 'BEVI_ALREADY_RANKED' using errcode = '23505';
  end if;

  select count(*) into v_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  -- A-14 3.6: the log must agree with the index, on the list just counted.
  perform public.assert_comparison_log(v_uid, p_bucket, p_bev_id, p_insert_index, p_comparisons);

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, p_note, p_photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, p_bucket);

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(select bev_id from public.rankings where user_id = v_uid and bucket = p_bucket)
  );

  delete from public.want_to_try where user_id = v_uid and bev_id = p_bev_id;
  update public.user_stats
  set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
      updated_at = now()
  where user_id = v_uid;

  perform public.refresh_user_stats(v_uid);

  -- A-14 3.1: the event the streak is computed from; never deleted.
  insert into public.ranking_events (user_id, bev_id, kind)
  values (v_uid, p_bev_id, 'submit');

  perform public.touch_streak(v_uid);

  -- DELIVERABLE-44: a ranking made while the caller is still onboarding (the
  -- starter screen) is not a post. Everything above has still happened.
  if exists (select 1 from public.profiles where id = v_uid and onboarded) then
    insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
    values (v_uid, 'ranked', p_bev_id, v_row.id);
  end if;

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_count + 1;
end;
$$;

alter function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) owner to postgres;
revoke execute on function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) from public, anon;
grant execute on function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) to authenticated;
