-- Custom Bevs, part 1: the generated-icon job ledger
-- (20261119185800_bev_icon_jobs.sql).
--
-- The feature's one non-negotiable requirement is a negative: an
-- image-generation job exists for a brand-new Bev created WITH an uploaded
-- photograph, and for nothing else. That is almost entirely testable here,
-- with no provider, no Edge Function and no network -- which is why this file
-- comes before either of those exists. "No API request occurred" is asserted
-- as "no job row was created", because the worker's only source of work is
-- claim_bev_icon_jobs() and a row it cannot see is a call it cannot make.
--
-- What this file covers, in order: the ledger's shape, and that one Bev
-- physically cannot hold two initial jobs; that no client role can reach any
-- of the three functions it should not; the bucket's limits; that writing an
-- icon result fans out to no embedding inference, which is the property that
-- keeps an icon from touching the recommender; create_bev's eligibility
-- decision from both sides, including a duplicate submission; the whole job
-- lifecycle (claim, complete, fail, retry, exhaust); the reaper that stops an
-- abandoned job reading as "waiting forever"; that enqueueing twice for one Bev
-- changes nothing; `get_bev_icons` and the catalog art it offers a custom Bev
-- to borrow; and finally that every read in the file scheduled nothing.
--
-- NOT COVERED HERE, because a single test transaction cannot produce it:
--   * two workers claiming concurrently. That is `for update skip locked`,
--     which needs two sessions. It is a code-review property of the migration
--     and a Deno test against a real stack.
--   * that a queued pg_net request is delivered, and that the Edge Function
--     refuses an anonymous caller. Those need a deployed function.
--   * that the provider returns usable art. That is the spike, and it is not
--     a database property.
--
-- Fixture uuid prefix: ...0000000fa0NN, and ...0000000fa0aN for users.
-- Checked against every other file in supabase/tests/: the prefixes in use
-- are 0000000ab0, 0000000be0, 0000000ca0, 0000000cd0 and 0000000ed0, plus the
-- short a1..f4, d1..d6, ff01..ff14 and ffff. fa0 collides with none.

begin;
select plan(94);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000fa0a1', 'pgtapicon1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000fa0a2', 'pgtapicon2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- A. The ledger's shape
-- ---------------------------------------------------------------------------
-- `bev_id` as the PRIMARY KEY is the entire duplicate-prevention story: not a
-- uniqueness convention the worker is trusted to honour, but a constraint the
-- database enforces against every client retry, replayed webhook and
-- restarted worker at once. recommendation_jobs (20261009000700) is the same
-- shape, so this is the house pattern rather than a new idea.

