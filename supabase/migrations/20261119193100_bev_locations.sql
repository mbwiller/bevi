-- =====================================================================
-- 20261119193100 · where a Bev was had (BEV-22, part 2)
-- =====================================================================
-- A ranking gains a place: the venue the drink was bought in. This is the
-- `rankings.venue_id` that 2026-10-19 removed, back in a different shape.
--
-- WHY A TABLE AND NOT A COLUMN ON `rankings`.
--
--   1. A RE-RANK REPLACES THE ROW. `rerank_bev` deletes the ranking and
--      inserts a new one, carrying `note` and `photo_path` across by hand. A
--      column would need that function re-created to carry a third thing, and
--      would be lost by any later writer that forgot. Keyed by (user, Bev),
--      the place simply outlives the row it describes, and a re-rank does not
--      have to know it exists.
--
--   2. ONE PLACE TODAY, SEVERAL LATER. "Every place you have had a Coke" is a
--      list per (user, Bev). `bev_locations_one_per_bev` below is what makes
--      it one for now, and dropping that index is the whole schema change the
--      list needs.
--
-- WHO MAY SEE A PLACE: whoever may see the ranking. `rankings_select`
-- (20261118220100) lets any signed-in user read a ranking unless a block
-- stands between them or the Bev is alcoholic and the viewer is under 21, and
-- a post in Explore is shown to people who do not follow its author. The
-- place follows the post, so the reads below apply those same two rules and
-- no others. The MAP is narrower by choice, not by privacy: it draws the
-- caller and the people the caller follows.
--
-- NO CLIENT POLICY, as on the three venue tables: RLS is on with no policy and
-- every read and write goes through a definer function below. A direct
-- `select` policy would have to restate the block and the age gate, and
-- `venues` (which a place is a pointer into) has no client read at all.
--
-- ADDITIVE: one table, its two triggers, a view and eight RPCs, all new. `submit_ranking` and
-- `rerank_bev` are CALLED by two wrappers rather than re-created, so a shipped
-- client that knows nothing of places calls exactly the functions it always
-- did.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. bev_locations
-- ---------------------------------------------------------------------------
create table public.bev_locations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  bev_id     uuid not null references public.bevs(id) on delete cascade,
  -- Venues are hidden, not deleted (`status`), so this cascade is for the
  -- day a row is removed by hand: the tag goes with the place.
  venue_id   uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One place per (user, Bev) for now. See the header: drop this, and only
-- this, to let a Bev collect several.
create unique index bev_locations_one_per_bev on public.bev_locations (user_id, bev_id);
create index bev_locations_venue_idx on public.bev_locations (venue_id);
create index bev_locations_bev_idx on public.bev_locations (bev_id);

comment on table public.bev_locations is
  'BEV-22: the venue a user had a Bev at. Keyed by (user, Bev) rather than by ranking id, because rerank_bev replaces the ranking row. One per (user, Bev) by bev_locations_one_per_bev. RLS on with no policy: read and written through definer RPCs.';

alter table public.bev_locations enable row level security;

-- Supabase's default privileges grant every verb on a new table to the client
-- roles, and TRUNCATE is not subject to RLS (20261119152455, section 2;
-- 42_table_privileges.test.sql fails a table that skips this).
revoke all on table public.bev_locations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Keeping a place in step with its ranking
-- ---------------------------------------------------------------------------
-- A place with no ranking behind it is a pin for a Bev its owner no longer
-- lists, so it has to go when the ranking goes. There is no foreign key to do
-- that (the key is (user, Bev), by design), so two triggers on `rankings` do:
--
--   * AFTER DELETE, DEFERRED TO COMMIT. `rerank_bev` deletes the row and
--     inserts its replacement in one transaction; checked at the delete, the
--     place would be removed in the middle of every re-rank. Checked at
--     commit, a re-rank finds the new row and leaves the place alone, and
--     `remove_ranking`, a merge that drops a duplicate ranking, and an account
--     deletion all find nothing and remove it.
--
--   * AFTER UPDATE OF bev_id: `merge_bev` re-points a ranking of the merged
--     Bev at the survivor (20261101000500, step 3), and the place moves with
--     it. A user who had ranked both keeps the survivor's place, as they keep
--     the survivor's ranking.
--
-- Both are `security definer`: an account deletion reaches `rankings` through
-- a cascade run by a role with no privilege on this table.
create or replace function public.bev_locations_follow_ranking_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create or replace function public.bev_locations_follow_ranking_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bev_locations l
     set bev_id = new.bev_id, updated_at = now()
   where l.user_id = new.user_id
     and l.bev_id = old.bev_id
     and not exists (
       select 1 from public.bev_locations d
        where d.user_id = new.user_id and d.bev_id = new.bev_id
     );

  -- What the update above declined to move: the survivor already had a place.
  delete from public.bev_locations l
   where l.user_id = new.user_id and l.bev_id = old.bev_id;
  return null;
