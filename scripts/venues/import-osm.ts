/**
 * The venue sync (A-08): imports NYC venues from OpenStreetMap, fills their
 * neighbourhood, links chain branches, and writes the assortments that give
 * the map its pins.
 *
 *   npm run venues:sync -- --dry-run     # every network call and parse, the CSV, the forecast; write NOTHING
 *   npm run venues:sync                  # the same, then write, then print what the database now holds
 *   npm run venues:sync -- --bbox=40.70,-74.02,40.80,-73.90
 *   npm run venues:sync -- --out=/tmp/venues.csv
 *
 * IN ORDER (each step is one service-role RPC of 20261109000200 or 20261102000300):
 *
 *   1. data/venues/chains.json -> `upsert_chains`. Resolved to Bev ids from
 *      data/catalog/bevs.csv by slug (`uuidv5(slug)` IS the id), so this needs
 *      no database read and a dry run can say exactly what each branch gets.
 *      First, so a branch imported in step 2 finds its chain.
 *   2. Overpass (D-13's bbox by default, ONE query) -> `import_venues`, with
 *      `chain_id` from the OSM brand and `neighborhood` / `borough` from NYC's
 *      Neighborhood Tabulation Areas (data/venues/nyc-nta-2020.geojson).
 *   3. data/venues/menus.csv -> `apply_venue_menus` (source 'menu'). Unknown
 *      venues and slugs are printed and skipped, never fatal.
 *   4. `expand_chain_assortments` (source 'chain'), which never touches a menu row.
 *   5. `venue_sync_report`: venues, neighbourhood coverage, branches per chain,
 *      venue_bevs rows by source, and how many venues now have a pin.
 *
 * Menus run before the expansion so a menu line deleted for a Bev the chain
 * also carries comes back as a chain row in the same run (see the migration).
 *
 * LOGS ARE PUBLIC. This runs in GitHub Actions on a public repo
 * (.github/workflows/venues-sync.yml), so it prints counts, chain ids and
 * neighbourhood names -- all of which the repo already contains -- and never
 * the project URL, a key, or a response body beyond PostgREST's error text.
 *
 * WHAT IS PURE LIVES IN import-core.ts and is unit tested there. This file is
 * the shell: Overpass over `fetch`, the CSV on disk, and PostgREST with a
 * service-role key. Conventions are scripts/graph/build-edges.ts's exactly --
 * Node 22 with `--experimental-strip-types`, no build step, NO DEPENDENCIES.
 *
 * WHAT IT NEVER DOES, and why:
 *   * It never writes `status`, `id` or `created_at`, so a venue hidden by
 *     hand stays hidden through every future sync.
 *   * It never touches a `source = 'menu'` row except through menus.csv, and
 *     then only for the venues the CSV names (per-venue replace).
 *   * It never ERASES a curated value. `import_venues` coalesces every
 *     nullable column OSM supplies, so a better value wins and a disappearing
 *     one leaves curation standing. The neighbourhood is now always supplied
 *     (from the NTA polygon), so a HAND-EDITED neighbourhood on an OSM venue is
 *     re-derived on the next sync: correct the name in `NTA_DISPLAY_NAMES`
 *     (import-core.ts), which fixes every venue in that area at once.
 *   * It cannot overwrite a manual row. A manual venue has `osm_id is null`
 *     (the `venues_osm_id_requires_osm_source` CHECK pairs the two), and the
 *     upsert conflicts on `osm_id`, so manual rows are not reachable from
 *     here. That is A-08's "manual rows are never overwritten", enforced by
 *     the schema rather than by this script remembering to.
 *
 * WHAT THE FIRST REAL RUN MEASURED (D-13's bbox, 2026-11-02, before chains and
 * NTAs): 410 venues; address 368, hours 247 (103 evaluable), website 212,
 * borough 69, neighbourhood 0. The neighbourhood line is why the NTA fill
 * exists: NYC mappers do not use `addr:suburb`, and a rectangle cannot split
 * the Upper East Side from Roosevelt Island. The polygons fill `borough` too.
 *
 * WHICH ELEMENTS: decision 35's tags (cafes, bars, pubs, juice bars;
 * convenience, supermarket, alcohol, beverages, coffee, tea and deli shops),
 * PLUS fast-food counters, pharmacies and chemists whose `brand` is a preset
 * chain -- Dunkin' and Duane Reade / CVS / Walgreens are mapped that way, and
 * decision 33 names them. See `CHAIN_ONLY_AMENITIES` in import-core.ts.
 *
 * ATTRIBUTION. The data is (c) OpenStreetMap contributors, ODbL. The venue
 * table is kept separable from our own curation for exactly this reason (see
 * 20261102000300's header), and the app shows the credit in the map's
 * attribution control (M-16).
 *
 * Credentials, from the environment (supabase/.env locally):
 *
 *   SUPABASE_URL                the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY   the service-role key
 *
 * Neither is optional and neither has a default: a missing one is exit 1 with
 * the name in the message. `--dry-run` needs neither, so the CSV can be
 * reviewed before any credential is in the room.
 *
 * Optional:
 *
 *   OVERPASS_URL                comma-separated https Overpass endpoints, tried in
 *                               order, REPLACING the built-in list (overpass-api.de,
 *                               then maps.mail.ru; see `overpassEndpoints` in
 *                               import-core.ts). The main instance answers 502 to
 *                               GitHub Actions runners, hence the fallback.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { catalogBevId, loadBevRows, loadCategories } from "../catalog/catalog.ts";
import {
  catalogFrom,
  chainsByBrand,
  chainsPayload,
  forecastPins,
  parseMenus,
  resolveChains,
  type MenuRow,
  type ResolvedChain,
} from "./curation-core.ts";
import {
  NYC_AREA_ID,
  NYC_BOUNDS,
  START_BBOX,
  areasFromGeoJson,
  makeLocator,
  overpassEndpoints,
  overpassQuery,
  parseElements,
  report,
  toCsv,
  type Bbox,
  type OsmElement,
  type VenueRow,
} from "./import-core.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "venues");
const CHAINS_PATH = join(DATA_DIR, "chains.json");
const MENUS_PATH = join(DATA_DIR, "menus.csv");
const NTA_PATH = join(DATA_DIR, "nyc-nta-2020.geojson");

/**
 * Overpass asks for a real User-Agent identifying the client (A-08, and its
 * usage policy). An anonymous bulk query is the thing that gets an IP blocked.
 * No email address: the repository URL is the contact.
 */
