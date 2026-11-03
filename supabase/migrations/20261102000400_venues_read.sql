-- =====================================================================
-- 20261102000400 · venues, the read path (S-10 + A-08, half 2)
-- =====================================================================
-- The three RPCs M-16 reads, on the tables 20261102000300 created. Contract
-- 2.10.0: `VenuesApi { inView, get }` plus `neighborhoods()`.
--
-- WHO MAY CALL THEM: `authenticated`, and nothing else. The three tables have
-- RLS on with no policy, so these definer functions are the ONLY way a client
-- sees a venue -- which means whatever they return is entirely their own
-- responsibility, including the age gate.
--
-- THE AGE GATE IS ON THE ASSORTMENT, not on the venue. A bar is not itself
-- age-restricted data; the Bevs it carries are. So every query below joins
-- through `venue_bevs` with the same predicate the rest of the schema uses
-- (`not c.is_alcoholic or public.viewer_is_adult()`), and a venue whose whole
-- assortment is alcoholic simply has nothing to show a minor -- which, by
-- D-13's "no assortment, no pin", means no pin. That falls out of the
-- counting rather than needing a rule of its own.
--
-- WHY `openNow` IS COMPUTED HERE and not in the app: `hours_known` promises
-- that `scripts/venues/import-core.ts`'s narrow recogniser understood the
-- string, and the board (TASKS.md A-08) suggested the `opening_hours` npm
-- parser for the evaluation. Those are two different definitions of
-- "understood", and a column that says "known" while a different parser
-- disagrees is the kind of drift nobody notices until a venue shows the wrong
-- state. So the evaluator lives next to the column, in SQL, accepting exactly
-- the subset the importer accepts -- and pgTAP pins it against the same cases
-- as the TypeScript tests. If the npm parser is ever wanted, it replaces BOTH
-- sides at once.
-- =====================================================================

set search_path = public, extensions;

