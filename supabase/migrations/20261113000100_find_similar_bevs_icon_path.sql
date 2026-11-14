-- find_similar_bevs returns the Bev's icon path (20261113000100): the last
-- read that 20261112000300 left without one.
--
-- WHAT. find_similar_bevs (the create wizard's "Did you mean...?",
-- `bevs.findLikelyDuplicates`) gains `icon_path text` as the LAST column of
-- its `returns table`, read exactly as 20261112000300 reads it everywhere
-- else:
--     (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
-- null when the Bev has no bev_icons row. packages/api already threads the
-- column (`FindSimilarRpcRow.icon_path`) into `BevSummary.iconUrl`, so the
-- contract does not move: it stays 2.13.0.
--
-- WHY A SEPARATE FILE. 20261112000300 left this function out on purpose:
-- 20261112000100 (the category boost) was an open PR that re-creates it, and
-- two migrations re-creating one function from two different copies is how a
-- body gets silently reverted. This one is written on top of 20261112000100.
--
-- WHY IT MATTERS. Once the app stops shipping its bundled icons, the
-- duplicate check is the one list that would draw category art for a Bev that
-- has an authored icon. The retirement of the bundled icons waits on this.
--
-- VERBATIM from 20261112000100 except three things: the new column, its
-- select expression, and `drop` + `create` in place of `create or replace`
-- (a `returns table` cannot be changed by `create or replace`). The signature,
-- the first eleven columns and their order, `stable security definer set
-- search_path = public, extensions`, the visibility rule, the age gate, the
-- token / trigram / alias match, the ORDER BY and the limit are unchanged.
--
-- The function is security definer owned by postgres, so bev_icons' RLS does
-- not apply inside it; which Bevs a caller sees is decided, as before, by the
-- function's own Bev filter, and the icon adds no row.
--
-- A drop loses the owner and the grants, so they are restated: the revoke and
-- grant of 20261112000100, and `owner to postgres` (no migration ever stated
-- an owner for this function; postgres is the role every migration runs as,
-- so it is the owner it already has). It has no comment to restore.

set search_path = public, extensions;

drop function if exists public.find_similar_bevs(text, text, text, text, int);

create function public.find_similar_bevs(
  p_name text,
  p_brand text default null,
  p_category_id text default null,
  p_flavor text default null,
  p_limit int default 5
)
returns table (
  bev_id          uuid,
  name            text,
  brand           text,
  flavor          text,
  thumb_path      text,
  similarity      real,
  category_id     text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  bayes_score     numeric(4,2),
  icon_path       text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select x.text,
           array(select tok
                   from regexp_split_to_table(x.text, '\s+') as tok
                  where tok <> '') as toks
      from (select lower(unaccent(coalesce(p_brand, '') || ' ' || p_name || ' ' || coalesce(p_flavor, ''))) as text) x
  )
  select b.id, b.name, b.brand, b.flavor, coalesce(b.thumb_path, b.photo_path),
         greatest(
           similarity(q.text, unaccent(b.search_text)),
           coalesce((select max(similarity(q.text, a.alias))
                       from public.bev_aliases a where a.bev_id = b.id), 0)
         )::real as sim,
         b.category_id, b.price_tier, b.price_estimated,
         coalesce(s.rating_count, 0), s.bayes_score,
         (select bi.path from public.bev_icons bi where bi.bev_id = b.id)
    from public.bevs b
    cross join q
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
    cross join lateral (
      select string_agg(a3.alias, ' ') as aliases
        from public.bev_aliases a3
       where a3.bev_id = b.id
    ) al
    cross join lateral (
      select cardinality(q.toks) > 0
             and not exists (select 1 from unnest(q.toks) as t(tok)
                              where strpos(lower(unaccent(b.search_text || ' ' || c.name || ' ' || coalesce(al.aliases, ''))),
                                           t.tok) = 0) as tok_hit
    ) tm
   where (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = auth.uid()))
     and (not c.is_alcoholic or public.viewer_is_adult())
     and (tm.tok_hit
          or unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by tm.tok_hit desc, (b.category_id = p_category_id) is true desc, sim desc
   limit p_limit;
$$;

alter function public.find_similar_bevs(text, text, text, text, int) owner to postgres;
revoke execute on function public.find_similar_bevs(text, text, text, text, int) from public, anon;
grant execute on function public.find_similar_bevs(text, text, text, text, int) to authenticated;
