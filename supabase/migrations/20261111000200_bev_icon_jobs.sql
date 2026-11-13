-- Custom Bevs, part 1: the generated-icon job ledger and its one trigger.
--
-- A user can create a Bev that is not in the catalog. When -- AND ONLY WHEN --
-- that creation workflow included a real uploaded photograph, the backend
-- generates one illustrated icon in Bevi's existing visual language and stores
-- it on the Bev. This migration is the eligibility decision and the durable
-- ledger. The worker that calls an image-generation API is a separate function
-- (`generate-bev-icon`) and a separate migration; nothing here talks to a
-- provider.
--
-- ---------------------------------------------------------------------------
-- WHY THE TRIGGER LIVES INSIDE create_bev AND NOWHERE ELSE
-- ---------------------------------------------------------------------------
-- The requirement is narrow: generation is initiated for a brand-new Bev
-- created WITH a user-uploaded photograph as part of its initial creation
-- workflow. Not for an edit, not for a later photo, not for a social post
-- about an existing Bev, not for a storage object appearing in a bucket.
--
-- `create_bev()` IS that workflow, and it is the only path that inserts a
-- `bevs` row with `source = 'user'`. By the time it reaches its
-- `insert ... returning`, it has already proved the photo asset exists, sits
-- in `bev-photos`, is under the caller's own folder and has
-- `owner_id = auth.uid()` (20261012000800). So "verify the uploaded image is
-- actually available before enqueueing" is work that path has already done --
-- there is nothing left to finalise and no window between the two.
--
-- An `AFTER INSERT` trigger on `bevs` was the obvious alternative and is
-- WORSE, for a reason this schema already learned once: it cannot distinguish
-- "a user completed the wizard with a photo" from "a seed migration inserted
-- several hundred rows that happen to have a photo_path", or from a future
-- admin RPC that sets one. 20261023000100 had to bolt
-- `when (new.source = 'user')` onto the embedding trigger for exactly that
-- reason, and even that predicate would not exclude an admin `set_bev_photo`.
-- A `perform` inside the one function that means "a person just created this
-- Bev" needs no predicate at all.
--
-- Being in the same transaction is the other half: a `create_bev` that rolls
-- back leaves no job behind, and a committed Bev always has its job. There is
-- no partial state to repair.
--
-- ---------------------------------------------------------------------------
-- WHY ONE JOB PER BEV IS A PRIMARY KEY, NOT APPLICATION LOGIC
-- ---------------------------------------------------------------------------
-- `bev_icon_jobs.bev_id` is the primary key. The database therefore cannot
-- hold two initial jobs for one Bev, whatever a duplicate form submission, a
-- retried webhook, a restarted worker or two concurrent requests try to do. A
-- retry reuses that row and bumps `attempt_count`; it never becomes a second
-- generation request. `recommendation_jobs` (20261009000700) is the same
-- shape: primary key on the entity, an attempts counter, RLS on with no
-- policy.
--
-- ---------------------------------------------------------------------------
-- STATE, AND THE DIFFERENCE BETWEEN "NOT ELIGIBLE" AND "WAITING"
-- ---------------------------------------------------------------------------
-- `bevs.icon_status` starts at 'none', which means "was never eligible" -- a
-- Bev created without a photo, and every one of the seeded catalog rows. It is
-- not 'pending', because a Bev that nothing will ever generate for must not
-- read as waiting forever. 'pending' and 'processing' are real waits,
-- 'completed' is terminal, and 'failed' is retryable up to MAX_ATTEMPTS.
--
-- The status lives on `bevs` rather than being read from the job table so that
-- every existing read path picks it up with no change, and so `last_error`
-- (a provider diagnostic) never has to be exposed to a client. The job table
-- gets no policy for `authenticated` at all.

set search_path = public, extensions;

-- =====================================================================
-- 1. The Bev's two new columns
--
-- Neither column appears in any trigger's column list on this table --
-- `bevs_leaf_category_guard` watches (category_id, leaf_category_id)
-- (20261026000100) and `bevs_embed_after_update` watches
-- (name, brand, flavor, category_id) (20261023000100). So writing an icon
-- result queues no embedding inference and no graph work. That is deliberate:
-- an icon is art, and it changes nothing the recommender reads.
-- =====================================================================