select is(
  (select string_agg(a.attname, ',' order by a.attname)
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.bev_icon_jobs'::regclass and i.indisprimary),
  'bev_id',
  'bev_icon_jobs is keyed by bev_id alone, so one Bev cannot hold two initial jobs'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_icon_jobs'::regclass),
  'bev_icon_jobs has RLS enabled'
);
-- Not "no write policy" but NO POLICY. With RLS on and nothing permissive, a
-- read by `authenticated` succeeds and returns NO ROWS -- it is not an error,
-- which is a distinction section K asserts precisely -- so attempt_count and
-- last_error (a provider diagnostic) have no path to a client. What a client
-- is allowed to know is bevs.icon_status.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_icon_jobs'),
  0,
  'bev_icon_jobs has no policy at all: security-definer functions are the only access path'
);
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'bevs'
      and column_name in ('generated_icon_path', 'icon_status')),
  2,
  'bevs gained generated_icon_path and icon_status'
);
-- 'none' means "was never eligible", which is what makes the default correct
-- for the 378 seeded rows and for every Bev created without a photo. A default
-- of 'pending' would have left them all reading as waiting for art forever.
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'bevs' and column_name = 'icon_status'),
  '''none''::text',
  'icon_status defaults to ''none'': never eligible, not waiting'
);
select throws_ok(
  $$ update public.bevs set icon_status = 'queued'
      where id = (select id from public.bevs where source = 'seed' limit 1) $$,
  '23514',
  null,
  'an icon_status outside the five known states is rejected'
);
select throws_ok(
  $$ insert into public.bev_icon_jobs (bev_id, source_photo_path, status, completed_at)
     values ((select id from public.bevs where source = 'seed' limit 1), 'x/y.jpg', 'pending', now()) $$,
  '23514',
  null,
  'completed_at and status cannot disagree'
);

-- ---------------------------------------------------------------------------
-- B. Who may call what
-- ---------------------------------------------------------------------------
-- enqueue mints work and makes the database POST a bearer token; claim hands
-- out work; finish writes an asset path onto a Bev. A signed-in user has no
-- business doing any of the three -- being able to call finish would mean
-- being able to put an arbitrary image on somebody else's Bev.

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_bev_icon_job'),
  'enqueue_bev_icon_job is security definer'
);
select ok(
  not has_function_privilege('anon',          'public.enqueue_bev_icon_job(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_bev_icon_job(uuid,text)', 'execute')
  and not has_function_privilege('service_role',  'public.enqueue_bev_icon_job(uuid,text)', 'execute'),
  'no role may execute enqueue_bev_icon_job -- only create_bev, as the definer'
);
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_bev_icon_jobs'),
  'claim_bev_icon_jobs is security definer'
);
select ok(
  not has_function_privilege('anon', 'public.claim_bev_icon_jobs(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_bev_icon_jobs(integer)', 'execute'),
  'neither anon nor authenticated may claim a job'
);
select ok(
  has_function_privilege('service_role', 'public.claim_bev_icon_jobs(integer)', 'execute'),
  'the service role may claim jobs, which is how the worker gets its work'
);
select ok(
  not has_function_privilege('anon', 'public.finish_bev_icon_job(uuid,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_bev_icon_job(uuid,text,text,text,jsonb)', 'execute'),
  'neither anon nor authenticated may write an icon result'
);
select ok(
  has_function_privilege('service_role', 'public.finish_bev_icon_job(uuid,text,text,text,jsonb)', 'execute'),
  'the service role may write an icon result'
);

-- ---------------------------------------------------------------------------
-- C. The bucket
-- ---------------------------------------------------------------------------

select ok(
  (select public from storage.buckets where id = 'bev-generated-icons'),
  'bev-generated-icons exists and is public, so icons are served from the CDN'
);
select ok(
  (select file_size_limit = 2097152
     and allowed_mime_types @> array['image/png', 'image/webp']
     and array_length(allowed_mime_types, 1) = 2
     from storage.buckets where id = 'bev-generated-icons'),
  'bev-generated-icons caps objects at 2 MB and accepts only png and webp'
);

-- The bucket this pipeline must NOT write to, and the reason it has its own.
-- 20261112000200 owns `bev-icons` for the authored catalogue SVGs: a raster
-- PNG posted there is refused on mime type, and the worker would burn every
-- attempt while both suites stayed green. Asserting the two are distinct, and
-- that this feature leaves main's settings alone, is what makes that
-- impossible to reintroduce quietly.
select ok(
  (select allowed_mime_types = array['image/svg+xml'] and file_size_limit = 524288
     from storage.buckets where id = 'bev-icons'),
  'bev-icons is still main''s authored-SVG bucket: this feature does not touch it'
);

-- A user never uploads a generated icon: the service role writes them, and
-- public objects are read through the endpoint that bypasses RLS.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      -- coalesce BOTH: `qual` is null on an INSERT-only policy, and a null
      -- concatenation would make such a policy invisible to this count.
      and coalesce(qual, '') || coalesce(with_check, '') like '%bev-generated-icons%'),
  0,
  'no storage policy mentions bev-generated-icons: nothing but the service role writes there'
);

-- ---------------------------------------------------------------------------
-- D. An icon result fans out to nothing
-- ---------------------------------------------------------------------------
-- This is what keeps the illustration out of the recommender. The embedding
-- trigger (20261023000100) fires on UPDATE OF (name, brand, flavor,
-- category_id); the leaf guard (20261026000100) on (category_id,
-- leaf_category_id). Neither new column is in either list, so publishing an
-- icon queues no model inference and no graph work. Asserted as a property of
-- the trigger AND by counting pg_net's queue across a real write.

select is(
  (select string_agg(a.attname, ',' order by a.attname)
     from pg_trigger t
     cross join unnest(string_to_array(t.tgattr::text, ' ')::smallint[]) as col(attnum)
     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
    where t.tgrelid = 'public.bevs'::regclass and t.tgname = 'bevs_embed_after_update'),
  'brand,category_id,flavor,name',
  'the embedding trigger still watches only its four columns -- neither icon column is one'
);

create temporary table t_icon_net (queued int not null) on commit drop;

-- Counting pg_net's queue needs a function because a static reference to
-- net.http_request_queue would fail to parse where pg_net is absent, turning
-- a vacuous pass into a file-wide error (12_embed_webhook does the same).
create function pg_temp.net_queued() returns int language plpgsql as $fn$
declare n int := 0;
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'select count(*)::int from net.http_request_queue' into n;
  end if;
  return n;
end;
$fn$;

insert into t_icon_net (queued) values (pg_temp.net_queued());

select lives_ok(
  $$ update public.bevs
        set generated_icon_path = 'x/icon-768.png', icon_status = 'completed'
      where id = (select id from public.bevs where source = 'seed' order by id limit 1) $$,
  'publishing an icon onto a Bev succeeds'
);
select is(
  pg_temp.net_queued() - (select queued from t_icon_net),
  0,
  'and queued no HTTP request: an icon is art, and it changes nothing the recommender reads'
);

-- Leave no icon on a seeded row for the rest of the file.
update public.bevs set generated_icon_path = null, icon_status = 'none'
 where id = (select id from public.bevs where source = 'seed' order by id limit 1);

-- ---------------------------------------------------------------------------
-- E. create_bev: the eligibility decision, from both sides
-- ---------------------------------------------------------------------------
-- The fixture objects are inserted by the owner because the Storage API is
-- not in the picture here and storage.objects RLS would stop `authenticated`
-- planting them (09_avatars does the same). fa0a1 owns one bev photo.
--
-- !! ROLE MATTERS IN THIS SECTION !!
-- create_bev must be called as `authenticated`, but bev_icon_jobs has RLS on
-- with NO policy, so `authenticated` reads zero rows from it NO MATTER WHAT.
-- Counting jobs while still in that role is how an assertion passes
-- vacuously: "no job was scheduled" would be true even when one was. Every
-- job count below therefore runs after `reset role`, as the table owner.

insert into storage.objects (bucket_id, name, owner_id) values
  ('bev-photos', '00000000-0000-4000-8000-0000000fa0a1/real-photo.jpg',
                 '00000000-0000-4000-8000-0000000fa0a1');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';

-- --- A new Bev with NO photo: created, usable, and never eligible. ---------

select lives_ok(
  $$ select public.create_bev('pgTAP Icon Smoothie', 'pgTAP Icon', 'Mango', 'juice',
                              2::smallint, false, null, null, null) $$,
  'create_bev succeeds with no photo: a homemade drink is still a Bev'
);
select is(
  (select status from public.bevs where name = 'pgTAP Icon Smoothie'),
  'pending_photo',
  'and it is pending_photo, so it stays visible to its creator alone'
);
select is(
  (select icon_status from public.bevs where name = 'pgTAP Icon Smoothie'),
  'none',
  'and its icon_status is ''none'' -- never eligible, not waiting forever'
);
reset role;
select is(
  (select count(*)::int from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.name = 'pgTAP Icon Smoothie'),
  0,
  'and NO generation job was scheduled, so no image-generation request can occur'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';

-- --- A new Bev WITH a photo: the one eligible event. -----------------------

select lives_ok(
  $$ select public.create_bev('pgTAP Icon Latte', 'pgTAP Icon', 'Lavender', 'coffee',
                              2::smallint, false, null,
                              '00000000-0000-4000-8000-0000000fa0a1/real-photo.jpg', null) $$,
  'create_bev succeeds with a verified photo'
);
select is(
  (select status from public.bevs where name = 'pgTAP Icon Latte'),
  'active',
  'and the Bev is active at once -- the user never waits on the illustration'
);
select is(
  (select icon_status from public.bevs where name = 'pgTAP Icon Latte'),
  'pending',
  'and its icon_status is ''pending'''
);
reset role;
select is(
  (select count(*)::int from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.name = 'pgTAP Icon Latte'),
  1,
  'and EXACTLY ONE generation job was scheduled'
);
-- The job keeps the path the ORIGINAL creation request carried, rather than
-- re-reading bevs.photo_path, so a later moderator photo swap cannot change
-- what gets illustrated.
select is(
  (select j.source_photo_path from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.name = 'pgTAP Icon Latte'),
  '00000000-0000-4000-8000-0000000fa0a1/real-photo.jpg',
  'and it points at the photograph that creation request carried'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';

-- --- The same submission again: a network retry, or a double tap. ----------

select throws_ok(
  $$ select public.create_bev('pgTAP Icon Latte', 'pgTAP Icon', 'Lavender', 'coffee',
                              2::smallint, false, null,
                              '00000000-0000-4000-8000-0000000fa0a1/real-photo.jpg', null) $$,
  '23505',
  'BEVI_DUPLICATE_BEV',
  'submitting the same new Bev twice is a duplicate, not a second Bev'
);
select is(
  (select count(*)::int from public.bevs where name = 'pgTAP Icon Latte'),
  1,
  'and only one Bev was committed'
);
reset role;
select is(
  (select count(*)::int from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.brand = 'pgTAP Icon'),
  1,
  'and still exactly one generation job across both submissions'
);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';


-- --- Editing an existing Bev: never an eligible event. --------------------
-- A rename is the case the embedding trigger DOES care about and the icon
-- pipeline must not, so it is worth asserting rather than assuming.
--
-- AS THE OWNER, for the same reason the photo edit below is: `authenticated`
-- has no update policy on bevs at all -- only `bevs_select` -- so an edit is
-- an RPC's job, not a client's. This block used to run as `authenticated`,
-- where the rename matched no row and raised nothing: `lives_ok` passed, and
-- so did the job count after it, without a rename ever having happened. The
-- hygiene sweep (20261119152455) then revoked the leftover UPDATE privilege
-- that had been letting it through the privilege check, and the same line
-- became a 42501. Running as the owner is what the assertion always meant,
-- and the `is` below pins the rename down so it cannot go quiet again.
reset role;
select lives_ok(
  $$ update public.bevs set name = 'pgTAP Icon Latte Deluxe', updated_at = now()
      where name = 'pgTAP Icon Latte' $$,
  'editing a Bev succeeds'
);
select is(
  (select count(*)::int from public.bevs where name = 'pgTAP Icon Latte Deluxe'),
  1,
  'and the rename actually landed, so the job count below is about an edit that happened'
);
select is(
  (select count(*)::int from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.brand = 'pgTAP Icon'),
  1,
  'and scheduled no further job: an edit is not a creation'
);

-- --- A photo added AFTER creation: still not an eligible event. ------------
-- The Bev created without one above now gets a photograph, the way a
-- moderator or a later edit would give it one. This is the case the brief
-- calls out explicitly, and the one an `AFTER UPDATE` trigger on bevs would
-- have got wrong. Done as the owner because `authenticated` has no update
-- policy on bevs at all -- an edit is an RPC's job, not a client's.

select lives_ok(
  $$ update public.bevs
        set photo_path = 'fa0a1/added-later.jpg', thumb_path = 'fa0a1/added-later.jpg',
            status = 'active', updated_at = now()
      where name = 'pgTAP Icon Smoothie' $$,
  'a photo can be added to an existing Bev afterwards'
);
select is(
  (select count(*)::int from public.bev_icon_jobs j
     join public.bevs b on b.id = j.bev_id where b.name = 'pgTAP Icon Smoothie'),
  0,
  'and it schedules no generation job: only the original creation workflow is eligible'
);
select is(
  (select icon_status from public.bevs where name = 'pgTAP Icon Smoothie'),
  'none',
  'and the Bev stays ''none'' rather than becoming pending'
);

-- ---------------------------------------------------------------------------
-- F. The job lifecycle
-- ---------------------------------------------------------------------------
-- From here the fixtures are inserted directly and enqueued by hand, as the
-- owner. That keeps the lifecycle assertions clear of create_bev's rate limit
-- and of the storage fixtures, and it is the worker's view of the world
-- anyway: it only ever sees claim and finish.

insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source, photo_path, thumb_path, created_by)
values ('00000000-0000-4000-8000-0000000fa011', 'pgTAP Icon Job One', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/one.jpg', 'fa0a1/one.jpg', '00000000-0000-4000-8000-0000000fa0a1'),
       ('00000000-0000-4000-8000-0000000fa012', 'pgTAP Icon Job Two', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/two.jpg', 'fa0a1/two.jpg', '00000000-0000-4000-8000-0000000fa0a1'),
       ('00000000-0000-4000-8000-0000000fa013', 'pgTAP Icon Job Three', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/three.jpg', 'fa0a1/three.jpg', '00000000-0000-4000-8000-0000000fa0a1'),
       ('00000000-0000-4000-8000-0000000fa014', 'pgTAP Icon Job Four', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/four.jpg', 'fa0a1/four.jpg', '00000000-0000-4000-8000-0000000fa0a1'),
       ('00000000-0000-4000-8000-0000000fa015', 'pgTAP Icon Job Five', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/five.jpg', 'fa0a1/five.jpg', '00000000-0000-4000-8000-0000000fa0a1'),
       ('00000000-0000-4000-8000-0000000fa016', 'pgTAP Icon Job Six', 'pgTAP Job', null, 'soda', 2, 'active',
        'user', 'fa0a1/six.jpg', 'fa0a1/six.jpg', '00000000-0000-4000-8000-0000000fa0a1');

do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa011', 'fa0a1/one.jpg'); end $$;

select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  1,
  'a pending job is claimed'
);
select is(
  (select status || ':' || attempt_count::text from public.bev_icon_jobs
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  'processing:1',
  'and the claim marks it processing and counts the attempt'
);
select is(
  (select icon_status from public.bevs where id = '00000000-0000-4000-8000-0000000fa011'),
  'processing',
  'and the Bev reads as processing, which is what the app polls on'
);
-- A fresh claim racing the first one must come back empty, or two workers
-- would both call the provider for the same Bev.
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  0,
  'a job already in flight is not claimed again'
);

select lives_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa011', 'completed',
                                       '00000000-0000-4000-8000-0000000fa011/icon-768.png') $$,
  'the worker reports success'
);
select is(
  (select generated_icon_path || ':' || icon_status from public.bevs
    where id = '00000000-0000-4000-8000-0000000fa011'),
  '00000000-0000-4000-8000-0000000fa011/icon-768.png:completed',
  'and the asset path is published onto the Bev'
);
select ok(
  (select status = 'completed' and completed_at is not null from public.bev_icon_jobs
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  'and the job is completed'
);
-- "Do not regenerate an icon that has already been generated", enforced in
-- the claim predicate rather than trusted to the worker.
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  0,
  'a completed job is never claimable again, so an icon is never regenerated'
);
-- A stale claim that races the original to the finish line, or a retried
-- webhook, must not replace good art or mark a success as a failure.
select lives_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa011', 'failed', null, 'late report') $$,
  'a late report for a completed job is accepted without erroring'
);
select is(
  (select generated_icon_path || ':' || icon_status from public.bevs
    where id = '00000000-0000-4000-8000-0000000fa011'),
  '00000000-0000-4000-8000-0000000fa011/icon-768.png:completed',
  'and changes nothing: a completed job is never overwritten'
);

select throws_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa012', 'completed', null) $$,
  '22023',
  'BEVI_VALIDATION',
  'reporting success with no asset path is refused'
);
select throws_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa012', 'cancelled', 'x.png') $$,
  '22023',
  'BEVI_VALIDATION',
  'an unknown outcome is refused'
);
select throws_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa0ff', 'failed', null, 'x') $$,
  'P0002',
  'BEVI_NOT_FOUND',
  'reporting on a Bev with no job is not found'
);

