-- Small gaps found while building packages/api against the existing
-- RPCs/views, not part of the #25 review checklist itself.

-- 0. Confirmed live (local stack, this PR's CI): GoTrue does not pass
-- handle_new_user's raised message through to the client -- a bad invite
-- code surfaces as a generic "Database error saving new user", not
-- BEVI_VALIDATION, so packages/api.signUp can't tell an invite-code
-- failure from a username-taken one that way. check_invite_code lets
-- signUp check this itself, with a real PostgrestError, before ever
-- calling auth.signUp -- the trigger stays as the race backstop it already
-- documented itself as (handle_new_user's own comment: "the uniqueness
-- check should never fire in practice ... a server-side backstop against
-- a race, not the primary validation path" -- same now applies to the
-- invite-code check).
create or replace function public.check_invite_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_secrets where key = 'invite_code' and value = p_code);
$$;

revoke execute on function public.check_invite_code(text) from public, anon;
grant execute on function public.check_invite_code(text) to anon;

-- 1. rankings.updateNote has no backing RPC -- rankings has no direct
-- update policy for `authenticated` (RPC-only, per supabase/CLAUDE.md), so
-- a plain `.from('rankings').update(...)` from packages/api would be
-- blocked by RLS.
create or replace function public.update_ranking_note(p_bev_id uuid, p_note text)
returns public.rankings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.rankings;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  update public.rankings
     set note = p_note, updated_at = now()
   where user_id = v_uid and bev_id = p_bev_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.update_ranking_note(uuid, text) from public, anon;
grant execute on function public.update_ranking_note(uuid, text) to authenticated;

-- 2. get_user_leaderboard's row didn't carry enough of `profiles` to build
-- a full `Profile` for `UserLeaderboardRow.profile` (needs timezone,
-- createdAt, onboarded; canSeeAlcohol can be computed here the same way
-- profiles_view does, without exposing the row's own birth_date).
drop function if exists public.get_user_leaderboard(int);

create or replace function public.get_user_leaderboard(p_limit int default 50)
returns table (
  user_id              uuid,
  handle               text,
  display_name         text,
  avatar_path          text,
  timezone             text,
  created_at           timestamptz,
  onboarded            boolean,
  can_see_alcohol      boolean,
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
  select p.id, p.handle, p.display_name, p.avatar_path, p.timezone, p.created_at, p.onboarded,
         coalesce(p.birth_date <= (current_date - interval '21 years')::date, false),
         p.bevi_rank,
         us.rating_count, us.want_count, us.follower_count, us.following_count,
         st.current_days, st.longest_days
    from public.profiles p
    left join public.user_stats us on us.user_id = p.id
    left join public.streaks st on st.user_id = p.id
   order by p.bevi_rank nulls last
   limit p_limit;
$$;

revoke execute on function public.get_user_leaderboard(int) from public, anon;
grant execute on function public.get_user_leaderboard(int) to authenticated;

-- 3. AuthApi.deleteAccount has no backing RPC either -- DEVELOPMENT-ARJUN.md
-- §4.3 drafted `delete_my_account` but it was never actually added to a
-- migration. Deleting `auth.users` cascades through every FK below
-- `profiles` (rankings, comparisons, follows, want_to_try, user_stats,
-- streaks, feed_events, user_bev_predictions, user_actions, bev_reports);
-- `bevs.created_by` is `on delete set null`, so Bevs the user created stay
-- in the catalog, per the contract. Only storage objects need an explicit
-- delete since they aren't DB rows. `refresh_global_stats()` doesn't exist
-- yet (global_stats is unpopulated pending its cron job, milestone 1.7),
-- so it isn't called here -- only the affected Bevs' stats are refreshed.
create or replace function public.delete_my_account() returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  v_uid  uuid := auth.uid();
  v_bevs uuid[];
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct bev_id), array[]::uuid[]) into v_bevs
  from public.rankings where user_id = v_uid;

  -- storage.objects' owner column is `owner_id text` on newer Postgres/
  -- storage versions, `owner uuid` on older ones -- unverified against the
  -- actual hosted/local storage schema version; confirm once a stack exists.
  delete from storage.objects where bucket_id in ('avatars', 'raw-uploads') and owner_id = v_uid::text;

  delete from auth.users where id = v_uid;

  perform public.refresh_bev_stats(v_bevs);
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 4. bevs.get(id) needs to distinguish `not_found` from `age_restricted`,
-- which a plain RLS-filtered select from packages/api can't do -- a row
-- blocked by `bevs_select`'s age gate and a row that genuinely doesn't
-- exist both just come back as "no row", with no way to tell them apart
-- from the client. This RPC does the same status/age checks `bevs_select`
-- does, but as explicit raises.
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
  where b.id = p_bev_id
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

-- 5. get_featured's row never carried starts_at/ends_at, which
-- `FeaturedBev.startsAt`/`endsAt` need.
drop function if exists public.get_featured();

create or replace function public.get_featured()
returns table (
  id               uuid,
  title            text,
  blurb            text,
  image_path       text,
  sort_order       smallint,
  starts_at        timestamptz,
  ends_at          timestamptz,
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
  select f.id, f.title, f.blurb, f.image_path, f.sort_order, f.starts_at, f.ends_at,
         b.id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path
    from public.featured_bevs f
    join public.bevs b on b.id = f.bev_id
    join public.categories c on c.id = b.category_id
   where now() between f.starts_at and coalesce(f.ends_at, 'infinity'::timestamptz)
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by f.sort_order, f.starts_at desc;
$$;

revoke execute on function public.get_featured() from public, anon;
grant execute on function public.get_featured() to authenticated;
