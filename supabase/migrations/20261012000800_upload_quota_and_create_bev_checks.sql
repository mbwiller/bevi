-- Follow-ups from the backend review of 20261011000900 (media upload) and 20261012000200..0400.
--
-- 1. Upload quota enforced by Storage itself. media.upload calls
--    assert_upload_rate() before uploading, but that is advisory: anyone can
--    call the Storage API directly and the insert policies didn't limit
--    anything. upload_quota_ok() counts the caller's own objects in the two
--    upload buckets (20 per hour, 100 per day; the RPC's 10/hour stays the
--    friendly limit) and both insert policies now require it.
-- 2. create_bev: an uploaded asset must also be owned by the caller
--    (storage.objects.owner_id), not only sit in their folder; and the UPC
--    shortcut only returns a live Bev the caller may see (it returned
--    hidden Bevs, other users' pending ones, and alcoholic ones to under-21
--    callers). packages/api never sends a UPC today; this closes it for
--    direct RPC calls. Same signature, so `create or replace`.

set search_path = public, extensions;

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
        and o.bucket_id in ('bev-photos', 'nutrition-labels')
        and o.created_at > now() - interval '1 hour') < 20
    and
    (select count(*) from storage.objects o
      where o.owner_id = auth.uid()::text
        and o.bucket_id in ('bev-photos', 'nutrition-labels')
        and o.created_at > now() - interval '1 day') < 100;
$$;

revoke execute on function public.upload_quota_ok() from public, anon;
grant execute on function public.upload_quota_ok() to authenticated;

drop policy if exists storage_bev_photos_insert on storage.objects;
create policy storage_bev_photos_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'bev-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_quota_ok()
  );

drop policy if exists storage_nutrition_labels_insert on storage.objects;
create policy storage_nutrition_labels_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'nutrition-labels'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_quota_ok()
  );

create or replace function public.create_bev(
  p_name             text,
  p_brand            text,
  p_flavor           text,
  p_category_id      text,
  p_price_tier       smallint default null,
  p_price_estimated  boolean default true,
  p_upc              text default null,
  p_photo_asset_id   text default null,
  p_label_asset_id   text default null
)
returns public.bevs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid             uuid := auth.uid();
  v_is_alcoholic    boolean;
  v_existing        public.bevs;
  v_row             public.bevs;
  v_price_tier      smallint;
  v_price_estimated boolean;
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

  -- An asset id is the storage path media.upload returned: it must exist, in
  -- the right bucket, under the caller's own folder.
  if p_photo_asset_id is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'bev-photos'
       and o.name = p_photo_asset_id
       and (storage.foldername(o.name))[1] = v_uid::text
       and o.owner_id = v_uid::text
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'photoAssetId:unknown_asset';
  end if;
  if p_label_asset_id is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'nutrition-labels'
       and o.name = p_label_asset_id
       and (storage.foldername(o.name))[1] = v_uid::text
       and o.owner_id = v_uid::text
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'labelAssetId:unknown_asset';
  end if;

  if p_price_tier is null then
    select percentile_disc(0.5) within group (order by price_tier)
      into v_price_tier
      from public.bevs
     where category_id = p_category_id and status = 'active';
    v_price_tier := coalesce(v_price_tier, 2);
    v_price_estimated := true;
  else
    v_price_tier := p_price_tier;
    v_price_estimated := p_price_estimated;
  end if;

  -- A known barcode returns that Bev instead of a new one, but only a live
  -- one the caller may see (it returned hidden Bevs, other users' pending
  -- ones, and alcoholic ones to under-21 callers).
  if p_upc is not null then
    select * into v_existing from public.bevs
     where upc = p_upc and status = 'active'
     limit 1;
    if found then
      if (select is_alcoholic from public.categories where id = v_existing.category_id)
         and not public.viewer_is_adult() then
        raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
      end if;
      return v_existing;
    end if;
  end if;

  begin
    insert into public.bevs (
      name, brand, flavor, category_id, price_tier, price_estimated,
      upc, photo_path, thumb_path, nutrition_label_path, status, created_by, source
    )
    values (
      p_name, p_brand, p_flavor, p_category_id, v_price_tier, v_price_estimated,
      p_upc, p_photo_asset_id, p_photo_asset_id, p_label_asset_id,
      case when p_photo_asset_id is null then 'pending_photo' else 'active' end,
      v_uid, 'user'
    )
    returning * into v_row;
  exception when unique_violation then
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
