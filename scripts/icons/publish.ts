/**
 * Publishes the authored beverage icons to the backend: the SVGs to the public
 * `bev-icons` Storage bucket, and the Bev -> icon link to `public.bev_icons`
 * (20261112000200_bev_icons.sql).
 *
 *   npm run icons:publish -- --dry-run   # read and check everything; needs no credentials; writes nothing
 *   npm run icons:publish                # the same, then upload, then publish_bev_icons, then verify
 *
 * IN ORDER:
 *
 *   1. design/beverage-icons/manifest.json, validated by export-app.mjs's
 *      rules (publish-core.ts `validateManifest`). Every record's portable SVG
 *      is read and its sha256 checked against the manifest; every SVG is
 *      checked for script, event attributes, <foreignObject> and non-#id
 *      links (`svgSafetyProblems`), because the bucket serves it from our
 *      storage origin; and every SVG must fit the bucket's 512 KiB limit. ANY
 *      problem is fatal, all of them are listed, and nothing is written.
 *   2. `--dry-run` stops here, with the counts.
 *   3. The paths `bev_icons` already holds, read through PostgREST.
 *   4. Upload every object not yet published (content-addressed keys, so a
 *      key that exists already holds these bytes; "already exists" is a
 *      success). BEFORE the RPC, so a row never points at a missing object.
 *   5. `publish_bev_icons` with ALL rows in one call: the manifest is the
 *      whole truth, so the RPC replaces the table. Its report is printed.
 *   6. One published object is fetched through its PUBLIC URL with
 *      `Accept-Encoding: gzip, br`, and the response's status and headers are
 *      printed on a line starting `public URL check:`. Exit 1 unless it is a
 *      200 with an SVG content type.
 *
 * THE STORAGE REQUESTS mirror what @supabase/storage-js 2.117 sends
 * (node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts):
 * `upload()` is POST `<url>/storage/v1/object/<bucket>/<path>` with
 * `x-upsert: false`, `cache-control: max-age=<seconds>` and the content type,
 * and the raw bytes as the body; `getPublicUrl()` is
 * `<url>/storage/v1/object/public/<bucket>/<path>`. The auth headers are
 * scripts/bugs/purge-evidence.ts's (`apikey` + `Authorization: Bearer`, the
 * service-role key). No dependency: plain `fetch`.
 *
 * LOGS ARE PUBLIC. The workflow (.github/workflows/icons-sync.yml) runs on a
 * public repo, so this prints counts, slugs and Bev ids -- all already in the
 * repo, except a user-created Bev's id, which is a random uuid -- and never
 * the project URL, a key, or a response body beyond the API's error text.
 *
 * Credentials, from the environment (supabase/.env locally), as
 * scripts/venues/import-osm.ts reads them:
 *
 *   SUPABASE_URL                the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY   the service-role key
 *
 * Neither has a default; a missing one is exit 1 with its name. `--dry-run`
 * needs neither.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUCKET,
  CACHE_SECONDS,
  MAX_ICON_BYTES,
  formatReport,
  isDuplicateUpload,
  svgSafetyProblems,
  toPublishRow,
  unpublished,
  validateManifest,
  type PublishReport,
  type PublishRow,
} from "./publish-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ICONS_DIR = join(ROOT, "design", "beverage-icons");
const MANIFEST_PATH = join(ICONS_DIR, "manifest.json");

/** Small: the uploads are a few KB each and this is a manual job. */
const CONCURRENCY = 6;
/** PostgREST's max_rows (supabase/config.toml); reads are paged at it. */
const PAGE = 1000;

function die(message: string): never {
  console.error(`icons:publish: ${message}`);
  process.exit(1);
}

interface Loaded {
  row: PublishRow;
  bytes: Buffer;
}

/** Step 1: the manifest, every SVG's hash, safety and size. Dies listing every problem. */
function load(): Loaded[] {
  if (!existsSync(MANIFEST_PATH)) die("design/beverage-icons/manifest.json not found");
  let entries;
  try {
    entries = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
  } catch (e) {
    return die(`design/beverage-icons/manifest.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  const problems: string[] = [];
  const loaded: Loaded[] = [];
  for (const entry of entries) {
    const file = resolve(ICONS_DIR, entry.source);
    if (!file.startsWith(ICONS_DIR + "/")) {
      problems.push(`${entry.slug}: ${entry.source} points outside design/beverage-icons`);
      continue;
    }
    if (!existsSync(file)) {
      problems.push(`${entry.slug}: ${entry.source} not found`);
      continue;
    }
    const bytes = readFileSync(file);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.sha256) {
      problems.push(`${entry.slug}: ${entry.source} has sha256 ${actual}, the manifest says ${entry.sha256}. Rebuild the icons first.`);
      continue;
    }
    if (bytes.length > MAX_ICON_BYTES) {
      problems.push(`${entry.slug}: ${bytes.length} bytes, over the bucket's ${MAX_ICON_BYTES}-byte limit`);
    }
    for (const p of svgSafetyProblems(bytes.toString("utf8"))) problems.push(`${entry.slug}: ${p}`);
    loaded.push({ row: toPublishRow(entry), bytes });
  }
  if (problems.length > 0) {
    die(`${problems.length} problem(s); nothing was published:\n  ${problems.join("\n  ")}`);
  }
  return loaded;
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Step 3: every path bev_icons holds (service role, so RLS does not filter). */
async function publishedPaths(url: string, key: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = new URLSearchParams({
      select: "path",
      order: "bev_id.asc",
      offset: String(offset),
      limit: String(PAGE),
    });
    const res = await fetch(`${url}/rest/v1/bev_icons?${query}`, { headers: authHeaders(key) });
    if (!res.ok) die(`reading bev_icons failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { path: string }[];
    paths.push(...page.map((r) => r.path));
    if (page.length < PAGE) return paths;
  }
}

type UploadOutcome = "uploaded" | "existed";

/** One object, never overwritten (x-upsert: false). */
async function uploadOne(url: string, key: string, item: Loaded): Promise<UploadOutcome> {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${item.row.path}`, {
    method: "POST",
    headers: {
      ...authHeaders(key),
      "x-upsert": "false",
      "cache-control": `max-age=${CACHE_SECONDS}`,
      "content-type": "image/svg+xml",
    },
    body: new Uint8Array(item.bytes),
  });
  if (res.ok) return "uploaded";
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON; `text` is reported as is below.
  }
  if (isDuplicateUpload(res.status, body)) return "existed";
  throw new Error(`upload of ${item.row.path} failed: ${res.status} ${text}`);
}

