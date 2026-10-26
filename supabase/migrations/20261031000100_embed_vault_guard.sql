-- A-16 (1): the embed trigger's Vault reads move inside an exception handler.
--
-- 20261025000200 moved the trigger's config from GUCs to Vault, but it put the
-- two `select ... from vault.decrypted_secrets` statements BEFORE the
-- `begin ... exception` block that wraps `net.http_post`. The GUC reads they
-- replaced were `current_setting(..., true)`, which cannot throw; a Vault read
-- can (the extension missing, the owner losing SELECT on the view after a
-- platform change, a decryption error). An error there would abort the user's
-- `bevs` INSERT or UPDATE, and with it `create_bev` -- the one thing both
-- earlier headers promise a failure here can never do. Found by the integrator
-- review of #123, after 20261025000200 was already on prod, so this is a new
-- migration rather than an edit.
--
-- Two changes, nothing else:
--   1. The Vault reads sit in their own handler. A failure logs a warning and
--      takes the same quiet no-op path as a missing secret; the write goes on.
--   2. The `bevi.embed_suspend` and `merged` checks run first, so bulk work
--      under `embed_suspend = 'true'` no longer decrypts two secrets per row.
--
-- A note on "encrypted at rest" in 20261025000200's header: true of the Vault
-- row, but every queued request still writes the bearer token in clear text
-- into `net.http_request_queue` until pg_net's worker consumes it, exactly as
-- before. docs/graph.md says so.

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

  -- Vault, not a GUC (20261025000200). `decrypted_secrets` is a view over
  -- vault.secrets that decrypts on read and is readable by the owner only,
  -- which is why this function is a definer. A missing row yields NULL. Unlike
  -- current_setting(..., true) a read here CAN throw, so it is caught: an
  -- unreadable config is treated like an absent one, and the write goes on.
  begin
    select nullif(s.decrypted_secret, '') into v_url
      from vault.decrypted_secrets s where s.name = 'embed_function_url';
    select nullif(s.decrypted_secret, '') into v_token
      from vault.decrypted_secrets s where s.name = 'embed_webhook_token';
  exception when others then
    raise warning 'enqueue_bev_embedding: could not read the embed config from Vault (%: %)',
      sqlstate, sqlerrm;
    return null;
  end;

  -- Not configured: do nothing, quietly.
  if v_url is null or v_token is null then
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
  'A-16: queues a pg_net POST to the `embed` Edge Function for one Bev. Async and failure-isolated, including the Vault reads; a no-op unless the Vault secrets embed_function_url and embed_webhook_token both exist. SECURITY DEFINER so the owner''s access to vault.decrypted_secrets and schema net is what matters, not the writer''s.';

-- Unchanged, restated because a migration is append-only: a trigger does not
-- check EXECUTE when it fires, so revoking from everybody costs nothing and
-- means no role can call this by hand to make the database POST a bearer
-- token to a URL of its choosing.
alter function public.enqueue_bev_embedding() owner to postgres;
revoke execute on function public.enqueue_bev_embedding() from public, anon, authenticated, service_role;
