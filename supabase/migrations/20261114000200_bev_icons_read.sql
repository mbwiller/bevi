-- Custom Bevs, part 2: the read path for generated icons.
--
-- 20261114000100 put `generated_icon_path` and `icon_status` on `bevs`. This
-- adds the one function that gets them to a client.
--
-- ---------------------------------------------------------------------------
-- WHY A BATCH LOOKUP AND NOT TWO MORE COLUMNS ON EVERY RPC
-- ---------------------------------------------------------------------------
-- A `BevSummary` reaches the app from about a dozen security-definer RPCs --
-- `get_bev`, `search_bevs`, `get_feed`, `get_user_feed`, `get_explore`,
-- `get_featured`, `get_bev_of_period`, `find_similar_bevs`,
-- `get_similar_bevs`, `list_bucket_bevs`, the venue assortment -- each with an
-- explicit `returns table`. Postgres will not let `create or replace` change a
-- function's return type, so threading two columns through all of them means
-- dropping and recreating every one, copying each body forward unchanged into
-- a very large migration whose risk is almost entirely unrelated to icons.
--
-- 20261026000100 already hit this exact problem and already answered it: the
-- leaf category is "one more per-Bev attribute that lots of lists want", and
-- it became `get_bev_leaves(uuid[])` rather than a column on every projection,
-- so "the screen gains one call, not one per Bev". This is the same shape, so
-- it is the same solution, and nearly all of this function is copied from that
-- one on purpose, down to the reasoning:
--
--   * `cardinality`, not `array_length(arr, 1)`: PostgREST turns a nested JSON
--     array into a multidimensional array whose first dimension is shorter
--     than the number of ids it unnests to, so the cap has to be on the
--     cardinality or the request body sets the bound.
--   * A Bev the caller may not see contributes NO ROW rather than an error. A
--     feed page is drawn from Bevs the caller already has on screen, and
--     failing the whole call because one id of thirty is age-gated would be
--     worse behaviour, not safer.
--
-- The one deliberate difference from `get_bev_leaves`: visibility here is
-- `bevs_select`'s rule rather than `status = 'active'` alone, because a custom
-- Bev created with no photograph is `pending_photo` and visible to its creator
-- only (20261011000100) -- and the profile collection draws exactly those. An
-- absent row therefore means "not yours to see"; a present row with
-- `icon_status = 'none'` means "eligible for no icon, draw the placeholder".
--
-- The path, not a URL: `packages/api` turns it into one with `publicUrl()`,
-- as it does for photo_path, thumb_path and avatar_path. `last_error` and
-- `attempt_count` stay in `bev_icon_jobs`, which no client can read at all.
--
-- ---------------------------------------------------------------------------
-- fallback_bev_ids: ART TO BORROW, DECIDED HERE AND CHOSEN THERE
-- ---------------------------------------------------------------------------
-- Without this, a Bev with no generated icon falls all the way through to a
-- generic category silhouette, and a profile collection of custom drinks is a
-- wall of identical placeholders. The repository already holds a large and
-- growing set of hand-authored, exactly on-style icons, so a custom drink can
-- borrow one.
--
-- The split matters: this function RANKS the candidates, the client CHOOSES.
-- Postgres has no idea which Bevs have authored art -- that map is
-- `app/src/lib/bevIcons.generated.ts`, a client asset generated from
-- `design/beverage-icons/manifest.json`, and deliberately so (an icon is a
-- shipped file, not a database row). So this returns up to 8 plausible catalog
-- Bevs, best first, and the app walks the list until `hasBevIcon` is true.
--
-- Ranked by same leaf category first, then by `rating_count` as a proxy for
-- "the most recognisable drink in this category". NOT by graph similarity,
-- deliberately: `bev_edges` is built overnight by
-- `scripts/graph/build-edges.ts`, so a Bev created five minutes ago -- exactly
-- the case this feature exists for -- has no neighbours at all. Re-ordering
-- these candidates by similarity later is a change to this one query and to
-- nothing else.
--
-- No extra age check on the candidates: they share `category_id` with a Bev
-- the caller can already see, so the alcohol predicate above has settled it.
-- Only `source in ('seed','featured')` rows are offered -- the artwork that
-- is ours -- so one user's custom Bev can never lend its art to another's.

