-- can_rank_bugs(): who may rank their bug tickets against each other.
--
-- WHY A SECOND GATE. Until now every internal reporter (`admin` or `tester`,
-- is_internal_reporter() in 20261109000300_bug_reports.sql) could do all of it:
-- file, read back their own tickets, close one once it is in review, and rank
-- their open tickets with "which is worse?". Ranking is not like the others.
-- It writes the ticket's place in the founders' board's ONE shared order and
-- the priority that position implies, so it reorders the list both founders
-- work from. That is a founder's act on the shared order, not a reporter's
-- note about their own ticket. A tester (someone a founder granted the role,
-- with no board login) files and confirms; only an admin ranks.
--
-- What reads it: the bug-report Edge Function's place route refuses a caller
-- for whom this is false, and its status route leaves every rank out for them;
-- the app asks it (`bugs.canRank()`) to decide whether to show Place at all.
-- Hiding Place is cosmetic; the function's check is the gate, as with
-- can_report_bugs().
--
-- Additive only: a new function, nothing else changes.

create or replace function public.can_rank_bugs() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- `from public` strips Postgres's implicit grant to PUBLIC; `anon` and
-- `authenticated` are named as well because Supabase's default privileges lay
-- down a direct EXECUTE grant to both on every new function in this schema
-- (20261019000400). Revoking from all three and granting back makes the final
-- privileges readable here, as 20261118214500_ping.sql does.
alter function public.can_rank_bugs() owner to postgres;
revoke execute on function public.can_rank_bugs() from public, anon, authenticated;
grant execute on function public.can_rank_bugs() to authenticated;
