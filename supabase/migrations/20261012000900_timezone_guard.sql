-- A profile's timezone must be a real IANA zone.
--
-- profiles.timezone is free text that users can write directly (own-row
-- profiles_update policy); packages/api checks it with Intl, but only in the
-- client. Since 20261012000500, effective_streak() evaluates
-- `now() at time zone <timezone>` for EVERY profile inside user_rank_points(),
-- so one user setting 'Not/AZone' made get_user_leaderboard and every user's
-- get_profile_stats fail with 22023 (found in review, reproduced locally).
--
-- Now a trigger rejects an unknown zone on insert or update with
-- BEVI_VALIDATION (detail 'timezone'), and any value already stored that
-- Postgres doesn't recognise is reset to UTC.

set search_path = public, extensions;

create or replace function public.validate_profile_timezone() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when invalid_parameter_value then
  raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'timezone';
end;
$$;

drop trigger if exists validate_profile_timezone on public.profiles;
create trigger validate_profile_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.validate_profile_timezone();

do $$
declare
  r record;
begin
  for r in select id, timezone from public.profiles loop
    begin
      perform now() at time zone r.timezone;
    exception when invalid_parameter_value then
      update public.profiles set timezone = 'UTC' where id = r.id;
    end;
  end loop;
end $$;

-- Consistency with the other helpers (20261012000500 left it executable by
-- anon; it's a pure function, so this is hygiene, not a fix).
revoke execute on function public.effective_streak(integer, date, text) from public, anon;
grant execute on function public.effective_streak(integer, date, text) to authenticated;
