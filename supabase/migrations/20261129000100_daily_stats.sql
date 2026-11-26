-- Bevi Daily charts: public.daily_stats(p_token text, p_days int), daily
-- aggregate counts for the founders' morning email.
--
-- WHAT THIS FILE ADDS
--
--   public.daily_stats(text, int)   RPC: per-day counts for the last p_days
--                                   days (America/New_York calendar days)
--
-- Additive only: one new function, nothing existing is changed.
--
-- WHAT IT RETURNS. Counts only: no names, handles, ids, posts or Bevs.
--   { "as_of": "2026-11-27", "tz": "America/New_York",
--     "totals": { "users": 4, "ranked": 42 },
--     "days": [ { "date": "2026-11-26", "new_users": 0, "total_users": 4,
--                 "new_ranked": 3, "reranks": 1, "ranked_events_total": 45 }, ... ] }
--   * users: every row in public.profiles (testers and admins included).
--   * totals.ranked: rows in public.rankings now, the same count graph-sync
--     logs as RANKED.
--   * new_ranked: ranking_events of kind 'submit' or 'backfill' that day.
--     reranks: kind 'rerank'. ranked_events_total is the running sum of
--     new_ranked, so it can run above totals.ranked once rankings are removed.
--
-- WHO CAN CALL IT. Anyone holding the export token. The caller (an Apps Script
-- in the Bevi admin Google account, see bevi-daily/stats-pipeline/README.md)
-- authenticates with the PUBLISHABLE key, as the keepalive does (40_ping), so
-- `anon` gets EXECUTE; the token is what actually guards it. The token lives in
-- Vault as `bevi_stats_token` (set once in the SQL editor, never in the repo),
-- read the way 20261031000100 reads its config: a definer, because
-- vault.decrypted_secrets is readable by the owner only. No token in Vault, or
-- a wrong token, raises 'not allowed' and returns nothing.

create or replace function public.daily_stats(p_token text, p_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_days  int := least(greatest(coalesce(p_days, 90), 1), 400);
  v_today date := (now() at time zone 'America/New_York')::date;
  v_first date := v_today - (v_days - 1);
  v_result jsonb;
begin
  begin
    select nullif(s.decrypted_secret, '') into v_token
      from vault.decrypted_secrets s where s.name = 'bevi_stats_token';
  exception when others then
    v_token := null;
  end;

  if v_token is null or p_token is null or p_token <> v_token then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with days as (
    select d::date as day
      from generate_series(v_first, v_today, interval '1 day') as d
  ),
  users_per_day as (
    select (p.created_at at time zone 'America/New_York')::date as day, count(*) as n
      from public.profiles p
     group by 1
  ),
  events_per_day as (
    select (e.created_at at time zone 'America/New_York')::date as day,
           count(*) filter (where e.kind in ('submit', 'backfill')) as ranked,
           count(*) filter (where e.kind = 'rerank')                as reranks
      from public.ranking_events e
     group by 1
  ),
  users_before as (
    select count(*) as n from public.profiles p
     where (p.created_at at time zone 'America/New_York')::date < v_first
  ),
  ranked_before as (
    select count(*) as n from public.ranking_events e
     where e.kind in ('submit', 'backfill')
       and (e.created_at at time zone 'America/New_York')::date < v_first
  ),
  series as (
    select d.day,
           coalesce(u.n, 0)        as new_users,
           coalesce(ev.ranked, 0)  as new_ranked,
           coalesce(ev.reranks, 0) as reranks,
           (select n from users_before)
             + sum(coalesce(u.n, 0)) over (order by d.day)      as total_users,
           (select n from ranked_before)
             + sum(coalesce(ev.ranked, 0)) over (order by d.day) as ranked_events_total
      from days d
      left join users_per_day  u  on u.day  = d.day
      left join events_per_day ev on ev.day = d.day
  )
  select jsonb_build_object(
           'as_of',  to_char(v_today, 'YYYY-MM-DD'),
           'tz',     'America/New_York',
           'totals', jsonb_build_object(
                       'users',  (select count(*) from public.profiles),
                       'ranked', (select count(*) from public.rankings)),
           'days',   coalesce(jsonb_agg(jsonb_build_object(
                       'date',                to_char(s.day, 'YYYY-MM-DD'),
                       'new_users',           s.new_users,
                       'total_users',         s.total_users,
                       'new_ranked',          s.new_ranked,
                       'reranks',             s.reranks,
                       'ranked_events_total', s.ranked_events_total)
                       order by s.day), '[]'::jsonb))
    into v_result
    from series s;

  return v_result;
end;
$$;

revoke all on function public.daily_stats(text, int) from public;
grant execute on function public.daily_stats(text, int) to anon, authenticated, service_role;

comment on function public.daily_stats(text, int) is
  'Bevi Daily charts: per-day aggregate user and ranking counts, guarded by the Vault secret bevi_stats_token. Counts only.';
