-- Recommendations and predicted scores, computed by the client.
--
-- recs.getRecommendations and Bev.prediction had no backend: no Edge
-- Function, no writer for user_bev_predictions. At Bevi's size (under ~200
-- users) the cheapest correct option is to hand the caller everything
-- @bevi/ranking's predictScore()/recommend() read, as one PredictionSnapshot-
-- shaped jsonb value (one value, so PostgREST's row cap can't truncate it),
-- and run the same pure functions packages/api already bundles. Revisit
-- (an Edge Function, or materialising user_bev_predictions) when the payload
-- or the user count grows.
--
-- What it contains, and what it deliberately doesn't:
--   * viewer: the caller's id, timezone, can_see_alcohol, ranking count.
--   * global: n/mean/stddev_pop over every stored score, and per-category
--     means.
--   * users / categoryStats: per-user n/mean/stddev_pop over ALL of that
--     user's scores (so z-scores are exact), and per user per category.
--     Everyone but the caller is a pseudonym ('u<n>'); no handles, no
--     birth dates, no other user's can_see_alcohol.
--   * bevs: every active Bev the caller may see (alcoholic ones only for
--     21+), with the fields a recommendation card shows.
--   * rankings: (user pseudonym, bev, score) for those Bevs.
-- Rankings are already visible to signed-in users (rankings_select), so
-- nothing here is newly exposed.

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
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.get_prediction_snapshot() from public, anon;
grant execute on function public.get_prediction_snapshot() to authenticated;
