-- Profile photos.
--
-- `profiles.avatar_path` and the public `avatars` bucket have existed since
-- the first schema (20261009000200, 20261009000800), and every reader already
-- returns the path (profiles_view, get_comments, get_feed / get_user_feed,
-- get_user_leaderboard), but nothing could write one: the bucket had no
-- storage policy and the contract had no way to set the column. This adds:
--
--   1. the INSERT policy and bucket limits for `avatars`, the same
--      `<uid>/<random>.<ext>` per-user-folder rule and the same
--      upload_quota_ok() term as bev-photos and nutrition-labels
--      (20261011000900, 20261012000800); upload_quota_ok() now counts
--      avatars in its 20/hour and 100/day too, so the Storage API itself
--      bounds the growth, not just packages/api's assert_upload_rate() call.
--   2. set_avatar(p_path): points the caller's avatar_path at an object they
--      uploaded to `avatars`, or clears it with null. An object that doesn't
--      exist, sits in another bucket or belongs to someone else is
--      BEVI_VALIDATION 'avatarAssetId:unknown_asset' (the create_bev rule,
--      20261012000200), which packages/api maps to
--      { field: 'avatarAssetId', reason: 'unknown_asset' }.
--      profile.updateMe({ avatarAssetId }) calls it.
--   3. avatar_path pinned in protect_profile_columns like birth_date, so the
--      own-row update policy can't point a profile at another user's photo;
--      only set_avatar() (via the bypass flag) changes it.
--
-- Old objects are not deleted when a photo is replaced or removed (there is
-- no storage worker; the quota bounds the growth), so a replaced or removed
-- photo stays reachable by its URL in the public bucket until a cleanup job
-- deletes `avatars` objects no profile references.

set search_path = public, extensions;

-- =====================================================================
-- 1. Storage: quota, INSERT policy and bucket limits for `avatars`
-- =====================================================================

-- Same body as 20261012000800 with `avatars` in both bucket lists.
create or replace function public.upload_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    (select count(*) from storage.objects o
      where o.owner_id = auth.uid()::text
        and o.bucket_id in ('bev-photos', 'nutrition-labels', 'avatars')
        and o.created_at > now() - interval '1 hour') < 20
    and
    (select count(*) from storage.objects o
      where o.owner_id = auth.uid()::text
        and o.bucket_id in ('bev-photos', 'nutrition-labels', 'avatars')
        and o.created_at > now() - interval '1 day') < 100;
$$;

create policy storage_avatars_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_quota_ok()
  );

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'avatars';

-- =====================================================================
-- 2. set_avatar(p_path): set or clear the caller's profile photo
-- =====================================================================

create or replace function public.set_avatar(p_path text)
returns public.profiles
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- The asset id is the storage path media.upload returned: it must exist,
  -- in the avatars bucket, under the caller's own folder and uploaded by
  -- them (the create_bev rule, 20261012000800).
  if p_path is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'avatars'
       and o.name = p_path
       and (storage.foldername(o.name))[1] = v_uid::text
       and o.owner_id = v_uid::text
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'avatarAssetId:unknown_asset';
  end if;

  perform set_config('bevi.rpc_bypass', 'true', true);
  update public.profiles
     set avatar_path = p_path, updated_at = now()
   where id = v_uid
  returning * into v_row;
  -- The flag is transaction-local, and a later statement in the same
  -- transaction (pgTAP, or a function calling this one) must not inherit it.
  perform set_config('bevi.rpc_bypass', 'false', true);
  return v_row;
end $$;

revoke execute on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;

-- =====================================================================
-- 3. Pin avatar_path: only set_avatar() changes it
--
-- Same body as 20261011000400 plus the avatar_path rule. A direct update
-- keeps the old value silently (like bevi_rank and birth_date) rather than
-- raising, so a client patching display_name and avatar_path together
-- still saves the name.
-- =====================================================================

create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
declare
  v_bypass boolean := coalesce(current_setting('bevi.rpc_bypass', true), 'false') = 'true';
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if new.bevi_rank is distinct from old.bevi_rank then
    new.bevi_rank := old.bevi_rank;
  end if;
  if new.handle is distinct from old.handle and not v_bypass then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'handle changes only via set_handle()';
  end if;
  if new.birth_date is distinct from old.birth_date and not v_bypass then
    new.birth_date := old.birth_date;
  end if;
  if new.avatar_path is distinct from old.avatar_path and not v_bypass then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end $$;
