-- 20261112000200 · bev_icons: the Bev -> icon link, in Postgres and Storage
--
-- WHAT THIS IS. The beverage icons are authored in git
-- (design/beverage-icons/manifest.json, one record per catalog Bev). Today the
-- app bundles them: scripts/icons/export-app.mjs copies each portable SVG into
-- app/public/bev-icons/ and writes a bevId -> URL map into the app's source.
-- This migration is the first of three PRs that move that link out of the app
-- bundle and into the backend:
--
--   1. the public `bev-icons` Storage bucket, which holds the SVGs;
--   2. `public.bev_icons`, one row per Bev that has an icon: which object in
--      that bucket is its icon, plus the provenance the manifest records;
--   3. `public.publish_bev_icons(p_rows jsonb)`, the service-role-only writer
--      that scripts/icons/publish.ts (`npm run icons:publish`, the manual
--      `icons-sync` workflow) calls once per run with the WHOLE manifest;
--   4. a trigger on `public.bevs` so `merge_bev` carries an icon across to the
--      Bev it merges into.
--
-- WHAT DOES NOT CHANGE. Nothing reads this table yet: the app keeps its
-- bundled copy (app/public/bev-icons/, app/src/lib/bevIcons.generated.ts) until
-- a later PR switches it over, so this migration has no visible effect. No
-- existing function, policy or table is altered. `merge_bev` (20261101000500)
-- is not re-created: the trigger in section 5 rides on the UPDATE it already
-- makes. No contract change (`shared/` is untouched).
--
-- THE PATH IS CONTENT-ADDRESSED. An icon's object key is
-- `<slug>.<first 16 hex of the SVG's sha256>.svg`, at the bucket root, and the
-- CHECK below holds every row to exactly that. An object is never overwritten:
-- a redraw is a NEW object and an UPDATE of the row. So a URL, once handed
-- out, always serves the same bytes and can be cached for a year
-- (publish.ts uploads with `cache-control: max-age=31536000`), and a row can
-- never point at bytes that differ from its `sha256`. Old objects are left in
-- the bucket; they are a few KB each and an old cached page may still name one.
--
-- WHAT IS PUBLIC AND WHAT IS NOT. The bucket is public: an icon is a drawing
-- of a retail package, and every one of them is already in this public
-- repository. Its object names carry catalog slugs, which are public too. The
-- TABLE is gated the way `bevs` is (section 3): a caller reads the icon row of
-- a Bev exactly when RLS lets them read the Bev. That keeps "which alcoholic
-- Bevs exist" out of an under-21 client's PostgREST reads, the same line
-- `rankings_select` and the graph tables hold.

-- =====================================================================
-- 1. The bucket
--
-- Public (read by URL, no SELECT policy needed), 512 KiB per object (today's
-- largest portable SVG is a small fraction of that; publish.ts refuses one
-- over the limit before uploading), SVG only. The form is 20261109000300's
-- section 7, so a re-run converges instead of failing.
--
-- NO storage.objects POLICY, on purpose. Only the service role writes here
-- (publish.ts), and the service role bypasses RLS on storage.objects. A
-- public bucket is served by URL without any policy. Granting `authenticated`
-- an insert would let any signed-in account put an SVG -- a document that can
-- carry script -- on our storage origin.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bev-icons', 'bev-icons', true, 524288, array['image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- 2. The table
--
-- One row per Bev with an icon, keyed on the Bev. `on delete cascade`: a
-- deleted Bev takes its icon row with it (the object stays; see above).
--
-- NO UNIQUE CONSTRAINT ON slug OR path. A slug can move from one Bev to
-- another in a single publish (an icon re-pointed after a catalog fix): the
-- upsert writes rows one at a time, and a non-deferrable unique index would
-- reject the intermediate state where both rows hold the slug. publish.ts
-- already refuses a manifest with a duplicate slug or bevId, which is the
-- check that matters.
-- =====================================================================

create table public.bev_icons (
  bev_id        uuid primary key references public.bevs(id) on delete cascade,
  slug          text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  path          text not null,   -- object key in the bev-icons bucket
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  style_version text not null,
  status        text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (path = slug || '.' || left(sha256, 16) || '.svg')
);

