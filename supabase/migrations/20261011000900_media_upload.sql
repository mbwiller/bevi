-- media.upload (packages/api) support: storage RLS for the two public
-- buckets it writes to directly, plus the rate-limit RPC it calls before
-- the storage upload (assert_rate() is security-definer SQL and can't be
-- invoked from the client-side storage API, so it needs a tiny wrapper).
--
-- Scope, matching the interim design in packages/api/src/media.ts:
--   * Uploads go straight into `bev-photos` / `nutrition-labels` (the
--     buckets the app actually serves from), not into `raw-uploads` as a
--     staging area -- there's no worker yet to move objects out of
--     staging (that's the `process-photo` Edge Function, milestone 1.6,
--     explicitly out of scope here). `raw-uploads` gets no policies in
--     this migration; it stays unused until that milestone.
--   * No background-removal pipeline exists, so there's no "processing"
--     state and no photo_jobs-style table here either.
--
-- =====================================================================
-- 1. Rate-limit RPC wrapper
--
-- public.assert_rate() (20261011000100_rls_and_core_rpcs.sql) is
-- security-definer SQL, callable only from inside another SQL/plpgsql
-- function -- packages/api can't call it directly since there's no
-- table/RPC hook on the Storage API's upload path. This wraps it so
-- packages/api can call `.rpc('assert_upload_rate')` right before
-- `client.storage.from(bucket).upload(...)`.
-- =====================================================================

create or replace function public.assert_upload_rate() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_rate('media_upload', 10, interval '1 hour');
end $$;

revoke execute on function public.assert_upload_rate() from public, anon;
grant execute on function public.assert_upload_rate() to authenticated;

-- =====================================================================
-- 2. Storage RLS -- INSERT only
--
-- Standard Supabase per-user-folder pattern: the first path segment must
-- equal the uploader's uid, matching the `<uid>/<random-id>.<ext>` path
-- packages/api/src/media.ts builds.
--
-- No SELECT policy: both buckets were created `public = true`
-- (20261009000800_storage.sql). Supabase's storage-js itself documents
-- that public buckets "don't require an authorization token to download
-- objects" (see the vendored `@supabase/storage-js` package, e.g.
-- `StorageBucketApi.ts`'s `public` option doc and `getPublicUrl`'s
-- example, which returns a `/storage/v1/object/public/...` URL) --
-- that public-object endpoint bypasses RLS entirely, so a SELECT policy
-- here would be a no-op for anonymous/public reads. It would only matter
-- for the *authenticated* `/object/authenticated/...` or
-- `download()` path, which `media.upload`'s result doesn't use (it
-- returns `getPublicUrl()`'s URL) -- not adding one until something
-- actually needs it.
--
-- No UPDATE/DELETE policy: uploads always write a fresh random path, so
-- there's nothing to overwrite; deletion isn't part of this ticket.
-- =====================================================================

-- No `alter table storage.objects enable row level security` here:
-- Supabase ships that table with RLS already enabled, and `postgres`
-- doesn't own it (confirmed live in CI -- "must be owner of table
-- objects", 42501), so the statement is both redundant and unauthorized.
-- `create policy` on it is the standard, officially-documented Supabase
-- pattern and doesn't require ownership.
create policy storage_bev_photos_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'bev-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_nutrition_labels_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'nutrition-labels' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- 3. Bucket-level size/type limits (defense in depth -- packages/api
-- already rejects oversized/unsupported uploads client-side before
-- ever calling `.storage.upload()`, this is the backstop for any other
-- caller of the Storage API). `file_size_limit` (bytes) and
-- `allowed_mime_types` (text[]) are real `storage.buckets` columns --
-- confirmed via the vendored `@supabase/storage-js` client, whose
-- `createBucket`/`updateBucket` options (`fileSizeLimit`,
-- `allowedMimeTypes`) serialize directly to these column names
-- (`StorageBucketApi.ts`). 10 MB matches the `raw-uploads object
-- insert: 10 MB max` limit in DEVELOPMENT-ARJUN.md's rate-limit table
-- (reused here for lack of a better number); mime list matches the
-- same table's `image/jpeg,image/png,image/heic,image/webp`.
-- =====================================================================

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id in ('bev-photos', 'nutrition-labels');