-- Mo..Su -> 0..6. Separate so `venue_open_at` reads as the grammar it is.
create or replace function public.weekday_index(p_day text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_day
           when 'Mo' then 0 when 'Tu' then 1 when 'We' then 2 when 'Th' then 3
           when 'Fr' then 4 when 'Sa' then 5 when 'Su' then 6
         end;
$$;

alter function public.weekday_index(text) owner to postgres;
revoke execute on function public.weekday_index(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. venue_open_at(p_hours, p_at) -> boolean
-- ---------------------------------------------------------------------------
-- Null when we do not understand the string, which is most of them: "Hours
-- unknown" is a real answer and better than a guess (A-08: Open now is
-- best-effort).
--
-- The accepted subset is `hoursKnown`'s, exactly: one or more
-- `<days> HH:MM-HH:MM` rules joined by `;`, days being a weekday, an ASCENDING
-- weekday range, or a comma list of either; `24:00` allowed as a close only;
-- the close strictly after the open; and, across rules, DISJOINT day sets.
--
-- Each of those exclusions is a case where a naive reading would be WRONG
-- rather than unknown. In the opening_hours spec `;` means the later rule
-- OVERRIDES the earlier one, so `Mo-Su 11:00-22:00; We 11:00-15:00` is not a
-- union and OR-ing it claims open at 20:00 on a Wednesday. An overnight range
-- (`18:00-02:00`) needs wrap-around, and bars are imported. A backwards day
-- range (`Fr-Mo`) wraps the week.
--
-- New York time, because the venues are in New York by construction.
create or replace function public.venue_open_at(p_hours text, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_rule       text;
  v_days_spec  text;
  v_open       integer;
  v_close      integer;
  v_part       text;
  v_from       integer;
  v_to         integer;
  v_claimed    integer[] := '{}';
  v_rule_days  integer[];
  v_d          integer;
  v_local      timestamp;
  v_dow        integer;
  v_minute     integer;
  v_answer     boolean := false;
  v_m          text[];
begin
  if p_hours is null or btrim(p_hours) = '' then
    return null;
  end if;

  -- Monday = 0, matching DAY_INDEX in import-core.ts.
  v_local  := p_at at time zone 'America/New_York';
  v_dow    := extract(isodow from v_local)::integer - 1;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;

  foreach v_rule in array string_to_array(btrim(p_hours), ';')
  loop
    v_m := regexp_match(
      btrim(v_rule),
      '^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*) '
      || '((?:[01][0-9]|2[0-3]):[0-5][0-9])-((?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    );
    if v_m is null then
      return null;
    end if;

    v_days_spec := v_m[1];
    v_open  := split_part(v_m[2], ':', 1)::integer * 60 + split_part(v_m[2], ':', 2)::integer;
    v_close := case when v_m[3] = '24:00' then 24 * 60
                    else split_part(v_m[3], ':', 1)::integer * 60 + split_part(v_m[3], ':', 2)::integer
               end;
    -- Overnight or degenerate.
    if v_close <= v_open then
      return null;
    end if;

    v_rule_days := '{}';
    foreach v_part in array string_to_array(v_days_spec, ',')
    loop
      v_from := public.weekday_index(split_part(v_part, '-', 1));
      if position('-' in v_part) = 0 then
        v_rule_days := v_rule_days || v_from;
      else
        v_to := public.weekday_index(split_part(v_part, '-', 2));
        -- A backwards range wraps the week.
        if v_to <= v_from then
          return null;
        end if;
        for v_d in v_from..v_to loop
          v_rule_days := v_rule_days || v_d;
        end loop;
      end if;
    end loop;

    -- Disjoint day sets only: that is exactly when override and union agree.
    foreach v_d in array v_rule_days
    loop
      if v_d = any(v_claimed) then
        return null;
      end if;
      v_claimed := v_claimed || v_d;
    end loop;

    if v_dow = any(v_rule_days) and v_minute >= v_open and v_minute < v_close then
      v_answer := true;
    end if;
  end loop;

  return v_answer;
end;
$$;

alter function public.venue_open_at(text, timestamptz) owner to postgres;
revoke execute on function public.venue_open_at(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. venue_pin_cap(p_zoom) -> integer
-- ---------------------------------------------------------------------------
-- The zoom cap S-10 asks for: "60 pins at zoom 11, 300 at zoom 15". Linear
-- between those two anchors, flat outside them, so zooming out thins the map
-- instead of changing which end of it you see (the cap keeps the
-- highest-scoring venues). `minZoom` is 10 in M-16, hence the floor.
create or replace function public.venue_pin_cap(p_zoom integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select greatest(60, least(300, 60 + (coalesce(p_zoom, 11) - 11) * 60));
$$;

alter function public.venue_pin_cap(integer) owner to postgres;
revoke execute on function public.venue_pin_cap(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. venues_in_view(...) -> the pins
-- ---------------------------------------------------------------------------
-- The bounds are CLAMPED to the five-borough box rather than rejected: a map
-- gesture routinely drags the viewport past the coast, and the right answer
-- there is "the venues that are inside", not an error. `strictBounds` on the
-- client makes it rare; this makes it harmless.
--
-- The viewport test is `geo <@ box(...)`, which the GiST index on `geo`
-- serves. No PostGIS: see 20261102000300's header.
create or replace function public.venues_in_view(
  p_bounds        jsonb,
  p_zoom          integer default 12,
  p_category_ids  text[] default null,
  p_kinds         text[] default null,
  p_price_tiers   smallint[] default null,
  p_neighborhoods text[] default null,
  p_open_now      boolean default false
)
returns table (
  id            uuid,
  name          text,
  kind          text,
  lat           double precision,
  lng           double precision,
  address       text,
  neighborhood  text,
  borough       text,
  hours_osm     text,
  hours_known   boolean,
  website       text,
  best_score    numeric(4,2),
  predicted_score numeric(4,2),
  open_now      boolean,
  bev_count     integer
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_south double precision;
  v_north double precision;
  v_west  double precision;
  v_east  double precision;
  v_now   timestamptz := now();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_bounds is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'bounds';
  end if;

  -- Clamped, not rejected: the same six figures as the CHECK and shared/.
  v_south := greatest(coalesce((p_bounds ->> 'south')::double precision, 40.477), 40.477);
  v_north := least(   coalesce((p_bounds ->> 'north')::double precision, 40.918), 40.918);
  v_west  := greatest(coalesce((p_bounds ->> 'west')::double precision, -74.260), -74.260);
  v_east  := least(   coalesce((p_bounds ->> 'east')::double precision, -73.700), -73.700);

  if v_south >= v_north or v_west >= v_east then
    -- A viewport entirely outside the city is not an error, it is empty.
    return;
  end if;

  return query
  with visible as (
    -- The assortment the CALLER may see. The age gate is here, so a venue
    -- whose whole assortment is alcoholic has nothing to show a minor and
    -- therefore no pin (D-13).
    select vb.venue_id,
           b.id as bev_id,
           b.price_tier,
           b.category_id,
           s.bayes_score,
           pr.predicted_score
      from public.venue_bevs vb
      join public.bevs b on b.id = vb.bev_id and b.status = 'active'
      join public.categories c on c.id = b.category_id
      left join public.bev_stats s on s.bev_id = b.id
      left join public.user_bev_predictions pr on pr.bev_id = b.id and pr.user_id = v_uid
     where not c.is_alcoholic or public.viewer_is_adult()
  ),
  in_box as (
    select v.*
      from public.venues v
     where v.status = 'active'
       and v.geo <@ box(point(v_west, v_south), point(v_east, v_north))
       and (p_kinds is null or v.kind = any(p_kinds))
       and (p_neighborhoods is null or v.neighborhood = any(p_neighborhoods))
  ),
  agg as (
    select v.id,
           max(vis.bayes_score) as best_score,
           -- Only for the Bevs with no Bayesian score: a prediction is what
           -- fills the gap before anyone has rated it, not a second opinion.
           max(case when vis.bayes_score is null then vis.predicted_score end) as predicted_score,
           count(*)::integer as bev_count
      from in_box v
      join visible vis on vis.venue_id = v.id
     where (p_category_ids is null or vis.category_id = any(p_category_ids))
       and (p_price_tiers is null or vis.price_tier = any(p_price_tiers))
     group by v.id
  )
  select v.id, v.name, v.kind, v.lat, v.lng, v.address, v.neighborhood, v.borough,
         v.hours_osm, v.hours_known, v.website,
         a.best_score,
         round(a.predicted_score, 2)::numeric(4,2),
         case when v.hours_known then public.venue_open_at(v.hours_osm, v_now) end,
         a.bev_count
    from agg a
    join in_box v on v.id = a.id
   where not coalesce(p_open_now, false)
      or (v.hours_known and public.venue_open_at(v.hours_osm, v_now))
   -- The cap keeps the best venues, and the tail is broken deterministically
   -- so two calls on the same data agree.
   order by a.best_score desc nulls last,
            a.predicted_score desc nulls last,
            a.bev_count desc,
            v.name collate "C" asc,
            v.id asc
   limit public.venue_pin_cap(p_zoom);
end;
$$;

alter function public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean) owner to postgres;
revoke execute on function public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean) from public, anon;
grant execute on function public.venues_in_view(jsonb, integer, text[], text[], smallint[], text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. venue_detail(p_venue_id) -> the venue and its assortment
-- ---------------------------------------------------------------------------
-- A hidden venue, or one whose whole assortment the caller may not see, is
-- BEVI_NOT_FOUND rather than an empty sheet: there is no pin to have tapped,
-- so arriving here means a stale client or a guessed id, and the answer an
-- unknown id gets is the right one.
create or replace function public.venue_detail(p_venue_id uuid)
returns table (
  venue_id      uuid,
  name          text,
  kind          text,
  lat           double precision,
  lng           double precision,
  address       text,
  neighborhood  text,
  borough       text,
  hours_osm     text,
  hours_known   boolean,
  website       text,
  open_now      boolean,
  bev_id        uuid,
  bev_name      text,
  bev_brand     text,
  bev_flavor    text,
  bev_category_id text,
  bev_photo_path  text,
  bev_price_tier  smallint,
  bev_price_estimated boolean,
  bev_rating_count integer,
  bev_bayes_score  numeric(4,2)
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.venues;
  v_now timestamptz := now();
  v_n   integer;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.venues v
   where v.id = p_venue_id and v.status = 'active';

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) into v_n
    from public.venue_bevs vb
    join public.bevs b on b.id = vb.bev_id and b.status = 'active'
    join public.categories c on c.id = b.category_id
   where vb.venue_id = p_venue_id
     and (not c.is_alcoholic or public.viewer_is_adult());

  if v_n = 0 then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select v_row.id, v_row.name, v_row.kind, v_row.lat, v_row.lng, v_row.address,
         v_row.neighborhood, v_row.borough, v_row.hours_osm, v_row.hours_known, v_row.website,
         case when v_row.hours_known then public.venue_open_at(v_row.hours_osm, v_now) end,
         b.id, b.name, b.brand, b.flavor, b.category_id,
         coalesce(b.thumb_path, b.photo_path),
         b.price_tier, b.price_estimated,
         coalesce(s.rating_count, 0), s.bayes_score
    from public.venue_bevs vb
    join public.bevs b on b.id = vb.bev_id and b.status = 'active'
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where vb.venue_id = p_venue_id
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by s.bayes_score desc nulls last, b.name collate "C" asc, b.id asc;
end;
$$;

alter function public.venue_detail(uuid) owner to postgres;
revoke execute on function public.venue_detail(uuid) from public, anon;
grant execute on function public.venue_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. venue_neighborhoods() -> the filter's vocabulary
-- ---------------------------------------------------------------------------
-- Only neighbourhoods that have at least one PINNED venue, so the filter can
-- never offer an option that returns nothing.
--
-- EXPECT THIS EMPTY TODAY. OSM has no `addr:suburb` for any venue in the
-- starting area -- 0 of 410 on the first real import -- so the column is ours
-- to fill and nothing has filled it. The app is told (contract 2.10.0) to hide
-- the filter on an empty list rather than show it with no options. Filling it
-- means point-in-polygon against NYC Open Data's Neighborhood Tabulation
-- Areas, which is tracked separately; nothing here changes when it lands.
create or replace function public.venue_neighborhoods()
returns table (neighborhood text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select distinct v.neighborhood
    from public.venues v
   where v.status = 'active'
     and v.neighborhood is not null
     and exists (
       select 1
         from public.venue_bevs vb
         join public.bevs b on b.id = vb.bev_id and b.status = 'active'
         join public.categories c on c.id = b.category_id
        where vb.venue_id = v.id
          and (not c.is_alcoholic or public.viewer_is_adult())
     )
   order by v.neighborhood;
$$;

alter function public.venue_neighborhoods() owner to postgres;
revoke execute on function public.venue_neighborhoods() from public, anon;
grant execute on function public.venue_neighborhoods() to authenticated;