comment on table public.bev_icons is
  'The authored icon of a Bev: `path` is the object key in the public bev-icons bucket, content-addressed as <slug>.<first 16 hex of sha256>.svg. Written only by publish_bev_icons (scripts/icons/publish.ts) from design/beverage-icons/manifest.json, which is the whole truth; readable by `authenticated` exactly when the Bev is.';
comment on column public.bev_icons.path is
  'Object key in the bev-icons bucket: slug || ''.'' || left(sha256, 16) || ''.svg''. Never overwritten; a redraw is a new object.';
comment on column public.bev_icons.sha256 is
  'sha256 of the portable SVG''s bytes, as design/beverage-icons/manifest.json records it (assets.portableSvgSha256).';
comment on column public.bev_icons.style_version is
  'The manifest record''s styleVersion (e.g. bevi-dimensional-v1).';
comment on column public.bev_icons.status is
  'The manifest record''s review status (e.g. needs-review). Free text: the manifest owns the vocabulary.';

-- =====================================================================
-- 3. RLS and grants
--
-- One policy: SELECT for `authenticated`, true exactly when the caller can
-- see the Bev. The subquery is a POSITIVE `exists` over `public.bevs`, and a
-- policy's own table references are themselves subject to those tables' RLS
-- under the querying role -- the mechanism behind Postgres's "infinite
-- recursion detected in policy", and the reading 20261019000500 (section 4,
-- the bev_edges / bev_embeddings policies) already relies on. So
-- `bevs_select` (20261011000100) applies inside it as written: its status arm
-- (active, your own pending_photo, or admin) and its alcohol arm (adult only)
-- both carry over, and an icon row is visible precisely when its Bev row is.
-- Unlike those graph policies this one does not restate the predicate: an
-- icon row says nothing the Bev row does not (no second Bev, no aggregate),
-- so "the same rows as bevs" is the whole requirement, and restating
-- bevs_select here would be a copy that drifts. A positive exists is
-- fail-closed under either reading of the nesting: an invisible Bev yields
-- false. pgTAP 33 pins the under-21 case.
--
-- No insert/update/delete policy (supabase/CLAUDE.md: content tables are
-- written through security-definer functions only).
--
-- Grants: Supabase's default privileges give anon, authenticated and
-- service_role ALL on every new table in this schema. `anon` and PUBLIC lose
-- everything; `authenticated` keeps SELECT only, so a write is refused at the
-- privilege check, before RLS is even consulted. `service_role` keeps its
-- default grant, and SELECT is restated for it because publish.ts reads the
-- published paths through PostgREST with the service-role key.
-- =====================================================================

alter table public.bev_icons enable row level security;

create policy bev_icons_select on public.bev_icons
  for select to authenticated using (
    exists (select 1 from public.bevs b where b.id = bev_icons.bev_id)
  );

revoke all on public.bev_icons from public, anon, authenticated;
grant select on public.bev_icons to authenticated;
grant select on public.bev_icons to service_role;

