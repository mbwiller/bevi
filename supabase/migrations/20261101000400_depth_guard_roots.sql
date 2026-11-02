-- A-13 follow-up (20261101000400): categories_depth_guard also protects the
-- Bevs that point at the tree.
--
-- A-13 (20261026000100) made `categories_depth_guard` reject a third level.
-- That was the whole of the rule it was written for, and it left one hole that
-- the A-13 board row names: a category can MOVE without any Bev being written,
-- so the row-level guard on `bevs` (`bevs_leaf_category_guard`) never fires and
-- cannot catch it. Concretely:
--
--   update public.categories set parent_id = 'soda' where id = 'water';
--
-- is a legal two-level tree (water becomes a leaf of soda) and touches zero
-- `bevs` rows. But the 14 Bevs whose `category_id` is 'water' now point at a
-- leaf, which is the exact state `bevs_leaf_category_guard` exists to forbid
-- on insert and update. The app keys exhaustive `Record<CategoryId, ...>` maps
-- off the 15 root ids, so every one of those Bevs would resolve to
-- `undefined` in BevArt, `categoryById()` and the alcohol filter, and
-- `user_category_stats` and `get_category_progress` would disagree about which
-- 15 categories exist. `water` and `sports` are the exposed ones (they are the
-- two roots with no leaves, so every Bev in them has `leaf_category_id` null
-- and the move above is otherwise "free"), but nothing about the rule is
-- specific to them.
--
-- The mirror image has the same shape. Promoting a leaf that Bevs use as their
-- `leaf_category_id` to a root (`parent_id = null`) leaves the Bevs saying
-- "my leaf is X" about a category that is now a root, so `category_root(X)`
-- returns X itself and `treeSimilarity`'s Wu-Palmer depths treat two Bevs in
-- different roots as one level apart -- quietly wrong rather than failing,
-- which is the reason the depth rule is a constraint in the first place.
--
-- So two end-state rules join the depth rule, checked in this order:
--
--   1. depth   no category's parent may itself have a parent (existing).
--   2. roots   no Bev's `category_id` may point at a category with a parent.
--              A root that Bevs use as their root must stay a root.
--   3. leaves  no Bev's `leaf_category_id` may point at a category without a
--              parent. A leaf that Bevs use as their leaf must stay a leaf.
--
-- Each raises BEVI_VALIDATION (22023) with a detail naming the category and the
-- rule, in the style of the existing message. Depth stays first so a statement
-- that breaks several rules reports the structural one.
--
-- WHY THE STATEMENT-LEVEL TRIGGER IS STILL THE RIGHT PLACE. The same argument
-- as the depth rule: these are properties of the END state, not of any one row.
-- A multi-row update can pass through states that violate rule 2 on the way
-- (e.g. a re-seed that re-parents a leaf and then fixes its siblings) and be
-- fine at the end; `after` + `for each statement` sees only the end state, once.
-- A row trigger on `bevs` cannot help, because the thing that changes is not a
-- `bevs` row, and a row trigger on `categories` would have to scan `bevs` once
-- per category row.
--
-- TRIGGER COVERAGE (confirmed from 20261026000100, not assumed). The trigger is
--
--   after insert or update of parent_id, id on public.categories
--   for each statement
--
-- Both new rules read only `parent_id` (the category side) against two columns
-- of `bevs`. A category can only change which side of a rule it falls on by
-- changing its own `parent_id`, which is in the column list. `id` is in the list
-- too, but renaming a category that Bevs reference already fails on the
-- `bevs.category_id` / `bevs.leaf_category_id` foreign keys (no `on update`
-- action), and a rename of an unreferenced category cannot violate either rule.
-- An INSERT cannot violate them either (no Bev can reference an id that does
-- not exist yet), so including it is harmless, not load-bearing. Writes to
-- `bevs` are covered by `bevs_leaf_category_guard`, whose column list
-- (`category_id`, `leaf_category_id`) is the other half. So no column outside
-- `parent_id, id` can bypass either rule, and the trigger definition is
-- UNCHANGED: this migration only replaces the function body with
-- `create or replace`, which keeps the trigger attached. It does not drop or
-- re-create the trigger.
--
-- What this does not cover, deliberately: it is a safety net for Studio edits
-- and future migrations, not a user-facing error. Clients have no write policy
-- on `categories`, so only the service role can reach it. It also does not
-- check that `parent_of(leaf_category_id) = category_id` when a LEAF is
-- re-parented to a different root; that is the pairing invariant
-- `bevs_leaf_category_guard` enforces on `bevs` writes, and re-parenting a
-- populated leaf is a different failure from the two named here.
--
-- The cost: two `exists` probes per statement on `categories`, which is a
-- 75-row table written by the seed and by Studio. The leaf probe uses
-- `bevs_leaf_category_idx`; the root probe is a scan of `bevs`, which is fine
-- at this write rate.

set search_path = public, extensions;

create or replace function public.categories_depth_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_bad text;
begin
  -- 1. depth: exactly two levels.
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

  -- 2. roots: a category that Bevs use as category_id must still be a root.
  select c.id
    into v_bad
    from public.categories c
   where c.parent_id is not null
     and exists (select 1 from public.bevs b where b.category_id = c.id)
   order by c.id
   limit 1;

  if v_bad is not null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('category %s is used by Bevs as their category_id, so it must stay a root (parent_id null)', v_bad);
  end if;

  -- 3. leaves: a category that Bevs use as leaf_category_id must still be a leaf.
  select c.id
    into v_bad
    from public.categories c
   where c.parent_id is null
     and exists (select 1 from public.bevs b where b.leaf_category_id = c.id)
   order by c.id
   limit 1;

  if v_bad is not null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('category %s is used by Bevs as their leaf_category_id, so it must stay a leaf (parent_id not null)', v_bad);
  end if;

  return null;
end;
$$;
