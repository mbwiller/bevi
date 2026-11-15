-- New-Bev barcode nutrition. Existing photo upload/create_bev callers keep their signature.
-- The snapshot is user-confirmed product data, not a verified transcription of the package.
create table public.bev_nutrition (
  bev_id uuid primary key references public.bevs(id) on delete cascade,
  nutrition jsonb not null check (jsonb_typeof(nutrition) = 'object'),
  source text not null default 'openfoodfacts' check (source = 'openfoodfacts'),
  created_at timestamptz not null default now()
);
alter table public.bev_nutrition enable row level security;
create policy bev_nutrition_select on public.bev_nutrition for select to authenticated
  using (exists (select 1 from public.bevs b where b.id = bev_id));
revoke all on public.bev_nutrition from anon, authenticated;
grant select on public.bev_nutrition to authenticated;

create function public.create_bev_with_nutrition(
  p_name text, p_brand text, p_flavor text, p_category_id text,
  p_price_tier smallint, p_price_estimated boolean,
  p_photo_asset_id text, p_label_asset_id text, p_nutrition jsonb
) returns public.bevs
language plpgsql security definer set search_path = ''
as $$
declare
  v_bev public.bevs;
  v_key text;
  v_has_value boolean := false;
  v_keys text[] := array['barcode','productName','basis','sourceUrl','calories','fatGrams',
    'carbohydrateGrams','sugarGrams','proteinGrams','sodiumMg'];
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_nutrition is null or jsonb_typeof(p_nutrition) <> 'object'
     or octet_length(p_nutrition::text) > 4096 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;
  if not (p_nutrition ?& v_keys) or p_nutrition - v_keys <> '{}'::jsonb then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;
  foreach v_key in array array['barcode','productName','basis','sourceUrl'] loop
    if jsonb_typeof(p_nutrition->v_key) <> 'string' or length(btrim(p_nutrition->>v_key)) = 0
       or length(p_nutrition->>v_key) > 256 then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
  end loop;
  if (p_nutrition->>'barcode') !~ '^(\d{8}|\d{12}|\d{13})$'
     or p_nutrition->>'sourceUrl' <> 'https://world.openfoodfacts.org/product/' || (p_nutrition->>'barcode') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;
  foreach v_key in array array['calories','fatGrams','carbohydrateGrams','sugarGrams','proteinGrams','sodiumMg'] loop
    if jsonb_typeof(p_nutrition->v_key) = 'null' then continue; end if;
    if jsonb_typeof(p_nutrition->v_key) <> 'number' then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
    if (p_nutrition->>v_key)::numeric < 0 or (p_nutrition->>v_key)::numeric > 1000000 then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
    v_has_value := true;
  end loop;
  if not v_has_value then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;
  -- No UPC shortcut: it could return someone else's Bev. The original function
  -- retains its ownership/asset validation, age gate, dedupe and creation quota.
  v_bev := public.create_bev(p_name, p_brand, p_flavor, p_category_id,
    p_price_tier, p_price_estimated, null, p_photo_asset_id, p_label_asset_id);
  insert into public.bev_nutrition(bev_id, nutrition) values (v_bev.id, p_nutrition);
  return v_bev;
end;
$$;
revoke all on function public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb) from public, anon;
grant execute on function public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb) to authenticated;