-- --- Failure and retry ----------------------------------------------------

do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa012', 'fa0a1/two.jpg'); end $$;
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa012'),
  1,
  'a second eligible job is claimed'
);
select lives_ok(
  $$ select public.finish_bev_icon_job('00000000-0000-4000-8000-0000000fa012', 'failed', null,
                                       'provider_timeout') $$,
  'the worker reports a failure'
);
select is(
  (select j.status || ':' || j.last_error || ':' || b.icon_status
     from public.bev_icon_jobs j join public.bevs b on b.id = j.bev_id
    where j.bev_id = '00000000-0000-4000-8000-0000000fa012'),
  'failed:provider_timeout:failed',
  'and the failure is recorded on both the job and the Bev'
);
-- The Bev survives its icon. This is the whole point of the pipeline being
-- out of band: a failed generation costs a placeholder and nothing else.
select ok(
  (select status = 'active' and photo_path is not null from public.bevs
    where id = '00000000-0000-4000-8000-0000000fa012'),
  'and the Bev is still active with its own photograph intact'
);
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa012'),
  1,
  'a failed job with attempts left is retried'
);
select is(
  (select attempt_count from public.bev_icon_jobs
    where bev_id = '00000000-0000-4000-8000-0000000fa012'),
  2,
  'and the retry reuses the original job rather than creating a second one'
);

