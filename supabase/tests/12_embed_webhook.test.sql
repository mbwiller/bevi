-- A-16 (1), the on-write half of the embedding pipeline
-- (20261023000100_embed_webhook.sql, config moved to Vault by 20261025000200,
-- Vault reads guarded by 20261031000100): the async `bevs` trigger that asks
-- the `embed` Edge Function for a Bev's gte-small vector.
--
-- What this file is for, in order: that the trigger function exists, is
-- SECURITY DEFINER and is not callable by a user role; that pg_net -- the
-- mechanism the migration chose over the unverifiable
-- `supabase_functions.http_request` -- is really installed; that the two
-- triggers are attached to exactly the right events, columns and condition, so
-- an `updated_at` touch cannot fire them; that writing a Bev still succeeds
-- with the configuration absent, which is the state of every local stack and
-- of CI, and queues nothing; that with both Vault secrets present a user
-- Bev's insert or rename queues exactly one request, while a merged Bev,
-- `bevi.embed_suspend` and a blank token queue none; and that this migration
-- left `bev_embeddings`
-- with no write path for `authenticated` and the shape prod already has.
--
-- NO NEO4J. Nothing here, and nothing in the migration under test, reaches
-- the Aura instance.
--
-- NOT COVERED HERE, because it needs a deployed function and a configured
-- project: that a queued request is actually delivered, that `embed` returns
-- 401 to an anonymous caller, and that the vector it writes has 384 values.
-- Those are the deploy-time checks in the PR description. Nor is a Vault read
-- that throws: reproducing one would mean revoking the owner's access to
-- vault.decrypted_secrets, which a test transaction cannot do safely. That
-- path is a code-review property of 20261031000100.
--
-- Fixture uuid prefix: ...0000000be0NN ("be" for bev embeddings, both hex).
-- Checked against every other file in supabase/tests/: 11_graph_tables uses
-- ed001..ed003, 09_leaderboard_parity ab001..ab006 and ab011..ab013,
-- 10_explore d1..d6 and ff01..ff14, and the earlier files a1, b1..b2, c1..c3,
-- e1..e3, f1..f4 and ffff. be0NN collides with none.

begin;
select plan(35);

-- ---------------------------------------------------------------------------
-- 1. The trigger function
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enqueue_bev_embedding'
  ),
  'public.enqueue_bev_embedding() exists'
);

-- SECURITY DEFINER so what matters is the owner's USAGE on schema net, not
-- the privileges of whoever happened to write the Bev.
select is(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_bev_embedding'),
  true,
  'enqueue_bev_embedding is security definer'
);

-- A trigger does not check EXECUTE when it fires, so revoking it costs
-- nothing and stops any role calling this by hand to make the database POST a
-- bearer token to a URL of its choosing.
select ok(
  not has_function_privilege('authenticated', 'public.enqueue_bev_embedding()', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_bev_embedding()', 'execute'),
  'neither anon nor authenticated may execute enqueue_bev_embedding directly'
);

-- ---------------------------------------------------------------------------
-- 2. The mechanism: pg_net, not supabase_functions.http_request
-- ---------------------------------------------------------------------------
-- The migration relies on pg_net because `20261009000100_extensions.sql`
-- installs it, whereas `supabase_functions.http_request` only appears once
-- database webhooks have been enabled in the hosted dashboard and could not be
-- established to exist. These two assertions are what makes that a fact rather
-- than an assumption.

select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net is installed, so net.http_post is a real mechanism and not a guess'
);
select ok(
  exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post'
  ),
  'net.http_post() exists'
);

-- ---------------------------------------------------------------------------
-- 3. The triggers: the right events, the right columns, the right condition
-- ---------------------------------------------------------------------------
-- pg_trigger.tgtype is a bitmask: ROW 1, BEFORE 2, INSERT 4, DELETE 8,
-- UPDATE 16. So AFTER INSERT FOR EACH ROW is 1|4 = 5 and AFTER UPDATE FOR EACH
-- ROW is 1|16 = 17. AFTER matters: BEFORE would put the queue insert inside
-- the row's own write path, and a trigger that fired on DELETE would ask the
-- function to embed a Bev that no longer exists.

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.bevs'::regclass
      and tgfoid = 'public.enqueue_bev_embedding()'::regprocedure
      and not tgisinternal),
  2,
  'exactly two triggers on bevs call enqueue_bev_embedding (one per event)'
);
select is(
  (select tgtype::int from pg_trigger
    where tgrelid = 'public.bevs'::regclass and tgname = 'bevs_embed_after_insert'),
  5,
  'bevs_embed_after_insert is AFTER INSERT ... FOR EACH ROW'
);
select is(
  (select tgtype::int from pg_trigger
    where tgrelid = 'public.bevs'::regclass and tgname = 'bevs_embed_after_update'),
  17,
  'bevs_embed_after_update is AFTER UPDATE ... FOR EACH ROW'
);

