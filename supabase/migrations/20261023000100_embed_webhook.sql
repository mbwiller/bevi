-- A-16 (1), the on-write half of the embedding pipeline.
--
-- A new or edited Bev gets its `gte-small` embedding without `create_bev` ever
-- waiting on it: an AFTER trigger queues an HTTP request to the `embed` Edge
-- Function, which does the inference and upserts `bev_embeddings`.
--
-- NOTHING HERE TOUCHES NEO4J. This is Postgres -> Edge Function -> Postgres.
-- `bev_edges` and the Aura instance are a different job's problem.
--
-- ---------------------------------------------------------------------------
-- Why pg_net directly, and not supabase_functions.http_request
-- ---------------------------------------------------------------------------
-- The dashboard's "Database Webhooks" feature installs
-- `supabase_functions.http_request()` as a trigger function. It is the obvious
-- thing to reach for and it is NOT used here, because I could not establish
-- that it exists on this project: that schema is created when webhooks are
-- first enabled in the hosted dashboard, no migration in this repo creates it,
-- there is no Docker or psql in the environment this was written in to go and
-- look, and a `create trigger ... execute function
-- supabase_functions.http_request(...)` against a project that has never
-- enabled the feature fails at migration time -- which would take the whole
-- deploy down, not just the embedding.
--
-- `pg_net` is a fact instead of a guess: `20261009000100_extensions.sql` does
-- `create extension if not exists pg_net`, so `net.http_post` is there. It is
-- also what `supabase_functions.http_request` is implemented on top of, so
-- this is the same mechanism with one fewer unverified dependency.
--
-- ---------------------------------------------------------------------------
-- Why this is genuinely async and failure-isolated
-- ---------------------------------------------------------------------------
-- `net.http_post` does not perform the request. It appends one row to
-- pg_net's queue and returns a request id immediately; a background worker
-- does the HTTP. So:
--   * the trigger adds an INSERT's worth of work to `create_bev`, not a
--     network round trip, and the Edge Function's cold start, its 2s CPU
--     budget and its failures are all invisible to the transaction;
--   * the queue row is written inside the caller's transaction, so a
--     `create_bev` that rolls back never leaves a request behind to embed a
--     Bev that does not exist;
--   * the function body is wrapped in an exception block, so even a hard
--     failure in the queueing call itself (pg_net uninstalled, the `net`
--     schema not visible to the owner, a malformed URL) degrades to a WARNING
--     and the Bev is still created.
-- A dropped request is therefore possible by design -- the Edge Function could
-- 500, or the net worker could be behind. That is deliberate: the missing row
-- is picked up by `scripts/graph/backfill-embeddings.ts`, which finds every
-- active Bev with no embedding, and by the nightly sync. The on-write path is
-- an optimisation (an embedding within seconds instead of by morning), never
-- the only path. Nothing in the app reads `bev_embeddings` on a request path.
-- So the TASKS.md-sanctioned "mark it dirty and let the backfill pick it up"
-- fallback is not needed as a second mechanism: the backfill IS that fallback,
-- and it needs no dirty column because "has no row in bev_embeddings" is
-- already the dirty flag, with `computed_at` vs `bevs.updated_at` covering the
-- edited case. A queue table would add an `authenticated`-writable surface and
-- a second thing to keep clean for no coverage this does not already have.
--
-- ---------------------------------------------------------------------------
-- Configuration, not literals
-- ---------------------------------------------------------------------------
-- The URL and the auth token are read from two custom GUCs, following the
-- `bevi.*` precedent already in this schema (`bevi.rpc_bypass`,
-- 20261011000400 and 20261019000300):
--
--   bevi.embed_function_url    e.g. https://<project-ref>.supabase.co/functions/v1/embed
--   bevi.embed_webhook_token   the EMBED_WEBHOOK_SECRET the function expects,
--                              or the service-role key when that is unset
--
-- Both are DATABASE-level settings, not per-session ones: PostgREST gives a
-- client no way to run `SET`, and no RPC in this schema calls `set_config` on
-- a `bevi.embed_*` name, so the URL this function POSTs a bearer token to
-- cannot be chosen by a caller.
--
-- Set once per environment, by a human, outside this repo -- no key is ever
-- committed:
--
--   alter database postgres set bevi.embed_function_url  = 'https://<ref>.supabase.co/functions/v1/embed';
--   alter database postgres set bevi.embed_webhook_token = '<EMBED_WEBHOOK_SECRET>';
--   select pg_reload_conf();   -- existing sessions pick it up on reconnect
--
-- EITHER SETTING MISSING OR BLANK IS A NO-OP, NOT AN ERROR. That is the
-- load-bearing property: `supabase db reset`, CI, pgTAP and any local stack
-- have no such setting, and `create_bev` has to keep working there. A blank
-- token is treated as absent too, so half-configuring the pair cannot start
-- sending unauthenticated requests.

