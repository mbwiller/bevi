-- Custom Bevs, part 3: everything the worker needs that lives in the database.
--
-- 20261111000200 built the ledger and the trigger; 20261111000300 the read
-- path. This adds the four things the `generate-bev-icon` Edge Function needs
-- around it:
--
--   1. a private bucket for the style reference images, because the function
--      cannot read the repository at runtime;
--   2. `release_bev_icon_job()`, so a daily-quota rejection re-queues a job
--      WITHOUT consuming one of its attempts;
--   3. `pending_bev_icon_failures`, so a failure is something an operator can
--      see rather than a row nobody reads;
--   4. the cron drain that makes the whole pipeline independent of anyone
--      having the app open.
--
-- ---------------------------------------------------------------------------
-- WHY release_bev_icon_job EXISTS AT ALL
-- ---------------------------------------------------------------------------
-- The spike (plan §4, 2026-11-11) established three distinct provider
-- outcomes, and they must not be treated alike:
--
--   * 3030, "output has been flagged" -- the model's safety filter rejecting a
--     recognisable BRAND MARK. Deterministic: three identical retries of a
--     branded input failed three times. So it is TERMINAL. Retrying spends the
--     daily allocation to arrive at the same answer, and the Bev falls through
--     to borrowed catalog art (plan §4b), which is the right outcome anyway.
--     `finish_bev_icon_job(..., 'failed', ...)` handles it, and
--     `attempt_count` deliberately runs out fast.
--
--   * 3043, "internal server error" -- genuinely transient, and common enough
--     on klein-9b to matter (observed needing three attempts, twice). A normal
--     retry: `finish_bev_icon_job(..., 'failed', ...)` and the next drain
--     re-claims while attempts remain.
--
--   * daily Neurons exhausted -- nothing is wrong with the job at all. The
--     free allocation resets at 00:00 UTC. Treating this as a failure would
--     burn all five attempts in a single busy afternoon and permanently fail a
--     perfectly good Bev. Hence this function: back to 'pending', attempt_count
--     DECREMENTED so the claim that just happened is undone, and the Bev's
--     status returned to 'pending' rather than 'failed' so the app keeps
--     showing it as waiting instead of giving up.

set search_path = public, extensions;

-- =====================================================================
-- 1. The style reference bucket
--
-- PRIVATE, unlike bev-icons. These are derivatives of the authored catalog
-- artwork, uploaded by `scripts/icons/export-style-refs.mjs` and read only by
-- the Edge Function as the service role. Nothing in the app ever fetches one,
-- so there is no reason to serve them publicly.
--
-- Only UNBRANDED artwork may go in here, and that is a correctness constraint
-- rather than a tidiness one: the provider's output filter rejects a
-- recognisable brand mark outright (3030), so a branded reference makes every
-- generation that uses it fail deterministically. The export script enforces
-- it; this comment records why.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bev-style-refs', 'bev-style-refs', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No policy for `authenticated`: the service role is the only reader and the
-- only writer, and it bypasses RLS.

-- =====================================================================
-- 2. release_bev_icon_job(): a claim handed back, not a failure
-- =====================================================================

