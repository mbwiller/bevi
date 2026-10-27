-- A-13 (20261026000100): the category hierarchy.
--
-- D-04 (#127) settled the taxonomy: today's 15 category ids stay as the
-- parents, 60 leaves go underneath them, and all 378 catalog Bevs are assigned
-- (344 to a leaf, 34 to the two roots that stay unsplit, `water` and `sports`).
-- This migration puts that tree in Postgres and gives a Bev a place to record
-- its leaf.
--
-- THE SHAPE DECISION, and why it is not the obvious one.
--
-- The obvious model is one category FK per Bev pointing at the leaf, with the
-- hierarchy in `categories`. This migration does NOT do that. `category_id`
-- keeps meaning one of the 15 roots and the leaf goes in a NEW nullable column,
-- for one reason: the app keys exhaustive maps off the 15 ids --
-- `Record<CategoryId, BevArtKind>` in app/src/components/BevArt.tsx,
-- `Record<CategoryId, CategoryInfo>` behind `categoryById()` in
-- app/src/lib/categories.ts, and `visibleCategories()`'s alcohol filter. Those
-- lookups return `undefined` for a leaf id, `categoryById` is typed as if it
-- cannot, and every merge to main deploys to production. Re-pointing
-- `category_id` at leaves would therefore have broken placeholder art, icons
-- and the age filter for 344 of 378 Bevs the moment this merged, and it would
-- have needed a coordinated deploy across two lanes to avoid that.
--
-- So the change is purely additive and nothing that exists today reads
-- differently:
--
--   categories.parent_id    null on a root, the root's id on a leaf
--   bevs.leaf_category_id   null, or a CHILD of the row's own category_id
--
-- A Bev may sit on a parent (D-04 section 3's shape rule): that is the right
-- state for `water` and `sports`, and for any user-created Bev until something
-- relabels it. `leaf_category_id` is then NULL rather than a copy of
-- `category_id`, so "no finer placement known" and "its leaf happens to be its
-- own parent" are not the same value, and nothing has to special-case a leaf
-- that is its own parent.
--
-- The invariant `parent_of(leaf_category_id) = category_id` is what makes the
-- redundancy safe, and it is enforced by a trigger rather than left to the
-- writer. A CHECK cannot do it: the test needs a subquery.
--
-- What this migration does NOT do:
--   * It does not add `leafCategoryId` to `BevSummary`. Eleven RPCs return Bev
--     columns (get_bev, get_feed, get_user_feed, get_explore, get_featured,
--     search_bevs, get_similar_bevs, list_bucket_bevs, get_bev_leaderboard,
--     get_prediction_snapshot, find_similar_bevs) and migrations are
--     append-only, so that means re-emitting eleven full function bodies
--     across the whole read surface. The leaf is exposed once instead, through
--     `get_bev_leaves(uuid[])` below -- the same bulk shape as
--     `get_bev_similarities`, which is what M-21's placement already calls per
--     bucket. Putting it on BevSummary later is additive and breaks nothing.
--   * It does not touch Neo4j. `CHILD_OF` is part of the deferred mirror
--     (A-16 steps 6, 8, 9), and nothing here depends on the instance -- same
--     posture as A-16 (1).
--   * It does not re-point any Bev. The 378 assignments and the six root
--     corrections ride in the generated seed migration that follows this one,
--     because data/catalog is the source of truth for a seeded row.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. categories.parent_id
-- ---------------------------------------------------------------------------
-- Self-referencing FK. `on delete restrict` (the default) rather than cascade:
-- deleting a root that still has leaves should fail loudly, because its leaves'
-- Bevs would otherwise lose their category tree silently. Categories are seed
-- data and nothing deletes them today, so this is about the one time somebody
-- tries it in Studio.

alter table public.categories
  add column parent_id text references public.categories(id);

-- A root is its own top: a category cannot parent itself. This is the one half
-- of "exactly two levels" a CHECK can express; the other half needs the
-- trigger below.
alter table public.categories
  add constraint categories_parent_not_self check (parent_id is null or parent_id <> id);

comment on column public.categories.parent_id is
  'A-13/D-04: null on one of the 15 roots, the root id on one of the 60 leaves. Exactly two levels, enforced by categories_depth_guard.';

-- `sort_order` changes meaning slightly and it is worth recording: it was a
-- global 1..15 and is now the order among SIBLINGS -- still 1..15 across the
-- roots, and 1..8 within each root's leaves. Every existing query orders
-- `categories` either with a `parent_id is null` filter alongside (section 5)
-- or after joining to a single Bev, so no existing ordering changes.
comment on column public.categories.sort_order is
  'Order among siblings: 1..15 across the roots, 1..n within one root''s leaves (A-13).';

-- Exactly two levels. The tree depth is not a style preference: the contract,
-- `category_is_alcoholic` below and `treeSimilarity`'s Wu-Palmer depths in
-- @bevi/ranking all assume a leaf's parent is a root, and a third level would
-- make each of them quietly wrong rather than fail. So it is a constraint.
--
-- A statement-level trigger, not a row-level one, and it re-checks the whole
-- table rather than the changed rows: a two-row update that moves a root under
-- a leaf while making that leaf a root is legal row by row in either order, and
-- only the end state shows the cycle. `after` + `for each statement` sees the
-- end state once, which is also cheaper than 75 row-level firings on a seed
-- re-run.
create or replace function public.categories_depth_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_bad text;
begin
  select c.id
    into v_bad
    from public.categories c
    join public.categories p on p.id = c.parent_id
   where p.parent_id is not null
   order by c.id
   limit 1;

  if v_bad is not null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('category %s is three levels deep; the taxonomy is exactly two levels', v_bad);
  end if;

  return null;
end;
$$;

create trigger categories_depth_guard
  after insert or update of parent_id, id on public.categories
  for each statement
  execute function public.categories_depth_guard();

-- ---------------------------------------------------------------------------
-- 2. bevs.leaf_category_id
-- ---------------------------------------------------------------------------
-- Nullable, and null is a normal state rather than a gap to be backfilled away:
-- the two unsplit roots have no leaf to point at, and `create_bev` takes one of
-- the 15 from the wizard, so every user-created Bev starts here.

alter table public.bevs
  add column leaf_category_id text references public.categories(id);

comment on column public.bevs.leaf_category_id is
  'A-13: the Bev''s leaf under category_id, or null when it sits on the parent (an unsplit root, or not yet relabelled). Always a child of category_id -- bevs_leaf_category_guard.';

-- The invariant that makes the redundancy with `category_id` safe. A trigger
-- because the test is a subquery; `before` because it must reject the row
-- rather than report on it afterwards; row-level because the offending value is
-- per row and the message should name it.
--
-- `when` keeps it off the hot path: `submit_ranking`, the feed writes and every
-- other update that does not touch either column never fires it. A new row
-- always does, which is `create_bev` (leaf null, passes immediately) and the
-- seed.
create or replace function public.bevs_leaf_category_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_parent text;
begin
  if new.leaf_category_id is null then
    return new;
  end if;

  select c.parent_id into v_parent
    from public.categories c
   where c.id = new.leaf_category_id;

  -- The FK already rejects an id that does not exist, but this function can run
  -- before it in the same statement, so an unknown id reads as "not found" here
  -- rather than as a null parent.
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('unknown leaf_category_id %L', new.leaf_category_id);
  end if;

  if v_parent is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('leaf_category_id %L is a root, not a leaf', new.leaf_category_id);
  end if;

  if v_parent <> new.category_id then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('leaf_category_id %L sits under %L, not under category_id %L',
                      new.leaf_category_id, v_parent, new.category_id);
  end if;

  return new;
end;
$$;

create trigger bevs_leaf_category_guard
  before insert or update of category_id, leaf_category_id on public.bevs
  for each row
  execute function public.bevs_leaf_category_guard();

-- "Which Bevs are in this leaf" is M-21's and the graph's query, and the leaf
-- is null for a third of the catalog, so a partial index: it indexes the 344
-- rows that have one and skips the rest.
create index bevs_leaf_category_idx
  on public.bevs (leaf_category_id)
  where leaf_category_id is not null;

-- ---------------------------------------------------------------------------
-- 3. category_root(text) and category_is_alcoholic(text)
-- ---------------------------------------------------------------------------
-- The age gate's question is "is this category, or the root above it,
-- alcoholic?" -- one hop, because section 1 guarantees the depth.
--
-- These exist so nothing has to know whether it is holding a root or a leaf.
-- Every current caller passes a root and gets the same answer it gets today
-- from `categories.is_alcoholic`, so this adds a path rather than changing one:
-- no existing RLS policy or RPC is rewritten here, and the four places that
-- join `categories` for the alcohol predicate keep working unchanged, because
-- `bevs.category_id` is still a root.
--
-- `stable`, not `immutable`: it reads a table. Not `security definer` either --
-- `categories_select` is readable by every authenticated user and carries no
-- age predicate of its own, so there is nothing to bypass.

create or replace function public.category_root(p_category_id text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(c.parent_id, c.id)
    from public.categories c
   where c.id = p_category_id;
$$;

comment on function public.category_root(text) is
  'A-13: the root above a category -- itself when it is a root, its parent when it is a leaf. Null when the id is unknown.';

create or replace function public.category_is_alcoholic(p_category_id text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  -- The leaf's own flag is kept in step with its root's (the catalog validator
  -- and the seed both enforce it), so either row answers. Reading the ROOT is
  -- still the right choice: it is the row the gate is really about, and if the
  -- two ever diverged through a manual edit this fails closed towards the
  -- parent rather than trusting a leaf somebody mislabelled.
  select r.is_alcoholic
    from public.categories c
    join public.categories r on r.id = coalesce(c.parent_id, c.id)
   where c.id = p_category_id;
$$;

comment on function public.category_is_alcoholic(text) is
  'A-13: does this category id -- root or leaf -- sit under an alcoholic root? Null when the id is unknown, so a caller must coalesce.';

-- ---------------------------------------------------------------------------
-- 4. get_category_tree() -> the 75 nodes the caller may see
-- ---------------------------------------------------------------------------
-- `CategoriesApi.tree()`. This is the structure call: it answers "what is the
-- taxonomy", not "how many Bevs are in each box" (`categories.list()` still
-- does that for the 15 roots, and `get_category_progress` is still the one age
-- rule for counts).
--
-- Age-gated by the ROOT's flag, so an under-21 caller sees neither `beer` nor
-- its `lager` leaf. `security definer` to match the other read RPCs, and
-- because the gate should be this function's own rather than the caller's RLS.
--
-- Ordered root-then-leaf in sibling order: a client can build the tree by
-- walking the list once, and the order is total, so it is stable across calls.
-- `collate "C"` on the final tie-break for the same reason the leaderboard
-- uses it (M-22): it is the order @bevi/ranking's `compareCodePoints` produces.

create or replace function public.get_category_tree()
returns table (
  id            text,
  name          text,
  parent_id     text,
  sort_order    smallint,
  is_alcoholic  boolean,
  emoji         text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
-- As in get_bev_similarities: the RETURNS TABLE column names (`id`, `name`,
-- `sort_order`, ...) are also plpgsql variables, and `name` in particular is
-- the kind of identifier a later edit will reference bare. Resolving to the
-- column is what every reference below wants.
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
    with visible as (
      select c.id, c.name, c.parent_id, c.sort_order, c.emoji,
             r.is_alcoholic as root_alcoholic,
             r.sort_order   as root_sort_order,
             r.id           as root_id
        from public.categories c
        join public.categories r on r.id = coalesce(c.parent_id, c.id)
       where not r.is_alcoholic or public.viewer_is_adult()
    )
    select v.id, v.name, v.parent_id, v.sort_order, v.root_alcoholic, v.emoji
      from visible v
     order by v.root_sort_order,
              v.root_id collate "C",
              -- the root before its own leaves
              (v.parent_id is not null),
              v.sort_order,
              v.id collate "C";
end;
$$;

comment on function public.get_category_tree() is
  'A-13: the 75-node category tree (15 roots + 60 leaves) the caller may see, age-gated by the root''s is_alcoholic, ordered root-then-leaf in sibling order.';

-- ---------------------------------------------------------------------------
-- 5. get_bev_leaves(uuid[]) -> (bev_id, leaf_category_id)
-- ---------------------------------------------------------------------------
-- `BevsApi.leaves(bevIds)`: the leaf of each of a caller-supplied set of Bevs,
-- for M-21's two-phase placement (compare a new mocha with mochas first). This
-- is the one place the leaf reaches the client, and it is deliberately the same
-- shape as `get_bev_similarities` (20261019000500), which M-21 already calls
-- once per bucket -- so the screen gains one call, not one per Bev.
--
-- Everything here is copied from that function on purpose, down to the
-- reasoning:
--   * `cardinality`, not `array_length(arr, 1)`: PostgREST turns a nested JSON
--     array into a multidimensional array, whose first dimension is shorter
--     than the number of ids it unnests to, so the cap has to be on the
--     cardinality or the request body sets the bound.
--   * A Bev the caller may not see contributes NO ROW rather than an error.
--     This feeds a placement heuristic over a bucket the caller already has on
--     screen, and failing a whole call because one id of thirty is age-gated
--     would be worse behaviour, not safer.
--   * `status = 'active'` and the alcohol predicate, spelled as
--     `search_bevs`/`get_featured` spell it. D-15's lesson from #113.
-- A Bev with no leaf is returned with a null `leaf_category_id` rather than
-- omitted: the caller asked about it, and "I have no finer placement for this
-- one" is the answer, distinguishable from "you may not see it".

create or replace function public.get_bev_leaves(p_bev_ids uuid[])
returns table (
  bev_id           uuid,
  leaf_category_id text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  -- A bucket is a few hundred Bevs at most. Same bound as
  -- get_bev_similarities, for the same reason: it caps the work one call can
  -- ask for, so exceeding it is the caller's bug and is reported as one.
  v_max constant int := 500;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_bev_ids), 0) > v_max then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'bevIds';
  end if;

  return query
    select distinct b.id, b.leaf_category_id
      from unnest(coalesce(p_bev_ids, '{}'::uuid[])) as want(id)
      join public.bevs b on b.id = want.id
      join public.categories c on c.id = b.category_id
     where b.status = 'active'
       and (not c.is_alcoholic or public.viewer_is_adult())
     order by b.id;
end;
$$;

comment on function public.get_bev_leaves(uuid[]) is
  'A-13: each requested active, visible Bev''s leaf_category_id (null when it sits on its parent), for M-21''s category-aware placement. Age-gated; invisible Bevs are omitted, not errors.';

grant execute on function public.get_category_tree() to authenticated;
grant execute on function public.get_bev_leaves(uuid[]) to authenticated;
grant execute on function public.category_root(text) to authenticated;
grant execute on function public.category_is_alcoholic(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_category_progress(): restrict it to the roots
-- ---------------------------------------------------------------------------
-- THE ONE EXISTING RPC THIS MIGRATION HAS TO REVISE, and the reason is worth
-- spelling out because it is the exact failure mode the whole shape decision
-- above exists to avoid.
--
-- `get_category_progress` (20261018000200) iterates `public.categories`
-- WHOLESALE -- `from public.categories c where not c.is_alcoholic or
-- viewer_is_adult()` -- so adding 60 leaf rows silently turns its 15 rows into
-- 75. That is wrong twice over:
--
--   * The contract says "one row per category (ranked 0 included), in
--     sortOrder", meaning the 15. The app's category progress strip (M-08)
--     would render 60 extra rows, every one of them "0 of 0", because no Bev's
--     `category_id` is a leaf.
--   * Worse, `categories.list()` in packages/api keeps exactly the categories
--     this RPC returns -- it uses the progress rows as the single age rule, so
--     a category absent from them is dropped. With 75 progress rows,
--     `list()` would return all 75, `mapCategory` would cast a leaf id to
--     `CategoryId`, and `categoryById()` in the app would return `undefined`
--     for 60 of them. That is the breakage this migration was shaped to
--     prevent, arriving through the back door.
--
-- So: `and c.parent_id is null`. Progress is a count of Bevs per category, and
-- every Bev's `category_id` is a root, so a per-leaf row could only ever be 0
-- until something re-points `category_id` -- which A-13 deliberately does not
-- do. Per-leaf progress is a product question for later and a new RPC when it
-- comes, not a silent side effect of loading a taxonomy.
--
-- Everything else about the function is unchanged, including `security
-- invoker`, the `viewer_is_adult()` gate and the `sort_order, id` order -- it
-- is re-emitted in full only because migrations are append-only.

create or replace function public.get_category_progress()
returns table (category_id text, ranked integer, total integer)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    (select count(*)::int
       from public.rankings r
       join public.bevs b on b.id = r.bev_id
      where r.user_id = v_uid
        and b.category_id = c.id
        and b.status = 'active'),
    (select count(*)::int
       from public.bevs b
      where b.category_id = c.id
        and b.status = 'active')
  from public.categories c
  where c.parent_id is null                               -- A-13: the 15 roots only
    and (not c.is_alcoholic or public.viewer_is_adult())
  order by c.sort_order, c.id;
end;
$$;

comment on function public.get_category_progress() is
  'S-07/A-06: the caller''s progress through each of the 15 TOP-LEVEL categories (A-13 restricted it to parent_id is null; a leaf could only ever read 0, and categories.list() keys its age filter off these rows).';

alter function public.get_category_progress() owner to postgres;
revoke execute on function public.get_category_progress() from public, anon;
grant execute on function public.get_category_progress() to authenticated;