set search_path = public, extensions;

create or replace function public.enqueue_bev_embedding()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text := nullif(current_setting('bevi.embed_function_url',  true), '');
  v_token text := nullif(current_setting('bevi.embed_webhook_token', true), '');
begin
  -- Not configured: do nothing, quietly. See the header.
  if v_url is null or v_token is null then
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
  'A-16: queues a pg_net POST to the `embed` Edge Function for one Bev. Async and failure-isolated; a no-op unless bevi.embed_function_url and bevi.embed_webhook_token are both set. SECURITY DEFINER so the owner''s USAGE on schema net is what matters, not the writer''s.';

-- SECURITY DEFINER, so pin the owner and take away every execute grant that
-- is not needed. A trigger does not check EXECUTE on its function when it
-- fires (the check happens at CREATE TRIGGER time), so revoking from everybody
-- costs nothing and means no role can call this by hand to make the database
-- POST a bearer token somewhere. `anon` is named separately because Supabase's
-- default privileges lay down a direct grant to anon, authenticated and
-- service_role on every new function in this schema, which a revoke from
-- PUBLIC does not touch (20261019000400, 20261019000500 learned this).
alter function public.enqueue_bev_embedding() owner to postgres;
revoke execute on function public.enqueue_bev_embedding()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The triggers: two, because one cannot be both precise and legal
-- ---------------------------------------------------------------------------
-- The requirement is "on insert, or when a column that feeds the embedding
-- actually changed -- not on every updated_at touch". That needs a WHEN clause
-- comparing OLD with NEW, and Postgres rejects an OLD reference in the WHEN
-- clause of a trigger that also fires on INSERT. So: one trigger per event.
--
-- The UPDATE one is doubly narrow on purpose. `UPDATE OF` fires when a column
-- is in the SET list even if the value is unchanged, so it alone would still
-- fire on `set name = name`; the WHEN clause's `is distinct from` chain is
-- what makes it fire only on a real change. Together they also mean an
-- `updated_at`-only touch, a `status` change from moderation, or a
-- `photo_path` being filled in after upload never reaches the function.
--
-- The embedded columns are exactly the ones `embeddingText()` in
-- supabase/functions/embed/text.ts reads: brand, name, flavor, category_id.
-- Add a part to that template and this list has to grow with it.

drop trigger if exists bevs_embed_after_insert on public.bevs;
create trigger bevs_embed_after_insert
  after insert on public.bevs
  for each row execute function public.enqueue_bev_embedding();

drop trigger if exists bevs_embed_after_update on public.bevs;
create trigger bevs_embed_after_update
  after update of name, brand, flavor, category_id on public.bevs
  for each row
  when (new.name        is distinct from old.name
     or new.brand       is distinct from old.brand
     or new.flavor      is distinct from old.flavor
     or new.category_id is distinct from old.category_id)
  execute function public.enqueue_bev_embedding();

-- No new table, no new policy, no new grant: `bev_embeddings` keeps exactly
-- the shape and the RLS 20261019000500 gave it (select for `authenticated`,
-- no write policy, written by the service role). This migration adds a writer
-- outside the database, not a write path inside it.