-- =====================================================================
-- 4. publish_bev_icons(p_rows jsonb) -> jsonb
--
-- The only writer. The manifest is the whole truth, so one call REPLACES the
-- table's contents: upsert every row it is given, delete every row it was not.
-- The shape is `import_venues` (20261102000300) for validation and
-- `replace_bev_graph_stats` (20261110000100) for "validate the entire payload
-- before writing anything": a bad payload raises and the call (one
-- transaction) leaves last run's rows untouched.
--
-- p_rows: a jsonb array of
--   { "bev_id", "slug", "path", "sha256", "style_version", "status" }
-- all six strings, non-empty. BEVI_VALIDATION / 22023 when:
--   * p_rows is null or not an array;
--   * p_rows is EMPTY. Not a no-op here: "the manifest is the whole truth"
--     would make an empty call delete every icon, and an empty payload is far
--     more likely to be a broken script than a decision to drop them all;
--   * an element is not an object, or misses one of the six fields;
--   * bev_id is not a uuid, slug not kebab-case, sha256 not 64 lowercase hex,
--     or path is not slug.left(sha256,16).svg (the table's CHECKs, checked
--     up front so a row that would have been skipped cannot hide a bad one);
--   * two elements carry the same bev_id.
--
-- RESOLUTION. Each bev_id goes through `resolve_bev_id` (20261102000100),
-- which follows `merged_into` and returns an unknown id unchanged:
--   * the resolved Bev does not exist -> the row is skipped and its bev_id
--     reported in `skipped_missing`. Expected when the manifest names a
--     user-created Bev (those exist only on prod) and the job runs against
--     another stack;
--   * it resolved to a different id (the manifest names a Bev since merged)
--     -> the row is written under the surviving id and reported in
--     `followed_merge` as {from, to};
--   * two rows resolve to the same Bev -> the one whose own bev_id IS the
--     resolved id wins, else the lowest slug (C collation); every other is
--     reported in `dropped_duplicate` (and only there: `followed_merge` lists
--     the rows that were actually written under another id).
-- A `merged_into` cycle (only possible by hand in Studio) makes
-- resolve_bev_id raise BEVI_NOT_FOUND, which fails the whole call and writes
-- nothing; that is resolve_bev_id's own documented answer to a cycle.
--
-- WRITE. `updated_at` moves only when slug, path, sha256, style_version or
-- status actually changed, so a re-run of an unchanged manifest writes no
-- row at all (`unchanged`). Then every row whose bev_id is not in the
-- resolved set is deleted.
--
-- RETURNS, for the job's log:
--   received, inserted, updated, unchanged, deleted  (counts)
--   skipped_missing    [bev ids, as sent]
--   followed_merge     [{from, to}]
--   dropped_duplicate  [bev ids, as sent]
--   inactive           [bev ids of icon rows whose Bev is not 'active' (hidden,
--                       pending_photo): written, but no client sees them]
--   active_bevs, active_with_icon, active_without_photo_or_icon
--                      (counts over public.bevs where status = 'active';
--                       "photo" is photo_path is not null)
-- The last three are the reconciliation the manifest cannot do on its own:
-- how much of the LIVE catalog has an image at all.
--
-- A global advisory lock serialises two publishes (two workflow runs, or a
-- run and a local one), so neither can delete what the other just wrote
-- between its own upsert and delete.
--
-- Service role only: definer, owner postgres, EXECUTE revoked from public,
-- anon and authenticated (named, because Supabase's default privileges grant
-- EXECUTE on every new function to them directly), granted to service_role.
-- The ACL is `import_venues`' and `forget_bug_evidence`'s.
-- =====================================================================

