-- S-07 + A-06: category progress.
--
-- TASKS.md decision 9: Your Lists › Bev'd shows "Soda · 4 of 61 tried · 7%".
-- The contract (S-07) adds `Category.bevCount` to `categories.list()` and
-- `StatsApi.getCategoryProgress()` for the caller's ranked count per category.
-- Both read this one RPC, so the two numbers can never disagree.
--
-- `categories.list()` stays a plain table select (no change to
-- `categories_select`); packages/api joins `total` from here onto it.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- get_category_progress
-- ---------------------------------------------------------------------------
-- One row per category the caller may see: alcoholic categories only for an
-- adult, the same rule as `bevs_select` (viewer_is_adult). A category with no
-- rankings still has a row (ranked 0), and so does one with no active Bevs
-- (total 0), so the app can render a full list without a second call.
--
--   total  = active Bevs in the category. `status = 'active'` explicitly, not
--            just "visible": `bevs_select` also shows the caller's own
--            pending_photo Bevs, which aren't in the catalog yet.
--   ranked = the caller's rankings of active Bevs in the category, so a Bev
--            merged away or pulled from the catalog stops counting on both
--            sides of the fraction and `ranked <= total` always holds.
--
-- Security invoker: RLS on bevs and rankings applies as well, and nothing
-- here needs to see past it.

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
  where not c.is_alcoholic or public.viewer_is_adult()
  order by c.sort_order, c.id;
end;
$$;

alter function public.get_category_progress() owner to postgres;

revoke execute on function public.get_category_progress() from public, anon;
grant execute on function public.get_category_progress() to authenticated;