-- ---------------------------------------------------------------------------
-- G. Exhaustion, and the reaper
-- ---------------------------------------------------------------------------
-- Retrying forever would spend money on a source photo that will never work.
-- But a job that stops being retried must also stop reading as "processing",
-- or its Bev waits for art that is never coming -- the state this feature is
-- explicitly required not to produce.

do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa013', 'fa0a1/three.jpg'); end $$;
update public.bev_icon_jobs
   set status = 'failed', attempt_count = public.bev_icon_max_attempts(), last_error = 'gave up'
 where bev_id = '00000000-0000-4000-8000-0000000fa013';

select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa013'),
  0,
  'a job that has used all its attempts is not claimed again'
);

-- A worker that died after taking its last attempt: stale, exhausted, and
-- stuck in 'processing' until something gives up on it.
do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa014', 'fa0a1/four.jpg'); end $$;
update public.bev_icon_jobs
   set status = 'processing',
       attempt_count = public.bev_icon_max_attempts(),
       started_at = now() - public.bev_icon_stale_after() - interval '1 minute'
 where bev_id = '00000000-0000-4000-8000-0000000fa014';
update public.bevs set icon_status = 'processing'
 where id = '00000000-0000-4000-8000-0000000fa014';

select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa014'),
  0,
  'an abandoned job with no attempts left is not claimed again either'
);
select is(
  (select j.status || ':' || b.icon_status
     from public.bev_icon_jobs j join public.bevs b on b.id = j.bev_id
    where j.bev_id = '00000000-0000-4000-8000-0000000fa014'),
  'failed:failed',
  'the reaper gives up on it, so neither the job nor the Bev is left reading as processing'
);

