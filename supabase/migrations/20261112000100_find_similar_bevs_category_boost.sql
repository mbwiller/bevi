-- find_similar_bevs (the create wizard's "Did you mean...?"): the category the
-- creator picked RANKS same-category matches first; it no longer FILTERS.
--
-- Why. Since 20261011000300 the function carried
--   and (p_category_id is null or b.category_id = p_category_id)
-- so the category was a hard filter. Found 2026-11-09: a Red Bull flavour was
-- created with the category set to Sports Drinks by mistake. The duplicate
-- check only looked inside `sports`, every catalog Red Bull sits in `energy`,
-- so nothing was offered and a miscategorised duplicate was created. Probed
-- against prod with the same inputs: category 'sports' -> only the new row;
-- 'energy' -> Red Bull Original Energy Drink; null -> both. A wrong category is
-- exactly the mistake a duplicate check should survive, so the category may
-- only reorder what the name, brand and flavour already matched.
--
-- What changed, and nothing else:
--   * the category predicate above is gone;
--   * ORDER BY is now
--       tm.tok_hit desc, (b.category_id = p_category_id) is true desc, sim desc
--     Token hits stay the primary key, so a fuzzy trigram-only row in the
--     chosen category never outranks a real token match from another one
--     (20261102000200 explains the token match); inside each tier the chosen
--     category comes first, then similarity as before. `is true` makes the key
--     null-safe: with p_category_id null it is false for every row, so the
--     order is exactly 20261102000200's `tm.tok_hit desc, sim desc`.
--
-- The in-memory FakeApi (app/src/testing/fakeApi/FakeApi.ts,
-- findLikelyDuplicates) already behaves this way: the category is a small score
-- boost and never a filter. This brings the SQL back in line with the test
-- double the app's tests run against.
--
-- Deliberately UNCHANGED (copied verbatim from 20261102000200): the signature
-- (names, types, defaults), the `returns table` column list (names, types,
-- order), `stable security definer set search_path = public, extensions`, the
-- visibility rule (active, or pending_photo for its creator), the age gate
-- (`not c.is_alcoholic or viewer_is_adult()`, which still applies to every
-- category now reachable), the token / trigram / alias match and
-- `limit p_limit`. Because the signature and row type are unchanged,
-- `create or replace` swaps the body in place; the grants are re-stated
-- anyway, as 20261102000200 states them. search_bevs keeps its category
-- filter: there the category is a browse scope the user chose on purpose.
-- packages/api (`bevs.findLikelyDuplicates`) forwards p_category_id as before
-- and needs no change.

set search_path = public, extensions;

create or replace function public.find_similar_bevs(
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
  bayes_score     numeric(4,2)
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
         coalesce(s.rating_count, 0), s.bayes_score
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
revoke execute on function public.find_similar_bevs(text, text, text, text, int) from public, anon;
grant execute on function public.find_similar_bevs(text, text, text, text, int) to authenticated;
