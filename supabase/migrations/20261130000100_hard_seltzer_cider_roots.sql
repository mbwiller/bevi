-- TICKET-23: Hard seltzer and Cider become top-level categories, so a new Bev
-- can be filed under either instead of under Spirits & cocktails.
--
-- `cider` is new. `hard_seltzer` already exists as a leaf under `beer` (A-13),
-- and is promoted in place so its id, and every Bev on it, keeps meaning the
-- same drinks. The order matters because of the two guards on the tree:
--
--   categories_depth_guard (statement level, after the categories write):
--     no Bev's leaf_category_id may name a root, and no Bev's category_id may
--     name a leaf.
--   bevs_leaf_category_guard (row level, before the bevs write):
--     category_id is a root, and leaf_category_id sits under it.
--
-- So: (1) take the Bevs off the leaf while it is still a leaf, leaving them on
-- `beer` with no leaf, which both guards allow; (2) make it a root, which the
-- depth guard now allows because no Bev names it; (3) move those same Bevs onto
-- the new root. The seeded rows are moved here as well as by the catalog seed
-- migration after this one, because that migration upserts the categories
-- before the Bevs and its step (2) would fail on Bevs still on the leaf.
--
-- Ciders and seltzers people filed by hand under spirits or beer are left
-- where they are: nothing marks them, and a guess by name would move drinks
-- that are not ciders. A founder can re-file one in Studio.

set search_path = public, extensions;

insert into public.categories (id, name, parent_id, sort_order, is_alcoholic, emoji)
values ('cider', 'Cider', null, 16, true, '🍏')
on conflict (id) do nothing;

create temporary table t23_moved as
  select id from public.bevs where leaf_category_id = 'hard_seltzer';

update public.bevs set leaf_category_id = null
 where id in (select id from t23_moved);

update public.categories
   set parent_id = null, name = 'Hard Seltzer', sort_order = 15, emoji = '🫧'
 where id = 'hard_seltzer';

update public.categories set sort_order = 17 where id = 'other';

update public.bevs set category_id = 'hard_seltzer'
 where id in (select id from t23_moved);

-- user_category_stats is keyed by a Bev's category, so the people who ranked a
-- moved Bev have a `beer` row that should now be partly `hard_seltzer`; the
-- per-category prior (category_stats) is the same story for everyone.
do $$
declare
  v_uid uuid;
begin
  for v_uid in
    select distinct r.user_id from public.rankings r where r.bev_id in (select id from t23_moved)
  loop
    perform public.refresh_user_category_stats(v_uid);
  end loop;
  perform public.refresh_global_stats();
end;
$$;

drop table t23_moved;