-- ---------------------------------------------------------------------------
-- H. Enqueueing twice for one Bev
-- ---------------------------------------------------------------------------
-- The database already makes a second job impossible (section A). This is the
-- function's behaviour on top of that: it must not re-arm a job that is
-- already in flight or already finished, and must not fire a second
-- notification.

create temporary table t_icon_net_again (queued int not null) on commit drop;
insert into t_icon_net_again (queued) values (pg_temp.net_queued());

select lives_ok(
  $$ select public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa011', 'fa0a1/elsewhere.jpg') $$,
  'enqueueing again for a Bev that already has a job succeeds quietly'
);
select is(
  (select j.status || ':' || j.source_photo_path || ':' || b.icon_status
     from public.bev_icon_jobs j join public.bevs b on b.id = j.bev_id
    where j.bev_id = '00000000-0000-4000-8000-0000000fa011'),
  'completed:fa0a1/one.jpg:completed',
  'and changes nothing: not the status, not the source photo, not the Bev'
);
select is(
  (select count(*)::int from public.bev_icon_jobs
    where bev_id = '00000000-0000-4000-8000-0000000fa011'),
  1,
  'still one job for that Bev'
);
select is(
  pg_temp.net_queued() - (select queued from t_icon_net_again),
  0,
  'and it notified nobody a second time'
);

