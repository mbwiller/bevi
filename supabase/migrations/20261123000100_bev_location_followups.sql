-- =====================================================================
-- 20261123000100 · two follow-ups to BEV-22's places
-- =====================================================================
-- A review of 20261119193000 and 20261119193100 found two defects. Both
-- files are merged and applied, so each fix is a `create or replace` of one
-- function here, with its signature, owner, grants and settings unchanged.
--
-- 1. A MERGE KEPT THE WRONG PLACE, OR NONE. When Bev SRC is merged into Bev
--    DST and a user had ranked both, `merge_bev` (20261115214237, step 3)
--    deletes the user's SRC ranking. At commit the deferred delete trigger
--    then deleted the user's place on SRC, as it does for any removal. A user
--    who had tagged a place on SRC and none on DST lost their only tag,
--    although 20261119193100's header promises that a merge leaves the
--    survivor with a place.
--
--    `bev_locations_follow_ranking_delete` now tells that case apart. Still
--    at commit, and still FIRST: if the same (user, Bev) is ranked again (a
--    re-rank), nothing happens. Otherwise, when the deleted ranking's Bev now
--    resolves to another Bev (`resolve_bev_id`, 20261102000100), the user
--    still ranks that survivor, and has no place on it yet, the place moves
--    to the survivor. In every other case -- a plain removal, a survivor that
--    already has its own place, an account deletion -- the place is deleted
--    exactly as before. The statement that deletes it is unchanged.
--
--    The constraint trigger is not re-created: `create or replace` keeps it
--    bound, DEFERRABLE INITIALLY DEFERRED, to the new body.
--
-- 2. TWO PEOPLE ADDING THE SAME NEW GOOGLE PLACE AT ONCE. Both calls of
--    `upsert_google_venue` miss the UPDATE of a row neither can see yet, both
--    INSERT, and the second fails on `venues_google_place_id_uq` (23505): the
--    user who lost the race sees an error for a place that now exists. The
--    INSERT is now `on conflict (google_place_id) do update`, setting exactly
--    what the function's own UPDATE branch sets, so the loser refreshes and
--    returns the winner's row. The index is total, not partial
--    (20261119193000, section 1), which is what lets `on conflict` infer it.
--    The rest of the body is 20261119193000's, verbatim.
--
-- NOTHING ELSE CHANGES: no table, column, data, grant or return shape. Not
-- `merge_bev`, and not `bev_locations_follow_ranking_move`, which already
-- carries the place of a user who ranked only SRC.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. bev_locations_follow_ranking_delete: a merge moves the only place
-- ---------------------------------------------------------------------------
-- Runs at commit, after `merge_bev` has marked SRC merged into DST, so
-- `resolve_bev_id(old.bev_id)` is DST by then. The resolver is only called
-- when there is a place to move: an account deletion's cascade has already
-- removed the user's places, and finds nothing to do.
create or replace function public.bev_locations_follow_ranking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_survivor uuid;
begin
  -- A re-rank: the same (user, Bev) is ranked again by commit. Keep the place.
  if exists (
    select 1 from public.rankings r
     where r.user_id = old.user_id and r.bev_id = old.bev_id
  ) then
    return null;
  end if;

  -- A merge dropped this ranking because the user also ranks the survivor:
  -- the place goes to the survivor, unless the survivor has one of its own.
  if exists (
    select 1 from public.bev_locations l
     where l.user_id = old.user_id and l.bev_id = old.bev_id
  ) then
    v_survivor := public.resolve_bev_id(old.bev_id);

    if v_survivor <> old.bev_id
       and exists (
         select 1 from public.rankings r
          where r.user_id = old.user_id and r.bev_id = v_survivor
       )
       and not exists (
         select 1 from public.bev_locations d
          where d.user_id = old.user_id and d.bev_id = v_survivor
       ) then
      update public.bev_locations l
         set bev_id = v_survivor, updated_at = now()
       where l.user_id = old.user_id
         and l.bev_id = old.bev_id;
    end if;
  end if;

  delete from public.bev_locations l
   where l.user_id = old.user_id
     and l.bev_id = old.bev_id
     and not exists (
       select 1 from public.rankings r
        where r.user_id = old.user_id and r.bev_id = old.bev_id
     );
  return null;
end;
$$;

