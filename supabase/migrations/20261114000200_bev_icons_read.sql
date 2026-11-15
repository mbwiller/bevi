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
-- fallback_icon_path: ART TO BORROW, DECIDED HERE
-- ---------------------------------------------------------------------------
-- Without this, a Bev with no generated icon falls all the way through to a
-- generic category silhouette, and a profile collection of custom drinks is a
-- wall of identical placeholders. The repository already holds a large and
-- growing set of hand-authored, exactly on-style icons, so a custom drink can
-- borrow one.
--
-- This function picks it. It used to only RANK candidates -- up to 8 bev_ids,
-- best first -- and leave the CHOICE to the app, because Postgres could not
-- tell which Bevs were drawn: that map was `app/src/lib/bevIcons.generated.ts`,
-- a client asset built from `design/beverage-icons/manifest.json`, on the
-- reasoning that an icon is a shipped file rather than a database row.
--
-- That reasoning expired. 20261112000200 put the published icons in
-- `public.bev_icons`, and #201 retired the bundled client copy, so the app
-- can no longer answer the question and the database now can. Joining
-- `bev_icons` here is strictly better than the old split: undrawn candidates
-- are skipped rather than offered and rejected, so the "all 8 happened to be
-- undrawn" miss cannot occur, and the answer is one path instead of a list
-- plus a lookup table.
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
  fallback_icon_path  text,
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
           f.path, v.icon_label_band
      from visible v
      left join lateral (
        -- The ONE authored icon this Bev may borrow, or no row at all.
        --
        -- The join to `public.bev_icons` is what makes this answerable here.
        -- It used to return a ranked list of up to eight bev_ids and let the
        -- caller walk it, because only the app knew which Bevs were drawn --
        -- that map was a bundled asset. 20261112000200 put the published
        -- icons in the database and #201 retired the bundled copy, so the
        -- server can now do what the client never could: skip the undrawn
        -- candidates outright and name the winner. No list, no walking, and
        -- no "none of these eight happened to be drawn" miss.
        --
        -- Presence of the row is the whole test. `bev_icons.status` is the
        -- manifest's own review vocabulary (free text, e.g. 'needs-review'),
        -- not a publish flag, so it is deliberately NOT filtered on.
        select bi.path
          from public.bevs b2
          join public.bev_icons bi on bi.bev_id = b2.id
          left join public.bev_stats bs on bs.bev_id = b2.id
         where v.generated_icon_path is null   -- a Bev with art needs none
           -- The authored catalogue is 'seed' AND 'featured'; both are ours
           -- and both may be drawn. What is excluded is 'user', so one
           -- person's custom Bev can never lend art to another's.
           and b2.source in ('seed', 'featured')
           and b2.status = 'active'
           -- Same category, which also settles the age gate: `is_alcoholic`
           -- is a property of the category, so a candidate sharing `v`'s
           -- category is visible to anyone who can see `v`. That mattered
           -- less when this returned ids; it matters now that the answer is
           -- an image the app will draw.
           and b2.category_id = v.category_id
           and b2.id <> v.id
         -- Same leaf first ("a mocha looks like other mochas"), then the
         -- most-rated, which is a decent proxy for the most recognisable
         -- drink in the category. `id` last so the choice is deterministic.
         order by (b2.leaf_category_id is not null
                   and b2.leaf_category_id = v.leaf_category_id) desc,
                  coalesce(bs.rating_count, 0) desc, b2.id
         limit 1
      ) f on true
     order by v.id;
end;
$$;

comment on function public.get_bev_icons(uuid[]) is
  'Each requested visible Bev''s generated icon path, icon_status, and -- when it has no generated icon -- the path of the one authored catalogue icon it may borrow (best match in its category that is actually published, else null). Read-only and age-gated; invisible Bevs are omitted, not errors. Starts no generation job: nothing in this function writes.';

-- The project's convention (20261019000500 explains why the anon revoke has to
-- be explicit on Supabase): owned by postgres, nothing for public or anon,
-- execute for authenticated only.
alter function public.get_bev_icons(uuid[]) owner to postgres;
revoke execute on function public.get_bev_icons(uuid[]) from public, anon;
grant execute on function public.get_bev_icons(uuid[]) to authenticated;