-- ---------------------------------------------------------------------------
-- I. get_bev_icons: the read path, and the art it offers to borrow
-- ---------------------------------------------------------------------------
-- 20261119185801. Read-only by construction, which section J re-checks by
-- counting jobs afterwards. The borrowed icon is what keeps a collection of
-- custom drinks from being a wall of identical category silhouettes.
--
-- `fallback_icon_path` names ONE authored icon, chosen here, and it is chosen
-- by joining `public.bev_icons` -- so an undrawn candidate is never offered.
-- `bev_icons` is empty after a reset (publishing is the icons-sync job's
-- work, not a migration's), which is why the miss is asserted first and the
-- published rows are fixtures of this test.

select ok(
  has_function_privilege('authenticated', 'public.get_bev_icons(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.get_bev_icons(uuid[])', 'execute'),
  'authenticated may read icons; anon may not'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';

-- A seeded catalog Bev: never eligible for generation, and it has no
-- generated art of its own.
select is(
  (select i.icon_status from public.get_bev_icons(
     array[(select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1)]
   ) i),
  'none',
  'a seeded Bev reads as never eligible'
);
-- Nothing in the catalogue is published yet, so there is nothing to borrow.
-- Null is the correct answer here and NOT an error: the app falls through to
-- the category art, exactly as it does on a project whose icons-sync has
-- never run.
select is(
  (select i.fallback_icon_path from public.get_bev_icons(
     array[(select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1)]
   ) i),
  null,
  'with no published icon in the category, there is nothing to borrow'
);

-- Publish three: a sibling of the target, the target's own, and a custom Bev's.
-- As the owner -- `bev_icons` has RLS and no insert policy, because only the
-- publish job writes it.
reset role;
insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
values ((select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1 offset 1),
        'pgtap-sibling-soda', 'pgtap-sibling-soda.aaaaaaaaaaaaaaaa.svg',
        repeat('a', 64), 'bevi-dimensional-v1', 'needs-review'),
       ((select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1),
        'pgtap-target-soda', 'pgtap-target-soda.bbbbbbbbbbbbbbbb.svg',
        repeat('b', 64), 'bevi-dimensional-v1', 'needs-review'),
       ('00000000-0000-4000-8000-0000000fa012',
        'pgtap-user-soda', 'pgtap-user-soda.cccccccccccccccc.svg',
        repeat('c', 64), 'bevi-dimensional-v1', 'needs-review');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';

select isnt(
  (select i.fallback_icon_path from public.get_bev_icons(
     array[(select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1)]
   ) i),
  null,
  'once an icon in the category is published, it is offered to borrow'
);

-- The invariants, asserted on the path itself rather than on a list: it is a
-- PUBLISHED icon, belonging to a DIFFERENT Bev, of the SAME category, and
-- that Bev is ours rather than someone's custom drink.
select ok(
  (select exists (
     select 1
       from public.get_bev_icons(array[t.id]) i
       join public.bev_icons bi on bi.path = i.fallback_icon_path
       join public.bevs b on b.id = bi.bev_id
      where b.id <> t.id
        and b.category_id = t.category_id
        and b.source in ('seed', 'featured')
        and b.status = 'active'
   )
   from (select id, category_id from public.bevs
          where source = 'seed' and category_id = 'soda' order by id limit 1) t),
  'the borrowed icon is a published one from another seeded Bev in the same category'
);

-- It has authored art of its own, and is still never offered it: what the app
-- borrows is art for a Bev that has none, and `BevSummary.iconUrl` already
-- carries a Bev's own authored icon.
select isnt(
  (select i.fallback_icon_path from public.get_bev_icons(
     array[(select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1)]
   ) i),
  'pgtap-target-soda.bbbbbbbbbbbbbbbb.svg',
  'and never the Bev''s own authored icon'
);

-- Only the authored catalogue is on offer, so one user's custom Bev can never
-- lend its art to another's -- even once that custom Bev has a published icon.
select isnt(
  (select i.fallback_icon_path from public.get_bev_icons(
     array[(select id from public.bevs where source = 'seed' and category_id = 'soda' order by id limit 1)]
   ) i),
  'pgtap-user-soda.cccccccccccccccc.svg',
  'and never a user-created Bev''s icon'
);

-- A Bev that already has a generated icon needs nothing to borrow.
select is(
  (select i.icon_status || ':' || coalesce(i.fallback_icon_path, 'null')
     from public.get_bev_icons(array['00000000-0000-4000-8000-0000000fa011'::uuid]) i),
  'completed:null',
  'a Bev with its own generated icon is offered no art to borrow'
);

-- The deliberate difference from get_bev_leaves: the caller's own
-- pending_photo Bev is visible to them, and the profile collection draws it.
select is(
  (select count(*)::int from public.get_bev_icons(
     array[(select id from public.bevs where name = 'pgTAP Icon Smoothie')]
   )),
  1,
  'the caller''s own Bev is returned even when it is not active'
);

-- An id the caller cannot see contributes no row rather than failing the call.
select is(
  (select count(*)::int from public.get_bev_icons(array['00000000-0000-4000-8000-0000000fa0ff'::uuid])),
  0,
  'an unknown id is omitted, not an error'
);

select throws_ok(
  $$ select * from public.get_bev_icons(
       (select array_agg(gen_random_uuid()) from generate_series(1, 501))) $$,
  '22023',
  'BEVI_VALIDATION',
  'over 500 ids is the caller''s bug and is reported as one'
);

reset role;

-- ---------------------------------------------------------------------------
-- J. Reading starts nothing
-- ---------------------------------------------------------------------------
-- The brief's test 10: viewing a Bev, a profile or the feed must not schedule
-- generation. Every read above ran against the same ledger section F left
-- behind, so the count settles it.

select is(
  (select count(*)::int from public.bev_icon_jobs),
  5,
  'all those reads created no job: still the five sections E-G made'
);

-- ---------------------------------------------------------------------------
-- K. 20261119185802: the worker's half
-- ---------------------------------------------------------------------------
-- release_bev_icon_job, pending_bev_icon_failures, drain_bev_icon_jobs and the
-- style bucket had no coverage at all, which was the wrong gap to leave: this
-- is the migration holding the one function that can strand a Bev and the one
-- object whose safety rests on a `security_invoker` claim.

select ok(
  not has_function_privilege('anon', 'public.release_bev_icon_job(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_bev_icon_job(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.release_bev_icon_job(uuid,text)', 'execute'),
  'only the service role may hand a claim back'
);
select ok(
  not has_function_privilege('anon', 'public.drain_bev_icon_jobs()', 'execute')
  and not has_function_privilege('authenticated', 'public.drain_bev_icon_jobs()', 'execute')
  and not has_function_privilege('service_role', 'public.drain_bev_icon_jobs()', 'execute'),
  'nobody may call the drain by hand -- it is cron''s, and it POSTs a bearer token'
);

-- The private style bucket. Branded references make every generation using
-- them fail 3030, which is why the export script filters on brand; this just
-- pins that the bucket itself is not public.
select ok(
  (select not public from storage.buckets where id = 'bev-style-refs'),
  'bev-style-refs is private: only the worker reads it'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') like '%bev-style-refs%'),
  0,
  'and no storage policy grants anyone else access to it'
);

-- release: back to pending, attempt handed back, Bev still waiting not failed.
do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa015', 'fa0a1/five.jpg'); end $$;
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa015'),
  1,
  'a fresh job is claimed'
);
select lives_ok(
  $$ select public.release_bev_icon_job('00000000-0000-4000-8000-0000000fa015', 'provider_quota_exhausted') $$,
  'and can be handed back'
);
select is(
  (select j.status || ':' || j.attempt_count::text || ':' || b.icon_status
     from public.bev_icon_jobs j join public.bevs b on b.id = j.bev_id
    where j.bev_id = '00000000-0000-4000-8000-0000000fa015'),
  'pending:0:pending',
  'a release costs no attempt and leaves the Bev waiting, not failed'
);

-- The backstop that stops an endless claim/release cycle. Without it a worker
-- with no provider credentials releases the same job every minute forever and
-- the Bev reads pending for all time.
update public.bev_icon_jobs
   set created_at = now() - public.bev_icon_give_up_after() - interval '1 minute'
 where bev_id = '00000000-0000-4000-8000-0000000fa015';
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa015'),
  0,
  'a job too old is not claimed again, however many attempts it has left'
);
select is(
  (select j.status || ':' || b.icon_status
     from public.bev_icon_jobs j join public.bevs b on b.id = j.bev_id
    where j.bev_id = '00000000-0000-4000-8000-0000000fa015'),
  'failed:failed',
  'and the reaper gives up on it, so it cannot read as pending forever'
);

