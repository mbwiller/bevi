-- Content RPCs: dedupe-guard search, catalog search, Bev creation, reports,
-- social follow/want-to-try, and the feed/featured/leaderboard reads.
--
-- Dependencies on sibling PRs in this same migration wave (NOT defined here,
-- NOT redefined here -- this migration will not apply cleanly to a fresh
-- database until both land first):
--   * public.viewer_is_adult(), public.is_admin()   -- 20261011000100_rls_and_core_rpcs.sql
--   * public.assert_rate(p_action, p_limit, p_window) -- 20261011000100_rls_and_core_rpcs.sql
--   * public.bayes_score(sum_score, rating_count, mean, c) -- 20261011000200_ranking_rpcs.sql
--
-- CI gotcha (already hit twice): hosted Supabase puts pg_trgm/unaccent in an
-- `extensions` schema with a restricted search_path during `db push`; local
-- Docker/CI puts them in `public` with a normal search_path. Fix: this file's
-- first statement sets search_path to include both schemas, and every
-- trigram/unaccent call below is UNQUALIFIED (similarity(...), unaccent(...),
-- gin_trgm_ops, the `%` operator) so it resolves under either layout. Do not
-- schema-qualify these -- qualifying fixes exactly one environment and
-- breaks the other.
set search_path = public, extensions;

-- =====================================================================
-- 1. find_similar_bevs -- read-only dedupe guard before creating a new Bev
-- =====================================================================
create or replace function public.find_similar_bevs(
  p_name text,
  p_brand text default null,
  p_category_id text default null,
  p_limit int default 5
)
returns table (
  bev_id     uuid,
  name       text,
  brand      text,
  flavor     text,
  thumb_path text,
  similarity real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(unaccent(coalesce(p_brand, '') || ' ' || p_name)) as text)
  select b.id, b.name, b.brand, b.flavor, b.thumb_path,
         greatest(
           similarity(q.text, unaccent(b.search_text)),
           coalesce((select max(similarity(q.text, a.alias))
                       from public.bev_aliases a where a.bev_id = b.id), 0)
         )::real as sim
    from public.bevs b, q
   where b.status in ('active', 'pending_photo')
     and (p_category_id is null or b.category_id = p_category_id)
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by sim desc
   limit p_limit;
$$;

-- Note: thumb_url is intentionally left out in favor of raw `thumb_path`.
-- There is no storage-URL-building function yet; the API layer builds the
-- public URL from `thumb_path` separately.

-- =====================================================================
-- 2. search_bevs -- catalog search, same shape `bev_cards` would expose
--    once that view exists
-- =====================================================================
create or replace function public.search_bevs(
  p_query text,
  p_category_id text default null,
  p_limit int default 20
)
returns table (
  id              uuid,
  name            text,
  brand           text,
  flavor          text,
  category_id     text,
  photo_path      text,
  thumb_path      text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  avg_score       numeric(4,2)
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(unaccent(p_query)) as text)
  select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
         b.price_tier, b.price_estimated,
         coalesce(s.rating_count, 0) as rating_count,
         s.avg_score
    from public.bevs b
    cross join q
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where b.status = 'active'
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by greatest(
              similarity(q.text, unaccent(b.search_text)),
              coalesce((select max(similarity(q.text, a2.alias))
                          from public.bev_aliases a2 where a2.bev_id = b.id), 0)
            ) desc,
            coalesce(s.rating_count, 0) desc
   limit p_limit;
$$;