alter function public.bev_locations_follow_ranking_delete() owner to postgres;
revoke execute on function public.bev_locations_follow_ranking_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. upsert_google_venue: the loser of a race returns the winner's row
-- ---------------------------------------------------------------------------
-- 20261119193000's function, with one change: the INSERT of outcome 3 ends
-- in `on conflict (google_place_id) do update`. Its SET list is the UPDATE of
-- outcome 1, line for line, so a place id that arrives twice at once ends
-- where it would have if the two calls had come one after the other.
create or replace function public.upsert_google_venue(
  p_place_id text,
  p_name     text,
  p_lat      double precision,
  p_lng      double precision,
  p_address  text default null,
  p_website  text default null,
  p_place_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row   public.venues;
  v_name  text := btrim(coalesce(p_name, ''));
  v_chain text;
  -- A type this table does not know is no type: the caller is a function of
  -- ours, but Google's vocabulary is not.
  v_type  text := case when p_place_type in ('cafe', 'store', 'bar', 'liquor', 'restaurant', 'other')
                       then p_place_type end;
begin
  if coalesce(p_place_id, '') = '' or char_length(p_place_id) > 300 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'place_id';
  end if;
  if v_name = '' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'name';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'position';
  end if;

  v_name := left(v_name, 120);

  -- 1. The same Google place again.
  update public.venues v
     set name = v_name,
         lat = p_lat,
         lng = p_lng,
         address = coalesce(left(p_address, 200), v.address),
         website = coalesce(left(p_website, 300), v.website),
         place_type = coalesce(v_type, v.place_type),
         google_refreshed_at = now(),
         updated_at = now()
   where v.google_place_id = p_place_id
  returning v.* into v_row;

  if v_row.id is null then
    -- 2. A venue we already have under another source.
    select v.* into v_row
      from public.venues v
     where v.geo <@ box(point(p_lng - 0.002, p_lat - 0.002), point(p_lng + 0.002, p_lat + 0.002))
       and lower(unaccent(v.name)) = lower(unaccent(v_name))
       and private.distance_m(p_lat, p_lng, v.lat, v.lng) <= 75
     order by private.distance_m(p_lat, p_lng, v.lat, v.lng) asc, v.id asc
     limit 1;

    -- Google may say what kind of place it is where nothing has yet; it never
    -- overrules a type the import or a person gave.
    if v_row.id is not null and v_row.place_type = 'other' and v_type is not null and v_type <> 'other' then
      update public.venues v set place_type = v_type, updated_at = now()
       where v.id = v_row.id
      returning v.* into v_row;
    end if;
  end if;

  if v_row.id is null then
    -- 3. New to us.
    select c.id into v_chain
      from public.chains c
     where lower(unaccent(c.name)) = lower(unaccent(v_name))
     order by c.id
     limit 1;

    -- Another call may have inserted this place id since the UPDATE above
    -- looked, in a transaction this one could not see. The unique index makes
    -- the second INSERT wait for the first, and then this becomes outcome 1.
    insert into public.venues as v
      (name, kind, lat, lng, address, website, source, google_place_id, google_refreshed_at, chain_id, place_type)
    values
      (v_name, case when v_chain is null then 'craft' else 'chain' end, p_lat, p_lng,
       left(p_address, 200), left(p_website, 300), 'google', p_place_id, now(), v_chain, coalesce(v_type, 'other'))
    on conflict (google_place_id) do update
       set name = v_name,
           lat = p_lat,
           lng = p_lng,
           address = coalesce(left(p_address, 200), v.address),
           website = coalesce(left(p_website, 300), v.website),
           place_type = coalesce(v_type, v.place_type),
           google_refreshed_at = now(),
           updated_at = now()
    returning * into v_row;
  end if;

  if v_row.status <> 'active' then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return private.venue_json(v_row);
end;
$$;

alter function public.upsert_google_venue(text, text, double precision, double precision, text, text, text) owner to postgres;
revoke execute on function public.upsert_google_venue(text, text, double precision, double precision, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_google_venue(text, text, double precision, double precision, text, text, text)
  to service_role;

comment on function public.upsert_google_venue(text, text, double precision, double precision, text, text, text) is
  'BEV-22: the places Edge Function''s one write. Returns the existing venue for a place id, or a same-named venue within 75 m, else inserts a source=''google'' row. service_role only.';
