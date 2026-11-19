-- IA-9 (20261118214500): public.ping(), the keepalive RPC.
--
-- WHY THIS EXISTS. A free Supabase project is PAUSED after a week of no API
-- activity and never resumes itself (DEVELOPMENT-ARJUN.md §2.3, the first row
-- of the free-tier table). Today that strands the handful of friends who know
-- to text us. With a TestFlight or App Store binary it is a one-star review
-- from someone we cannot reach, because the app has no way to say "the
-- database is asleep, poke Arjun". `.github/workflows/supabase-keepalive.yml`
-- calls this function on a schedule so the clock never runs out.
--
-- The commonly reported pause trigger is "no API activity", and it is NOT
-- confirmed that pg_cron activity inside the database counts (§2.3 again), so
-- the ping has to arrive over PostgREST from outside. That is the whole design
-- requirement: a real HTTP request, authenticated with the publishable key,
-- that reaches the database.
--
-- WHY IT IS THIS SMALL.
--   * `security invoker` (the default), NOT definer. It reads no table and
--     touches no row, so it needs nobody's privileges but the caller's. A
--     definer function here would be a privilege escalation vector added for
--     nothing.
--   * `stable`, and `select now()` rather than a literal. `now()` is the
--     cheapest statement that still proves a backend answered rather than a
--     cache or a proxy: PostgREST has to reach Postgres to evaluate it. The
--     returned timestamp is also the one useful diagnostic -- the workflow
--     prints it, so a log line says what the database thinks the time is.
--   * No table, no write, no counter. Anything persisted here would be a row
--     nobody reads, replicated into every backup, and a write path exposed to
--     `anon`.
--
-- WHY `anon` MAY CALL IT. The keepalive runs on the publishable key, which is
-- what the app ships with and what an unauthenticated request carries. The
-- function discloses `now()`, which every HTTP `Date` header already
-- discloses, so there is nothing to protect. `authenticated` gets it too so a
-- signed-in client can use the same health check.
--
-- RATE LIMITING is not this function's job: the publishable key is public, and
-- so is every other `anon`-callable RPC we have (`check_invite_code`,
-- `check_handle`). This one is strictly cheaper than those.
--
-- This migration creates one function. It changes no table, no policy, no
-- other function, and nothing in the contract: `BeviApi` does not gain a
-- method, because no screen calls this -- only CI does.

set search_path = public, extensions;

create or replace function public.ping()
returns timestamptz
language sql
stable
set search_path = public, extensions
as $$
  select now();
$$;

comment on function public.ping() is
  'IA-9: the keepalive RPC. Returns now() and nothing else. Called on a schedule by .github/workflows/supabase-keepalive.yml with the publishable key, so a free project never reaches a week without API activity and pauses (DEVELOPMENT-ARJUN.md §2.3). Security invoker: it reads nothing.';

-- `from public` strips Postgres's implicit grant to PUBLIC; `anon` and
-- `authenticated` are named in the revoke as well because Supabase's default
-- privileges lay down a direct EXECUTE grant to them on every new function in
-- this schema (20261019000400). Revoking first and granting back makes the two
-- roles that may call this an explicit statement of this migration rather than
-- a side effect of the stack's defaults.
alter function public.ping() owner to postgres;
revoke execute on function public.ping() from public, anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
