-- Bevi offline-evaluation export (eval/README.md, formatVersion 1). Prints ONE jsonb value.
--
--   psql "$DATABASE_URL" -At -v salt="$SALT" -f packages/ranking/eval/export.sql > export.json
--
-- Run as a database role that bypasses RLS (e.g. postgres). Pass the salt with -v (not \set) so
-- it stays out of psql history; without it the query fails with a syntax error rather than
-- exporting unsalted. Keep export.json outside the repo.
--
-- Re-identification guards: user ids become salted aliases ('u<n>'), submission ids are salted
-- hashes, and every timestamp is truncated to the hour (UTC) so rows cannot be joined to the
-- visible feed_events.created_at. Arrays are ordered so that hour-level ties keep their true
-- order: rankings by exact ranked_at then id, comparisons by id (insertion order); the harness
-- relies on that order to break ties.

with ids as (
  select user_id from public.rankings
  union
  select user_id from public.comparisons
),
alias as (
  select user_id, 'u' || row_number() over (order by md5(user_id::text || :'salt')) as a
    from ids
)
select jsonb_build_object(
  'format', 'bevi-eval-export',
  'formatVersion', 1,
  'exportedAt', date_trunc('hour', now(), 'UTC'),
  'bevs', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'brand', b.brand, 'flavor', b.flavor,
             'categoryId', b.category_id, 'priceTier', b.price_tier, 'isAlcoholic', c.is_alcoholic)
             order by b.id), '[]'::jsonb)
      from public.bevs b
      join public.categories c on c.id = b.category_id
     where b.status = 'active'
        or exists (select 1 from public.rankings r where r.bev_id = b.id)
  ),
  'rankings', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', a.a, 'bevId', r.bev_id, 'bucket', r.bucket, 'position', r.position,
             'score', r.score, 'rankedAt', date_trunc('hour', r.ranked_at, 'UTC'))
             order by r.ranked_at, r.id), '[]'::jsonb)
      from public.rankings r
      join alias a using (user_id)
  ),
  'comparisons', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'userId', a.a, 'submissionId', md5(c.submission_id::text || :'salt'),
             'winnerBevId', c.winner_bev_id, 'loserBevId', c.loser_bev_id, 'tie', c.tie,
             'createdAt', date_trunc('hour', c.created_at, 'UTC'))
             order by c.id), '[]'::jsonb)
      from public.comparisons c
      join alias a using (user_id)
  )
);
