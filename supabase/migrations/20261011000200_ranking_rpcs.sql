-- Ranking write-path RPCs: submit/rerank/remove a ranking, plus the scoring/stats
-- helpers they share. This mirrors the REAL math in packages/ranking/src/*.ts
-- (score.ts, bayesian.ts, stats.ts, constants.ts), not the equal-thirds / guessed
-- Bayesian prior in the stale planning doc (DEVELOPMENT-ARJUN.md). Every formula
-- function below is checked against shared/fixtures/*.vectors.json.
--
-- Depends on `public.assert_rate(action, limit, window)` and `public.viewer_is_adult()`
-- from a parallel ticket. They are called, not redefined, here; if that PR hasn't
-- merged yet on this branch, `submit_ranking` will fail at call time (not at
-- `create function` time, since PL/pgSQL resolves embedded SQL lazily) until it does.

-- `comparisons` (20261009000400_rankings.sql) predates the `tie` flag the
-- placement state machine actually logs (packages/ranking/src/placement.ts
-- RankingComparison.tie). Additive column on a frozen, already-merged migration.
alter table public.comparisons add column tie boolean not null default false;

-- ============================================================================
-- 1. ranking_score — SQL twin of scoreFromPosition() / storedScoreCents() / storedScore()
-- ============================================================================
-- Mirrors packages/ranking/src/score.ts scoreFromPosition(). Verified against shared/fixtures/score-from-position.vectors.json
--
-- Bands (packages/ranking/src/constants.ts BANDS, decided 2026-10-09):
--   DISLIKED (1) [0, 4)   FINE (2) [4, 7)   LOVED (3) [7, 10]
--
-- storedScoreCents, exact integer arithmetic so JS and SQL always agree:
--   D = n + 1
--   N = 100 * (hi*D - (hi - lo) * (index + 1))        -- = 100 * score * D, an integer
--   cents = floor((2N + D) / (2D))                     -- round half up
--   capped at hi*100 for LOVED, hi*100 - 1 for FINE/DISLIKED (they exclude their top edge)
-- storedScore = cents / 100.
--
-- Postgres integer division on non-negative operands truncates toward zero, which
-- is exactly floor() here (every operand is >= 0 by construction), so the SQL
-- below is a literal transliteration of storedScoreCents, not an approximation.
create or replace function public.ranking_score(p_bucket smallint, p_position integer, p_count integer)
returns numeric
language plpgsql
immutable
as $$
declare
  v_lo        integer;
  v_hi        integer;
  v_d         bigint;
  v_num       bigint;
  v_cents     bigint;
  v_max_cents integer;
begin
  if p_count is null or p_count < 1 then
    raise exception 'ranking_score: p_count must be an integer >= 1, got %', p_count;
  end if;
  if p_position is null or p_position < 0 or p_position >= p_count then
    raise exception 'ranking_score: p_position must be an integer in [0, %], got %', p_count - 1, p_position;
  end if;

  if p_bucket = 3 then        -- LOVED [7, 10]
    v_lo := 7; v_hi := 10;
  elsif p_bucket = 2 then     -- FINE [4, 7)
    v_lo := 4; v_hi := 7;
  elsif p_bucket = 1 then     -- DISLIKED [0, 4)
    v_lo := 0; v_hi := 4;
  else
    raise exception 'ranking_score: unknown bucket %, expected 1 (DISLIKED), 2 (FINE) or 3 (LOVED)', p_bucket;
  end if;

  v_d   := p_count + 1;
  v_num := 100 * (v_hi * v_d - (v_hi - v_lo) * (p_position + 1));
  v_cents := (2 * v_num + v_d) / (2 * v_d);
  v_max_cents := case when p_bucket = 3 then v_hi * 100 else v_hi * 100 - 1 end;
  v_cents := least(v_cents, v_max_cents);

  return v_cents / 100.0;
end;
$$;

-- ============================================================================
-- 2. respace_bucket — recompute `score` for a whole bucket from current positions
-- ============================================================================
create or replace function public.respace_bucket(p_uid uuid, p_bucket smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.rankings
  where user_id = p_uid and bucket = p_bucket;

  if v_count = 0 then
    return;
  end if;

  update public.rankings r
  set score = public.ranking_score(p_bucket, r.position, v_count),
      updated_at = now()
  where r.user_id = p_uid and r.bucket = p_bucket;
end;
$$;
alter function public.respace_bucket(uuid, smallint) owner to postgres;

-- ============================================================================
-- 3. refresh_bev_stats — recompute bev_stats from scratch (not incremented)
-- ============================================================================
-- rating_count/sum_score/avg_score/score_stddev per packages/ranking/src/stats.ts:
-- "Every standard deviation is POPULATION (divide by n, SQL stddev_pop): n = 1 gives
-- 0, not NULL." stddev_pop() returns NULL for n = 0, which is correct here too: a
-- Bev with zero remaining rankings gets rating_count = 0 and NULL avg/stddev.
--
-- bayes_score (the leaderboard figure) needs the global/category prior means and is
-- intentionally NOT written here — it is out of this ticket's scope and belongs to
-- the leaderboard refresh job, which has the aggregate stats this function doesn't.
create or replace function public.refresh_bev_stats(p_bev_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_bev_ids is null or array_length(p_bev_ids, 1) is null then
    return;
  end if;

  insert into public.bev_stats (bev_id, rating_count, sum_score, avg_score, score_stddev, last_ranked_at, updated_at)
  select
    ids.bev_id,
    coalesce(agg.rating_count, 0),
    coalesce(agg.sum_score, 0),
    agg.avg_score,
    agg.score_stddev,
    agg.last_ranked_at,
    now()
  from (select distinct bev_id from unnest(p_bev_ids) as u(bev_id)) as ids
  left join (
    select
      bev_id,
      count(*)          as rating_count,
      sum(score)        as sum_score,
      avg(score)        as avg_score,
      stddev_pop(score) as score_stddev,
      max(ranked_at)    as last_ranked_at
    from public.rankings
    where bev_id = any(p_bev_ids)
    group by bev_id
  ) agg on agg.bev_id = ids.bev_id
  on conflict (bev_id) do update set
    rating_count   = excluded.rating_count,
    sum_score      = excluded.sum_score,
    avg_score      = excluded.avg_score,
    score_stddev   = excluded.score_stddev,
    last_ranked_at = excluded.last_ranked_at,
    updated_at     = excluded.updated_at;
end;
$$;
alter function public.refresh_bev_stats(uuid[]) owner to postgres;

-- ============================================================================
-- 4. bayes_score — SQL twin of bayesianAverage()
-- ============================================================================
-- Mirrors packages/ranking/src/bayesian.ts bayesianAverage(). Verified against shared/fixtures/bayesian.vectors.json
-- (C*m + n*mean) / (C + n) = (C*m + sum) / (C + n), since sum = n*mean; with n = 0 this is the prior m.
-- Current tuned constant (packages/ranking/src/constants.ts): BAYES_C = 3.
create or replace function public.bayes_score(p_sum numeric, p_n integer, p_m numeric, p_c numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_n is null or p_n = 0 then p_m
    else (p_c * p_m + p_sum) / (p_c + p_n)
  end;
$$;

-- ============================================================================
-- 5. submit_ranking
-- ============================================================================
create or replace function public.submit_ranking(
  p_bev_id       uuid,
  p_bucket       smallint,
  p_insert_index integer,
  p_comparisons  jsonb default '[]'::jsonb,
  p_note         text default null,
  p_photo_path   text default null
)
returns public.rankings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_category_id  text;
  v_is_alcoholic boolean;
  v_count        integer;
  v_row          public.rankings;
  v_submission   uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  -- Per-user mutex: serialises all ranking writes for this user within this transaction.
  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  perform public.assert_rate('submit_ranking', 60, interval '1 hour');

  select b.category_id, c.is_alcoholic
    into v_category_id, v_is_alcoholic
  from public.bevs b
  join public.categories c on c.id = b.category_id
  where b.id = p_bev_id;

  if v_category_id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  if exists (select 1 from public.rankings where user_id = v_uid and bev_id = p_bev_id) then
    raise exception 'BEVI_ALREADY_RANKED' using errcode = '23505';
  end if;

  select count(*) into v_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if p_insert_index < 0 or p_insert_index > v_count then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023';
  end if;

  -- Shift everything at/after the insert point down one slot. Safe only because
  -- (user_id, bucket, position) is `deferrable initially deferred` (20261009000400_rankings.sql).
  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, p_note, p_photo_path)
  returning * into v_row;

  -- Real scores for the whole bucket (the placeholder 0 above is only a slot-holder).
  perform public.respace_bucket(v_uid, p_bucket);

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winner')::uuid, (c ->> 'loser')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  -- Respacing just changed every score in the bucket, so every Bev in it needs fresh stats.
  perform public.refresh_bev_stats(
    array(select bev_id from public.rankings where user_id = v_uid and bucket = p_bucket)
  );

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'ranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return v_row;
end;
$$;
alter function public.submit_ranking(uuid, smallint, integer, jsonb, text, text) owner to postgres;

-- ============================================================================
-- 6. rerank_bev
-- ============================================================================
create or replace function public.rerank_bev(
  p_bev_id       uuid,
  p_bucket       smallint,
  p_insert_index integer,
  p_comparisons  jsonb default '[]'::jsonb
)
returns public.rankings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.rankings;
  v_new_count  integer;
  v_row        public.rankings;
  v_submission uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Remove from the old slot and close the gap in the old bucket.
  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  -- Count in the target bucket AFTER the removal above (correct even when
  -- p_bucket = v_old.bucket, since that bucket's gap was just closed).
  select count(*) into v_new_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if p_insert_index < 0 or p_insert_index > v_new_count then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023';
  end if;

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  -- note/photo_path carry over: this RPC repositions a ranking, it doesn't edit it.
  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, v_old.note, v_old.photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, v_old.bucket);
  if p_bucket <> v_old.bucket then
    perform public.respace_bucket(v_uid, p_bucket);
  end if;

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winner')::uuid, (c ->> 'loser')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(
      select distinct bev_id from public.rankings
      where user_id = v_uid and bucket in (v_old.bucket, p_bucket)
    )
  );

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'reranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return v_row;
end;
$$;
alter function public.rerank_bev(uuid, smallint, integer, jsonb) owner to postgres;

-- ============================================================================
-- 7. remove_ranking
-- ============================================================================
create or replace function public.remove_ranking(p_bev_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     public.rankings;
  v_bev_ids uuid[];
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  perform public.respace_bucket(v_uid, v_old.bucket);

  select coalesce(array_agg(bev_id), array[]::uuid[]) into v_bev_ids
  from public.rankings
  where user_id = v_uid and bucket = v_old.bucket;

  -- Refresh every Bev still in the bucket (respacing just changed their scores)
  -- plus the removed Bev itself (its stats must drop by this one rating).
  perform public.refresh_bev_stats(v_bev_ids || v_old.bev_id);
end;
$$;
alter function public.remove_ranking(uuid) owner to postgres;

-- ============================================================================
-- Grants
-- ============================================================================
revoke execute on function
  public.submit_ranking(uuid, smallint, integer, jsonb, text, text),
  public.rerank_bev(uuid, smallint, integer, jsonb),
  public.remove_ranking(uuid),
  public.ranking_score(smallint, integer, integer),
  public.respace_bucket(uuid, smallint),
  public.refresh_bev_stats(uuid[]),
  public.bayes_score(numeric, integer, numeric, numeric)
from public, anon;

grant execute on function
  public.submit_ranking(uuid, smallint, integer, jsonb, text, text),
  public.rerank_bev(uuid, smallint, integer, jsonb),
  public.remove_ranking(uuid)
to authenticated;
