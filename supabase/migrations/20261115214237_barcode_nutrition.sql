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
  using (exists (select 1 from public.bevs b where b.id = bev_nutrition.bev_id));
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
  -- `create_bev` is still called with a NULL p_upc. A non-null one makes it
  -- RETURN an existing Bev with that barcode instead of creating one
  -- (20261111000200), and this function would then attach the caller's scan to
  -- a Bev it did not create. The original function retains its
  -- ownership/asset validation, age gate, dedupe and creation quota.
  v_bev := public.create_bev(p_name, p_brand, p_flavor, p_category_id,
    p_price_tier, p_price_estimated, null, p_photo_asset_id, p_label_asset_id);
  insert into public.bev_nutrition(bev_id, nutrition) values (v_bev.id, p_nutrition);

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
  return v_bev;
end;
$$;
revoke all on function public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb) from public, anon;
grant execute on function public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb) to authenticated;


-- Preserve confirmed nutrition when a duplicate Bev is merged. The original
-- merge migration is frozen; this replacement adds the snapshot carry-over.
create or replace function public.merge_bev(p_src uuid, p_dst uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_src            public.bevs;
  v_dst            public.bevs;
  v_users          uuid[] := '{}';
  v_uid            uuid;
  v_grew           boolean;
  r                record;
  v_respaced_bevs  uuid[] := '{}';
  v_want_users     uuid[];
  v_alias          text;
  v_n              integer;
  v_moved          integer := 0;
  v_dropped        integer := 0;
  v_wants_moved    integer := 0;
  v_aliases_added  integer := 0;
  v_reports        integer := 0;
  v_edges          integer := 0;
begin
  -- 1. Validate --------------------------------------------------------------
  if p_src is null or p_dst is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'merge_bev: both p_src and p_dst are required';
  end if;
  if p_src = p_dst then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: p_src and p_dst are the same Bev (%s)', p_src);
  end if;

  perform pg_advisory_xact_lock(hashtext('merge_bev'));

  select * into v_src from public.bevs where id = p_src;
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: no Bev %s (p_src)', p_src);
  end if;
  select * into v_dst from public.bevs where id = p_dst;
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: no Bev %s (p_dst)', p_dst);
  end if;
  if v_src.status = 'merged' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is already merged into %s', p_src, v_src.merged_into);
  end if;
  if v_dst.status = 'merged' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is itself merged into %s; merge into %s instead',
                      p_dst, v_dst.merged_into, v_dst.merged_into),
      hint = format('select public.merge_bev(%L, %L);', p_src, v_dst.merged_into);
  end if;
  if v_dst.status <> 'active' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is %s, and only an active Bev can absorb another',
                      p_dst, v_dst.status);
  end if;

  -- 2. Lock every affected user's ranking path ------------------------------
  loop
    v_grew := false;
    for v_uid in
      select distinct rk.user_id
        from public.rankings rk
       where rk.bev_id in (p_src, p_dst)
         and not (rk.user_id = any (v_users))
       order by rk.user_id
    loop
      perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));
      v_users := v_users || v_uid;
      v_grew := true;
    end loop;
    exit when not v_grew;
  end loop;

  -- 3. Rankings --------------------------------------------------------------
  -- Ranked both: drop the src ranking exactly as remove_ranking does.
  for r in
    select s.id, s.user_id, s.bucket, s.position
      from public.rankings s
     where s.bev_id = p_src
       and exists (select 1 from public.rankings d
                    where d.user_id = s.user_id and d.bev_id = p_dst)
     order by s.user_id
  loop
    delete from public.rankings where id = r.id;

    update public.rankings
       set position = position - 1, updated_at = now()
     where user_id = r.user_id and bucket = r.bucket and position > r.position;

    perform public.respace_bucket(r.user_id, r.bucket);

    v_respaced_bevs := v_respaced_bevs
      || array(select rk.bev_id from public.rankings rk
                where rk.user_id = r.user_id and rk.bucket = r.bucket);
    v_dropped := v_dropped + 1;
  end loop;

  -- Ranked only src: the same row now ranks dst.
  update public.rankings
     set bev_id = p_dst, updated_at = now()
   where bev_id = p_src;
  get diagnostics v_moved = row_count;

  -- 4. Comparisons -----------------------------------------------------------
  delete from public.comparisons
   where (winner_bev_id = p_src and loser_bev_id = p_dst)
      or (winner_bev_id = p_dst and loser_bev_id = p_src);
  update public.comparisons set winner_bev_id = p_dst where winner_bev_id = p_src;
  update public.comparisons set loser_bev_id  = p_dst where loser_bev_id  = p_src;

  -- 5. Want to Try -----------------------------------------------------------
  with moved as (
    update public.want_to_try w
       set bev_id = p_dst
     where w.bev_id = p_src
       and not exists (select 1 from public.want_to_try w2
                        where w2.user_id = w.user_id and w2.bev_id = p_dst)
       and not exists (select 1 from public.rankings rk
                        where rk.user_id = w.user_id and rk.bev_id = p_dst)
    returning w.user_id
  )
  select count(*)::int into v_wants_moved from moved;

  with dropped as (
    delete from public.want_to_try where bev_id = p_src returning user_id
  )
  select coalesce(array_agg(dropped.user_id), '{}') into v_want_users from dropped;

  update public.user_stats us
     set want_count = (select count(*) from public.want_to_try w where w.user_id = us.user_id),
         updated_at = now()
   where us.user_id = any (v_want_users);

  -- 6. Feed events -----------------------------------------------------------
  update public.feed_events set bev_id = p_dst where bev_id = p_src;

  -- 7. Aliases ---------------------------------------------------------------
  update public.bev_aliases
     set bev_id = p_dst, source = 'merge'
   where bev_id = p_src;
  get diagnostics v_n = row_count;
  v_aliases_added := v_n;

  v_alias := btrim(lower(unaccent(
    coalesce(v_src.brand, '') || ' ' || v_src.name || ' ' || coalesce(v_src.flavor, '')
  )));
  if v_alias <> '' then
    insert into public.bev_aliases (alias, bev_id, source)
    values (v_alias, p_dst, 'merge')
    on conflict (alias) do nothing;
    get diagnostics v_n = row_count;
    v_aliases_added := v_aliases_added + v_n;
  end if;

  -- 8. Reports ---------------------------------------------------------------
  update public.bev_reports
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
   where status = 'open'
     and (bev_id = p_src or (bev_id = p_dst and duplicate_of = p_src));
  get diagnostics v_reports = row_count;

  update public.bev_reports
     set duplicate_of = p_dst
   where duplicate_of = p_src
     and bev_id <> p_dst;

  -- 9. Every other reference -------------------------------------------------
  if exists (select 1 from public.featured_bevs where bev_id = p_dst) then
    delete from public.featured_bevs where bev_id = p_src;
  else
    update public.featured_bevs set bev_id = p_dst where bev_id = p_src;
  end if;

  delete from public.user_bev_predictions where bev_id = p_src;

  delete from public.bev_edges where src_bev_id = p_src or dst_bev_id = p_src;
  get diagnostics v_edges = row_count;

  update public.bevs
     set merged_into = p_dst, updated_at = now()
   where merged_into = p_src;

  -- 10. The rows themselves --------------------------------------------------
  update public.bevs
     set status = 'merged', merged_into = p_dst, updated_at = now()
   where id = p_src;

  if v_dst.upc is null and v_src.upc is not null then
    update public.bevs set upc = v_src.upc, updated_at = now() where id = p_dst;
  end if;
  if v_dst.photo_path is null and v_src.photo_path is not null then
    update public.bevs
       set photo_path = v_src.photo_path, thumb_path = v_src.thumb_path, updated_at = now()
     where id = p_dst;
  end if;
  if v_dst.nutrition_label_path is null and v_src.nutrition_label_path is not null then
    update public.bevs
       set nutrition_label_path = v_src.nutrition_label_path, updated_at = now()
     where id = p_dst;
  end if;

  -- Keep the source snapshot when the destination has none. If both have one,
  -- the destination's confirmed snapshot remains authoritative.
  insert into public.bev_nutrition (bev_id, nutrition, source, created_at)
  select p_dst, n.nutrition, n.source, n.created_at
    from public.bev_nutrition n
   where n.bev_id = p_src
  on conflict (bev_id) do nothing;

  -- 11. Stats ----------------------------------------------------------------
  perform public.refresh_bev_stats(array[p_src, p_dst] || v_respaced_bevs);

  foreach v_uid in array v_users loop
    perform public.refresh_user_stats(v_uid);
  end loop;

  -- 12. Summary --------------------------------------------------------------
  return jsonb_build_object(
    'src',             p_src,
    'dst',             p_dst,
    'rankingsMoved',   v_moved,
    'rankingsDropped', v_dropped,
    'wantToTryMoved',  v_wants_moved,
    'aliasesAdded',    v_aliases_added,
    'reportsResolved', v_reports,
    'edgesDeleted',    v_edges
  );
end;
$$;

comment on function public.merge_bev(uuid, uuid) is
  'S-13/A-12: folds Bev p_src into active Bev p_dst (rankings, comparisons, Want to Try, feed, aliases, reports, featured, edges, UPC/photo/nutrition) and marks p_src merged. Never automatic: run by hand from Studio, usually by pasting pending_duplicate_reports.merge_sql. postgres/service_role only.';

-- `anon` and `authenticated` are named as well as PUBLIC because Supabase's
-- default privileges grant EXECUTE on every new function in `public` to anon,
-- authenticated and service_role directly, which a revoke from PUBLIC does
-- not touch (20261019000500 and 20261023000100 learned this). service_role
-- keeps its grant, stated explicitly so the intent is in the file.
alter function public.merge_bev(uuid, uuid) owner to postgres;
revoke execute on function public.merge_bev(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_bev(uuid, uuid) to service_role;