end;
$$;

alter function public.bev_locations_follow_ranking_delete() owner to postgres;
alter function public.bev_locations_follow_ranking_move() owner to postgres;
revoke execute on function public.bev_locations_follow_ranking_delete() from public, anon, authenticated;
revoke execute on function public.bev_locations_follow_ranking_move() from public, anon, authenticated;

create constraint trigger bev_locations_follow_ranking_delete
  after delete on public.rankings
  deferrable initially deferred
  for each row execute function public.bev_locations_follow_ranking_delete();

create trigger bev_locations_follow_ranking_move
  after update of bev_id on public.rankings
  for each row when (old.bev_id is distinct from new.bev_id)
  execute function public.bev_locations_follow_ranking_move();

-- ---------------------------------------------------------------------------
-- 3. private.put_bev_location: the one writer
-- ---------------------------------------------------------------------------
-- Sets, replaces or (p_venue_id null) clears the place of p_user_id's ranking
-- of p_bev_id. The three public functions below are this plus a caller.
--
-- A hidden venue and an unknown one are the same answer, as in `venue_detail`.
create or replace function private.put_bev_location(p_user_id uuid, p_bev_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues;
begin
  if not exists (
    select 1 from public.rankings r where r.user_id = p_user_id and r.bev_id = p_bev_id
  ) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002', detail = 'ranking';
  end if;

  if p_venue_id is null then
    delete from public.bev_locations l
     where l.user_id = p_user_id and l.bev_id = p_bev_id;
    return null;
  end if;

  select v.* into v_venue from public.venues v
   where v.id = p_venue_id and v.status = 'active';

  if v_venue.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002', detail = 'venue';
  end if;

  insert into public.bev_locations as l (user_id, bev_id, venue_id)
  values (p_user_id, p_bev_id, p_venue_id)
  on conflict (user_id, bev_id) do update
    set venue_id = excluded.venue_id, updated_at = now();

  return private.venue_json(v_venue);
end;
$$;

alter function private.put_bev_location(uuid, uuid, uuid) owner to postgres;
revoke execute on function private.put_bev_location(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. set_bev_location(p_bev_id, p_venue_id) -> the venue, or null
-- ---------------------------------------------------------------------------
-- For a Bev already ranked: add a place, change it, or (null) remove it.
create or replace function public.set_bev_location(p_bev_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- A stale client may still hold a merged Bev's id, as in update_ranking_note.
  return private.put_bev_location(v_uid, public.resolve_bev_id(p_bev_id), p_venue_id);
end;
$$;

alter function public.set_bev_location(uuid, uuid) owner to postgres;
revoke execute on function public.set_bev_location(uuid, uuid) from public, anon;
grant execute on function public.set_bev_location(uuid, uuid) to authenticated;

comment on function public.set_bev_location(uuid, uuid) is
  'BEV-22: sets, replaces or (null) clears where the caller had a Bev they have ranked. Returns the venue as venue_json, or null when cleared. BEVI_NOT_FOUND for a Bev not ranked or a venue that is not active.';

-- ---------------------------------------------------------------------------
-- 5. submit_ranking_with_location / rerank_bev_with_location
-- ---------------------------------------------------------------------------
-- The ranking and its place in ONE transaction: a place that fails to save
-- takes the ranking with it, so there is never a post that silently lost the
-- place its author picked.
--
-- They CALL the live functions, so every rule those enforce (the bucket size,
-- the comparison log, the age gate, the rate limit, the feed post) is the
-- same rule, and the next migration that re-creates `submit_ranking` changes
-- this path too without knowing it is here.
--
-- `p_venue_id` null: submit saves no place; a re-rank CLEARS the one it had.
-- A re-rank that should keep its place calls plain `rerank_bev`, which keeps
-- it by not touching it.
create or replace function public.submit_ranking_with_location(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null,
  p_venue_id             uuid default null,
  p_photo_path           text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A record, then its two fields: plpgsql will not take a composite variable
  -- as one of several INTO targets.
  v_res     record;
  v_ranking public.rankings;
begin
  select s.ranking, s.bucket_size into v_res
    from public.submit_ranking(
      p_bev_id, p_bucket, p_insert_index, p_expected_bucket_size, p_comparisons, p_note, p_photo_path
    ) s;
  v_ranking := v_res.ranking;

  if p_venue_id is not null then
    -- `v_ranking.bev_id`, not `p_bev_id`: submit_ranking resolved a merged id.
    perform private.put_bev_location(v_ranking.user_id, v_ranking.bev_id, p_venue_id);
  end if;

  return query select v_ranking, v_res.bucket_size::integer;
end;
$$;

create or replace function public.rerank_bev_with_location(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null,
  p_venue_id             uuid default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res     record;
  v_ranking public.rankings;
begin
  select s.ranking, s.bucket_size into v_res
    from public.rerank_bev(
      p_bev_id, p_bucket, p_insert_index, p_expected_bucket_size, p_comparisons, p_note
    ) s;
  v_ranking := v_res.ranking;

  perform private.put_bev_location(v_ranking.user_id, v_ranking.bev_id, p_venue_id);

  return query select v_ranking, v_res.bucket_size::integer;
end;
$$;

alter function public.submit_ranking_with_location(uuid, smallint, integer, integer, jsonb, text, uuid, text) owner to postgres;
revoke execute on function public.submit_ranking_with_location(uuid, smallint, integer, integer, jsonb, text, uuid, text) from public, anon;
grant execute on function public.submit_ranking_with_location(uuid, smallint, integer, integer, jsonb, text, uuid, text) to authenticated;

alter function public.rerank_bev_with_location(uuid, smallint, integer, integer, jsonb, text, uuid) owner to postgres;
revoke execute on function public.rerank_bev_with_location(uuid, smallint, integer, integer, jsonb, text, uuid) from public, anon;
grant execute on function public.rerank_bev_with_location(uuid, smallint, integer, integer, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. private.visible_bev_locations: the places the caller may see
-- ---------------------------------------------------------------------------
-- One definition of "may see", used by every read below: the ranking still
-- exists, no block stands between the caller and its author, the venue is
-- active, the Bev is active, and an alcoholic Bev needs an adult viewer.
--
-- A VIEW, not a function, so the planner folds it into each caller and a feed
-- page's forty pairs are forty index lookups rather than a pass over every
-- place on file (a `security definer` or `set`-carrying SQL function is never
-- inlined). It is read only by the definer functions below, which run as its
-- owner; no client role is granted it, and `private` is not an API schema.
create view private.visible_bev_locations as
  select l.user_id, l.bev_id, l.venue_id, r.id as ranking_id, r.ranked_at
    from public.bev_locations l
    join public.rankings r on r.user_id = l.user_id and r.bev_id = l.bev_id
    join public.venues v on v.id = l.venue_id and v.status = 'active'
    join public.bevs b on b.id = l.bev_id and b.status = 'active'
    join public.categories c on c.id = b.category_id
   where auth.uid() is not null
     and not private.is_blocked(l.user_id)
     and (not c.is_alcoholic or public.viewer_is_adult());

alter view private.visible_bev_locations owner to postgres;
revoke all on private.visible_bev_locations from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. get_bev_locations / get_user_bev_locations -> the place on a post
-- ---------------------------------------------------------------------------
-- The feed RPCs are not re-created to carry a venue: `packages/api` already
-- makes a second round trip per page for the actors (`profiles_view`), and
-- asks this for the places in the same way. `get_feed`, `get_user_feed` and
-- `get_explore` therefore keep the shape every shipped client parses.
--
-- `get_bev_locations` takes PAIRS, as two arrays of one length: the place of
-- p_user_ids[i]'s ranking of p_bev_ids[i]. A feed page is at most 50 posts;
-- 200 is the cap.
create or replace function public.get_bev_locations(p_user_ids uuid[], p_bev_ids uuid[])
returns table (user_id uuid, bev_id uuid, venue jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_user_ids), 0) <> coalesce(cardinality(p_bev_ids), 0)
     or coalesce(cardinality(p_user_ids), 0) > 200 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'pairs';
  end if;

  return query
  select distinct on (l.user_id, l.bev_id)
         l.user_id, l.bev_id, private.venue_json(v)
    from unnest(p_user_ids, p_bev_ids) as k(user_id, bev_id)
    join private.visible_bev_locations l on l.user_id = k.user_id and l.bev_id = k.bev_id
    join public.venues v on v.id = l.venue_id
   order by l.user_id, l.bev_id;
end;
$$;

-- Every place of one user's rankings: the Bev'd list and a profile's Activity.
create or replace function public.get_user_bev_locations(p_user_id uuid)
returns table (bev_id uuid, venue jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
  select l.bev_id, private.venue_json(v)
    from private.visible_bev_locations l
    join public.venues v on v.id = l.venue_id
   where l.user_id = p_user_id
   order by l.bev_id;
end;
$$;

alter function public.get_bev_locations(uuid[], uuid[]) owner to postgres;
revoke execute on function public.get_bev_locations(uuid[], uuid[]) from public, anon;
grant execute on function public.get_bev_locations(uuid[], uuid[]) to authenticated;

alter function public.get_user_bev_locations(uuid) owner to postgres;
revoke execute on function public.get_user_bev_locations(uuid) from public, anon;
grant execute on function public.get_user_bev_locations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. bevd_map(p_scope) -> the pins
-- ---------------------------------------------------------------------------
-- One row per venue where someone in scope had a Bev:
--   'mine'     the caller;
--   'friends'  the people the caller follows;
--   'all'      both, which is what the Map tab opens on.
--
-- Not a viewport query. The map is of a person and the people they follow, so
-- the whole answer is small (a pin per place, not per Bev) and the client
-- fits its camera to it; `venues_in_view` needed a box because it drew a city.
-- Capped at 1000 pins, the most recent first, so the cap drops old places.
--
-- `mine_count` lets a pin say whether the caller has been there without a
-- second call; `bev_count - mine_count` is the friends'.
create or replace function public.bevd_map(p_scope text default 'all')
returns table (
  venue      jsonb,
  bev_count  integer,
  mine_count integer,
  latest_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('mine', 'friends', 'all') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'scope';
  end if;

  return query
  with scoped as (
    select l.*
      from private.visible_bev_locations l
     where (p_scope in ('mine', 'all') and l.user_id = v_uid)
        or (p_scope in ('friends', 'all')
            and l.user_id in (select f.followee_id from public.follows f where f.follower_id = v_uid))
  ),
  agg as (
    select s.venue_id,
           count(*)::integer as bev_count,
           (count(*) filter (where s.user_id = v_uid))::integer as mine_count,
           max(s.ranked_at) as latest_at
      from scoped s
     group by s.venue_id
  )
  select private.venue_json(v), a.bev_count, a.mine_count, a.latest_at
    from agg a
    join public.venues v on v.id = a.venue_id
   order by a.latest_at desc, v.id asc
   limit 1000;
end;
$$;

alter function public.bevd_map(text) owner to postgres;
revoke execute on function public.bevd_map(text) from public, anon;
grant execute on function public.bevd_map(text) to authenticated;

comment on function public.bevd_map(text) is
  'BEV-22: one row per venue where the caller (''mine''), the people they follow (''friends'') or both (''all'') had a Bev the caller may see. bev_count is rankings, not people.';

-- ---------------------------------------------------------------------------
-- 9. bevd_at_venue(p_venue_id, p_scope) -> what was had there
-- ---------------------------------------------------------------------------
-- The rankings behind one pin, the most recent first. It returns ids, and
-- `packages/api` reads the rankings and the profiles through the same RLS'd
-- paths a profile screen uses, so a Bev or a person is shaped in one place.
--
-- An inactive or unknown venue is BEVI_NOT_FOUND. A venue with nothing in
-- scope returns no rows, which the contract also reports as not found: there
-- was no pin to tap.
create or replace function public.bevd_at_venue(p_venue_id uuid, p_scope text default 'all')
returns table (
  venue      jsonb,
  ranking_id uuid,
  user_id    uuid,
  bev_id     uuid,
  ranked_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_venue public.venues;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_scope is null or p_scope not in ('mine', 'friends', 'all') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'scope';
  end if;

  select v.* into v_venue from public.venues v
   where v.id = p_venue_id and v.status = 'active';

  if v_venue.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select private.venue_json(v_venue), l.ranking_id, l.user_id, l.bev_id, l.ranked_at
    from private.visible_bev_locations l
   where l.venue_id = p_venue_id
     and ((p_scope in ('mine', 'all') and l.user_id = v_uid)
          or (p_scope in ('friends', 'all')
              and l.user_id in (select f.followee_id from public.follows f where f.follower_id = v_uid)))
   order by l.ranked_at desc, l.ranking_id asc
   limit 200;
end;
$$;

alter function public.bevd_at_venue(uuid, text) owner to postgres;
revoke execute on function public.bevd_at_venue(uuid, text) from public, anon;
grant execute on function public.bevd_at_venue(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. bev_location_summary() -> how much of the caller's list has a place
-- ---------------------------------------------------------------------------
-- "12 of your 40 Bevs have no location": the Map tab's nudge to go back and
-- add them, which is how the first users' existing Bevs get onto the map.
create or replace function public.bev_location_summary()
returns table (ranked_count integer, located_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
  select (select count(*) from public.rankings r where r.user_id = v_uid)::integer,
         (select count(*)
            from public.bev_locations l
            join public.rankings r on r.user_id = l.user_id and r.bev_id = l.bev_id
           where l.user_id = v_uid)::integer;
end;
$$;

alter function public.bev_location_summary() owner to postgres;
revoke execute on function public.bev_location_summary() from public, anon;
grant execute on function public.bev_location_summary() to authenticated;