const USER_AGENT = "bevi-venue-sync/1.1 (+https://github.com/mbwiller/bevi)";

/** PostgREST pages writes; 500 rows a request keeps bodies small and retries cheap. */
const CHUNK = 500;

function die(message: string): never {
  console.error(`venues:sync: ${message}`);
  process.exit(1);
}

function arg(argv: readonly string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** `--bbox=south,west,north,east`, the order Overpass itself uses. */
function parseBbox(raw: string | null): Bbox {
  if (raw === null) return START_BBOX;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    die(`--bbox needs four finite numbers, south,west,north,east -- got "${raw}"`);
  }
  const [south, west, north, east] = parts as [number, number, number, number];
  if (south >= north || west >= east) die(`--bbox is inverted: south<north and west<east -- got "${raw}"`);
  // A wider box is allowed (the Overpass area clause still clips to the city),
  // but there is no point querying outside the CHECK's rectangle.
  const clipped: Bbox = {
    south: Math.max(south, NYC_BOUNDS.south),
    north: Math.min(north, NYC_BOUNDS.north),
    west: Math.max(west, NYC_BOUNDS.west),
    east: Math.min(east, NYC_BOUNDS.east),
  };
  if (clipped.south >= clipped.north || clipped.west >= clipped.east) {
    die(`--bbox does not overlap New York City -- got "${raw}"`);
  }
  return clipped;
}

/**
 * Overpass is a free, busy, shared service and fails transiently as a matter of
 * routine: 429 is its rate limit, 504 its own query timeout, and 502/503 are
 * the public instance being overloaded. The first run of this script hit a 502
 * and the second succeeded on the identical query, so a transient status is
 * retried rather than reported as a broken query -- an operator re-running by
 * hand learns nothing the script could not have done itself.
 *
 * Some failures are about WHERE the request comes from, not about load:
 * overpass-api.de answered 502 to every GitHub Actions attempt while answering
 * a laptop. So each endpoint gets RETRIES retries, then the next one is tried;
 * only when every endpoint has failed does the script give up. A non-transient
 * 4xx means the query is wrong, which no mirror will fix, so that still fails
 * at once.
 */
const TRANSIENT = new Set([429, 502, 503, 504]);
const RETRIES = 2;
const BACKOFF_MS = 15_000;
/**
 * A mirror that accepts the connection and never answers would otherwise stall
 * the whole run (fetch has no timeout of its own). Overpass's own query timeout
 * is 180s by default and this query is a few seconds, so 120s is generous.
 */
