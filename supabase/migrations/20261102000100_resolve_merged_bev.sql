-- =====================================================================
-- 20261102000100 · resolve_merged_bev
-- =====================================================================
-- Two follow-ups left by the 2026-11-01 wave, both found by review.
--
-- 1. `refresh_bev_stats` has granted EXECUTE to `authenticated` since
--    20261011000200. 20261101000300 revoked it from `public, anon` only, and
--    `has_function_privilege('authenticated', ...)` on prod still says true.
--    Nothing outside the definer RPCs calls it, so the grant is revoked here.
--
-- 2. 20261101000500 taught `get_bev` to follow `merged_into`, so a user who
--    opens an old link to a merged duplicate lands on the Bev it was merged
--    into. The write RPCs were not taught the same thing: `submit_ranking`,
--    `rerank_bev`, `add_want_to_try`, `remove_ranking` and
--    `remove_want_to_try` all look the Bev up by id and never read `status`.
--    A client holding a stale list -- a cached feed, a screen opened before
--    the merge, an app that has not refetched -- could therefore rank, want
--    or unwant the row that went away. The ranking would be real (nothing
--    stops a row in `rankings` pointing at a merged Bev) but invisible
--    everywhere a read goes through `get_bev`, and `merge_bev` has already
--    run, so nothing would ever move it across.
--
--    THE CHOICE: follow the merge, do not reject. The alternative was
--    BEVI_NOT_FOUND, which is defensible -- the id really is gone -- but it
--    throws away an action the user has already taken, for a state they
--    cannot see and did not cause. Following matches `get_bev`, and it
--    matches what `merge_bev` itself does to the rankings that already
--    existed: it moves them to `dst` rather than deleting them.
--
--    The walk lives in `resolve_bev_id` now, so there is one copy of it.
--    `get_bev` loses its inline loop and calls the function instead; its
--    behaviour is unchanged, including every error path.
--
-- WHAT DOES NOT CHANGE, deliberately:
--   * `report_bev` still accepts any status (20261101000500 section 1 is
--     explicit that whether a Bev is visible is not what a report of it
--     needs), and its `p_duplicate_of` still requires an active Bev.
--   * `get_bev_similarities` and `get_similar_bevs` still return an empty
--     list for a merged id, because `merge_bev` deletes `src`'s edges. No
--     resolution is needed there: the app reaches those RPCs with the id
--     `get_bev` gave it, which is already the surviving Bev's.
--   * The comparison ids inside `p_comparisons` are not resolved. They name
--     Bevs in the caller's own bucket, which the server listed, so they
--     cannot be merged ids; `assert_comparison_log` would reject one anyway.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. refresh_bev_stats: finish the revoke
-- ---------------------------------------------------------------------------
revoke execute on function public.refresh_bev_stats(uuid[]) from authenticated;