-- A merged Bev is on its way out; generating art for it spends a metered call
-- on something nothing renders.
do $$ begin perform public.enqueue_bev_icon_job('00000000-0000-4000-8000-0000000fa016', 'fa0a1/six.jpg'); end $$;
update public.bevs set status = 'merged', merged_into = '00000000-0000-4000-8000-0000000fa011'
 where id = '00000000-0000-4000-8000-0000000fa016';
select is(
  (select count(*)::int from public.claim_bev_icon_jobs(10)
    where bev_id = '00000000-0000-4000-8000-0000000fa016'),
  0,
  'a job for a merged Bev is never claimed'
);

-- The operator view. `security_invoker = true` means the caller''s privileges
-- decide, and bev_icon_jobs has RLS on with no policy, so a signed-in user
-- reads nothing -- which is the whole reason last_error can live in it.
select ok(
  (select count(*) from public.pending_bev_icon_failures) > 0,
  'the owner sees unfinished jobs in the operator view'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000fa0a1", "role": "authenticated"}';
select throws_ok(
  $$ select count(*) from public.pending_bev_icon_failures $$,
  '42501',
  null,
  'a signed-in user cannot read the operator view at all'
);
-- The ledger is closed TWICE, and both locks are asserted because they fail
-- differently. The grants are revoked, so a read raises 42501 and the table is
-- not a REST endpoint at all. Underneath that, RLS is on with no policy, so
-- even with the grant restored a read would return zero rows rather than data.
-- Testing only the outer lock would let a later migration re-grant SELECT and
-- still pass; testing only the inner one would miss the schema disclosure.
select throws_ok(
  $$ select count(*) from public.bev_icon_jobs $$,
  '42501',
  null,
  'the ledger is not readable by a signed-in user at all, so last_error never reaches a client'
);
reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_icon_jobs'),
  0,
  'and the second lock is still there: no policy, so a re-grant alone would expose nothing'
);
select ok(
  (select count(*) from public.bev_icon_jobs) > 0,
  'while the owner sees the very rows the signed-in user could not'
);