const REQUEST_TIMEOUT_MS = 120_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One endpoint: its elements, or null once it has failed transiently `RETRIES` times. */
async function overpassOnce(endpoint: string, host: string, query: string): Promise<OsmElement[] | null> {
  for (let attempt = 1; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // A reset or DNS failure never reaches a status code, so the status
      // retry below cannot see it.
      const why = cause instanceof Error ? cause.message : String(cause);
      if (attempt > RETRIES) {
        console.log(`  ${host}: connection failed after ${RETRIES} retries (${why})`);
        return null;
      }
      const wait = BACKOFF_MS * attempt;
      console.log(`  ${host}: connection failed (${why}); retrying in ${wait / 1000}s (attempt ${attempt} of ${RETRIES})`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      let body: { elements?: unknown };
      try {
        body = (await res.json()) as { elements?: unknown };
      } catch {
        console.log(`  ${host}: answered 200 but not with JSON`);
        return null;
      }
      if (!Array.isArray(body.elements)) {
        console.log(`  ${host}: answered 200 with no \`elements\` array`);
        return null;
      }
      return body.elements as OsmElement[];
    }
    if (!TRANSIENT.has(res.status)) {
      die(`Overpass (${host}) returned ${res.status} ${res.statusText}. Not a transient status, so check the query.`);
    }
    if (attempt > RETRIES) {
      console.log(`  ${host}: ${res.status} after ${RETRIES} retries`);
      return null;
    }
    const wait = BACKOFF_MS * attempt;
    console.log(`  ${host}: ${res.status}; retrying in ${wait / 1000}s (attempt ${attempt} of ${RETRIES})`);
    await sleep(wait);
  }
}

