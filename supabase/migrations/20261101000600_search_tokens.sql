-- Search finds a Bev by any piece of its words (20261101000600).
--
-- THE BUG. Searching "A&W" returned nothing, although A&W Root Beer, A&W
-- Diet Root Beer and A&W Cream Soda are in the catalog. `search_bevs`
-- (20261012000700) kept a Bev only when `unaccent(search_text) % query` (or an
-- alias `% query`) held, i.e. pg_trgm similarity >= 0.3, the default
-- `pg_trgm.similarity_threshold`.
--
-- WHY PG_TRGM MISSES IT. Similarity is shared trigrams over all trigrams of
-- BOTH strings, and pg_trgm drops every non-alphanumeric character before it
-- builds them. "a&w" is the two one-letter words "a" and "w": four padded
-- trigrams ("  a", " a ", "  w", " w "). "a&w a&w root beer root beer" (the
-- generated search_text of A&W Root Beer: brand, name, flavour) has 14, so
-- the best a query of "a&w" can score is 4/14 = 0.29 and the row is never
-- kept. Any query much shorter than the Bev's text loses the same way, and in
-- a typeahead that is most queries: a brand abbreviation, or a word still
-- being typed ("pep" scores 0.19 against "pepsi pepsi original" and 0.25
-- against its alias "pepsi cola").
-- The FakeApi the app's tests run against has always matched by substring,
-- so every app test passed while the real search failed.
--
-- THE RULE NOW, in both functions:
--   * The query is normalised as lower(unaccent(q)) and split on runs of
--     whitespace into non-empty tokens. Punctuation stays inside a token:
--     "a&w" is ONE token and "barq's" is one, so "a&w" no longer means "an
--     a and a w somewhere", which almost every name has.
--   * The haystack is lower(unaccent(search_text || ' ' || category name ||
--     ' ' || every alias of the Bev, space-joined)), with runs of whitespace
--     collapsed to one space (the FakeApi's `norm`). search_text is already
--     brand + name + flavour.
--   * A Bev is a TOKEN MATCH when every token is a substring of its haystack
--     (strpos, so '%' and '_' in a token are plain characters). Order and
--     position do not matter: "root beer", "beer root", "dr pepper", "diet
--     dr", "pepper", "mountain", "baja", "a&w" all find the obvious Bevs.
--   * This is the FakeApi's rule (app/src/testing/fakeApi/FakeApi.ts,
--     `bevs.search`: `norm` + `tokens`, haystack name + brand + flavor +
--     category name + aliases), whose `tokens` changes in the same PR from a
--     split on [^a-z0-9]+ to the same whitespace split. One difference stays:
--     the FakeApi's `norm` does not unaccent, the SQL does (as before).
--
-- search_bevs: the trigram predicate of 20261012000700 is kept as a TYPO
-- FALLBACK, used only when no visible Bev token-matches the query (after the
-- category filter and the age gate). "pepsii" matches no Bev by substring
-- and still finds Pepsi (0.38 against its alias "pepsi cola").
-- It is a fallback rather than an OR because the two together would put fuzzy
-- strangers into an exact answer: "diet dr" has trigram similarity 0.38 with
-- "pepsi diet pepsi diet", so an OR would list Diet Pepsi under Diet Dr
-- Pepper.
--
-- search_bevs ORDER, for typeahead. The app queries from the first character
-- (debounced 250 ms, previous results kept on screen), so a partial word is
-- the normal query, and one character is a valid one. Three tiers:
--   0. WORD-PREFIX matches: every token starts a whitespace-delimited word of
--      the haystack (strpos(' ' || hay, ' ' || tok) > 0; no LIKE, so nothing
--      to escape). "a&" -> the three A&W Bevs; "dr" -> Dr Pepper and friends.
--   1. SUBSTRING matches: every token is somewhere in the haystack, at least
--      one of them mid-word ("dr" inside "hydro").
--   2. The trigram fallback above (only ever alone in a result).
-- Within tiers 0 and 1: rating_count desc, then relevance (the old
-- greatest(similarity(query, search_text), best alias similarity)) desc, so
-- that among equally rated Bevs "a&w root" puts A&W Root Beer above A&W Diet
-- Root Beer and "coke" puts Coca-Cola Classic (alias "coke") first. Within
-- tier 2 relevance leads, since that tier exists to find the closest
-- spelling. Then name (collate "C") and id, so the order is total. Nothing
-- new is returned: the tier and relevance are only sort keys.
--
-- find_similar_bevs (the create wizard's "Did you mean...?"): fuzzy on
-- purpose, so the token match is added as an alternative (OR) to the `%`
-- predicate, not as a fallback. Its query text is still brand + name + flavour
-- (20261012000700). Typing "A&W Root Beer" with brand "A&W" now offers the
-- catalog's A&W Root Beer even when the trigram score would have fallen short.
-- Order: token matches first, then `sim desc` as before (no word-prefix tier:
-- the wizard sends a whole name, not a word being typed).
--
-- ONE CHARACTER IS A QUERY ("a" lists Bevs with a word starting with "a"
-- first). AN EMPTY OR WHITESPACE-ONLY QUERY RETURNS NO ROWS from search_bevs.
-- It has no tokens, so nothing token-matches, and the fallback's `%` is false
-- for a string with no trigrams; the function also says so outright
-- (`cardinality(toks) > 0`). That is what 20261012000700 effectively did.
-- (The FakeApi still returns everything for q = ''; several app tests list the
-- catalog that way, and the app never sends an empty query.)
--
-- PERFORMANCE. The catalog is ~380 active Bevs and ~480 aliases, so building a
-- haystack per visible Bev and scanning it with strpos is a few hundred short
-- string operations per keystroke-debounced call. The GIN trigram indexes
-- (bevs_search_trgm, bev_aliases_trgm) still serve the `%` predicates. Should
-- the catalog grow by orders of magnitude, a stored haystack column with its
-- own gin_trgm_ops index (pg_trgm accelerates LIKE '%tok%') is the next step.
--
-- Deliberately UNCHANGED, in both functions: the signature (names, types,
-- defaults), the `returns table` column list (names, types, order), `stable
-- security definer set search_path = public, extensions`, visibility
-- (search_bevs: status = 'active'; find_similar_bevs: active, or
-- pending_photo for its creator), the age gate (`not c.is_alcoholic or
-- viewer_is_adult()`), the category filter (exact category_id, as before) and
-- `limit p_limit`. Because nothing in the signature or the returned row type
-- changes, `create or replace` replaces each body in place; the grants are
-- re-stated anyway, as 20261012000700 states them.
-- packages/api (`bevs.search`, `bevs.findLikelyDuplicates`) needs no change.

set search_path = public, extensions;

create or replace function public.search_bevs(
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
  with q as (
    select x.text,
           array(select tok
                   from regexp_split_to_table(x.text, '\s+') as tok
                  where tok <> '') as toks
      from (select lower(unaccent(p_query)) as text) x
  ),
  m as (
    select b.id, b.name, b.brand, b.flavor, b.category_id, b.photo_path, b.thumb_path,
           b.price_tier, b.price_estimated,
           coalesce(s.rating_count, 0) as rating_count,
           s.avg_score,
           s.bayes_score,
           not exists (select 1 from unnest(q.toks) as t(tok)
                        where strpos(' ' || h.hay, ' ' || t.tok) = 0) as word_hit,
           not exists (select 1 from unnest(q.toks) as t(tok)
                        where strpos(h.hay, t.tok) = 0) as tok_hit,
           (unaccent(b.search_text) % q.text
            or exists (select 1 from public.bev_aliases a
                        where a.bev_id = b.id and a.alias % q.text)) as trgm_hit,
           greatest(
             similarity(q.text, unaccent(b.search_text)),
             coalesce((select max(similarity(q.text, a2.alias))
                         from public.bev_aliases a2 where a2.bev_id = b.id), 0)
           ) as sim
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
        select regexp_replace(
                 lower(unaccent(b.search_text || ' ' || c.name || ' ' || coalesce(al.aliases, ''))),
                 '\s+', ' ', 'g') as hay
      ) h
     where b.status = 'active'
       and (p_category_id is null or b.category_id = p_category_id)
       and (not c.is_alcoholic or public.viewer_is_adult())
       and cardinality(q.toks) > 0
  ),
  r as (
    select m.*,
           case when m.word_hit then 0 when m.tok_hit then 1 else 2 end as tier
      from m
     where m.tok_hit
        or (m.trgm_hit and not exists (select 1 from m as m2 where m2.tok_hit))
  )
  select r.id, r.name, r.brand, r.flavor, r.category_id, r.photo_path, r.thumb_path,
         r.price_tier, r.price_estimated, r.rating_count, r.avg_score, r.bayes_score
    from r
   order by r.tier,
            case when r.tier = 2 then r.sim end desc nulls last,
            r.rating_count desc,
            r.sim desc,
            r.name collate "C",
            r.id
   limit p_limit;
$$;
revoke execute on function public.search_bevs(text, text, int) from public, anon;
grant execute on function public.search_bevs(text, text, int) to authenticated;

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
     and (p_category_id is null or b.category_id = p_category_id)
     and (not c.is_alcoholic or public.viewer_is_adult())
     and (tm.tok_hit
          or unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by tm.tok_hit desc, sim desc
   limit p_limit;
$$;
revoke execute on function public.find_similar_bevs(text, text, text, text, int) from public, anon;
grant execute on function public.find_similar_bevs(text, text, text, text, int) to authenticated;
