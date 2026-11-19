-- =====================================================================
-- 20261119193000 · venues become the place lookup (BEV-22, part 1)
-- =====================================================================
-- Until now a venue was something the MAP showed: a shop with an assortment,
-- read through a viewport (`venues_in_view`). BEV-22 makes it also the answer
-- to "where did you have it?", which asks two things the table could not do:
--
--   1. BE SEARCHED, by name and by how near it is. `venues_search` below.
--      20261102000300's header dropped `venues_search(q, lat, lng)` with the
--      ranking step that would have called it, and left a note for the
--      author who brought distance back. This is that author, and the note's
--      advice (install PostGIS) is still not needed: see section 2.
--
--   2. HOLD A PLACE OUTSIDE NEW YORK, and one OpenStreetMap never had. A Bev
--      had in Dublin has to be taggable, so the five-borough CHECK now binds
--      the OSM import only, and a third `source`, 'google', records a place
--      found through the Places fallback (the `places` Edge Function).
--
-- EVERYTHING HERE IS ADDITIVE (supabase/CLAUDE.md, "Compatibility with
-- clients you cannot redeploy"): two CHECKs get wider, two nullable columns
-- and three functions are new, and no existing function, column or return
-- shape changes. `venues_in_view` still clamps its viewport to the city, so
-- the parked venue map answers exactly as before.
--
-- RLS is unchanged: the three venue tables keep RLS on with no policy, and
-- the functions below are the surface.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. venues: wider bounds, a third source, Google's place id
-- ---------------------------------------------------------------------------
-- The five-borough box stays the rule FOR THE IMPORT, which is what decision
-- 36 was about (the Overpass clip, and a map that could not pan past it). A
-- row from anywhere else only has to be on the planet.
alter table public.venues drop constraint venues_nyc_bounds;
alter table public.venues add constraint venues_bounds check (
  lat between -90 and 90 and lng between -180 and 180
  and (source <> 'osm' or (lat between 40.477 and 40.918 and lng between -74.260 and -73.700))
);

alter table public.venues drop constraint venues_source_check;
alter table public.venues add constraint venues_source_check
  check (source in ('osm', 'manual', 'google'));

alter table public.venues
  -- Google's place id. It is the one field of a Places result Google's terms
  -- let a client keep indefinitely; the name and the position next to it are
  -- a copy that `google_refreshed_at` dates, so a refresh job can find the
  -- rows that are due.
  add column google_place_id     text check (char_length(google_place_id) between 1 and 300),
  add column google_refreshed_at timestamptz,
  add constraint venues_google_id_matches_source
    check ((source = 'google') = (google_place_id is not null));

-- Total, for the reason `venues_osm_id_uq` is: `on conflict (google_place_id)`
-- cannot infer a partial index, and NULLs are distinct in a unique btree.
create unique index venues_google_place_id_uq on public.venues (google_place_id);

comment on column public.venues.google_place_id is
  'BEV-22: set exactly when source = ''google''. The row was created by upsert_google_venue from a Places result a user picked.';

-- ---------------------------------------------------------------------------
-- 2. private.distance_m: metres between two positions
-- ---------------------------------------------------------------------------
-- The haversine formula, on a sphere of the Earth's mean radius. Good to a
-- fraction of a percent, which is far inside what "the nearest Duane Reade"
-- needs. This is why PostGIS is still not installed: the candidates come from
-- the GiST index on `geo` that the viewport already uses (`<->`, nearest
-- first, in degrees), and the true distance is computed for those few rows.
create or replace function private.distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = public
as $$
  select 6371008.8 * 2 * asin(least(1, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2))
             * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
         )));
$$;

