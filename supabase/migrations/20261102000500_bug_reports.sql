-- Internal bug reporting (beverage-ticketing-codex/docs/TICKETING_SYSTEM_SPEC.md).
--
-- Linear is the issue system of record: this migration deliberately stores NO
-- mutable issue state (status, priority, assignee, comments). What it does
-- store is the submission ledger -- an immutable record of "this reporter sent
-- this idempotency key and we got back this Linear identifier" -- which is the
-- only way to make a repeated tap or a client retry not create a second ticket,
-- and the only record of an evidence object that needs expiring.
--
-- Shape of the flow (supabase/functions/bug-report/index.ts):
--   1. the app uploads the screenshot to the private `bug-evidence` bucket
--      (storage RLS below: internal reporters, own folder, on submit only);
--   2. the app calls the bug-report Edge Function with the caller's JWT;
--   3. the function calls claim_bug_report() AS THE CALLER -- that is where
--      authorisation and rate limiting happen, under auth.uid();
--   4. the function talks to Linear with a server-only key;
--   5. the function calls finish_bug_report() AS THE SERVICE ROLE to record
--      the identifier, or the failure.
--
-- =====================================================================
-- 1. `tester`: the non-admin internal role
--
-- `profiles.role` was ('user','admin') (20261009000200). An internal tester
-- needs to file bugs without getting admin's moderation powers, so the check
-- grows a third value. Changing a CHECK constraint is append-only-safe: the
-- old migration file is untouched and every existing row still satisfies it.
-- Only an admin can set `role` at all (protect_profile_columns, last rewritten
-- in 20261019000300) -- that rule is unchanged.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'admin', 'tester'));

-- Who may file an internal bug report. Admins included: they are internal by
-- definition and we do not want a separate grant to remember.
create or replace function public.is_internal_reporter() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'tester') from public.profiles where id = auth.uid()), false);
$$;

-- The client's gate for showing the Report a bug entry point. Hiding the
-- button is cosmetic; claim_bug_report() below is the real check, and it runs
-- again server-side on every submission.
create or replace function public.can_report_bugs() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_internal_reporter();
$$;

revoke execute on function public.is_internal_reporter(), public.can_report_bugs() from public, anon;
grant execute on function public.is_internal_reporter(), public.can_report_bugs() to authenticated;

-- =====================================================================
-- 2. The submission ledger
-- =====================================================================

create table public.bug_reports (
  id                bigint generated always as identity primary key,
  reporter_id       uuid not null references public.profiles(id) on delete cascade,
  -- Client-generated UUID, one per draft. The same draft retried (a flaky
  -- network, a double tap) reuses it and resolves to the same Linear issue.
  idempotency_key   text not null check (char_length(idempotency_key) between 8 and 100),
  state             text not null default 'pending' check (state in ('pending', 'created', 'failed')),
  -- Linear's own identifier and URL, e.g. 'BEV-104'. Never invented here:
  -- null until the provider confirmed the issue exists.
  ticket_identifier text check (char_length(ticket_identifier) <= 40),
  ticket_url        text check (char_length(ticket_url) <= 500),
  -- Object path in the private `bug-evidence` bucket, for expiry. Never a URL.
  evidence_path     text check (char_length(evidence_path) <= 300),
  -- A short provider/stage code for triage of the integration itself
  -- ('linear_error', 'linear_not_configured'...). Never a payload, never a secret.
  error_code        text check (char_length(error_code) <= 60),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (reporter_id, idempotency_key)
);

create index bug_reports_reporter_idx on public.bug_reports (reporter_id, created_at desc);
-- Drives the evidence retention sweep (scripts/bugs/purge-evidence.ts).
create index bug_reports_evidence_idx on public.bug_reports (created_at) where evidence_path is not null;

alter table public.bug_reports enable row level security;

-- Read your own submissions (and an admin reads all) so a reporter can be told
-- what happened to a draft. No insert/update/delete policy for `authenticated`:
-- writes go through the two security-definer functions below, per the project
-- rule in supabase/CLAUDE.md.
create policy bug_reports_select on public.bug_reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());

-- =====================================================================
-- 3. Rate limit
--
-- assert_rate() is security-definer and only callable from inside another
-- SQL/plpgsql function, so claim_bug_report() below calls it directly. 20 an
-- hour is generous for a human tester and still caps a runaway client loop.
-- =====================================================================

create or replace function public.assert_bug_report_rate() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_rate('bug_report', 20, interval '1 hour');
end $$;

revoke execute on function public.assert_bug_report_rate() from public, anon;
grant execute on function public.assert_bug_report_rate() to authenticated;

-- =====================================================================
-- 4. claim_bug_report(): called by the Edge Function AS THE CALLER
--
-- Returns the ledger row to act on plus `claimed`, which says whether THIS
-- call owns the attempt:
--   claimed = true  -> go and create the Linear issue, then finish_bug_report().
--   claimed = false, state 'created' -> this key already produced a ticket;
--                    return it, create nothing. That is the idempotency.
--   claimed = false, state 'pending' -> another attempt for this key is in
--                    flight right now; answer 409 rather than risk a duplicate.
-- A previous attempt that failed, or one that died mid-flight and went stale,
-- is re-armed and claimed.
-- =====================================================================

