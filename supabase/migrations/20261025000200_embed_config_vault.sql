-- A-16 (1): the embed trigger reads its config from Vault, not from a GUC.
--
-- 20261023000100 read the function URL and the bearer token with
-- `current_setting('bevi.embed_*', true)`, and its header told the deployer to
-- set them with
--
--   alter database postgres set bevi.embed_function_url = '...';
--
-- That does not work on Supabase. The `postgres` role is not a superuser here
-- (`select usesuper from pg_user where usename = current_user` is false), and
-- setting a *custom* parameter on a database requires superuser, so the
-- statement fails with
--
--   42501: permission denied to set parameter "bevi.embed_function_url"
--
-- The instruction was never executable, which is why the trigger has been a
-- silent no-op since it shipped: every write took the "not configured" branch.
-- Nothing was broken by it -- the backfill covered all 383 existing Bevs -- but
-- no NEW or EDITED Bev has been embedded automatically.
--
-- `supabase_vault` is installed, and reading a secret from it is what
-- Supabase's own database-webhook documentation does for exactly this job. It
-- also keeps the token encrypted at rest rather than sitting in
-- pg_db_role_setting in the clear, which is a better place for it than the GUC
-- ever was.
--
-- The two secrets are inserted OUTSIDE this migration, by a human or by
-- `supabase db query`, so no value is committed:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/embed',
--                              'embed_function_url',
--                              'A-16: the embed Edge Function endpoint');
--   select vault.create_secret('<EMBED_WEBHOOK_SECRET>',
--                              'embed_webhook_token',
--                              'A-16: the bearer token the embed function checks');
--
-- Everything else about the function is unchanged from 20261023000100: it is
-- still async through pg_net, still exception-wrapped so a failure can never
-- break `create_bev`, still skips a `merged` Bev, still honours
-- `bevi.embed_suspend`, and a missing secret is still a quiet no-op so
-- `supabase db reset`, CI and every local stack keep working.

set search_path = public, extensions;

create or replace function public.enqueue_bev_embedding()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text;
  v_token text;
begin
  -- Vault, not a GUC: see the header. `decrypted_secrets` is a view over
  -- vault.secrets that decrypts on read; it is readable by the table owner
  -- only, which is why this function has to be a definer to see it. A missing
  -- row yields NULL and the no-op branch below, exactly as the GUC did.
  select nullif(s.decrypted_secret, '') into v_url
    from vault.decrypted_secrets s where s.name = 'embed_function_url';
  select nullif(s.decrypted_secret, '') into v_token
    from vault.decrypted_secrets s where s.name = 'embed_webhook_token';

  -- Not configured: do nothing, quietly.
  if v_url is null or v_token is null then
    return null;
  end if;

  -- An escape hatch for bulk work that legitimately touches the embedded
  -- columns on many rows at once -- a catalog refresh that edits existing
  -- rows, or an admin correction run. `set local bevi.embed_suspend = 'true';`
  -- at the top of such a migration or session keeps it from queueing one
  -- function invocation per row; the backfill picks the rows up afterwards.
  if coalesce(current_setting('bevi.embed_suspend', true), '') = 'true' then
    return null;
  end if;

  -- A merged Bev is on its way out (A-12 re-points its rankings and removes
  -- its node and edges); embedding it would be work for a row nothing reads.
  if new.status = 'merged' then
    return null;
  end if;

  begin
    -- Queued, not sent: returns a request id at once and a background worker
    -- performs the POST. The body is the function's canonical input shape.
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('bevIds', jsonb_build_array(new.id),
                                    'source', 'bevs_trigger'),
      headers := jsonb_build_object('Content-Type',  'application/json',
                                    'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- Never let the embedding break the write. The backfill will catch this
    -- Bev; losing its vector for a few hours costs a slightly worse
    -- "Bevs like this" row and nothing else.
    raise warning 'enqueue_bev_embedding: could not queue bev % (%: %)',
      new.id, sqlstate, sqlerrm;
  end;

  return null;  -- AFTER ... FOR EACH ROW: the return value is ignored.
end;
$$;

comment on function public.enqueue_bev_embedding() is
  'A-16: queues a pg_net POST to the `embed` Edge Function for one Bev. Async and failure-isolated; a no-op unless the Vault secrets embed_function_url and embed_webhook_token both exist. SECURITY DEFINER so the owner''s access to vault.decrypted_secrets and schema net is what matters, not the writer''s.';

-- Unchanged from 20261023000100, restated because a migration is append-only:
-- a trigger does not check EXECUTE when it fires, so revoking from everybody
-- costs nothing and means no role can call this by hand to make the database
-- POST a bearer token to a URL of its choosing.
alter function public.enqueue_bev_embedding() owner to postgres;
revoke execute on function public.enqueue_bev_embedding() from public, anon, authenticated, service_role;