create or replace function public.release_bev_icon_job(p_bev_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status text;
begin
  select status into v_status from public.bev_icon_jobs where bev_id = p_bev_id for update;
  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002', detail = 'bevIconJob';
  end if;
  -- A job that finished between the claim and this call keeps its result. The
  -- same guard finish_bev_icon_job has, for the same reason.
  if v_status = 'completed' then
    return;
  end if;

  update public.bev_icon_jobs
     set status = 'pending',
         -- Undo the increment claim_bev_icon_jobs just made: this attempt
         -- never reached the provider, so it should not count against the cap.
         attempt_count = greatest(attempt_count - 1, 0),
         started_at = null,
         completed_at = null,
         last_error = left(p_reason, 500)
   where bev_id = p_bev_id;

  -- Still waiting, not failed: the app keeps polling and the user sees a
  -- pending icon rather than a Bev that gave up.
  update public.bevs set icon_status = 'pending' where id = p_bev_id;
end;
$$;

comment on function public.release_bev_icon_job(uuid, text) is
  'Hands a claimed icon job back to the queue without consuming an attempt, for the case where nothing is wrong with the job -- the daily provider allocation is exhausted and resets at 00:00 UTC. Service role only.';

alter function public.release_bev_icon_job(uuid, text) owner to postgres;
revoke execute on function public.release_bev_icon_job(uuid, text) from public, anon, authenticated;
grant execute on function public.release_bev_icon_job(uuid, text) to service_role;

-- =====================================================================
-- 3. pending_bev_icon_failures: the operator's view
--
-- Modelled on `pending_duplicate_reports` (20261101000500): a view a human
-- reads in Studio, not an app surface. Without it, `last_error` is written
-- into a table with no SELECT policy and read by nobody, and the only symptom
-- of a broken pipeline is a user noticing a placeholder.
--
-- `security_invoker = true` so it is the reader's privileges that decide, not
-- the view owner's -- which keeps this from becoming a way for `authenticated`
-- to read a table that deliberately has no policy. In practice the service
-- role and a superuser in Studio can read it, and a signed-in user gets
-- nothing.
-- =====================================================================

create or replace view public.pending_bev_icon_failures
with (security_invoker = true) as
  select j.bev_id,
         b.name,
         b.brand,
         b.category_id,
         j.status,
         j.attempt_count,
         public.bev_icon_max_attempts() as max_attempts,
         -- Both ways a job dies. The age branch matters because a job killed
         -- by the 24h backstop holds attempt_count = 0 (release decrements),
         -- so an attempts-only test would report `false` for a job that is
         -- definitively dead -- and this view exists so a human can tell.
         (j.attempt_count >= public.bev_icon_max_attempts()
          or j.created_at < now() - public.bev_icon_give_up_after()) as gave_up,
         j.last_error,
         j.source_photo_path,
         j.created_at,
         j.started_at
    from public.bev_icon_jobs j
    join public.bevs b on b.id = j.bev_id
   where j.status <> 'completed'
   order by j.attempt_count desc, j.created_at;

comment on view public.pending_bev_icon_failures is
  'Operator view: every icon job that has not completed, with why. `gave_up` marks the ones past bev_icon_max_attempts(). A 3030 (brand mark) row is expected and is not a bug -- that Bev borrows catalog art instead (plan 4b).';

revoke all on public.pending_bev_icon_failures from public, anon, authenticated;

-- =====================================================================
-- 4. The drain
--
-- `enqueue_bev_icon_job` already pokes the function over pg_net the moment an
-- eligible Bev is created, but that POST can be lost and is a no-op wherever
-- the Vault secrets are absent. THIS is the mechanism that actually makes the
-- guarantee: a committed job row is picked up within the minute whether or not
-- anyone's browser is open, whether or not the poke arrived, and whether or
-- not the worker that last held it is still alive.
--
-- Same Vault-with-a-handler shape as enqueue_bev_icon_job, and the same
-- reasoning as 20261031000100: a Vault read can throw, and a throw here must
-- degrade to "no drain this minute", never to a failing cron job.
-- =====================================================================

create or replace function public.drain_bev_icon_jobs()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text;
  v_token text;
begin
  -- Nothing to do: skip the Vault read and the HTTP entirely. The common case
  -- by far, since this runs every minute and eligible Bevs are rare.
  if not exists (
    select 1 from public.bev_icon_jobs
     where attempt_count < public.bev_icon_max_attempts()
       and (status in ('pending', 'failed')
         or (status = 'processing' and started_at < now() - public.bev_icon_stale_after()))
  ) then
    return;
  end if;

  begin
    select nullif(s.decrypted_secret, '') into v_url
      from vault.decrypted_secrets s where s.name = 'icon_function_url';
    select nullif(s.decrypted_secret, '') into v_token
      from vault.decrypted_secrets s where s.name = 'icon_webhook_token';
  exception when others then
    raise warning 'drain_bev_icon_jobs: could not read the icon config from Vault (%: %)',
      sqlstate, sqlerrm;
    return;
  end;

  if v_url is null or v_token is null then
    return;  -- Unconfigured: local stacks and CI. Quiet, not an error.
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('source', 'cron'),
      headers := jsonb_build_object('Content-Type',  'application/json',
                                    'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'drain_bev_icon_jobs: could not queue the drain (%: %)', sqlstate, sqlerrm;
  end;
end;
$$;

comment on function public.drain_bev_icon_jobs() is
  'Pokes the generate-bev-icon Edge Function when any job is claimable. Runs every minute from pg_cron; a no-op when there is no work or no Vault config. This, not the create_bev poke, is what makes the pipeline independent of the app being open.';

alter function public.drain_bev_icon_jobs() owner to postgres;
revoke execute on function public.drain_bev_icon_jobs() from public, anon, authenticated, service_role;

-- cron.schedule upserts by job name (pg_cron >= 1.4; 20261011000800 confirms
-- the version and the behaviour), so re-running this migration re-points the
-- job rather than creating a second one.
select cron.schedule(
  'drain-bev-icon-jobs',
  '* * * * *',
  $cron$ select public.drain_bev_icon_jobs(); $cron$
);

-- =====================================================================
-- 5. A merge carries the generated icon too
--
-- 20261112000200 added `bevs_merge_moves_icon`, which re-points a Bev's
-- AUTHORED icon (`public.bev_icons`) to the surviving Bev when `merge_bev`
-- marks it 'merged'. Nothing did the same for the GENERATED one, and the
-- asymmetry is the bug: `generated_icon_path` and `icon_label_band` stayed on
-- the row nothing renders, so merging a custom Bev that had art into one that
-- did not LOST that art permanently. Permanently, because a generation job is
-- only ever created by `create_bev` (20261111000200) -- there is no path that
-- regenerates an icon for an existing Bev, by design.
--
-- Same trigger shape and the same WHEN clause as main's, so the two fire
-- together on the one status change and a reader finds them side by side.
--
-- Only when the survivor has none: a destination that already has its own
-- generated icon keeps it. The surviving Bev is the canonical one, so its art
-- wins; this fills a gap rather than overwriting a choice.
-- =====================================================================

create or replace function public.bev_generated_icon_follow_merge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.merged_into is null then
    return null;
  end if;

  update public.bevs dest
     set generated_icon_path = new.generated_icon_path,
         icon_label_band     = new.icon_label_band,
         icon_status         = 'completed'
   where dest.id = new.merged_into
     and dest.generated_icon_path is null
     and new.generated_icon_path is not null;

  return null;
end;
$$;

comment on function public.bev_generated_icon_follow_merge() is
  'Carries a merged Bev''s generated icon to the surviving Bev when it has none of its own. The mirror of bev_icons_follow_merge (20261112000200) for generated art; without it a merge loses art that nothing can regenerate.';

alter function public.bev_generated_icon_follow_merge() owner to postgres;
revoke execute on function public.bev_generated_icon_follow_merge()
  from public, anon, authenticated, service_role;

drop trigger if exists bevs_merge_moves_generated_icon on public.bevs;
create trigger bevs_merge_moves_generated_icon
  after update of status on public.bevs
  for each row
  when (new.status = 'merged' and old.status is distinct from 'merged')
  execute function public.bev_generated_icon_follow_merge();