alter table public.bevs
  add column generated_icon_path text
    check (generated_icon_path is null or char_length(generated_icon_path) <= 300),
  add column icon_status text not null default 'none'
    check (icon_status in ('none', 'pending', 'processing', 'completed', 'failed')),
  -- Where the drink's label sits on its generated icon, normalised 0-1, so the
  -- app can letter it. The lettering is NOT generated: the image model rejects
  -- a recognisable brand mark outright, so the wordmark is drawn from the name
  -- the user typed. Null when the drink has no label band at all -- a cafe
  -- latte, a homemade smoothie -- which is the correct answer for those.
  add column icon_label_band jsonb
    check (icon_label_band is null or (
      jsonb_typeof(icon_label_band) = 'object'
      and icon_label_band ? 'x' and icon_label_band ? 'y'
      and icon_label_band ? 'width' and icon_label_band ? 'height'
      -- `dark` is non-optional in the contract's BevIconLabelBand, so the
      -- database has to insist on it too; otherwise a future writer yields
      -- `dark: undefined` behind a type that promises a boolean.
      and icon_label_band ? 'dark'
    ));

-- A path, never a URL -- the same convention as photo_path, thumb_path and
-- avatar_path. packages/api turns it into a public URL with `publicUrl()`.
comment on column public.bevs.generated_icon_path is
  'Object path in the public `bev-icons` bucket for this Bev''s generated illustration, or null. Written only by finish_bev_icon_job().';
