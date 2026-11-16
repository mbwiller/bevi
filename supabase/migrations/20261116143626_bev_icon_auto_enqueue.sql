-- Automatically queue a new photo-backed Bev. The queue is durable even when
-- the worker is disabled or its notification secrets are not configured.
-- Historical opt-in-era rows stay stopped; this does not bulk-generate icons.
update public.bev_icon_jobs set status = 'failed', retryable = false,
  claim_token = null, last_error = 'legacy_job_not_requeued'
where status <> 'completed';
update public.bevs b set icon_status = 'none'
where b.icon_status in ('pending', 'processing')
  and not exists (select 1 from public.bev_icon_jobs j where j.bev_id = b.id and j.status = 'completed');

create or replace function public.enqueue_bev_icon_job(p_bev_id uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_token text;
begin
  if p_bev_id is null or p_photo_path is null then return; end if;

  -- The original photo was validated by create_bev. This durable row is the
  -- automatic pipeline trigger; it is independent of provider availability.
  insert into public.bev_icon_jobs(bev_id, source_photo_path)
    values(p_bev_id, p_photo_path) on conflict(bev_id) do nothing;
  if not found then return; end if;

  update public.bevs set icon_status = 'pending' where id = p_bev_id;
  if coalesce(current_setting('bevi.icon_suspend', true), '') = 'true' then return; end if;

  -- Best-effort wake-up. The durable queue and cron drain remain the fallback.
  begin
    select nullif(decrypted_secret, '') into v_url
      from vault.decrypted_secrets where name = 'icon_function_url';
    select nullif(decrypted_secret, '') into v_token
      from vault.decrypted_secrets where name = 'icon_webhook_token';
  exception when others then
    raise warning 'enqueue_bev_icon_job: could not read icon worker configuration (%: %)', sqlstate, sqlerrm;
    return;
  end;
  if v_url is null or v_token is null then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('bevIds', jsonb_build_array(p_bev_id), 'source', 'create_bev'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'enqueue_bev_icon_job: could not notify for Bev % (%: %)', p_bev_id, sqlstate, sqlerrm;
  end;
end;
$$;

alter function public.enqueue_bev_icon_job(uuid, text) owner to postgres;
revoke execute on function public.enqueue_bev_icon_job(uuid, text)
  from public, anon, authenticated, service_role;
comment on function public.enqueue_bev_icon_job(uuid, text) is
  'Automatically records one durable icon-generation job for a newly created photo-backed Bev and best-effort wakes the worker. The job remains queued if the worker is disabled or unavailable; called only by create_bev.';