-- A pending row older than this is assumed dead (the function timed out, the
-- worker was recycled) and may be retried. Shorter than any plausible Linear
-- round trip would be a duplicate-ticket risk; much longer would strand a
-- reporter behind a 409.
create or replace function public.claim_bug_report(p_idempotency_key text, p_evidence_path text default null)
returns table (
  id bigint,
  state text,
  ticket_identifier text,
  ticket_url text,
  evidence_path text,
  claimed boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_row public.bug_reports;
  v_stale constant interval := interval '2 minutes';
  v_claimed boolean;
begin
  if not public.is_internal_reporter() then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'idempotencyKey';
  end if;
  if p_evidence_path is not null then
    -- The uploader's own folder, as the storage policy enforces on insert.
    if split_part(p_evidence_path, '/', 1) <> auth.uid()::text or char_length(p_evidence_path) > 300 then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'evidencePath';
    end if;
  end if;

  -- Lock the existing row so two taps can't both decide they are the first.
  select * into v_row from public.bug_reports b
    where b.reporter_id = auth.uid() and b.idempotency_key = p_idempotency_key
    for update;

  if found then
    if v_row.state = 'failed' or (v_row.state = 'pending' and v_row.updated_at < now() - v_stale) then
      update public.bug_reports b
         set state = 'pending', evidence_path = coalesce(p_evidence_path, b.evidence_path),
             error_code = null, updated_at = now()
       where b.id = v_row.id
       returning * into v_row;
      v_claimed := true;
    else
      v_claimed := false;
    end if;
  else
    perform public.assert_bug_report_rate();
    insert into public.bug_reports (reporter_id, idempotency_key, evidence_path)
    values (auth.uid(), p_idempotency_key, p_evidence_path)
    returning * into v_row;
    v_claimed := true;
  end if;

  return query select v_row.id, v_row.state, v_row.ticket_identifier, v_row.ticket_url,
                      v_row.evidence_path, v_claimed;
end $$;

revoke execute on function public.claim_bug_report(text, text) from public, anon;
grant execute on function public.claim_bug_report(text, text) to authenticated;

-- =====================================================================
-- 5. finish_bug_report(): called by the Edge Function AS THE SERVICE ROLE
--
-- Not callable by a signed-in user: a client must never be able to write a
-- ticket identifier the provider did not return.
-- =====================================================================

create or replace function public.finish_bug_report(
  p_id bigint,
  p_state text,
  p_ticket_identifier text default null,
  p_ticket_url text default null,
  p_error_code text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_state not in ('created', 'failed') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'state';
  end if;
  if p_state = 'created' and (p_ticket_identifier is null or p_ticket_url is null) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'ticketIdentifier';
  end if;
  update public.bug_reports
     set state = p_state,
         ticket_identifier = coalesce(p_ticket_identifier, ticket_identifier),
         ticket_url = coalesce(p_ticket_url, ticket_url),
         error_code = p_error_code,
         updated_at = now()
   where id = p_id;
end $$;

revoke execute on function public.finish_bug_report(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_bug_report(bigint, text, text, text, text) to service_role;

-- =====================================================================
-- 6. forget_bug_evidence(): the retention sweep's bookkeeping half
--
-- scripts/bugs/purge-evidence.ts deletes the objects through the Storage API
-- (storage.objects is owned by supabase_storage_admin, so a function here
-- cannot delete them) and then calls this to clear the paths it removed.
-- =====================================================================

create or replace function public.forget_bug_evidence(p_paths text[]) returns integer
language sql security definer set search_path = public as $$
  with cleared as (
    update public.bug_reports set evidence_path = null, updated_at = now()
     where evidence_path = any(p_paths)
    returning 1
  ) select count(*)::int from cleared;
$$;

revoke execute on function public.forget_bug_evidence(text[]) from public, anon, authenticated;
grant execute on function public.forget_bug_evidence(text[]) to service_role;

-- =====================================================================
-- 7. Evidence storage: a PRIVATE bucket
--
-- Unlike bev-photos/avatars (public = true, served by public URL), a bug
-- screenshot can contain anything that was on a tester's screen. The bucket is
-- private, gets no SELECT policy, and is read only by the Edge Function with
-- the service role, which hands the bytes to Linear and never mints a public
-- URL. 10 MB and the same image types the other buckets accept.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-evidence', 'bug-evidence', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Insert only, internal reporters only, own folder -- matching the
-- `<uid>/<random-id>.<ext>` path packages/api/src/bugs.ts builds. No SELECT,
-- UPDATE or DELETE policy: nothing in the app ever reads or replaces an
-- object here.
create policy storage_bug_evidence_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'bug-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_internal_reporter()
  );