comment on column public.bevs.icon_status is
  '''none'' = never eligible for generation (no creation photo, or a seeded row). Otherwise the state of this Bev''s one icon-generation job.';

-- "Which Bevs are still waiting for art" is the only query over this column
-- that is not already filtered by id, and it matches a handful of rows out of
-- the whole catalog, so a partial index.
create index bevs_icon_pending_idx on public.bevs (icon_status)
  where icon_status in ('pending', 'processing');

-- =====================================================================
-- 2. The ledger
-- =====================================================================

create table public.bev_icon_jobs (
  -- One job per Bev, enforced by the database. See the header.
  bev_id             uuid primary key references public.bevs(id) on delete cascade,
  -- The object path in `bev-photos` that create_bev validated. Kept here, not
  -- re-read from `bevs.photo_path`, so the job always regenerates from the
  -- photograph the ORIGINAL creation request carried, even if the Bev's photo
  -- is later replaced by a moderator.
  source_photo_path  text not null check (char_length(source_photo_path) between 1 and 300),
  status             text not null default 'pending'
                     check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count      integer not null default 0 check (attempt_count >= 0),
  -- A short provider/stage diagnostic, for triage of the integration itself.
  -- Never a payload, never a secret, never shown to a user.
  last_error         text check (char_length(last_error) <= 500),
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  -- A completed job has art; a job that has not completed has none.
  constraint bev_icon_jobs_completed_at_matches_status
    check ((status = 'completed') = (completed_at is not null))
);

-- Drives the drain in claim_bev_icon_jobs(): oldest claimable first. Excludes
-- 'completed', which is terminal and is where almost every row ends up.
create index bev_icon_jobs_claimable_idx on public.bev_icon_jobs (created_at)
  where status in ('pending', 'processing', 'failed');

alter table public.bev_icon_jobs enable row level security;

-- Two independent locks, because one of them is only a convention.
--
-- First, the grants: Supabase hands `anon`, `authenticated` and
-- `service_role` full DML on every new table in this schema by default, which
-- also makes it a live PostgREST endpoint. Revoked below, so the table is not
-- addressable over REST at all.
--
-- Second, NO POLICY, deliberately -- not even SELECT for `authenticated`. The three
-- functions below are security definer and are the only access path; the
-- service role reaches the table through them. A client that wants to know
-- whether its Bev has art reads `bevs.icon_status`, which it can already see,
-- and never sees `last_error` or `attempt_count`.

-- Supabase's default privileges grant these before we get here, so a revoke
-- is required to make the paragraph above true. RLS with no policy would stop
-- a read returning rows either way; this stops it being a REST endpoint that
-- discloses the schema, and means one permissive policy added later cannot
-- quietly expose last_error, attempt_count and source_photo_path.
revoke all on public.bev_icon_jobs from anon, authenticated;

comment on table public.bev_icon_jobs is
  'At most one initial icon-generation job per eligible Bev (primary key on bev_id). Created only by create_bev, for a brand-new Bev whose creation request carried an uploaded photo. RLS on with no policy: security-definer functions only.';

-- How many times an eligible job may be attempted before it is left alone.
-- A failure is almost always a provider hiccup, so a few retries are worth it;
-- past that it is a bad source photo or a bad prompt, and retrying forever
-- just spends money. Exposed as a function so the worker and the tests agree
-- on one number.
create or replace function public.bev_icon_max_attempts() returns integer
language sql immutable set search_path = public as $$ select 5 $$;

-- A job stuck in 'processing' longer than this is assumed dead -- the Edge
-- Function timed out, or the worker was recycled mid-flight -- and may be
-- claimed again. Comfortably longer than two provider round trips, so a slow
-- but living worker is never raced; short enough that a dead one does not
-- strand a Bev without art.
create or replace function public.bev_icon_stale_after() returns interval
language sql immutable set search_path = public as $$ select interval '5 minutes' $$;

-- A backstop on WALL-CLOCK age, independent of attempt_count.
--
-- `attempt_count` alone is not enough, because `release_bev_icon_job`
-- (20261111000400) deliberately DECREMENTS it: a job released for a reason
-- that is nobody's fault -- the daily provider allocation is spent, or the
-- worker has no provider credentials at all -- must not burn an attempt. But
-- that means a job can be claimed and released forever, oscillating 0<->1,
-- never reaching the cap, and its Bev reads 'pending' for all time. That is
-- precisely the "waiting for art that will never come" state this feature is
-- required not to produce, and the stale-'processing' reaper does not catch
-- it because such a job is never left in 'processing'.
--
-- A day is long enough that a quota pause (which clears at 00:00 UTC) and a
-- weekend of provider trouble both recover on their own, and short enough
-- that a misconfiguration surfaces as a visible failure rather than as
-- silence.
create or replace function public.bev_icon_give_up_after() returns interval
language sql immutable set search_path = public as $$ select interval '24 hours' $$;

revoke execute on function public.bev_icon_max_attempts(), public.bev_icon_stale_after(),
  public.bev_icon_give_up_after() from public, anon, authenticated;
grant execute on function public.bev_icon_max_attempts(), public.bev_icon_stale_after(),
  public.bev_icon_give_up_after() to service_role;

-- =====================================================================
-- 3. enqueue_bev_icon_job(): called by create_bev, by nothing else
--
-- Two things, in this order:
--   1. the durable part -- insert the job row and mark the Bev 'pending',
--      inside the caller's transaction, so it commits with the Bev or not at
--      all;
--   2. the optimisation -- a best-effort pg_net POST that wakes the worker now
--      instead of within a minute. It may be lost and that is fine: the cron
--      drain finds the row regardless. This is the one place the design
--      differs from 20261023000100's embedding webhook, where a dropped
--      request means a missing vector until the nightly backfill. Here the
--      ledger row is the source of truth and the POST is pure latency.
--
-- Configuration comes from VAULT, not from a GUC. 20261023000100 told its
-- deployer to `alter database postgres set bevi.embed_function_url = ...`, and
-- 20261025000200 found out the hard way that this is not executable on
-- Supabase: `postgres` is not a superuser here, setting a custom parameter on
-- a database requires one, so the statement fails 42501 and that trigger was a
-- silent no-op for two weeks. Two secrets, inserted OUTSIDE this repo by a
-- human so no value is ever committed:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/generate-bev-icon',
--                              'icon_function_url',
--                              'the generate-bev-icon Edge Function endpoint');
--   select vault.create_secret('<ICON_WEBHOOK_SECRET>',
--                              'icon_webhook_token',
--                              'the bearer token generate-bev-icon checks');
--
-- EITHER SECRET MISSING, BLANK OR UNREADABLE SKIPS ONLY THE POST, NEVER THE
-- JOB ROW. `supabase db reset`, CI and pgTAP have no secrets and must still
-- see the ledger behave correctly -- that is exactly what makes eligibility
-- testable with no provider in the picture.
--
-- The ledger write comes FIRST, before the suspend check and before the Vault
-- read, because it is the part that must not be skipped. And the Vault read
-- sits in its own exception handler: unlike `current_setting(..., true)` it
-- can throw (the extension missing, the owner losing SELECT on the view, a
-- decryption error), and 20261031000100 exists because the first version of
-- the embed trigger let such a throw abort the user's `create_bev`.
-- =====================================================================

create or replace function public.enqueue_bev_icon_job(p_bev_id uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text;
  v_token text;
begin
  if p_bev_id is null or p_photo_path is null then
    return;
  end if;

  -- The durable half. `do nothing` rather than `do update`: a Bev that already
  -- has a job keeps the one it has. This is what makes a retried creation
  -- request, a replayed webhook and two concurrent calls all collapse to a
  -- single generation.
  insert into public.bev_icon_jobs (bev_id, source_photo_path)
  values (p_bev_id, p_photo_path)
  on conflict (bev_id) do nothing;

  -- FOUND is false when the conflict clause swallowed the row.
  if not found then
    return;  -- Already has a job. Never re-arm, never re-notify.
  end if;

  update public.bevs set icon_status = 'pending' where id = p_bev_id;

  -- An escape hatch for bulk work that legitimately creates many eligible
  -- Bevs at once (an import, an admin backfill). `set local bevi.icon_suspend
  -- = 'true';` keeps it from firing one function invocation per row; the drain
  -- picks them up at its own pace. Transaction-local, it only ever suppresses
  -- the POST, never the ledger row, and -- as in 20261031000100 -- it is
  -- checked before the Vault read so suspended bulk work decrypts nothing.
  if coalesce(current_setting('bevi.icon_suspend', true), '') = 'true' then
    return;
  end if;

  begin
    select nullif(s.decrypted_secret, '') into v_url
      from vault.decrypted_secrets s where s.name = 'icon_function_url';
    select nullif(s.decrypted_secret, '') into v_token
      from vault.decrypted_secrets s where s.name = 'icon_webhook_token';
  exception when others then
    raise warning 'enqueue_bev_icon_job: could not read the icon config from Vault (%: %)',
      sqlstate, sqlerrm;
    return;
  end;

  -- Not configured: the cron drain is the only wake-up, which is enough.
  if v_url is null or v_token is null then
    return;
  end if;

  begin
    -- Queued, not sent: net.http_post appends one row to pg_net's queue and
    -- returns at once; a background worker performs the HTTP. So the Edge
    -- Function's cold start and its failures are invisible to create_bev.
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('bevIds', jsonb_build_array(p_bev_id),
                                    'source', 'create_bev'),
      headers := jsonb_build_object('Content-Type',  'application/json',
                                    'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- Never let the icon break the Bev. The drain will claim this job within
    -- the minute; the cost of landing here is a slightly later illustration.
    raise warning 'enqueue_bev_icon_job: could not notify for bev % (%: %)',
      p_bev_id, sqlstate, sqlerrm;
  end;
end;
$$;

comment on function public.enqueue_bev_icon_job(uuid, text) is
  'Records the single icon-generation job for a brand-new Bev created with an uploaded photo, and best-effort notifies the worker over pg_net. Called only from create_bev, inside its transaction. The ledger row is unconditional; the notification is a no-op unless the Vault secrets icon_function_url and icon_webhook_token both exist and are readable. SECURITY DEFINER so the owner''s access to vault.decrypted_secrets and schema net is what matters, not the creator''s.';

-- SECURITY DEFINER, so pin the owner and take every execute grant away. The
-- only caller is another security-definer function in the same schema, which
-- does not need EXECUTE. Revoking from everybody means no role can make the
-- database POST a bearer token, or fabricate a job for someone else's Bev, by
-- calling this by hand. `anon`, `authenticated` and `service_role` are named
-- separately because Supabase's default privileges lay down direct grants that
-- a revoke from PUBLIC does not touch (20261019000400 learned this).
alter function public.enqueue_bev_icon_job(uuid, text) owner to postgres;
revoke execute on function public.enqueue_bev_icon_job(uuid, text)
  from public, anon, authenticated, service_role;

-- =====================================================================
-- 4. claim_bev_icon_jobs(): the worker's only way in
--
-- Returns the jobs THIS invocation owns, already flipped to 'processing'.
-- Zero rows means there is nothing to do, which is the common case and is not
-- an error.
--
-- Claimable is:
--   * 'pending'     -- never attempted;
--   * 'failed'      -- with attempts left;
--   * 'processing'  -- but stale AND with attempts left, so the worker that
--                      claimed it is gone and it is still worth retrying.
-- 'completed' is absent from that list and that is the "do not regenerate an
-- icon that already exists" rule, enforced here rather than in the worker.
--
-- The `attempt_count` guard is on the stale branch too, not only on 'failed'.
-- Without it a worker that dies after its last attempt leaves a row that is
-- stale forever and gets re-claimed forever, with `attempt_count` climbing
-- past the cap and a provider call every minute. Step 0 below closes the
-- other half of that: such a row must not sit in 'processing' either, or its
-- Bev reads as waiting for art that will never come -- exactly the
-- "permanently pending" state this feature is required not to have.
--
-- `for update skip locked` is what makes concurrent workers safe: two
-- invocations claim disjoint sets, and neither waits on the other.
-- =====================================================================

create or replace function public.claim_bev_icon_jobs(p_limit integer default 5)
returns table (bev_id uuid, source_photo_path text, attempt_count integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
begin
  -- Step 0, the reaper: a job abandoned mid-flight with no attempts left is
  -- given up on, so it stops being claimable and its Bev stops reading as
  -- 'processing'.
  with abandoned as (
    update public.bev_icon_jobs j
       set status = 'failed',
           -- OVERWRITE, not coalesce. A job that was repeatedly released
           -- already carries a release reason ('provider_quota_exhausted'),
           -- and coalesce would keep it -- so the operator view would show a
           -- dead job whose stated reason is a transient one, with nothing
           -- saying the backstop fired. The reaper's reason is the true one.
           last_error = case
             when j.created_at < now() - public.bev_icon_give_up_after()
               then 'gave up: still unfinished after bev_icon_give_up_after()'
             else 'abandoned: worker did not report back' end
     where j.status <> 'completed'
       and (
         -- A worker that died mid-flight with no attempts left.
         (j.status = 'processing'
          and j.started_at < now() - public.bev_icon_stale_after()
          and j.attempt_count >= public.bev_icon_max_attempts())
         -- Or any job that has simply been around too long, which is the only
         -- thing that catches an endless claim/release cycle.
         or j.created_at < now() - public.bev_icon_give_up_after()
       )
    returning j.bev_id
  )
  update public.bevs b
     set icon_status = 'failed'
   where b.id in (select a.bev_id from abandoned a);

  -- Step 1, the claim.
  return query
  with claimable as (
    select j.bev_id
      from public.bev_icon_jobs j
      -- A Bev merged into another (A-12) is on its way out: its rankings are
      -- re-pointed and nothing renders it, so generating art for it would
      -- spend a metered call on something nobody can see.
      join public.bevs b on b.id = j.bev_id and b.status <> 'merged'
     where j.attempt_count < public.bev_icon_max_attempts()
       and j.created_at >= now() - public.bev_icon_give_up_after()
       and (j.status = 'pending'
         or j.status = 'failed'
         or (j.status = 'processing'
             and j.started_at < now() - public.bev_icon_stale_after()))
     order by j.created_at
     limit v_limit
       for update skip locked
  ),
  claimed as (
    update public.bev_icon_jobs j
       set status = 'processing',
           attempt_count = j.attempt_count + 1,
           started_at = now(),
           completed_at = null,
           last_error = null
     where j.bev_id in (select c.bev_id from claimable c)
    returning j.bev_id, j.source_photo_path, j.attempt_count
  ),
  -- An unreferenced data-modifying CTE still runs to completion, so this
  -- needs no join into the result.
  marked as (
    update public.bevs b
       set icon_status = 'processing'
     where b.id in (select c.bev_id from claimed c)
    returning b.id
  )
  select c.bev_id, c.source_photo_path, c.attempt_count from claimed c;
end;
$$;

comment on function public.claim_bev_icon_jobs(integer) is
  'Claims up to p_limit (1..25) eligible icon jobs for one worker invocation, flipping them to processing. Never returns a completed job, so an icon is never regenerated. Uses FOR UPDATE SKIP LOCKED, so concurrent workers claim disjoint sets.';

alter function public.claim_bev_icon_jobs(integer) owner to postgres;
revoke execute on function public.claim_bev_icon_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_bev_icon_jobs(integer) to service_role;

-- =====================================================================
-- 5. finish_bev_icon_job(): the worker's only way out
--
-- Service role only. A signed-in user must never be able to write an icon
-- path the provider did not produce -- that would be an arbitrary image on
-- somebody's Bev.
-- =====================================================================

create or replace function public.finish_bev_icon_job(
  p_bev_id     uuid,
  p_status     text,
  p_icon_path  text default null,
  p_error      text default null,
  p_label_band jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current text;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'status';
  end if;
  if p_status = 'completed' and coalesce(p_icon_path, '') = '' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'iconPath';
  end if;

  select status into v_current from public.bev_icon_jobs where bev_id = p_bev_id for update;
  if not found then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002', detail = 'bevIconJob';
  end if;

  -- A late or duplicated report for a job that already succeeded is dropped,
  -- not applied. Two workers that both got through (a stale claim racing the
  -- original) cannot overwrite good art with a failure, and cannot replace one
  -- icon with another.
  if v_current = 'completed' then
    return;
  end if;

  if p_status = 'completed' then
    update public.bev_icon_jobs
       set status = 'completed', completed_at = now(), last_error = null
     where bev_id = p_bev_id;
    update public.bevs
       set generated_icon_path = p_icon_path,
           icon_status = 'completed',
           icon_label_band = p_label_band
     where id = p_bev_id;
  else
    update public.bev_icon_jobs
       set status = 'failed', completed_at = null, last_error = left(p_error, 500)
     where bev_id = p_bev_id;
    -- The Bev stays fully usable: its own photograph, its rankings and its
    -- posts are untouched. Only the illustration is missing, and the app
    -- falls back to the category placeholder.
    update public.bevs set icon_status = 'failed' where id = p_bev_id;
  end if;
end;
$$;

comment on function public.finish_bev_icon_job(uuid, text, text, text, jsonb) is
  'Records the outcome of one icon-generation attempt and publishes the asset path onto the Bev. Service role only. A job already completed is never overwritten.';

alter function public.finish_bev_icon_job(uuid, text, text, text, jsonb) owner to postgres;
revoke execute on function public.finish_bev_icon_job(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_bev_icon_job(uuid, text, text, text, jsonb) to service_role;

-- =====================================================================
-- 6. The bucket
--
-- Public, like bev-photos: these are illustrations shown in the feed, on the
-- Bev screen, in search results and in the profile collection, so they are
-- served from the CDN by public URL.
--
-- NO storage policy for `authenticated`. The service role is the only writer
-- -- a user never uploads here -- and public buckets need no SELECT policy
-- (the /object/public/... endpoint bypasses RLS entirely; 20261011000900's
-- header has the reasoning). 2 MB is generous for a 1024px transparent PNG of
-- one drink on nothing.
--
-- Paths are `<bev_id>/icon-768.png` and `<bev_id>/icon-192.png`, matching
-- OUT_WIDTH and THUMB_WIDTH in the worker: two pre-rendered sizes, because
-- Supabase image transformations are a Pro feature (DEVELOPMENT-ARJUN.md
-- §7.5) and one generation call should serve every size the app draws. 768 is
-- the model's own output width -- upscaling to a rounder number would invent
-- detail that was never generated.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bev-icons', 'bev-icons', true, 2097152, array['image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- 7. create_bev(): the one line that makes a Bev eligible
--
-- Byte-for-byte the version from 20261012000800 (same signature, so
-- `create or replace`), plus the `perform public.enqueue_bev_icon_job(...)`
-- marked below, and `p_photo_asset_id` is now genuinely optional at the
-- contract level too (it always was in SQL -- a Bev with no photo has been
-- inserted 'pending_photo' since 20261012000200).
--
-- Note where the `perform` sits: AFTER the begin/exception/end block that owns
-- the insert. So it is unreachable when
--   * the UPC shortcut returned an existing Bev (returns earlier),
--   * the natural key collided (the handler raises BEVI_DUPLICATE_BEV),
--   * any validation failed (raises earlier).
-- Only a Bev this call actually inserted gets a job, and only when this call
-- actually carried a photo.
-- =====================================================================

create or replace function public.create_bev(
  p_name             text,
  p_brand            text,
  p_flavor           text,
  p_category_id      text,
  p_price_tier       smallint default null,
  p_price_estimated  boolean default true,
  p_upc              text default null,
  p_photo_asset_id   text default null,
  p_label_asset_id   text default null
)
returns public.bevs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid             uuid := auth.uid();
  v_is_alcoholic    boolean;
  v_existing        public.bevs;
  v_row             public.bevs;
  v_price_tier      smallint;
  v_price_estimated boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_rate('create_bev', 5, interval '1 hour');
  perform public.assert_rate('create_bev', 20, interval '1 day');

  select is_alcoholic into v_is_alcoholic from public.categories where id = p_category_id;
  if coalesce(v_is_alcoholic, false) and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  -- An asset id is the storage path media.upload returned: it must exist, in
  -- the right bucket, under the caller's own folder, uploaded by them. This is
  -- also the icon pipeline's eligibility proof -- past this point, a non-null
  -- p_photo_asset_id is known to be a real photograph this caller uploaded.
  if p_photo_asset_id is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'bev-photos'
       and o.name = p_photo_asset_id
       and (storage.foldername(o.name))[1] = v_uid::text
       and o.owner_id = v_uid::text
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'photoAssetId:unknown_asset';
  end if;
  if p_label_asset_id is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'nutrition-labels'
       and o.name = p_label_asset_id
       and (storage.foldername(o.name))[1] = v_uid::text
       and o.owner_id = v_uid::text
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'labelAssetId:unknown_asset';
  end if;

  if p_price_tier is null then
    select percentile_disc(0.5) within group (order by price_tier)
      into v_price_tier
      from public.bevs
     where category_id = p_category_id and status = 'active';
    v_price_tier := coalesce(v_price_tier, 2);
    v_price_estimated := true;
  else
    v_price_tier := p_price_tier;
    v_price_estimated := p_price_estimated;
  end if;

  -- A known barcode returns that Bev instead of a new one, but only a live
  -- one the caller may see. Returning an EXISTING Bev is not a creation
  -- event: no job is scheduled, and the icon it already has is left alone.
  if p_upc is not null then
    select * into v_existing from public.bevs
     where upc = p_upc and status = 'active'
     limit 1;
    if found then
      if (select is_alcoholic from public.categories where id = v_existing.category_id)
         and not public.viewer_is_adult() then
        raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
      end if;
      return v_existing;
    end if;
  end if;

  begin
    insert into public.bevs (
      name, brand, flavor, category_id, price_tier, price_estimated,
      upc, photo_path, thumb_path, nutrition_label_path, status, created_by, source
    )
    values (
      p_name, p_brand, p_flavor, p_category_id, v_price_tier, v_price_estimated,
      p_upc, p_photo_asset_id, p_photo_asset_id, p_label_asset_id,
      case when p_photo_asset_id is null then 'pending_photo' else 'active' end,
      v_uid, 'user'
    )
    returning * into v_row;
  exception when unique_violation then
    select * into v_existing from public.bevs
     where status in ('pending_photo', 'active')
       and (
         (category_id = p_category_id
          and lower(coalesce(brand, '')) = lower(coalesce(p_brand, ''))
          and lower(name) = lower(p_name)
          and lower(coalesce(flavor, '')) = lower(coalesce(p_flavor, '')))
         or (p_upc is not null and upc = p_upc)
       )
     limit 1;
    raise exception 'BEVI_DUPLICATE_BEV' using errcode = '23505', detail = coalesce(v_existing.id::text, '');
  end;

  -- >>> The icon pipeline's one and only trigger. <<<
  -- A Bev this call just inserted, whose creation request carried a verified
  -- photograph of its own. No photo means no job and `icon_status` stays
  -- 'none'; adding a photo later through any other path never reaches here.
  if p_photo_asset_id is not null then
    perform public.enqueue_bev_icon_job(v_row.id, p_photo_asset_id);
    -- Re-read, because `returning * into v_row` captured the row BEFORE the
    -- enqueue set `icon_status = 'pending'`. Without this the RPC answers
    -- 'none' -- documented as "never eligible, draw the placeholder" -- for
    -- precisely the Bev that just became eligible. `packages/api` happens to
    -- discard this row and re-read, so nothing is broken today, but the
    -- contract says `create` returns the Bev and any other consumer would get
    -- the wrong answer.
    select * into v_row from public.bevs where id = v_row.id;
  end if;

  return v_row;
end;
$$;
