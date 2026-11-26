-- Claims are leases, not merely a status. A release/retry must never reuse a
-- lease token. Old RPCs are revoked so old workers fail closed on rollout.
alter table public.bev_icon_jobs
  add column claim_token uuid,
  add column retryable boolean not null default true,
  add column next_attempt_at timestamptz not null default now();

create function public.claim_bev_icon_jobs_v2(p_limit integer default 1)
returns table(bev_id uuid, source_photo_path text, attempt_count integer, claim_token uuid)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  with expired as (
    update public.bev_icon_jobs j
       set status = 'failed', retryable = false, claim_token = null,
           last_error = coalesce(j.last_error, 'generation_expired_or_unavailable')
     where j.status <> 'completed' and (j.retryable or j.status = 'processing')
       and (j.created_at < now() - public.bev_icon_give_up_after()
         or (j.attempt_count >= public.bev_icon_max_attempts()
             and (j.status <> 'processing' or j.started_at < now() - public.bev_icon_stale_after()))
         or not exists (select 1 from public.bevs b where b.id = j.bev_id and b.status = 'active'))
    returning j.bev_id
  ) update public.bevs b set icon_status = 'failed' where b.id in (select e.bev_id from expired e);

  return query
  with candidates as (
    select j.bev_id from public.bev_icon_jobs j
    join public.bevs b on b.id = j.bev_id and b.status = 'active'
    where j.retryable and j.attempt_count < public.bev_icon_max_attempts()
      and j.created_at >= now() - public.bev_icon_give_up_after()
      and j.next_attempt_at <= now()
      and (j.status in ('pending', 'failed')
        or (j.status = 'processing' and j.started_at < now() - public.bev_icon_stale_after()))
    order by j.created_at, j.bev_id
    limit least(greatest(coalesce(p_limit, 1), 1), 25)
    for update of j skip locked
  ), claimed as (
    update public.bev_icon_jobs j
       set status = 'processing', attempt_count = j.attempt_count + 1,
           started_at = now(), completed_at = null, last_error = null,
           claim_token = gen_random_uuid()
     where j.bev_id in (select c.bev_id from candidates c)
    returning j.*
  ), marked as (
    update public.bevs b set icon_status = 'processing'
    where b.id in (select c.bev_id from claimed c) returning b.id
  ) select c.bev_id, c.source_photo_path, c.attempt_count, c.claim_token from claimed c;
end;
$$;

create function public.finish_bev_icon_job_v2(
  p_bev_id uuid, p_claim_token uuid, p_status text,
  p_icon_path text default null, p_error text default null,
  p_label_band jsonb default null, p_retryable boolean default true
) returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare j public.bev_icon_jobs; v_retry boolean;
begin
  select * into j from public.bev_icon_jobs where bev_id = p_bev_id for update;
  if not found or j.status <> 'processing' or j.claim_token is distinct from p_claim_token
    or p_claim_token is null then return false; end if;
  if p_status is null or p_status not in ('completed', 'failed') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'status';
  end if;
  if p_status = 'completed' and p_icon_path is distinct from
      (p_bev_id::text || '/' || p_claim_token::text || '/icon-768.png') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'iconPath';
  end if;
  if not exists (select 1 from public.bevs where id = p_bev_id and status = 'active') then
    update public.bev_icon_jobs set status = 'failed', retryable = false,
      claim_token = null, last_error = 'bev_unavailable' where bev_id = p_bev_id;
    update public.bevs set icon_status = 'failed' where id = p_bev_id;
    return true;
  end if;
  if p_status = 'completed' then
    update public.bev_icon_jobs set status = 'completed', completed_at = now(),
      claim_token = null, retryable = false, last_error = null where bev_id = p_bev_id;
    update public.bevs set generated_icon_path = p_icon_path, icon_label_band = p_label_band,
      icon_status = 'completed' where id = p_bev_id;
  else
    v_retry := coalesce(p_retryable, false) and j.attempt_count < public.bev_icon_max_attempts()
      and j.created_at >= now() - public.bev_icon_give_up_after();
    update public.bev_icon_jobs set status = 'failed', completed_at = null,
      retryable = v_retry, claim_token = null, last_error = left(p_error, 500),
      next_attempt_at = now() + make_interval(secs => least(1800, 60 * power(2, greatest(j.attempt_count - 1, 0)))::integer)
      where bev_id = p_bev_id;
    update public.bevs set icon_status = case when v_retry then 'pending' else 'failed' end where id = p_bev_id;
  end if;
  return true;
end;
$$;

create function public.release_bev_icon_job_v2(p_bev_id uuid, p_claim_token uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare j public.bev_icon_jobs;
begin
  select * into j from public.bev_icon_jobs where bev_id = p_bev_id for update;
  if not found or j.status <> 'processing' or j.claim_token is distinct from p_claim_token
    or p_claim_token is null then return false; end if;
  update public.bev_icon_jobs set status = 'pending', claim_token = null,
    attempt_count = greatest(attempt_count - 1, 0), started_at = null,
    completed_at = null, next_attempt_at = now() + interval '15 minutes',
    last_error = left(p_reason, 500) where bev_id = p_bev_id;
  update public.bevs set icon_status = 'pending' where id = p_bev_id;
  return true;
end;
$$;

-- The drain must wake the reaper for expired/stale jobs, even when no retry
-- is currently due. Completed and terminal jobs never keep the cron busy.
create or replace function public.drain_bev_icon_jobs()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_token text;
begin
  if not exists (select 1 from public.bev_icon_jobs j
    where j.status <> 'completed' and (j.retryable or j.status = 'processing')
      and (j.created_at < now() - public.bev_icon_give_up_after()
        or (j.status in ('pending', 'failed') and j.next_attempt_at <= now())
        or (j.status = 'processing' and j.started_at < now() - public.bev_icon_stale_after()))) then return; end if;
  begin
    select nullif(decrypted_secret, '') into v_url from vault.decrypted_secrets where name = 'icon_function_url';
    select nullif(decrypted_secret, '') into v_token from vault.decrypted_secrets where name = 'icon_webhook_token';
    if v_url is null or v_token is null then return; end if;
    perform net.http_post(url := v_url, body := '{"source":"cron"}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000);
  exception when others then raise warning 'icon drain could not queue a worker request'; end;
end;
$$;

revoke execute on function public.claim_bev_icon_jobs(integer),
  public.finish_bev_icon_job(uuid,text,text,text,jsonb), public.release_bev_icon_job(uuid,text)
  from public, anon, authenticated, service_role;
alter function public.claim_bev_icon_jobs_v2(integer) owner to postgres;
alter function public.finish_bev_icon_job_v2(uuid,uuid,text,text,text,jsonb,boolean) owner to postgres;
alter function public.release_bev_icon_job_v2(uuid,uuid,text) owner to postgres;
revoke all on function public.claim_bev_icon_jobs_v2(integer),
  public.finish_bev_icon_job_v2(uuid,uuid,text,text,text,jsonb,boolean),
  public.release_bev_icon_job_v2(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_bev_icon_jobs_v2(integer),
  public.finish_bev_icon_job_v2(uuid,uuid,text,text,text,jsonb,boolean),
  public.release_bev_icon_job_v2(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