-- ---------------------------------------------------------------------------
-- L. A merge carries the generated icon
-- ---------------------------------------------------------------------------
-- 20261112000200 carries the AUTHORED icon across a merge; without the mirror
-- trigger the GENERATED one is lost, and lost for good, because only
-- create_bev ever makes a job.

insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source,
                         photo_path, thumb_path, created_by, generated_icon_path, icon_status)
values ('00000000-0000-4000-8000-0000000fa021', 'pgTAP Icon Merge Source', 'pgTAP Merge', null,
        'soda', 2, 'active', 'user', 'fa0a1/m1.jpg', 'fa0a1/m1.jpg',
        '00000000-0000-4000-8000-0000000fa0a1',
        '00000000-0000-4000-8000-0000000fa021/icon-768.png', 'completed'),
       ('00000000-0000-4000-8000-0000000fa022', 'pgTAP Icon Merge Dest', 'pgTAP Merge', null,
        'soda', 2, 'active', 'user', 'fa0a1/m2.jpg', 'fa0a1/m2.jpg',
        '00000000-0000-4000-8000-0000000fa0a1', null, 'none');

update public.bevs
   set status = 'merged', merged_into = '00000000-0000-4000-8000-0000000fa022'
 where id = '00000000-0000-4000-8000-0000000fa021';

select is(
  (select generated_icon_path || ':' || icon_status from public.bevs
    where id = '00000000-0000-4000-8000-0000000fa022'),
  '00000000-0000-4000-8000-0000000fa021/icon-768.png:completed',
  'the survivor inherits the merged Bev''s generated icon, which nothing could regenerate'
);

-- A destination with art of its own keeps it: the survivor is canonical.
insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source,
                         photo_path, thumb_path, created_by, generated_icon_path, icon_status)
values ('00000000-0000-4000-8000-0000000fa023', 'pgTAP Icon Merge Source Two', 'pgTAP Merge', 'B',
        'soda', 2, 'active', 'user', 'fa0a1/m3.jpg', 'fa0a1/m3.jpg',
        '00000000-0000-4000-8000-0000000fa0a1',
        '00000000-0000-4000-8000-0000000fa023/icon-768.png', 'completed');
update public.bevs
   set status = 'merged', merged_into = '00000000-0000-4000-8000-0000000fa022'
 where id = '00000000-0000-4000-8000-0000000fa023';

select is(
  (select generated_icon_path from public.bevs where id = '00000000-0000-4000-8000-0000000fa022'),
  '00000000-0000-4000-8000-0000000fa021/icon-768.png',
  'and a survivor that already had art keeps its own'
);

select * from finish();
rollback;
