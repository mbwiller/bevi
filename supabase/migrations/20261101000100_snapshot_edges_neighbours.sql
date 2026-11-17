-- S-21 + Stage 4 (20261101000100): the prediction snapshot carries the stored
-- Bev-graph edges and the viewer's stored taste neighbours.
--
-- One revision of `get_prediction_snapshot()` (20261012000600), same signature,
-- same `stable security definer`, same search_path, and every existing key
-- byte-for-byte as before. It gains two keys, both of which @bevi/ranking
-- already knows how to read and both of which are OFF by default there:
--
--   * S-21, `edges` (package side: #137, M-27 (a), `bevSimilarity: 'edges'`).
--     Layer 1 can weigh a Bev pair by its stored `bev_edges.weight` instead of
--     the computed content similarity, but only if the snapshot hands it the
--     edges. Stage 2 of docs/graph_db_implementation.md filled `bev_edges`
--     (4669 rows on prod); this is the read side.
--   * Stage 4, `userNeighbors` (package side: #144, `RANKING_VERSION` 1.6.0,
--     `userSimilarity: 'stored'`). Layer 2 can weigh a neighbour by the stored
--     blended similarity sim_B from `user_neighbors` (A-16 (2), 20261026000300)
--     times the reliability min(1, n_v / NEIGHBOUR_RELIABILITY_N), instead of
--     the in-snapshot cosine. Same story: the nightly job writes the table;
--     this is the only reader.
--
-- THE CONTRACT, fixed on the package side by #137 and #144 (PredictionSnapshot
-- in packages/ranking/src/types.ts), so nothing below is a choice made here:
--
--   edges          [[src, dst, w], ...]
--                  Every `bev_edges` row with AT LEAST ONE endpoint among the
--                  caller's ranked Bevs and BOTH endpoints in `visible`. All
--                  stored rows, not a top-k: the package treats a pair absent
--                  from a present array as weight 0, so trimming here would
--                  silently zero real edges. `w` is the `weight` column.
--                  Ordered (src_bev_id, dst_bev_id) so the payload is
--                  deterministic. `[]`, never null.
--   userNeighbors  [[alias, sim, common], ...]
--                  The VIEWER's rows only (`user_id = auth.uid()`), with
--                  `neighbor_id` joined to the same `aliases` CTE that `users`,
--                  `categoryStats` and `rankings` use, so a neighbour is the
--                  same `u<n>` everywhere in one payload. Ordered
--                  `sim desc, neighbor_id` (the order of
--                  user_neighbors_user_sim_idx and of `topUserNeighbours`'
--                  tie-break). `[]`, never null.
--
-- packages/api/src/snapshot.ts maps `edges` to `snapshot.edges` and
-- `userNeighbors` to `snapshot.userNeighbours = { [viewer]: [...] }`, each only
-- when its key is present. An older payload without the keys therefore maps
-- to a snapshot without the fields, which the package treats exactly like
-- today ("a missing field behaves exactly like today").
--
-- NAMING. The RPC key is `userNeighbors` (American, matching the table and the
-- doc's §5); the package field is `userNeighbours` (British, matching the rest
-- of @bevi/ranking). The comment in 20261026000300 (lines 19-20) says Stage 4
-- is "`layer2()` reading `snapshot.userNeighbors`"; as built, `layer2()` reads
-- the package field `snapshot.userNeighbours`, and `userNeighbors` is only this
-- RPC's key. That file is frozen (append-only migrations), so the correction
-- lives here.
--
-- WHY BOTH EDGE ENDPOINTS MUST BE VISIBLE. An edge is a statement about two
-- Bevs. `visible` is this function's own gate (status 'active', alcoholic Bevs
-- only for 21+), and bev_edges' RLS (20261019000500) mirrors both halves of
-- bevs_select for exactly this reason: a row joining a ranked Bev to a hidden
-- or age-gated one would tell the caller that Bev's id, and how much it
-- resembles something they drank. A row whose OTHER endpoint is hidden is
-- dropped; so is a row whose RANKED endpoint is hidden (the caller's ranking
-- survives moderation in `ranked`, but `rankings` already drops it, and so
-- does this). For the package this is harmless: Layer 1 only ever scores Bevs
-- that are in `bevs`, which is `visible`.
--
-- WHY NO `version` FILTER ON user_neighbors. `user_neighbors.version` is the
-- RANKING_VERSION of the run that wrote the row. sim_B's formula has not
-- changed since 1.3.0 (M-28, #131), and every RANKING_VERSION bump since
-- (1.4.0, 1.5.0, 1.6.0) touched other formulas. Filtering on the consuming
-- bundle's version would therefore empty stored mode after every bump until
-- the next nightly run re-stamps the rows, for no change in the numbers. The
-- column stays what 20261026000300 made it: a staleness diagnostic
-- (`select distinct version from user_neighbors`), not a read filter. The same
-- holds for `bev_edges.version`, which is not filtered either.
--
-- WHY A RANKINGLESS NEIGHBOUR DISAPPEARS. `aliases` is built from `raters`,
-- i.e. every user with at least one row in `rankings`, plus the viewer. A
-- neighbour with no rankings left (they removed them all after the nightly
-- run) has no alias, so the inner join drops their row. That is the package's
-- rule, not a loss: a neighbour counts only if their rankings are in
-- `rankings`, because Layer 2 predicts from the neighbour's z-scores and a
-- neighbour with none contributes nothing. It is also the privacy guarantee:
-- the only way a neighbour can appear is through an alias, so no neighbour's
-- uuid can reach the client from this key. If `rankings` or `users` is ever
-- trimmed (top-k raters, a page of the catalogue), keep the viewer's
-- neighbours in both, or stored mode quietly loses them.
--
-- WHAT DOES NOT CHANGE. Every existing key, its shape and its semantics; the
-- signature; the grants. No table, policy or index. Nothing in the nightly
-- jobs (`graph:edges`, `graph:neighbours`): they write the tables this reads.
-- `user_neighbors` still has no client policy (20261026000300 section 2): this
-- definer function is still its only reader, and it still emits aliases only.

set search_path = public, extensions;

create or replace function public.get_prediction_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_adult boolean;
  v_tz    text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  select timezone into v_tz from public.profiles where id = v_uid;
  v_adult := public.viewer_is_adult();

  return (
    with ranked as (
      select r.user_id, r.bev_id, r.score::float8 as score, b.category_id, c.is_alcoholic
        from public.rankings r
        join public.bevs b on b.id = r.bev_id
        join public.categories c on c.id = b.category_id
    ),
    raters as (
      select distinct user_id from ranked
      union
      select v_uid
    ),
    aliases as (
      select user_id,
             case when user_id = v_uid then user_id::text
                  else 'u' || row_number() over (order by user_id) end as alias
        from raters
    ),
    visible as (
      select b.id, b.name, b.brand, b.flavor, b.category_id, b.price_tier, b.price_estimated,
             coalesce(b.thumb_path, b.photo_path) as photo_path, c.is_alcoholic,
             coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score
        from public.bevs b
        join public.categories c on c.id = b.category_id
        left join public.bev_stats s on s.bev_id = b.id
       where b.status = 'active'
         and (v_adult or not c.is_alcoholic)
    )
    select jsonb_build_object(
      'generatedAt', now(),
      'viewer', jsonb_build_object(
        'id', v_uid,
        'timezone', v_tz,
        'canSeeAlcohol', v_adult,
        'rankingCount', (select count(*) from ranked where user_id = v_uid)
      ),
      'global', jsonb_build_object(
        'n', (select count(*) from ranked),
        'mean', (select avg(score) from ranked),
        'stddev', (select stddev_pop(score) from ranked),
        'byCategoryMean', coalesce((
          select jsonb_object_agg(category_id, m)
            from (select category_id, avg(score) as m from ranked
                   where v_adult or not is_alcoholic group by category_id) x
        ), '{}'::jsonb)
      ),
      'users', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.n, x.mean, x.sd))
          from (select user_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked group by user_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'categoryStats', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, x.category_id, x.n, x.mean, x.sd))
          from (select user_id, category_id, count(*) as n, avg(score) as mean, stddev_pop(score) as sd
                  from ranked where v_adult or not is_alcoholic group by user_id, category_id) x
          join aliases a on a.user_id = x.user_id
      ), '[]'::jsonb),
      'bevs', coalesce((
        select jsonb_agg(jsonb_build_array(
                 id, name, brand, flavor, category_id, price_tier, price_estimated, photo_path,
                 is_alcoholic, rating_count, avg_score, score_stddev, bayes_score))
          from visible
      ), '[]'::jsonb),
      'rankings', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, r.bev_id, r.score))
          from ranked r
          join aliases a on a.user_id = r.user_id
         where exists (select 1 from visible v where v.id = r.bev_id)
      ), '[]'::jsonb),
      -- S-21: every stored edge touching a Bev the caller ranked, both ends
      -- visible, all rows, in a fixed order.
      'edges', coalesce((
        select jsonb_agg(jsonb_build_array(e.src_bev_id, e.dst_bev_id, e.weight)
                         order by e.src_bev_id, e.dst_bev_id)
          from public.bev_edges e
         where (e.src_bev_id in (select bev_id from ranked where user_id = v_uid)
                or e.dst_bev_id in (select bev_id from ranked where user_id = v_uid))
           and exists (select 1 from visible v where v.id = e.src_bev_id)
           and exists (select 1 from visible v where v.id = e.dst_bev_id)
      ), '[]'::jsonb),
      -- Stage 4: the viewer's stored taste neighbours, aliased exactly as in
      -- `users` and `rankings`; no version filter (see the header).
      'userNeighbors', coalesce((
        select jsonb_agg(jsonb_build_array(a.alias, n.sim, n.common)
                         order by n.sim desc, n.neighbor_id)
          from public.user_neighbors n
          join aliases a on a.user_id = n.neighbor_id
         where n.user_id = v_uid
      ), '[]'::jsonb)
    )
  );
end;
$$;

alter function public.get_prediction_snapshot() owner to postgres;
revoke execute on function public.get_prediction_snapshot() from public, anon;
grant execute on function public.get_prediction_snapshot() to authenticated;