create or replace function public.publish_bev_icons(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received   integer;
  v_resolved   jsonb;
  v_inserted   integer;
  v_updated    integer;
  v_unchanged  integer;
  v_deleted    integer;
  v_skipped    jsonb;
  v_followed   jsonb;
  v_dropped    jsonb;
  v_inactive   jsonb;
  v_active     integer;
  v_with_icon  integer;
  v_bare       integer;
begin
  -- ---- validate the whole payload before touching anything -----------------
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'p_rows must be a jsonb array';
  end if;

  v_received := jsonb_array_length(p_rows);
  if v_received = 0 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'p_rows is empty; an empty manifest never clears bev_icons';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r) <> 'object'
        or jsonb_typeof(r -> 'bev_id')        is distinct from 'string'
        or jsonb_typeof(r -> 'slug')          is distinct from 'string'
        or jsonb_typeof(r -> 'path')          is distinct from 'string'
        or jsonb_typeof(r -> 'sha256')        is distinct from 'string'
        or jsonb_typeof(r -> 'style_version') is distinct from 'string'
        or jsonb_typeof(r -> 'status')        is distinct from 'string'
        or r ->> 'bev_id' = '' or r ->> 'slug' = '' or r ->> 'path' = ''
        or r ->> 'sha256' = '' or r ->> 'style_version' = '' or r ->> 'status' = ''
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'every row needs bev_id, slug, path, sha256, style_version and status as non-empty strings';
  end if;

  -- Checked before anything casts it, in its own statement, so the cast below
  -- never meets a non-uuid.
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where r ->> 'bev_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'bev_id must be a uuid';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) r
              where r ->> 'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'slug must be kebab-case';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) r
              where r ->> 'sha256' !~ '^[0-9a-f]{64}$') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'sha256 must be 64 lowercase hex';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) r
              where r ->> 'path' <> (r ->> 'slug') || '.' || left(r ->> 'sha256', 16) || '.svg') then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'path must be <slug>.<first 16 hex of sha256>.svg';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     group by (r ->> 'bev_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'duplicate bev_id in p_rows';
  end if;

  perform pg_advisory_xact_lock(hashtext('publish_bev_icons'));

  -- ---- resolve every row once ----------------------------------------------
  -- `target` is the surviving Bev, `found` whether it exists, `rn` the row's
  -- rank among the rows that resolved to the same target (1 is kept).
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    into v_resolved
    from (
      select i.bev_id, t.target, (b.id is not null) as found,
             row_number() over (
               partition by t.target
               order by (i.bev_id = t.target) desc, i.slug collate "C", i.bev_id
             ) as rn,
             i.slug, i.path, i.sha256, i.style_version, i.status
        from (
          select (r ->> 'bev_id')::uuid as bev_id,
                 r ->> 'slug'           as slug,
                 r ->> 'path'           as path,
                 r ->> 'sha256'         as sha256,
                 r ->> 'style_version'  as style_version,
                 r ->> 'status'         as status
            from jsonb_array_elements(p_rows) r
        ) i
        cross join lateral (select public.resolve_bev_id(i.bev_id) as target) t
        left join public.bevs b on b.id = t.target
    ) x;

  select coalesce(jsonb_agg(to_jsonb(r.bev_id) order by r.bev_id) filter (where not r.found), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('from', r.bev_id, 'to', r.target) order by r.bev_id)
                    filter (where r.found and r.rn = 1 and r.bev_id <> r.target), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(r.bev_id) order by r.bev_id) filter (where r.found and r.rn > 1), '[]'::jsonb)
    into v_skipped, v_followed, v_dropped
    from jsonb_to_recordset(v_resolved)
           as r(bev_id uuid, target uuid, found boolean, rn integer,
                slug text, path text, sha256 text, style_version text, status text);

  -- ---- classify against what is there, then write --------------------------
  -- Counted before the upsert rather than read back from it, so the numbers
  -- do not depend on how ON CONFLICT reports an update.
  select count(*) filter (where bi.bev_id is null),
         count(*) filter (where bi.bev_id is not null
                            and (bi.slug, bi.path, bi.sha256, bi.style_version, bi.status)
                                is distinct from (k.slug, k.path, k.sha256, k.style_version, k.status)),
         count(*) filter (where bi.bev_id is not null
                            and (bi.slug, bi.path, bi.sha256, bi.style_version, bi.status)
                                is not distinct from (k.slug, k.path, k.sha256, k.style_version, k.status))
    into v_inserted, v_updated, v_unchanged
    from jsonb_to_recordset(v_resolved)
           as k(bev_id uuid, target uuid, found boolean, rn integer,
                slug text, path text, sha256 text, style_version text, status text)
    left join public.bev_icons bi on bi.bev_id = k.target
   where k.found and k.rn = 1;

  insert into public.bev_icons as bi (bev_id, slug, path, sha256, style_version, status)
  select k.target, k.slug, k.path, k.sha256, k.style_version, k.status
    from jsonb_to_recordset(v_resolved)
           as k(bev_id uuid, target uuid, found boolean, rn integer,
                slug text, path text, sha256 text, style_version text, status text)
   where k.found and k.rn = 1
  on conflict (bev_id) do update
    set slug          = excluded.slug,
        path          = excluded.path,
        sha256        = excluded.sha256,
        style_version = excluded.style_version,
        status        = excluded.status,
        updated_at    = now()
  where (bi.slug, bi.path, bi.sha256, bi.style_version, bi.status)
        is distinct from (excluded.slug, excluded.path, excluded.sha256, excluded.style_version, excluded.status);

  delete from public.bev_icons bi
   where not exists (
     select 1
       from jsonb_to_recordset(v_resolved)
              as k(bev_id uuid, target uuid, found boolean, rn integer,
                   slug text, path text, sha256 text, style_version text, status text)
      where k.found and k.rn = 1 and k.target = bi.bev_id
   );
  get diagnostics v_deleted = row_count;

  -- ---- report --------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(bi.bev_id) order by bi.bev_id), '[]'::jsonb)
    into v_inactive
    from public.bev_icons bi
    join public.bevs b on b.id = bi.bev_id
   where b.status <> 'active';

  -- bev_icons.bev_id is the primary key, so the left join is one-to-one.
  select count(*)::int,
         count(bi.bev_id)::int,
         count(*) filter (where b.photo_path is null and bi.bev_id is null)::int
    into v_active, v_with_icon, v_bare
    from public.bevs b
    left join public.bev_icons bi on bi.bev_id = b.id
   where b.status = 'active';

  return jsonb_build_object(
    'received',                     v_received,
    'inserted',                     v_inserted,
    'updated',                      v_updated,
    'unchanged',                    v_unchanged,
    'deleted',                      v_deleted,
    'skipped_missing',              v_skipped,
    'followed_merge',               v_followed,
    'dropped_duplicate',            v_dropped,
    'inactive',                     v_inactive,
    'active_bevs',                  v_active,
    'active_with_icon',             v_with_icon,
    'active_without_photo_or_icon', v_bare
  );
