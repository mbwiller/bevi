-- Birth dates are readable only by their owner.
--
-- profiles_select (20261011000100) lets every signed-in user read every
-- profile row, birth_date included: profiles_view masks it, but anyone could
-- `select birth_date from profiles` directly. Fix with column privileges:
--
--   * authenticated may select every profiles column except birth_date;
--     anon gets nothing (it never had a select policy).
--   * profiles_view now runs with its owner's rights (security_invoker =
--     false), so it can still read birth_date to mask it (the caller's own
--     row only) and to derive can_see_alcohol. Because it no longer runs as
--     the caller, it is select-only and authenticated-only: an updatable view
--     with owner rights would let anyone rewrite other users' profiles.
--   * can_see_alcohol is the caller's own flag; for anyone else it is false,
--     so the view doesn't leak whether another user is over 21.
--
-- Security-definer RPCs (set_birth_date, viewer_is_adult, handle_new_user...)
-- run as the owner and are unaffected. A column added to profiles later
-- needs its own `grant select (<col>) ... to authenticated`.

set search_path = public, extensions;

revoke select on public.profiles from anon, authenticated;
grant select (
  id, handle, display_name, avatar_path, age_attested_at, timezone, role,
  bevi_rank, handle_changed_at, onboarded, created_at, updated_at
) on public.profiles to authenticated;

create or replace view public.profiles_view
  with (security_invoker = false) as
select
  id, handle, display_name, avatar_path,
  case when id = auth.uid() then birth_date else null end as birth_date,
  age_attested_at, timezone, role, bevi_rank, handle_changed_at, onboarded,
  created_at, updated_at,
  case
    when id = auth.uid() then coalesce(birth_date <= (current_date - interval '21 years')::date, false)
    else false
  end as can_see_alcohol
from public.profiles;

revoke all on public.profiles_view from public, anon, authenticated;
grant select on public.profiles_view to authenticated;
