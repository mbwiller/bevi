/**
 * Evidence retention for the internal bug reporter (docs/bug-workflow.md).
 *
 *   npm run bugs:purge-evidence                    # delete objects older than 90 days
 *   npm run bugs:purge-evidence -- --days 30
 *   npm run bugs:purge-evidence -- --dry-run       # list what would go, delete nothing
 *
 * WHY THIS EXISTS. A bug screenshot is a picture of whatever was on a tester's
 * screen. The ticket in Linear carries its own copy of anything worth keeping
 * (the function uploads the image to Linear and embeds it), so the copy in the
 * private `bug-evidence` bucket is only ever a staging artefact. Keeping it
 * forever would mean holding a growing pile of screenshots that nothing reads.
 * This is the sweep that ends them.
 *
 * It also clears the orphans: an evidence object whose report never became a
 * ticket. The Edge Function already deletes those as it fails, so this is the
 * backstop for the case where the function itself died between the upload and
 * the cleanup.
 *
 * Deletion is in two halves, because they live in two places:
 *   1. the objects, through the Storage API (storage.objects is owned by
 *      supabase_storage_admin, so no SQL function of ours may delete them);
 *   2. the paths in each row's `evidence_paths` array, through
 *      `public.forget_bug_evidence()`, which is granted to the service role
 *      alone and removes only the paths it is handed.
 * Order matters: objects first, bookkeeping second. A crash in between leaves
 * a path pointing at a deleted object, which the next run clears; the reverse
 * would leave an object nothing remembers.
 *
 * Node 22, no build step and no dependencies (same convention as
 * scripts/graph/*): plain `fetch`, run with `node --experimental-strip-types`.
 *
 * ENVIRONMENT (supabase/.env locally; never hardcoded):
 *
 *   SUPABASE_URL                required. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   required. Reads `bug_reports` past RLS and
 *                               deletes from a private bucket. Neither is
 *                               possible with a publishable key -- which is
 *                               the point of the bucket being private.
 */

export {};

const BUCKET = 'bug-evidence';
const DEFAULT_DAYS = 90;
/** PostgREST pages; a sweep is never urgent, so the batches stay small. */
const PAGE = 200;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (supabase/.env). Nothing was deleted.');
  process.exit(1);
}

const days = Number(option('days') ?? DEFAULT_DAYS);
if (!Number.isFinite(days) || days < 0) {
  console.error(`--days must be a non-negative number, got ${option('days')}`);
  process.exit(1);
}
const dryRun = flag('dry-run');

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

interface LedgerRow {
  id: number;
  evidence_paths: string[];
  created_at: string;
  state: string;
}

/** Every submission older than the cutoff that still names at least one evidence object. */
async function expiredRows(): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = new URLSearchParams({
      select: 'id,evidence_paths,created_at,state',
      // A non-empty array: PostgREST compares against the `{}` literal.
      evidence_paths: 'neq.{}',
      created_at: `lt.${cutoff}`,
      order: 'created_at.asc',
      offset: String(offset),
      limit: String(PAGE),
    });
    const response = await fetch(`${url}/rest/v1/bug_reports?${query}`, { headers });
    if (!response.ok) {
      throw new Error(`reading bug_reports failed: ${response.status} ${await response.text()}`);
    }
    const page = (await response.json()) as LedgerRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function deleteObjects(paths: string[]): Promise<string[]> {
  const gone: string[] = [];
  for (const path of paths) {
    const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers });
    // 404 means someone (the Edge Function's own cleanup) got there first,
    // which is success for this script's purpose: the object is not there.
    if (response.ok || response.status === 404) gone.push(path);
    else console.warn(`could not delete ${path}: ${response.status}`);
  }
  return gone;
}

async function forget(paths: string[]): Promise<number> {
  const response = await fetch(`${url}/rest/v1/rpc/forget_bug_evidence`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_paths: paths }),
  });
  if (!response.ok) throw new Error(`forget_bug_evidence failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as number;
}

const rows = await expiredRows();
const paths = rows.flatMap((r) => r.evidence_paths);
if (paths.length === 0) {
  console.log(`No bug evidence older than ${days} days (cutoff ${cutoff}).`);
  process.exit(0);
}

console.log(`${paths.length} evidence object(s) on ${rows.length} submission(s) older than ${days} days (cutoff ${cutoff}):`);
for (const row of rows) for (const path of row.evidence_paths) console.log(`  ${row.created_at}  ${row.state.padEnd(7)}  ${path}`);

if (dryRun) {
  console.log('--dry-run: nothing was deleted.');
  process.exit(0);
}

const gone = await deleteObjects(paths);
const cleared = await forget(gone);
console.log(`Deleted ${gone.length}/${paths.length} object(s); cleared ${cleared} evidence path(s).`);
