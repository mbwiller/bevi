-- Nutrition read from a photo of the label, for the products a barcode lookup
-- cannot answer (contract 3.1.0: NutritionPreview.source, and a nullable
-- `barcode`/`sourceUrl`). The reading itself happens ON THE DEVICE, in the
-- app, using the platform's own text recogniser: there is no service to call,
-- no credential, and nothing for this migration to authorise or meter. Two
-- things:
--
--   1. bev_nutrition.source accepts 'label-ocr' as well as 'openfoodfacts'.
--      Widening a check constraint is safe in one release
--      (DEVELOPMENT-ARJUN.md section 14's table), so no v2 table and no
--      ledger row for this part.
--   2. create_bev_with_nutrition_v2(): create_bev_with_nutrition plus the
--      `source` key and the label-ocr branch of the validation. v1 keeps
--      answering old clients untouched (section 14, "RPC versioning"); its
--      migration (20261115214237) is frozen.

-- =====================================================================
-- 1. The widened source constraint
--
-- The column was created inline as `check (source = 'openfoodfacts')`
-- (20261115214237), which Postgres named bev_nutrition_source_check. An
-- old client reading the column parses a string, not an enum, and nothing
-- in `packages/api` relies on the set being a single value, so widening
-- needs no gate.
-- =====================================================================

alter table public.bev_nutrition
  drop constraint bev_nutrition_source_check,
  add constraint bev_nutrition_source_check
    check (source in ('openfoodfacts', 'label-ocr'));

-- =====================================================================
-- 2. create_bev_with_nutrition_v2(): the same call, with a source
--
-- Identical parameter list, security and grants to v1. What changed:
--
--   * `source` joins the accepted keys and is optional -- a client built
--     against 2.14/2.15 sends a snapshot without it, and that snapshot is
--     an Open Food Facts one, so absent resolves to 'openfoodfacts'. Any
--     third value is a validation failure. It is stored in
--     bev_nutrition.source as well as left inside the jsonb, which is what
--     merge_bev already carries over.
--   * The validation branches on the resolved source:
--       - 'openfoodfacts': exactly v1 -- an 8/12/13-digit barcode, a
--         sourceUrl that is the Open Food Facts product URL for that
--         barcode, and the barcode persisted to bevs.upc with v1's
--         duplicate handling.
--       - 'label-ocr': `barcode` and `sourceUrl` must both be JSON null
--         (there is no code and no third-party page behind the reading),
--         p_label_asset_id must be present so the photo the numbers came
--         from stays attached to the Bev, and **bevs.upc is never
--         touched**. A label read is a transcription of a panel, not an
--         identification of a product: letting it claim a UPC would both
--         invent product identity and drag the reading into the barcode
--         dedupe path.
--   * Everything else v1 enforces is unchanged: the 4096-byte cap, the
--     required keys with no extras, non-empty strings of at most 256
--     characters, numeric fields null or a number in [0, 1000000], and at
--     least one of the six present.
-- =====================================================================

create or replace function public.create_bev_with_nutrition_v2(
  p_name text, p_brand text, p_flavor text, p_category_id text,
  p_price_tier smallint, p_price_estimated boolean,
  p_photo_asset_id text, p_label_asset_id text, p_nutrition jsonb
) returns public.bevs
language plpgsql security definer set search_path = ''
as $$
declare
  v_bev public.bevs;
  v_key text;
  v_source text;
  v_barcode text;
  v_existing_id uuid;
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
  -- `source` is optional, so it is excluded from the required set and
  -- allowed in the extra-key check.
  if not (p_nutrition ?& v_keys) or p_nutrition - (v_keys || array['source']) <> '{}'::jsonb then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;
  if p_nutrition ? 'source' then
    if jsonb_typeof(p_nutrition->'source') <> 'string' then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
    v_source := p_nutrition->>'source';
  else
    v_source := 'openfoodfacts';
  end if;
  if v_source not in ('openfoodfacts', 'label-ocr') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
  end if;

  foreach v_key in array array['productName','basis'] loop
    if jsonb_typeof(p_nutrition->v_key) <> 'string' or length(btrim(p_nutrition->>v_key)) = 0
       or length(p_nutrition->>v_key) > 256 then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
  end loop;

  if v_source = 'openfoodfacts' then
    foreach v_key in array array['barcode','sourceUrl'] loop
      if jsonb_typeof(p_nutrition->v_key) <> 'string' or length(btrim(p_nutrition->>v_key)) = 0
         or length(p_nutrition->>v_key) > 256 then
        raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
      end if;
    end loop;
    if (p_nutrition->>'barcode') !~ '^(\d{8}|\d{12}|\d{13})$'
       or p_nutrition->>'sourceUrl' <> 'https://world.openfoodfacts.org/product/' || (p_nutrition->>'barcode') then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
  else
    if jsonb_typeof(p_nutrition->'barcode') <> 'null'
       or jsonb_typeof(p_nutrition->'sourceUrl') <> 'null' then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'nutrition';
    end if;
    -- The photo the reading came from has to stay attached to the Bev: it is
    -- the only evidence behind numbers no third party confirmed.
    if p_label_asset_id is null then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'labelAssetId';
    end if;
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
  -- `create_bev` is still called with a NULL p_upc. A non-null one makes it
  -- RETURN an existing Bev with that barcode instead of creating one
  -- (20261111000200), and this function would then attach the caller's scan to
  -- a Bev it did not create. The original function retains its
  -- ownership/asset validation, age gate, dedupe and creation quota.
  v_bev := public.create_bev(p_name, p_brand, p_flavor, p_category_id,
    p_price_tier, p_price_estimated, null, p_photo_asset_id, p_label_asset_id);
  insert into public.bev_nutrition(bev_id, nutrition, source) values (v_bev.id, p_nutrition, v_source);

  if v_source = 'openfoodfacts' then
    -- Barcode dedupe is the point of scanning, so the scanned code is persisted
    -- on the Bev rather than left only inside the snapshot. `bevs_upc_uq`
    -- (20261009000300) is unique on (upc) where upc is not null and status <>
    -- 'merged', so a barcode already held by a live Bev is a duplicate: report it
    -- the way `create_bev` reports a name/brand/flavor collision, with the
    -- existing Bev's id as the detail. Raising here rolls the whole call back,
    -- leaving no Bev and no snapshot behind.
    -- `updated_at` is touched but no embedding is queued: bevs_embed_after_update
    -- (20261023000100) fires only on name, brand, flavor or category_id.
    v_barcode := p_nutrition->>'barcode';
    begin
      update public.bevs set upc = v_barcode, updated_at = now()
       where id = v_bev.id
       returning * into v_bev;
    exception when unique_violation then
      select b.id into v_existing_id
        from public.bevs b
       where b.upc = v_barcode and b.status <> 'merged' and b.id <> v_bev.id
       limit 1;
      raise exception 'BEVI_DUPLICATE_BEV' using errcode = '23505',
        detail = coalesce(v_existing_id::text, '');
    end;
  end if;
  return v_bev;
end;
$$;

revoke execute on function public.create_bev_with_nutrition_v2(text,text,text,text,smallint,boolean,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_bev_with_nutrition_v2(text,text,text,text,smallint,boolean,text,text,jsonb) to authenticated;