-- The UPDATE trigger is narrowed twice: the column list keeps it from firing
-- on an `updated_at`, `status` or `photo_path` write at all, and the WHEN
-- clause keeps it from firing when one of these four columns is in the SET
-- list but unchanged (`set name = name`). The four are exactly the columns
-- embeddingText() in supabase/functions/embed/text.ts reads.
select is(
  (select string_agg(a.attname, ',' order by a.attname)
     from pg_trigger t
     -- tgattr is an int2vector; its text form is space separated, which is the
     -- portable way to expand it without relying on a cast to smallint[].
     cross join unnest(string_to_array(t.tgattr::text, ' ')::smallint[]) as col(attnum)
     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
    where t.tgrelid = 'public.bevs'::regclass and t.tgname = 'bevs_embed_after_update'),
  'brand,category_id,flavor,name',
  'the update trigger watches exactly the four columns that feed the embedding'
);
select ok(
  (select tgqual is not null from pg_trigger
    where tgrelid = 'public.bevs'::regclass and tgname = 'bevs_embed_after_update'),
  'the update trigger has a WHEN condition, so an unchanged value does not fire it'
);
-- The INSERT trigger is narrowed to `source = 'user'`. Without that, a catalog
-- seed migration -- 378 rows in one statement in 20261014000500 -- would queue
-- a pg_net request per row inside its own transaction, and the worker would
-- then fire 378 function invocations and inferences. Seeded rows are the
-- backfill's job.
select ok(
  (select tgqual is not null from pg_trigger
    where tgrelid = 'public.bevs'::regclass and tgname = 'bevs_embed_after_insert'),
  'the insert trigger has a WHEN condition, so a seeded catalog row does not fan out'
);

-- ---------------------------------------------------------------------------
-- 4. The no-op path: writing a Bev with no configuration
-- ---------------------------------------------------------------------------
-- This is the state of every local stack, every `supabase db reset` and CI:
-- neither Vault secret exists. (A blank secret counts as absent too; section
-- 4b tests that, once the pair exists.)
--
-- If this section ever fails, `create_bev` is broken on every environment that
-- has not been configured, which is the whole reason the migration treats a
-- missing setting as a no-op rather than an error.

-- The temp table comes first so the session's temp schema certainly exists
-- before anything is created in pg_temp.
create temporary table t_before (queued int not null) on commit drop;

-- Counting pg_net's queue needs a function because a static reference to
-- net.http_request_queue would fail to parse where pg_net is absent, which
-- would turn a vacuous pass into a file-wide error.
create function pg_temp.net_queued() returns int language plpgsql as $fn$
declare n int := 0;
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'select count(*)::int from net.http_request_queue' into n;
  end if;
  return n;
end;
$fn$;

insert into t_before (queued) values (pg_temp.net_queued());

-- A user-created Bev, exactly as create_bev makes one: pending_photo first.
select lives_ok(
  $$ insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source)
     values ('00000000-0000-4000-8000-0000000be001', 'pgTAP Embed Cola', 'pgTAP Embed',
             'Cherry', 'soda', 2, 'pending_photo', 'user') $$,
  'inserting a Bev succeeds with no embed configuration (the insert trigger no-ops)'
);

-- create_bev's second step, once the photo has uploaded. Neither column is in
-- the update trigger's column list, so this one does not even reach the
-- function.
select lives_ok(
  $$ update public.bevs
        set status = 'active', photo_path = 'bevs/pgtap-embed.jpg', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'filling in the photo and activating the Bev succeeds'
);

-- An embedded column really changing: the one case the update trigger is for.
select lives_ok(
  $$ update public.bevs set name = 'pgTAP Embed Cola Zero', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'renaming a Bev succeeds with no embed configuration (the update trigger no-ops)'
);

-- The case the column list exists to exclude.
select lives_ok(
  $$ update public.bevs set updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'an updated_at-only touch succeeds'
);

select is(
  pg_temp.net_queued() - (select queued from t_before),
  0,
  'and none of those four writes queued an HTTP request, because the configuration is absent'
);

-- The suspend escape hatch, for bulk work that legitimately edits the embedded
-- columns on many rows. It only ever suppresses work, so the worst outcome is
-- a missing embedding that the backfill repairs.
set local bevi.embed_suspend = 'true';
select lives_ok(
  $$ update public.bevs set name = 'pgTAP Embed Cola Suspended', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'bevi.embed_suspend makes the trigger a no-op without breaking the write'
);
set local bevi.embed_suspend = 'false';