-- =====================================================================
-- 3. create_bev -- user-submitted catalog entry, dedupe-aware
-- =====================================================================
create or replace function public.create_bev(
  p_name             text,
  p_brand            text,
  p_flavor           text,
  p_category_id      text,
  p_price_tier       smallint,
  p_price_estimated  boolean,
  p_upc              text default null,
  p_raw_photo_path   text default null
)
returns public.bevs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid          uuid := auth.uid();
  v_is_alcoholic boolean;
  v_existing     public.bevs;
  v_row          public.bevs;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_rate('create_bev', 5, interval '1 hour');
  perform public.assert_rate('create_bev', 20, interval '1 day');

  select is_alcoholic into v_is_alcoholic from public.categories where id = p_category_id;
  if coalesce(v_is_alcoholic, false) and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  -- Idempotent by barcode: if the UPC already matches a live (non-merged)
  -- Bev, hand that one back instead of creating a duplicate.
  if p_upc is not null then
    select * into v_existing from public.bevs
     where upc = p_upc and status <> 'merged'
     limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  -- p_raw_photo_path is accepted for forward-compat with the (not yet
  -- built) photo-processing pipeline; photo_path/thumb_path stay null and
  -- status stays 'pending_photo' until that ticket lands.
  begin
    insert into public.bevs (
      name, brand, flavor, category_id, price_tier, price_estimated,
      upc, status, created_by, source
    )
    values (
      p_name, p_brand, p_flavor, p_category_id, p_price_tier, p_price_estimated,
      p_upc, 'pending_photo', v_uid, 'user'
    )
    returning * into v_row;
  exception when unique_violation then
    -- bevs_natural_uq (or, in a race, bevs_upc_uq) fired. Look the
    -- conflicting row up by either key so the caller can jump straight to
    -- ranking it instead of erroring blindly.
    select * into v_existing from public.bevs
     where status in ('pending_photo', 'active')
       and (
         (category_id = p_category_id
          and lower(coalesce(brand, '')) = lower(coalesce(p_brand, ''))
          and lower(name) = lower(p_name)
          and lower(coalesce(flavor, '')) = lower(coalesce(p_flavor, '')))
         or (p_upc is not null and upc = p_upc)
       )
     limit 1;
    raise exception 'BEVI_DUPLICATE_BEV' using errcode = '23505', detail = coalesce(v_existing.id::text, '');
  end;

  return v_row;
end;
$$;

-- =====================================================================
-- 4. report_bev -- moderation report; table's own check constraint
--    validates p_reason, we don't duplicate that logic here
-- =====================================================================
create or replace function public.report_bev(
  p_bev_id        uuid,
  p_reason        text,
  p_duplicate_of  uuid default null,
  p_note          text default null
)
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

  perform public.assert_rate('report_bev', 20, interval '1 day');

  insert into public.bev_reports (reporter_id, bev_id, reason, duplicate_of, note)
  values (v_uid, p_bev_id, p_reason, p_duplicate_of, p_note);
end;
$$;

-- =====================================================================
-- 5. Social: follow / unfollow / want-to-try
-- =====================================================================
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

  perform public.assert_rate('follow', 100, interval '1 day');

  insert into public.follows (follower_id, followee_id)
  values (v_uid, p_user_id)
  on conflict (follower_id, followee_id) do nothing;

  -- Recompute (not increment) so double-calls / races stay correct.
  update public.user_stats
     set follower_count = (select count(*) from public.follows where followee_id = p_user_id),
         updated_at = now()
   where user_id = p_user_id;
  update public.user_stats
     set following_count = (select count(*) from public.follows where follower_id = v_uid),
         updated_at = now()
   where user_id = v_uid;

  insert into public.feed_events (actor_id, kind, target_user_id) values (v_uid, 'followed', p_user_id);
end;
$$;

create or replace function public.unfollow_user(p_user_id uuid)
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

  delete from public.follows where follower_id = v_uid and followee_id = p_user_id;

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

create or replace function public.add_want_to_try(p_bev_id uuid, p_source_ranking_id uuid default null)
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

  insert into public.want_to_try (user_id, bev_id, source_ranking_id)
  values (v_uid, p_bev_id, p_source_ranking_id)
  on conflict (user_id, bev_id) do nothing;

  update public.user_stats
     set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
         updated_at = now()
   where user_id = v_uid;
end;
$$;

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

  delete from public.want_to_try where user_id = v_uid and bev_id = p_bev_id;

  update public.user_stats
     set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
         updated_at = now()
   where user_id = v_uid;
end;
$$;

