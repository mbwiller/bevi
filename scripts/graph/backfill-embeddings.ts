/**
 * Backfills `public.bev_embeddings` by calling the `embed` Edge Function for
 * every active Bev that has no embedding yet (A-16 (1), step 2).
 *
 *   npm run graph:backfill-embeddings                  # embed what is missing
 *   npm run graph:backfill-embeddings -- --dry-run     # print the plan, write nothing
 *   npm run graph:backfill-embeddings -- --stale       # also re-embed outdated rows
 *   npm run graph:backfill-embeddings -- --all         # re-embed every active Bev
 *   npm run graph:backfill-embeddings -- --batch 4 --limit 50
 *
 * NEO4J IS NOT INVOLVED. This script talks to Supabase and to one Edge
 * Function, both over HTTPS. It does not read, need or care about the Aura
 * instance, and it must never grow a NEO4J_* dependency -- the nightly sync is
 * where the graph half lives.
 *
 * Node 22, no build step and no dependencies (same convention as
 * scripts/catalog/* and scripts/graph/apply-schema.ts): plain `fetch` against
 * PostgREST, run with `node --experimental-strip-types`.
 *
 * ENVIRONMENT (supabase/.env locally, GitHub Actions secrets in CI; never
 * hardcoded -- see docs/graph.md):
 *
 *   SUPABASE_URL                required. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   required. Reads `bevs` and `bev_embeddings`
 *                               past RLS. Service-role only: a publishable key
 *                               cannot see a pending Bev and cannot be
 *                               accepted by `embed`.
 *   EMBED_FUNCTION_URL          optional. Defaults to
 *                               <SUPABASE_URL>/functions/v1/embed.
 *   EMBED_WEBHOOK_SECRET        optional. The token `embed` expects; when
 *                               unset, the function accepts the service-role
 *                               key and this script sends that instead. Keep
 *                               the two in step: if the function has the secret
 *                               set, this must have it too.
 *
 * IDEMPOTENT AND RESUMABLE. It writes nothing itself: `embed` upserts on
 * `bev_id`, so embedding a Bev twice replaces one row with an identical one.
 * The work list is re-derived from the database on every run, so an
 * interrupted run is resumed simply by running it again -- whatever got
 * written is no longer missing. There is no cursor file and no partial state
 * to clean up.
 */

// This script imports nothing (plain `fetch`, no node: modules needed), so
// without this marker it is not a module -- and top-level `await`, which the
// whole file is built on, is only legal in one. Node's module detection
// reparses it as ESM either way; `tsc` does not.
export {};

const DEFAULT_BATCH = 8;
/** Must not exceed MAX_BATCH in supabase/functions/embed/text.ts. */
const MAX_BATCH = 16;
/** PostgREST's own cap for this project (`max_rows` in supabase/config.toml). */
const PAGE = 1000;
const MODEL = "gte-small";

interface BevRow {
  id: string;
  brand: string | null;
  name: string;
  flavor: string | null;
  category_id: string;
  updated_at: string;
}

interface EmbeddingRow {
  bev_id: string;
  model: string;
  computed_at: string | null;
}

interface Options {
  dryRun: boolean;
  stale: boolean;
  all: boolean;
  batch: number;
  limit: number | null;
}

function fail(message: string): never {
  console.error(`graph:backfill-embeddings failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, stale: false, all: false, batch: DEFAULT_BATCH, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--stale") options.stale = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--batch" || arg === "--limit") {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) fail(`${arg} needs a positive integer, got ${raw ?? "nothing"}`);
      if (arg === "--batch") options.batch = value;
      else options.limit = value;
    } else if (arg.startsWith("--batch=") || arg.startsWith("--limit=")) {
      const [flag, raw] = arg.split("=", 2);
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) fail(`${flag} needs a positive integer, got ${raw}`);
      if (flag === "--batch") options.batch = value;
      else options.limit = value;
    } else {
      fail(`unknown argument ${arg}. Flags: --dry-run, --stale, --all, --batch N, --limit N`);
    }
  }
  if (options.batch > MAX_BATCH) {
    fail(`--batch ${options.batch} is above the Edge Function's bound of ${MAX_BATCH} (supabase/functions/embed/text.ts)`);
  }
  return options;
}

/** Reads every row of a table, a page at a time, ordered so paging is stable. */
async function readAll<T>(rest: string, headers: Record<string, string>, path: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${rest}/${path}&order=${order}&limit=${PAGE}&offset=${offset}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      fail(`reading ${path.split("?")[0]} returned ${response.status}: ${await response.text()}`);
    }
    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function postBatch(
  url: string,
  token: string,
  ids: string[],
): Promise<
  { ok: true; embedded: number } | { ok: false; detail: string; status?: number }
> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bevIds: ids, source: "backfill" }),
    });
  } catch (error: unknown) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: `HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  }
  try {
    const body = JSON.parse(text) as { embedded?: number };
    return { ok: true, embedded: typeof body.embedded === "number" ? body.embedded : ids.length };
  } catch {
    return { ok: true, embedded: ids.length };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl) fail("SUPABASE_URL is required (https://<project-ref>.supabase.co).");
if (!serviceRoleKey) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is required: the publishable key cannot read a pending Bev " +
      "and cannot authorise the embed function. Put it in supabase/.env (gitignored) or the " +
      "environment -- never in a committed file.",
  );
}

const functionUrl = process.env.EMBED_FUNCTION_URL?.replace(/\/+$/, "") ?? `${supabaseUrl}/functions/v1/embed`;
// Required, and deliberately not defaulted to the service-role key: the token
// travels in a header that pg_net persists in net.http_request_queue when the
// trigger sends it, so the two are kept distinct. See the comment in
// supabase/functions/embed/index.ts.
const embedToken = process.env.EMBED_WEBHOOK_SECRET || undefined;
if (!embedToken) {
  fail(
    "EMBED_WEBHOOK_SECRET is required: it is the bearer token the embed function checks. " +
      "Set the same value here, in `supabase secrets set EMBED_WEBHOOK_SECRET=...` and in the " +
      "database setting bevi.embed_webhook_token.",
  );
}

const rest = `${supabaseUrl}/rest/v1`;
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

console.log(`graph:backfill-embeddings · ${MODEL} · ${supabaseUrl}`);
if (options.dryRun) console.log("--dry-run: nothing will be written.");

const bevs = await readAll<BevRow>(
  rest,
  headers,
  "bevs?select=id,brand,name,flavor,category_id,updated_at&status=eq.active",
  "id.asc",
);
const embeddings = await readAll<EmbeddingRow>(rest, headers, "bev_embeddings?select=bev_id,model,computed_at", "bev_id.asc");

const existing = new Map<string, EmbeddingRow>(embeddings.map((row) => [row.bev_id, row]));

function needsEmbedding(bev: BevRow): boolean {
  if (options.all) return true;
  const row = existing.get(bev.id);
  if (!row) return true;
  if (!options.stale) return false;
  if (row.model !== MODEL) return true;
  // The embedding is older than the Bev's last edit, so the text it was built
  // from may no longer be the Bev's text. Same comparison the sync's "new or
  // changed Bevs" filter makes.
  return row.computed_at === null || Date.parse(row.computed_at) < Date.parse(bev.updated_at);
}

let todo = bevs.filter(needsEmbedding);
const totalCandidates = todo.length;
if (options.limit !== null && todo.length > options.limit) todo = todo.slice(0, options.limit);

console.log(
  `${bevs.length} active Bevs · ${existing.size} embeddings on record · ` +
    `${totalCandidates} to embed${options.limit !== null && totalCandidates > todo.length ? ` (--limit ${options.limit}: doing ${todo.length})` : ""}`,
);

if (todo.length === 0) {
  console.log("Nothing to do. Every active Bev has an embedding.");
  process.exit(0);
}

const batches: BevRow[][] = [];
for (let i = 0; i < todo.length; i += options.batch) batches.push(todo.slice(i, i + options.batch));

if (options.dryRun) {
  for (const bev of todo.slice(0, 10)) {
    const category = bev.category_id.replace(/[_-]+/g, " ");
    const text = [bev.brand, bev.name, bev.flavor, category].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    console.log(`  ${bev.id}  "${text}"`);
  }
  if (todo.length > 10) console.log(`  ... and ${todo.length - 10} more`);
  console.log(
    `--dry-run: would POST ${batches.length} batch(es) of up to ${options.batch} to ${functionUrl}. Nothing written.`,
  );
  process.exit(0);
}

let embedded = 0;
let done = 0;
const failures: Array<{ ids: string[]; detail: string }> = [];

for (const [index, batch] of batches.entries()) {
  const ids = batch.map((bev) => bev.id);
  let result = await postBatch(functionUrl, embedToken, ids);
  // 401/403 is a misconfiguration, not a blip, and retrying it 96 times
  // produces 96 futile requests and a 96-line failure dump instead of one
  // clear error. The token is set by hand in three places, so a mismatch is
  // the likeliest failure of this whole pipeline -- say so and stop.
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    fail(
      `${result.status} from embed. EMBED_WEBHOOK_SECRET here does not match the function's ` +
        "secret (`supabase secrets list`) -- and the trigger's own copy lives in the database " +
        "setting bevi.embed_webhook_token. All three must be the same value.",
    );
  }
  if (!result.ok) {
    // One retry: a cold start or a transient 5xx should not need a second run
    // of the whole script. A second failure is recorded and the run continues,
    // because 377 embedded Bevs plus a named failure beats stopping at the
    // first one -- and re-running picks up exactly what is still missing.
    await sleep(1500);
    result = await postBatch(functionUrl, embedToken, ids);
  }
  done += batch.length;
  if (result.ok) {
    embedded += result.embedded;
    console.log(`[${String(done).padStart(String(todo.length).length)}/${todo.length}] batch ${index + 1}/${batches.length} ok (${result.embedded} embedded)`);
  } else {
    failures.push({ ids, detail: result.detail });
    console.error(`[${done}/${todo.length}] batch ${index + 1}/${batches.length} FAILED: ${result.detail}`);
  }
}

console.log(`\nEmbedded ${embedded} of ${todo.length} Bev(s) with ${MODEL}.`);
if (failures.length > 0) {
  console.error(`${failures.length} batch(es) failed:`);
  for (const failure of failures) console.error(`  ${failure.ids.join(", ")} -> ${failure.detail}`);
  console.error("Re-run the script: it recomputes what is still missing, so only the failures are retried.");
  process.exit(1);
}
console.log("Done. Re-running is a no-op until a Bev is added or edited.");
