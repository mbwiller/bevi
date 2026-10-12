-- Search results, duplicate suggestions and featured cards carry real card
-- data.
--
-- packages/api had to fill BevSummary fields these RPCs didn't return with
-- placeholders: no Bevi score in search results, and on the "Did you
-- mean...?" duplicate list and the Featured carousel a $ price tier, no rating
-- count, and category 'other'. Each now returns the full card (price tier,
-- price_estimated, rating_count, bayes_score, and photo = thumb, falling back
-- to the full photo).
--
-- find_similar_bevs also: hides alcoholic Bevs from under-21 callers (it
-- ignored the age gate), and shows a 'pending_photo' Bev only to its creator
-- (it showed everyone's).
--
-- The return types change, so each function is dropped and recreated, and its
-- grants are set again (a new function is executable by PUBLIC by default).

set search_path = public, extensions;

drop function if exists public.search_bevs(text, text, int);
create function public.search_bevs(
  p_query text,
  p_category_id text default null,
  p_limit int default 20
)
returns table (
  id              uuid,
  name            text,
  brand           text,
  flavor          text,
  category_id     text,
  photo_path      text,
  thumb_path      text,
  price_tier      smallint,
  price_estimated boolean,
  rating_count    integer,
  avg_score       numeric(4,2),
  bayes_score     numeric(4,2)
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(unaccent(p_query)) as text)
  select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
         b.price_tier, b.price_estimated,
         coalesce(s.rating_count, 0) as rating_count,
         s.avg_score,
         s.bayes_score
    from public.bevs b
    cross join q
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where b.status = 'active'
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by greatest(
              similarity(q.text, unaccent(b.search_text)),
              coalesce((select max(similarity(q.text, a2.alias))
                          from public.bev_aliases a2 where a2.bev_id = b.id), 0)
            ) desc,
            coalesce(s.rating_count, 0) desc
   limit p_limit;
$$;
revoke execute on function public.search_bevs(text, text, int) from public, anon;
grant execute on function public.search_bevs(text, text, int) to authenticated;

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
  bayes_score     numeric(4,2)
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(unaccent(coalesce(p_brand, '') || ' ' || p_name || ' ' || coalesce(p_flavor, ''))) as text)
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
   where (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = auth.uid()))
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by sim desc
   limit p_limit;
$$;
revoke execute on function public.find_similar_bevs(text, text, text, text, int) from public, anon;
grant execute on function public.find_similar_bevs(text, text, text, text, int) to authenticated;

drop function if exists public.get_featured();
create function public.get_featured()
returns table (
  id                   uuid,
  title                text,
  blurb                text,
  image_path           text,
  sort_order           smallint,
  starts_at            timestamptz,
  ends_at              timestamptz,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_rating_count     integer,
  bev_bayes_score      numeric(4,2)
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select f.id, f.title, f.blurb, f.image_path, f.sort_order, f.starts_at, f.ends_at,
         b.id, b.name, b.brand, b.flavor, b.category_id, coalesce(b.thumb_path, b.photo_path),
         b.price_tier, b.price_estimated, coalesce(s.rating_count, 0), s.bayes_score
    from public.featured_bevs f
    join public.bevs b on b.id = f.bev_id
    join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
   where now() between f.starts_at and coalesce(f.ends_at, 'infinity'::timestamptz)
     and b.status = 'active'
     and (not c.is_alcoholic or public.viewer_is_adult())
   order by f.sort_order, f.starts_at desc;
$$;
revoke execute on function public.get_featured() from public, anon;
grant execute on function public.get_featured() to authenticated;