set search_path = public, extensions;

create or replace function public.get_bev_icons(p_bev_ids uuid[])
returns table (
  bev_id              uuid,
  generated_icon_path text,
  icon_status         text,
  fallback_bev_ids    uuid[],
  icon_label_band     jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- The same bound as get_bev_leaves and get_bev_similarities, for the same
  -- reason: it caps the work one call can ask for, so exceeding it is the
  -- caller's bug and is reported as one.
  v_max constant int := 500;
  -- How many catalog Bevs to offer as art to borrow. The client walks the list
  -- until it finds one it has authored art for, so this has to be long enough
  -- to survive the gaps -- only part of the catalog is drawn at any time, and
  -- that fraction keeps growing as icon batches land. Eight makes a miss
  -- unlikely without making the list big enough to be worth caching.
  v_candidates constant int := 8;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_bev_ids), 0) > v_max then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'bevIds';
  end if;

  return query
    with visible as (
      select distinct b.id, b.generated_icon_path, b.icon_status,
             b.icon_label_band, b.category_id, b.leaf_category_id
        from unnest(coalesce(p_bev_ids, '{}'::uuid[])) as want(id)
        join public.bevs b on b.id = want.id
        join public.categories c on c.id = b.category_id
       where (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = v_uid))
         and (not c.is_alcoholic or public.viewer_is_adult())
    )
    select v.id, v.generated_icon_path, v.icon_status,
           coalesce(f.ids, '{}'::uuid[]), v.icon_label_band
      from visible v
      left join lateral (
        select array_agg(cand.id order by cand.same_leaf desc, cand.rating_count desc, cand.id) as ids
          from (
            select b2.id,
                   (b2.leaf_category_id is not null
                    and b2.leaf_category_id = v.leaf_category_id) as same_leaf,
                   coalesce(bs.rating_count, 0) as rating_count
              from public.bevs b2
              left join public.bev_stats bs on bs.bev_id = b2.id
             where v.generated_icon_path is null   -- a Bev with art needs none
               -- The authored catalogue is 'seed' AND 'featured'; both are
               -- ours and both may be drawn. What is excluded is 'user', so
               -- one person's custom Bev can never lend art to another's.
               and b2.source in ('seed', 'featured')
               and b2.status = 'active'
               and b2.category_id = v.category_id
               and b2.id <> v.id
             -- Same leaf first ("a mocha looks like other mochas"), then the
             -- most-rated, which is a decent proxy for the most recognisable
             -- drink in the category. `id` last so the list is deterministic.
             order by (b2.leaf_category_id is not null
                       and b2.leaf_category_id = v.leaf_category_id) desc,
                      coalesce(bs.rating_count, 0) desc, b2.id
             limit v_candidates
          ) cand
      ) f on true
     order by v.id;
end;
$$;

comment on function public.get_bev_icons(uuid[]) is
  'Each requested visible Bev''s generated icon path, icon_status, and -- when it has no generated icon -- up to 8 catalog Bevs whose authored art it may borrow, best first. Read-only and age-gated; invisible Bevs are omitted, not errors. Starts no generation job: nothing in this function writes.';

-- The project's convention (20261019000500 explains why the anon revoke has to
-- be explicit on Supabase): owned by postgres, nothing for public or anon,
-- execute for authenticated only.
alter function public.get_bev_icons(uuid[]) owner to postgres;
revoke execute on function public.get_bev_icons(uuid[]) from public, anon;
grant execute on function public.get_bev_icons(uuid[]) to authenticated;
