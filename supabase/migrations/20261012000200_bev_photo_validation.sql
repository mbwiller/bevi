-- A Bev a user creates is visible to everyone as soon as its photo is real.
--
-- Before this, create_bev always inserted status 'pending_photo' (waiting for
-- a background-removal job that doesn't exist yet), so a user-created Bev was
-- invisible to everyone but its creator (bevs_select RLS, search_bevs,
-- get_bev) while still showing up in followers' feeds. It also stored
-- whatever asset ids the client sent without checking them, and never set
-- thumb_path, which the feed, featured and duplicate lists read.
--
-- Now:
--   * the photo asset must be an object the caller uploaded to `bev-photos`
--     (media.upload writes `<uid>/<random>.<ext>`, 20261011000900); likewise
--     the optional label in `nutrition-labels`. Otherwise BEVI_VALIDATION with
--     detail '<field>:unknown_asset', which packages/api maps to
--     { field, reason: 'unknown_asset' } (the app stops retrying on it).
--   * with a valid photo the Bev is inserted 'active', thumb_path = photo_path
--     (no separate thumbnail yet).
--   * a Bev with no photo stays 'pending_photo' (as before).
--   * seeded catalog Bevs (source 'seed') may be active without a photo: the
--     catalog has no images yet and the app draws placeholder art
--     (20261012000300 loads it).
--
-- Same signature as the version in 20261011000400, so `create or replace`.

set search_path = public, extensions;

-- 1. The photo rule, relaxed for seeded catalog rows. The original check is
--    unnamed (20261009000300), so find it by definition.
do $$
declare
  v_names text[];
begin
  select array_agg(conname) into v_names
    from pg_constraint
   where conrelid = 'public.bevs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%photo_path IS NOT NULL%';
  if coalesce(array_length(v_names, 1), 0) <> 1 then
    raise exception 'expected exactly one photo_path check on public.bevs, found %', coalesce(v_names, '{}');
  end if;
  execute format('alter table public.bevs drop constraint %I', v_names[1]);
end $$;

alter table public.bevs
  add constraint bevs_active_needs_photo
  check (status <> 'active' or photo_path is not null or source = 'seed');

-- 2. create_bev validates the uploaded assets and publishes the Bev.
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
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'photoAssetId:unknown_asset';
  end if;
  if p_label_asset_id is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'nutrition-labels'
       and o.name = p_label_asset_id
       and (storage.foldername(o.name))[1] = v_uid::text
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

  if p_upc is not null then
    select * into v_existing from public.bevs
     where upc = p_upc and status <> 'merged'
     limit 1;
    if found then
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