alter function private.distance_m(double precision, double precision, double precision, double precision) owner to postgres;
revoke execute on function private.distance_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.venue_json: one venue, as every new read returns it
-- ---------------------------------------------------------------------------
-- The keys are the columns `venues_in_view` returns for a venue, so
-- packages/api maps both with one function. `hours_known` is "the evaluator
-- understood the string", as it is there, not the column.
create or replace function private.venue_json(v public.venues)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'kind', v.kind,
    'lat', v.lat,
    'lng', v.lng,
    'address', v.address,
    'neighborhood', v.neighborhood,
    'borough', v.borough,
    'hours_osm', v.hours_osm,
    'hours_known',
      (case when v.hours_known then public.venue_open_at(v.hours_osm, now()) end) is not null,
    'website', v.website
  );
$$;

alter function private.venue_json(public.venues) owner to postgres;
revoke execute on function private.venue_json(public.venues) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. venues_search(p_query, p_lat, p_lng, p_limit) -> the picker's results
-- ---------------------------------------------------------------------------
-- Two questions in one function, because the picker asks them of one list:
--
--   * NO QUERY, a position: the places nearest the caller, so the sheet opens
--     with the shop they are standing in already on it. No position either:
--     nothing, because "every venue, in no order" is not an answer.
--
--   * A QUERY: the places whose name matches, the nearest first when there is
--     a position. Three tiers, and the tier outranks the distance, so a typo
--     never beats the real thing:
--       0  the query starts a word of the name ("duane" -> Duane Reade,
--          "cafe" -> The Café at Cornell Tech);
--       1  every word of the query is somewhere in the name, the address or
--          the neighbourhood ("starbucks main", "duane roosevelt");
--       2  the name is merely similar (pg_trgm, 0.35): "duan reed". Within
--          this tier the most similar comes first, then the nearest.
--
-- Accents are folded on both sides (`unaccent`), as `search_bevs` folds them.
--
-- EVERY ACTIVE VENUE IS SEARCHABLE, with or without an assortment. D-13's
-- rule (no assortment, no pin) was about a map of what a shop sells; a place
-- you bought a drink in needs no menu on file.
--
-- THE POSITION IS USED AND FORGOTTEN. It orders this one answer and is not
-- written anywhere: no table in this schema has a column for where a user
-- was.
create or replace function public.venues_search(
  p_query text default '',
  p_lat   double precision default null,
  p_lng   double precision default null,
  p_limit integer default 20
)
returns table (venue jsonb, distance_m integer)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_q       text;
  v_tokens  text[];
  v_has_pos boolean := p_lat is not null and p_lng is not null;
  v_limit   integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if char_length(coalesce(p_query, '')) > 80 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'query';
  end if;

  if (p_lat is null) <> (p_lng is null)
     or (v_has_pos and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'position';
  end if;

  v_q := btrim(regexp_replace(lower(unaccent(coalesce(p_query, ''))), '\s+', ' ', 'g'));

  if v_q = '' then
    if not v_has_pos then
      return;
    end if;

    return query
    select private.venue_json(v), round(n.d)::integer
      from (
        select c.id, private.distance_m(p_lat, p_lng, c.lat, c.lng) as d
          from (
            -- The index's order is in degrees, which stretches east-west at
            -- this latitude; 200 candidates is far more than the stretch can
            -- reorder out of the top `v_limit`.
            select k.id, k.lat, k.lng
              from public.venues k
             where k.status = 'active'
             order by k.geo <-> point(p_lng, p_lat)
             limit 200
          ) c
      ) n
      join public.venues v on v.id = n.id
     order by n.d asc, v.name collate "C" asc, v.id asc
     limit v_limit;
    return;
  end if;

  v_tokens := string_to_array(v_q, ' ');

  return query
  select private.venue_json(v), round(m.d)::integer
    from (
      select k.id,
             case when v_has_pos then private.distance_m(p_lat, p_lng, k.lat, k.lng) end as d,
             x.sim,
             case
               when strpos(' ' || x.n, ' ' || v_q) > 0 then 0
               when not exists (select 1 from unnest(v_tokens) t where strpos(x.hay, t) = 0) then 1
               else 2
             end as tier
        from public.venues k
       cross join lateral (
         select lower(unaccent(k.name)) as n,
                lower(unaccent(k.name || ' ' || coalesce(k.address, '') || ' ' || coalesce(k.neighborhood, ''))) as hay,
                similarity(lower(unaccent(k.name)), v_q) as sim
       ) x
       where k.status = 'active'
         and (strpos(' ' || x.n, ' ' || v_q) > 0
              or not exists (select 1 from unnest(v_tokens) t where strpos(x.hay, t) = 0)
              or x.sim >= 0.35)
    ) m
    join public.venues v on v.id = m.id
   -- A similar name is only as good as it is similar, so the third tier is
   -- ordered by that before distance; in the first two every row is a real
   -- match and the nearest wins.
   order by m.tier asc,
            (case when m.tier = 2 then m.sim end) desc nulls last,
            m.d asc nulls last,
            m.sim desc,
            v.name collate "C" asc,
            v.id asc
   limit v_limit;
end;
$$;

alter function public.venues_search(text, double precision, double precision, integer) owner to postgres;
revoke execute on function public.venues_search(text, double precision, double precision, integer) from public, anon;
grant execute on function public.venues_search(text, double precision, double precision, integer) to authenticated;

comment on function public.venues_search(text, double precision, double precision, integer) is
  'BEV-22: the place picker. No query: the venues nearest (p_lat, p_lng). A query: name matches in three tiers, nearest first within a tier. Every active venue, assortment or not. The position is not stored.';

-- ---------------------------------------------------------------------------
-- 5. upsert_google_venue(...) -> the venue a Places result becomes
-- ---------------------------------------------------------------------------
-- Called by the `places` Edge Function, as the service role, when a user
-- picks a result of the Google fallback. Three outcomes, in this order:
--
--   1. We already made a venue from this place id: refresh its copy of the
--      name and the position, and return it.
--   2. We already have this place from OpenStreetMap or by hand: a venue of
--      the same name (accents and case folded) within 75 m. Return THAT, and
--      insert nothing. The fallback is reached when the caller's search of
--      our table missed, which a different spelling of the query is enough
--      to cause, and two rows for one shop would split its Bevs in two.
--   3. Otherwise, insert it.
--
-- A new venue is a chain branch when its name is exactly a chain's, so the
-- Duane Reade someone tags in Brooklyn is known to be a Duane Reade.
--
-- A venue hidden by hand stays hidden: BEVI_NOT_FOUND, and the function never
-- flips `status` back.
create or replace function public.upsert_google_venue(
  p_place_id text,
  p_name     text,
  p_lat      double precision,
  p_lng      double precision,
  p_address  text default null,
  p_website  text default null
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
  end if;

  if v_row.id is null then
    -- 3. New to us.
    select c.id into v_chain
      from public.chains c
     where lower(unaccent(c.name)) = lower(unaccent(v_name))
     order by c.id
     limit 1;

    insert into public.venues
      (name, kind, lat, lng, address, website, source, google_place_id, google_refreshed_at, chain_id)
    values
      (v_name, case when v_chain is null then 'craft' else 'chain' end, p_lat, p_lng,
       left(p_address, 200), left(p_website, 300), 'google', p_place_id, now(), v_chain)
    returning * into v_row;
  end if;

  if v_row.status <> 'active' then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return private.venue_json(v_row);
end;
$$;

alter function public.upsert_google_venue(text, text, double precision, double precision, text, text) owner to postgres;
revoke execute on function public.upsert_google_venue(text, text, double precision, double precision, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_google_venue(text, text, double precision, double precision, text, text)
  to service_role;

comment on function public.upsert_google_venue(text, text, double precision, double precision, text, text) is
  'BEV-22: the places Edge Function''s one write. Returns the existing venue for a place id, or a same-named venue within 75 m, else inserts a source=''google'' row. service_role only.';