/** Step 4, with at most CONCURRENCY requests in flight. */
async function uploadAll(url: string, key: string, items: readonly Loaded[]): Promise<Record<UploadOutcome, number>> {
  const counts: Record<UploadOutcome, number> = { uploaded: 0, existed: 0 };
  let next = 0;
  let failure: Error | null = null;
  async function worker(): Promise<void> {
    while (failure === null && next < items.length) {
      const item = items[next++]!;
      try {
        counts[await uploadOne(url, key, item)] += 1;
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  if (failure !== null) die(`${(failure as Error).message}. publish_bev_icons was NOT called.`);
  return counts;
}

/** Step 5: one service-role RPC. The error text is PostgREST's, which names no secret. */
async function publish(url: string, key: string, rows: readonly PublishRow[]): Promise<PublishReport> {
  const res = await fetch(`${url}/rest/v1/rpc/publish_bev_icons`, {
    method: "POST",
    headers: { ...authHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!res.ok) die(`publish_bev_icons failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PublishReport;
}

/**
 * Step 6. Prints the URL's response, never the URL. `fetch` decodes a gzip or
 * br body transparently, so the decoded length is the SVG's size and
 * `content-length` (when the server sends one) is what crossed the wire.
 */
async function verifyPublic(url: string, path: string, expectedBytes: number): Promise<void> {
  const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${path}`, {
    headers: { "accept-encoding": "gzip, br" },
  });
  const body = new Uint8Array(await res.arrayBuffer());
  const h = (name: string): string => res.headers.get(name) ?? "(none)";
  console.log(
    `public URL check: status ${res.status}; content-type ${h("content-type")}; cache-control ${h("cache-control")}; ` +
      `content-encoding ${h("content-encoding")}; content-length ${h("content-length")}; ` +
      `decoded body ${body.length} bytes (the SVG is ${expectedBytes})`,
  );
  if (res.status !== 200) die(`the public URL answered ${res.status}, not 200`);
  if (!h("content-type").toLowerCase().startsWith("image/svg+xml")) {
    die(`the public URL served ${h("content-type")}, not image/svg+xml`);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun) {
    if (!url) die("SUPABASE_URL is not set");
    if (!key) die("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  console.log(`icons:publish${dryRun ? " (dry run)" : ""}`);
  const loaded = load();
  const bytes = loaded.reduce((n, l) => n + l.bytes.length, 0);
  const largest = loaded.reduce((n, l) => Math.max(n, l.bytes.length), 0);
  const objects = new Set(loaded.map((l) => l.row.path)).size;
  console.log(`  manifest: ${loaded.length} record(s), ${objects} distinct object(s)`);
  console.log(`  portable SVGs: ${bytes} bytes total, largest ${largest} (bucket limit ${MAX_ICON_BYTES})`);
  console.log("  every sha256 matches the manifest; no SVG has script, event attributes, foreignObject or external links");

  if (dryRun) {
    console.log("icons:publish: dry run, nothing uploaded or written");
    return;
  }

  const have = await publishedPaths(url!, key!);
  console.log(`  bev_icons holds ${have.length} row(s)`);

  const pending = unpublished(
    loaded.map((l) => l.row),
    have,
  );
  const byPath = new Map(loaded.map((l) => [l.row.path, l] as const));
  const counts = await uploadAll(url!, key!, pending.map((r) => byPath.get(r.path)!));
  console.log(
    `  storage: ${pending.length} object(s) not yet published; ${counts.uploaded} uploaded, ` +
      `${counts.existed} already there`,
  );

  const report = await publish(url!, key!, loaded.map((l) => l.row));
  for (const line of formatReport(report)) console.log(`  ${line}`);

  // The first object in path order, so a rerun checks the same one.
  const probe = [...loaded].sort((a, b) => (a.row.path < b.row.path ? -1 : a.row.path > b.row.path ? 1 : 0))[0]!;
  await verifyPublic(url!, probe.row.path, probe.bytes.length);
  console.log("icons:publish: done");
}

await main(process.argv.slice(2));