-- ---------------------------------------------------------------------------
-- 4b. The configured path: both Vault secrets present
-- ---------------------------------------------------------------------------
-- Nothing tested this before. The secrets and every queued row live only in
-- this transaction, which rolls back, so pg_net's worker never sees a request
-- and no HTTP is sent. The URL points at a closed local port for the same
-- reason. The deltas below are cumulative from one baseline.
--
-- On a local stack where someone has already created either secret by hand,
-- vault.create_secret fails on the unique name and so does this section; CI
-- and a fresh `supabase db reset` have no secrets.

create temporary table t_configured (queued int not null) on commit drop;
insert into t_configured (queued) values (pg_temp.net_queued());

select lives_ok(
  $$ select vault.create_secret('http://127.0.0.1:1/functions/v1/embed', 'embed_function_url') $$,
  'the embed_function_url Vault secret can be created'
);
select lives_ok(
  $$ select vault.create_secret('pgtap-embed-token', 'embed_webhook_token') $$,
  'the embed_webhook_token Vault secret can be created'
);

select lives_ok(
  $$ insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source)
     values ('00000000-0000-4000-8000-0000000be002', 'pgTAP Embed Lemonade', 'pgTAP Embed',
             'Lemon', 'juice', 2, 'pending_photo', 'user') $$,
  'inserting a user Bev succeeds with the embed configuration present'
);
select is(
  pg_temp.net_queued() - (select queued from t_configured),
  1,
  'and it queued exactly one request'
);

select lives_ok(
  $$ update public.bevs set name = 'pgTAP Embed Cola Configured', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'renaming a Bev succeeds with the embed configuration present'
);
select is(
  pg_temp.net_queued() - (select queued from t_configured),
  2,
  'and the rename queued exactly one more'
);

-- `merged` is set by A-12's merge in the same statement that may touch an
-- embedded column (the bevs check pairs `merged` with `merged_into`); the
-- column change fires the trigger, the status stops it.
select lives_ok(
  $$ update public.bevs
        set status = 'merged', merged_into = '00000000-0000-4000-8000-0000000be001',
            name = 'pgTAP Embed Lemonade Merged', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be002' $$,
  'renaming a Bev while marking it merged succeeds'
);
select is(
  pg_temp.net_queued() - (select queued from t_configured),
  2,
  'and a merged Bev queues nothing'
);

set local bevi.embed_suspend = 'true';
select lives_ok(
  $$ update public.bevs set name = 'pgTAP Embed Cola Suspended Again', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'renaming under bevi.embed_suspend succeeds with the configuration present'
);
set local bevi.embed_suspend = 'false';
select is(
  pg_temp.net_queued() - (select queued from t_configured),
  2,
  'and bevi.embed_suspend queues nothing even when configured'
);

-- Half-configuring the pair must not start sending unauthenticated requests.
select lives_ok(
  $$ select vault.update_secret(
       (select id from vault.secrets where name = 'embed_webhook_token'), '') $$,
  'the token can be blanked'
);
select lives_ok(
  $$ update public.bevs set name = 'pgTAP Embed Cola Blank Token', updated_at = now()
      where id = '00000000-0000-4000-8000-0000000be001' $$,
  'renaming a Bev succeeds with a blank token'
);
select is(
  pg_temp.net_queued() - (select queued from t_configured),
  2,
  'and a blank token counts as absent: nothing queued'
);

-- ---------------------------------------------------------------------------
-- 5. bev_embeddings: still no write path for authenticated, still prod's shape
-- ---------------------------------------------------------------------------
-- This migration adds a writer outside the database (the Edge Function, as the
-- service role), not a write path inside it. `bev_embeddings` is on prod and
-- migrations are append-only, so its shape must be exactly what
-- 20261019000500 created.

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_embeddings'::regclass),
  'bev_embeddings still has RLS enabled'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'bev_embeddings'),
  4,
  'bev_embeddings still has its four prod columns (bev_id, embedding, model, computed_at)'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_embeddings'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no insert/update/delete policy for authenticated on bev_embeddings'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_embeddings'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no write policy on bev_embeddings for any role -- only the service role, which bypasses RLS'
);

-- The live attempt. Supabase's default privileges may well have granted
-- `authenticated` the INSERT privilege on this table, which is exactly why the
-- absence of a permissive policy is what does the work: with RLS enabled and
-- no INSERT policy, the row is refused. Both the "permission denied" and the
-- "violates row-level security policy" failures are 42501, so this assertion
-- holds whichever way the grant went.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000be0a1", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.bev_embeddings (bev_id, embedding)
     values ('00000000-0000-4000-8000-0000000be001',
             ('[' || (select string_agg('0.05', ',') from generate_series(1, 384)) || ']')::extensions.vector(384)) $$,
  '42501',
  null,
  'an authenticated caller cannot write its own embedding row'
);

reset role;
select * from finish();
rollback;