-- =====================================================================
-- 6. Read RPCs: feed, featured, leaderboards
-- =====================================================================
create or replace function public.get_feed(p_limit int default 20)
returns table (
  id                  bigint,
  kind                text,
  created_at          timestamptz,
  actor_id            uuid,
  actor_handle        text,
  actor_display_name  text,
  actor_avatar_path   text,
  bev_id              uuid,
  bev_name            text,
  bev_brand           text,
  bev_flavor          text,
  bev_thumb_path      text,
  ranking_id          uuid,
  target_user_id      uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id, e.kind, e.created_at,
         e.actor_id, p.handle, p.display_name, p.avatar_path,
         e.bev_id, b.name, b.brand, b.flavor, b.thumb_path,
         e.ranking_id, e.target_user_id
    from public.feed_events e
    join public.profiles p on p.id = e.actor_id
    left join public.bevs b on b.id = e.bev_id
    left join public.categories c on c.id = b.category_id
   where (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
   order by e.id desc
   limit p_limit;
$$;

create or replace function public.get_featured()
returns table (
  id               uuid,
  title            text,
  blurb            text,
  image_path       text,
  sort_order       smallint,
  bev_id           uuid,
  bev_name         text,
  bev_brand        text,
  bev_flavor       text,
  bev_category_id  text,
  bev_thumb_path   text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select f.id, f.title, f.blurb, f.image_path, f.sort_order,
         b.id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path
    from public.featured_bevs f
    join public.bevs b on b.id = f.bev_id
    join public.categories c on c.id = b.category_id
   where now() between f.starts_at and coalesce(f.ends_at, 'infinity'::timestamptz)
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by f.sort_order, f.starts_at desc;
$$;

-- Bevs with exactly 1 rating are excluded here (they belong in a separate
-- "new" bucket, which is a nice-to-have for later -- not built in this PR).
-- `C = 3` is a literal constant matching the project's current tuning; this
-- should eventually read from a `ranking_constants` table once one exists
-- (out of scope here -- that table isn't built yet).
create or replace function public.get_bev_leaderboard(p_category_id text default null, p_limit int default 50)
returns table (
  id            uuid,
  name          text,
  brand         text,
  flavor        text,
  category_id   text,
  photo_path    text,
  thumb_path    text,
  price_tier    smallint,
  rating_count  integer,
  avg_score     numeric(4,2),
  bayes_score   numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
         b.price_tier, s.rating_count, s.avg_score,
         public.bayes_score(
           s.sum_score, s.rating_count,
           coalesce((select mean_score from public.global_stats limit 1), 0),
           3
         )::numeric
    from public.bevs b
    join public.bev_stats s on s.bev_id = b.id
    join public.categories c on c.id = b.category_id
   where b.status = 'active'
     and s.rating_count >= 2
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by public.bayes_score(
              s.sum_score, s.rating_count,
              coalesce((select mean_score from public.global_stats limit 1), 0),
              3
            )::numeric desc
   limit p_limit;
$$;

-- `profiles.bevi_rank` is populated by a rank-refresh cron that doesn't
-- exist yet; until it does, this just reads whatever's there (likely all
-- null), which is an acceptable placeholder per the task.
create or replace function public.get_user_leaderboard(p_limit int default 50)
returns table (
  user_id              uuid,
  handle               text,
  display_name         text,
  avatar_path          text,
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
  select p.id, p.handle, p.display_name, p.avatar_path, p.bevi_rank,
         us.rating_count, us.want_count, us.follower_count, us.following_count,
         st.current_days, st.longest_days
    from public.profiles p
    left join public.user_stats us on us.user_id = p.id
    left join public.streaks st on st.user_id = p.id
   order by p.bevi_rank nulls last
   limit p_limit;
$$;

-- =====================================================================
-- Grants -- authenticated only; anon gets nothing (these all read/write
-- user content or require sign-in, including the two read-only ones).
-- =====================================================================
revoke execute on function public.find_similar_bevs(text, text, text, int) from public, anon;
revoke execute on function public.search_bevs(text, text, int) from public, anon;
revoke execute on function public.create_bev(text, text, text, text, smallint, boolean, text, text) from public, anon;
revoke execute on function public.report_bev(uuid, text, uuid, text) from public, anon;
revoke execute on function public.follow_user(uuid) from public, anon;
revoke execute on function public.unfollow_user(uuid) from public, anon;
revoke execute on function public.add_want_to_try(uuid, uuid) from public, anon;
revoke execute on function public.remove_want_to_try(uuid) from public, anon;
revoke execute on function public.get_feed(int) from public, anon;
revoke execute on function public.get_featured() from public, anon;
revoke execute on function public.get_bev_leaderboard(text, int) from public, anon;
revoke execute on function public.get_user_leaderboard(int) from public, anon;

grant execute on function public.find_similar_bevs(text, text, text, int) to authenticated;
grant execute on function public.search_bevs(text, text, int) to authenticated;
grant execute on function public.create_bev(text, text, text, text, smallint, boolean, text, text) to authenticated;
grant execute on function public.report_bev(uuid, text, uuid, text) to authenticated;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.add_want_to_try(uuid, uuid) to authenticated;
grant execute on function public.remove_want_to_try(uuid) to authenticated;
grant execute on function public.get_feed(int) to authenticated;
grant execute on function public.get_featured() to authenticated;
grant execute on function public.get_bev_leaderboard(text, int) to authenticated;
grant execute on function public.get_user_leaderboard(int) to authenticated;
