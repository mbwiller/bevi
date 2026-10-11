-- packages/api gap: every `Profile` (including another user's, via
-- `ProfileRow`/`FeedItem.actor`) needs `canSeeAlcohol`, but profiles_view
-- (20261011000400) masks birth_date to null for everyone but the caller --
-- so a boolean computed client-side from the row's birth_date is always
-- wrong for other users. Compute it here from the real, unmasked birth_date
-- (the view can see it even while hiding it), same threshold as
-- viewer_is_adult().
--
-- `create or replace view` can only append new columns at the end of the
-- select list -- inserting one earlier reads as renaming whatever column
-- used to be at that position (42P16). `can_see_alcohol` goes last.
create or replace view public.profiles_view
  with (security_invoker = true) as
select
  id, handle, display_name, avatar_path,
  case when id = auth.uid() then birth_date else null end as birth_date,
  age_attested_at, timezone, role, bevi_rank, handle_changed_at, onboarded,
  created_at, updated_at,
  coalesce(birth_date <= (current_date - interval '21 years')::date, false) as can_see_alcohol
from public.profiles;