async function overpass(query: string): Promise<OsmElement[]> {
  let endpoints: string[];
  try {
    endpoints = overpassEndpoints(process.env);
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
  for (const endpoint of endpoints) {
    const host = new URL(endpoint).hostname; // hostname only: the log is public
    const elements = await overpassOnce(endpoint, host, query);
    if (elements !== null) {
      console.log(`  Overpass answered from ${host}`);
      return elements;
    }
  }
  return die(`every Overpass endpoint failed (${endpoints.length} tried); try again later or set OVERPASS_URL.`);
}

/** One service-role RPC call. The error text is PostgREST's, which names no secret. */
async function rpc<T>(url: string, key: string, fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(`${fn} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * The write, through `import_venues` rather than a PostgREST upsert. The
 * 20261102000300 migration's section 5 explains why at length; in short,
 * merge-duplicates would assign every payload column from EXCLUDED and erase
 * curation. The RPC coalesces instead.
 */
async function importVenues(url: string, key: string, rows: readonly VenueRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    written += Number(await rpc<number>(url, key, "import_venues", { p_rows: chunk }));
    console.log(`  wrote ${written} / ${rows.length}`);
  }
  return written;
}

interface Curation {
  chains: ResolvedChain[];
  menus: MenuRow[];
  menuProblems: string[];
}

/** chains.json and menus.csv, resolved against data/catalog. Any error in chains.json is fatal. */
function loadCuration(): Curation {
  const catalog = catalogFrom({ rows: loadBevRows(), categories: loadCategories() });
  let chains: ResolvedChain[];
  try {
    chains = resolveChains(JSON.parse(readFileSync(CHAINS_PATH, "utf8")), catalog, catalogBevId);
  } catch (e) {
    die(`data/venues/chains.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  let parsed;
  try {
    parsed = parseMenus(readFileSync(MENUS_PATH, "utf8"), catalog, catalogBevId);
  } catch (e) {
    die(`data/venues/menus.csv: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { chains, menus: parsed.rows, menuProblems: parsed.problems };
}

async function main(argv: readonly string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const bbox = parseBbox(arg(argv, "bbox"));
  const out = arg(argv, "out") ?? "venues-import.csv";

  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // A dry run needs no credentials at all, so everything can be reviewed
  // before a key is in the room.
  if (!dryRun) {
    if (!url) die("SUPABASE_URL is not set");
    if (!key) die("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  console.log(`venues:sync: bbox ${bbox.south},${bbox.west},${bbox.north},${bbox.east}${dryRun ? " (dry run)" : ""}`);

  // ---- curation inputs, resolved offline -----------------------------------
  const { chains, menus, menuProblems } = loadCuration();
  const presetBevs = new Set(chains.flatMap((c) => c.bev_ids)).size;
  console.log(`  chains.json: ${chains.length} chain(s), ${presetBevs} distinct catalog Bev(s) across their presets`);
  console.log(`  menus.csv: ${menus.length} row(s)${menuProblems.length > 0 ? `, ${menuProblems.length} skipped` : ""}`);
  for (const p of menuProblems) console.log(`    skipped ${p}`);

  const locate = makeLocator(areasFromGeoJson(JSON.parse(readFileSync(NTA_PATH, "utf8"))));

  // ---- 1. chains ------------------------------------------------------------
  if (!dryRun) {
    const n = await rpc<number>(url!, key!, "upsert_chains", { p_chains: chainsPayload(chains) });
    console.log(`  upsert_chains: ${n} chain(s) written; chains not in the file were removed`);
  }

  // ---- 2. venues ------------------------------------------------------------
  const brands = chains.flatMap((c) => c.osm_brands);
  const elements = await overpass(overpassQuery(bbox, NYC_AREA_ID, brands));
  console.log(`  ${elements.length} element(s) from Overpass`);

  const result = parseElements(elements, chainsByBrand(chains), NYC_BOUNDS, locate);
  const r = report(result);

  writeFileSync(out, toCsv(result.rows));
  console.log(`  wrote ${out}`);
  console.log(`  ${r.total} venue(s): ${r.chain} chain branch(es), ${r.craft} craft`);
  console.log(`  neighbourhood: ${r.withNeighborhood} / ${r.total}; borough: ${r.withBorough} / ${r.total}`);
  console.log(`  hours: ${r.withHours} with a string, ${r.withKnownHours} we can evaluate`);
  console.log("  by neighbourhood:");
  for (const [n, c] of r.neighborhoods) console.log(`    ${n}: ${c}`);
  console.log("  branches by chain:");
  for (const [n, c] of r.chainBranches) console.log(`    ${n}: ${c}`);
  if (r.skipped.length > 0) {
    console.log("  skipped:");
    for (const [reason, c] of r.skipped) console.log(`    ${reason}: ${c}`);
  }
  console.log("  data (c) OpenStreetMap contributors, ODbL");

  if (dryRun) {
    const f = forecastPins(result.rows, chains, menus);
    console.log("  forecast, if this were written (assumes every catalog slug is an active Bev):");
    console.log(`    venue_bevs rows: ${f.chainRows} chain, ${f.menuRows} menu`);
    console.log(`    venues with a pin: ${f.pinned} (${f.fromChain} from a chain preset, ${f.fromMenu} from a menu)`);
    if (f.menuUnknownVenues.length > 0) {
      console.log(`    menu rows for venues this import did not see: ${f.menuUnknownVenues.join(", ")}`);
    }
    console.log("venues:sync: dry run, nothing written to the database");
    return;
  }

  if (result.rows.length > 0) {
    const written = await importVenues(url!, key!, result.rows);
    console.log(`  import_venues: ${written} venue(s)`);
  } else {
    // Not a failure: an empty result for a small bbox is normal. The
    // curation steps below still run, over what the table already holds.
    console.log("  import_venues: no rows");
  }

  // ---- 3. menus -------------------------------------------------------------
  const m = await rpc<{ upserted: number; deleted: number; unknown_venues: string[]; unknown_bevs: string[] }>(
    url!, key!, "apply_venue_menus", { p_rows: menus },
  );
  console.log(`  apply_venue_menus: ${m.upserted} upserted, ${m.deleted} removed`);
  if (m.unknown_venues.length > 0) console.log(`    skipped, no such venue: ${m.unknown_venues.join(", ")}`);
  if (m.unknown_bevs.length > 0) console.log(`    skipped, not an active Bev: ${m.unknown_bevs.length} id(s)`);

  // ---- 4. chain expansion ---------------------------------------------------
  const e = await rpc<{ inserted: number; deleted: number }>(url!, key!, "expand_chain_assortments", {});
  console.log(`  expand_chain_assortments: ${e.inserted} inserted, ${e.deleted} removed`);

  // ---- 5. what is there now -------------------------------------------------
  const rep = await rpc<{
    venues_active: number;
    with_neighborhood: number;
    with_borough: number;
    chain_branches: Record<string, number>;
    rows_by_source: Record<string, number>;
    pinned: number;
    pinned_for_minors: number;
  }>(url!, key!, "venue_sync_report", {});
  console.log("  the database now holds:");
  console.log(`    ${rep.venues_active} active venue(s); neighbourhood ${rep.with_neighborhood}, borough ${rep.with_borough}`);
  console.log(`    venue_bevs rows: ${Object.entries(rep.rows_by_source).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
  console.log(`    branches: ${Object.entries(rep.chain_branches).map(([c, n]) => `${c} ${n}`).join(", ") || "none"}`);
  console.log(`    venues with a pin: ${rep.pinned} (${rep.pinned_for_minors} for a viewer under 21)`);
  console.log("venues:sync: done");
}

await main(process.argv.slice(2));