-- ---------------------------------------------------------------------------
-- 2. resolve_bev_id(p_bev_id): the merge walk, in one place
-- ---------------------------------------------------------------------------
-- Returns the id of the first Bev in the `merged_into` chain whose status is
-- not 'merged'. Lifted verbatim from 20261101000500's `get_bev`, including
-- its two guards: more than 8 hops is BEVI_NOT_FOUND (a cycle, or a chain
-- long enough to be a mistake), and so is a 'merged' row with a null
-- `merged_into`, which the `bevs` CHECK already makes impossible.
--
-- AN ID THAT DOES NOT EXIST COMES BACK UNCHANGED. The SELECT INTO leaves
-- `v_status` null, the loop never runs, and the caller's own lookup raises
-- its own BEVI_NOT_FOUND. That is what keeps every caller's error paths
-- exactly as they were.
--
-- `stable`: the chain can change between statements but not within one.
-- Definer, like its callers, and revoked from every client role -- only the
-- definer RPCs in this file and in 20261101000500 call it.
create or replace function public.resolve_bev_id(p_bev_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id     uuid := p_bev_id;
  v_status text;
  v_next   uuid;
  v_hops   integer := 0;
begin
  select b.status, b.merged_into into v_status, v_next
    from public.bevs b
   where b.id = v_id;

  while v_status = 'merged' loop
    v_hops := v_hops + 1;
    if v_hops > 8 or v_next is null then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_id := v_next;
    select b.status, b.merged_into into v_status, v_next
      from public.bevs b
     where b.id = v_id;
  end loop;

  return v_id;
end;
$$;

alter function public.resolve_bev_id(uuid) owner to postgres;
revoke execute on function public.resolve_bev_id(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_bev: the same function, with the loop replaced by the call
-- ---------------------------------------------------------------------------
create or replace function public.get_bev(p_bev_id uuid)
returns table (
  id                   uuid,
  name                 text,
  brand                text,
  flavor               text,
  category_id          text,
  photo_path           text,
  nutrition_label_path text,
  price_tier           smallint,
  price_estimated      boolean,
  status               text,
  is_starter           boolean,
  created_at           timestamptz,
  created_by_id        uuid,
  created_by_handle    text,
  rating_count         integer,
  avg_score            numeric(4,2),
  score_stddev         numeric(4,2),
  bayes_score          numeric(4,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  -- 20261101000500 walked `merged_into` inline here. The walk is now
  -- `resolve_bev_id`, so the write RPCs below follow a merge the same way.
  v_id  uuid := public.resolve_bev_id(p_bev_id);
begin
  select b.id, b.name, b.brand, b.flavor, b.category_id,
         b.photo_path, b.nutrition_label_path, b.price_tier, b.price_estimated,
         b.status, b.is_starter, b.created_at,
         p.id as creator_id, p.handle as creator_handle,
         c.is_alcoholic,
         coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score
    into v_row
  from public.bevs b
  join public.categories c on c.id = b.category_id
  left join public.profiles p on p.id = b.created_by
  left join public.bev_stats s on s.bev_id = b.id
  where b.id = v_id
    and (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = auth.uid()) or public.is_admin());

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  return query select
    v_row.id, v_row.name, v_row.brand, v_row.flavor, v_row.category_id,
    v_row.photo_path, v_row.nutrition_label_path, v_row.price_tier, v_row.price_estimated,
    v_row.status, v_row.is_starter, v_row.created_at,
    v_row.creator_id, v_row.creator_handle,
    v_row.rating_count, v_row.avg_score, v_row.score_stddev, v_row.bayes_score;
end;
$$;

revoke execute on function public.get_bev(uuid) from public, anon;
grant execute on function public.get_bev(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. submit_ranking: rank the Bev the duplicate was merged into
-- ---------------------------------------------------------------------------
-- 20261101000200's body, with one line added. The line sits in the same
-- place in all five RPCs -- immediately after the auth guard, so nothing an
-- anonymous caller can reach touches the chain, and so a reviewer can check
-- every one of them the same way. Reassigning the parameter is what keeps
-- the diff to one line: the resolved id then flows through everything
-- downstream on its own -- the already-ranked check, the comparison log,
-- `rankings`, `comparisons`, the `want_to_try` cleanup, `ranking_events`
-- and the feed event.
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

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'ranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_count + 1;
end;
$$;

alter function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- 5. rerank_bev: find the ranking merge_bev moved
-- ---------------------------------------------------------------------------
-- Before this, a re-rank of a merged id raised BEVI_NOT_FOUND even though
-- the user's ranking still existed: `merge_bev` had moved it to `dst`, so
-- the lookup by (user, src) found nothing. It now finds it.
create or replace function public.rerank_bev(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.rankings;
  v_new_count  integer;
  v_row        public.rankings;
  v_submission uuid := gen_random_uuid();
  v_note       text;
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

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  select count(*) into v_new_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_new_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_new_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  -- A-14 3.6: the log must agree with the index, on the list the Bev was
  -- searched in (its own row is already deleted, as the package filters it).
  perform public.assert_comparison_log(v_uid, p_bucket, p_bev_id, p_insert_index, p_comparisons);

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  v_note := coalesce(p_note, v_old.note);

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, v_note, v_old.photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, v_old.bucket);
  if p_bucket <> v_old.bucket then
    perform public.respace_bucket(v_uid, p_bucket);
  end if;

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(
      select distinct bev_id from public.rankings
      where user_id = v_uid and bucket in (v_old.bucket, p_bucket)
    )
  );

  -- rating_count is unchanged by a rerank, but mean/stddev can shift if
  -- the score did.
  perform public.refresh_user_stats(v_uid);

  -- Re-ranks count towards the streak (packages/ranking's own doc: "Re-ranks
  -- count"). A-14 3.1: the re-rank is its own event; the original submit's
  -- event (and so its day) stays, although the row above was re-inserted.
  insert into public.ranking_events (user_id, bev_id, kind)
  values (v_uid, p_bev_id, 'rerank');

  perform public.touch_streak(v_uid);

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'reranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_new_count + 1;
end;
$$;

alter function public.rerank_bev(uuid, smallint, integer, integer, jsonb, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- 6. add_want_to_try: want the surviving Bev
-- ---------------------------------------------------------------------------
-- The `on conflict (user_id, bev_id) do nothing` now collapses correctly
-- when the user already wants the Bev under its surviving id, which is what
-- `merge_bev` left them with.
create or replace function public.add_want_to_try(
  p_bev_id uuid,
  p_source_ranking_id uuid default null,
  p_via_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid          uuid := auth.uid();
  v_is_alcoholic boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- A-12 follow-up: a stale client may still hold a merged Bev's id.
  p_bev_id := public.resolve_bev_id(p_bev_id);

  select c.is_alcoholic into v_is_alcoholic
    from public.bevs b
    join public.categories c on c.id = b.category_id
   where b.id = p_bev_id;

  if v_is_alcoholic is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  insert into public.want_to_try (user_id, bev_id, source_ranking_id, source_user_id)
  values (v_uid, p_bev_id, p_source_ranking_id, p_via_user_id)
  on conflict (user_id, bev_id) do nothing;

  if found then
    update public.user_stats
       set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
           updated_at = now()
     where user_id = v_uid;
  end if;
end;
$$;

alter function public.add_want_to_try(uuid, uuid, uuid) owner to postgres;
revoke execute on function public.add_want_to_try(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_want_to_try(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. remove_ranking: remove the ranking merge_bev moved
-- ---------------------------------------------------------------------------
create or replace function public.remove_ranking(p_bev_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     public.rankings;
  v_bev_ids uuid[];
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- A-12 follow-up: a stale client may still hold a merged Bev's id.
  p_bev_id := public.resolve_bev_id(p_bev_id);

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  perform public.respace_bucket(v_uid, v_old.bucket);

  select coalesce(array_agg(bev_id), array[]::uuid[]) into v_bev_ids
  from public.rankings
  where user_id = v_uid and bucket = v_old.bucket;

  -- Refresh every Bev still in the bucket (respacing just changed their scores)
  -- plus the removed Bev itself (its stats must drop by this one rating).
  perform public.refresh_bev_stats(v_bev_ids || v_old.bev_id);

  perform public.refresh_user_stats(v_uid);
end;
$$;

alter function public.remove_ranking(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- 8. remove_want_to_try: unwant the surviving Bev
-- ---------------------------------------------------------------------------
-- The DELETE was silent on a miss, so this was the one case that failed
-- without an error: the user tapped the bookmark off and the row stayed.
create or replace function public.remove_want_to_try(p_bev_id uuid)
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

  -- A-12 follow-up: a stale client may still hold a merged Bev's id.
  p_bev_id := public.resolve_bev_id(p_bev_id);

  delete from public.want_to_try where user_id = v_uid and bev_id = p_bev_id;

  update public.user_stats
     set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
         updated_at = now()
   where user_id = v_uid;
end;
$$;

alter function public.remove_want_to_try(uuid) owner to postgres;
revoke execute on function public.remove_want_to_try(uuid) from public, anon;
grant execute on function public.remove_want_to_try(uuid) to authenticated;