end;
$$;

comment on function public.publish_bev_icons(jsonb) is
  'Replaces bev_icons with the given manifest rows (following merges, skipping Bevs that do not exist) and returns a reconciliation report. scripts/icons/publish.ts only; service_role.';

alter function public.publish_bev_icons(jsonb) owner to postgres;
revoke execute on function public.publish_bev_icons(jsonb) from public, anon, authenticated;
grant execute on function public.publish_bev_icons(jsonb) to service_role;

-- =====================================================================
-- 5. A merge carries the icon across
--
-- WHAT merge_bev DOES, read in 20261101000500 section 3 before writing this:
-- step 10 marks the duplicate with ONE statement,
--     update public.bevs set status = 'merged', merged_into = p_dst,
--            updated_at = now() where id = p_src;
-- (the `bevs` CHECK `(status = 'merged') = (merged_into is not null)` forces
-- both in one UPDATE). So when this AFTER trigger fires, NEW.merged_into is
-- already the destination. Nothing else in merge_bev conflicts:
--   * its step 9 re-points earlier merges into src with
--     `set merged_into = p_dst, updated_at = now()` -- `status` is not in that
--     SET list, so an `UPDATE OF status` trigger never fires for it (and the
--     WHEN clause would reject it anyway: those rows were already merged);
--   * it validates that dst is active and not merged, and takes a global
--     advisory lock, so the destination is a live Bev and two merges never
--     interleave;
--   * it never reads or writes bev_icons, so moving the row here cannot
--     collide with anything it does later in the same transaction.
-- A merge made by hand in Studio (the same UPDATE) is handled the same way.
--
-- THE RULE. If the destination has no icon, the duplicate's icon row moves to
-- it (its primary key changes; the foreign key is satisfied because the
-- destination exists). If the destination already has one, both rows are
-- left alone: which drawing is right is the manifest's call, and the next
-- publish reconciles (the manifest's row for the merged id follows the merge
-- through resolve_bev_id, and a merged Bev's own row is deleted unless the
-- manifest still names it). Until then the merged Bev's row is invisible to
-- clients anyway: bevs_select hides merged Bevs, and the policy above follows.
--
-- Definer so it can write bev_icons whoever performs the merge. EXECUTE is
-- revoked from everyone: Postgres checks it only at CREATE TRIGGER time
-- (20261023000100's enqueue_bev_embedding does the same).
-- =====================================================================

create or replace function public.bev_icons_follow_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merged_into is not null
     and not exists (select 1 from public.bev_icons where bev_id = new.merged_into) then
    update public.bev_icons
       set bev_id = new.merged_into, updated_at = now()
     where bev_id = new.id;
  end if;
  return null;
end;
$$;

alter function public.bev_icons_follow_merge() owner to postgres;
revoke execute on function public.bev_icons_follow_merge()
  from public, anon, authenticated, service_role;

create trigger bevs_merge_moves_icon
  after update of status on public.bevs
  for each row
  when (new.status = 'merged' and old.status is distinct from 'merged')
  execute function public.bev_icons_follow_merge();

-- No `notify pgrst, 'reload schema'`: no migration in this repository issues
-- one (the CLI's push reloads PostgREST's schema cache), so neither does this.
