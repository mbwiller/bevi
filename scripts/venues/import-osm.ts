/**
 * Imports NYC venues from OpenStreetMap into `public.venues` (A-08, half 1).
 *
 *   npm run venues:import -- --dry-run     # query, parse, write the CSV, write NOTHING to the database
 *   npm run venues:import                  # the above, then upsert by osm_id
 *   npm run venues:import -- --bbox=40.70,-74.02,40.80,-73.90
 *   npm run venues:import -- --out=/tmp/venues.csv
 *
 * WHAT IS PURE LIVES IN import-core.ts and is unit tested there. This file is
 * the shell: Overpass over `fetch`, the CSV on disk, and PostgREST with a
 * service-role key. Conventions are scripts/graph/build-edges.ts's exactly --
 * Node 22 with `--experimental-strip-types`, no build step, NO DEPENDENCIES.
 *
 * WHAT IT DOES NOT DO, and why:
 *   * It never writes `venue_bevs`. A venue with no assortment gets no pin
 *     (D-13), so an import alone changes nothing a user can see; curation is
 *     the separate, human step. That is also the safety property that makes
 *     re-running this cheap.
 *   * It never writes `status`, `id`, `created_at` or `venue_bevs`, so a venue
 *     hidden by hand stays hidden through every future import.
 *   * It never ERASES a curated value. `import_venues` coalesces every
 *     nullable column OSM supplies, so a better OSM value wins and a
 *     disappearing one leaves curation standing. This matters because OSM has
 *     no neighbourhood for the starting area at all (see below), so
 *     `neighborhood` and `borough` are going to be filled by us -- and the
 *     first draft of this script, a PostgREST `merge-duplicates` upsert, would
 *     have nulled both on the next monthly run.
 *   * It cannot overwrite a manual row. A manual venue has `osm_id is null`
 *     (the `venues_osm_id_requires_osm_source` CHECK pairs the two), and the
 *     upsert conflicts on `osm_id`, so manual rows are not reachable from
 *     here. That is A-08's "manual rows are never overwritten", enforced by
 *     the schema rather than by this script remembering to.
 *
 * WHAT A REAL RUN MEASURES (D-13's bbox, 2026-11-02): 412 elements,
 * 410 venues, 2 dropped for having no name. Field coverage, which matters to
 * half 2 more than the count does:
 *
 *   address        368 / 410
 *   hours_osm      247 / 410, of which 103 are evaluable (`hours_known`)
 *   website        212 / 410
 *   borough         69 / 410
 *   neighborhood     0 / 410
 *
 * The evaluable count was 111 before review tightened `hoursKnown`; the eight
 * it lost were strings the old recogniser accepted and could not actually
 * evaluate -- overnight ranges, `;` overrides and backwards day ranges. A
 * smaller honest number beats a larger wrong one.
 *
 * THE NEIGHBOURHOOD LINE IS A PROBLEM FOR HALF 2, not a bug here: NYC mappers do not
 * use `addr:suburb`, so OSM has no neighbourhood for any venue in the starting
 * area, and half 2's `neighborhoods()` RPC -- the vocabulary behind M-16's
 * "Neighborhood" filter (decision 36 turns the city filter into it) -- would
 * come back empty. Bounding boxes cannot fix it either: the Upper East Side
 * and Roosevelt Island overlap in any rectangle, because the island is
 * diagonal and the river between them is narrow. The real fix is
 * point-in-polygon against NYC Open Data's Neighborhood Tabulation Areas, as a
 * GeoJSON file plus a ray-casting function -- no dependency, and it fills
 * `borough` correctly at the same time. That belongs with the RPC that reads
 * the column, so it is called out on the board rather than guessed at here.
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
 */

import { writeFileSync } from "node:fs";

import {
  NYC_BOUNDS,
  START_BBOX,
  overpassQuery,
  parseElements,
  report,
  toCsv,
  type Bbox,
  type OsmElement,
  type VenueRow,
} from "./import-core.ts";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Overpass asks for a real User-Agent identifying the client (A-08, and its
 * usage policy). An anonymous bulk query is the thing that gets an IP blocked.
 */
const USER_AGENT = "bevi-venue-import/1.0 (+https://github.com/mbwiller/bevi)";

/** PostgREST pages writes; 500 rows a request keeps bodies small and retries cheap. */
const CHUNK = 500;

function die(message: string): never {
  console.error(`venues:import: ${message}`);
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
 */
const TRANSIENT = new Set([429, 502, 503, 504]);
const RETRIES = 3;
const BACKOFF_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string): Promise<OsmElement[]> {
  for (let attempt = 1; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body: new URLSearchParams({ data: query }).toString(),
      });
    } catch (cause) {
      // A reset or DNS failure never reaches a status code, so the status
      // retry below cannot see it. Overpass drops connections under load as
      // readily as it returns 502, and an uncaught one here is a stack trace
      // where an operator wants "retrying".
      if (attempt > RETRIES) {
        die(`Overpass connection failed after ${RETRIES} retries: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const wait = BACKOFF_MS * attempt;
      console.log(`  Overpass connection failed (${cause instanceof Error ? cause.message : String(cause)}); retrying in ${wait / 1000}s (attempt ${attempt} of ${RETRIES})`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as { elements?: unknown };
      if (!Array.isArray(body.elements)) die("Overpass returned no `elements` array");
      return body.elements as OsmElement[];
    }
    if (TRANSIENT.has(res.status) && attempt <= RETRIES) {
      const wait = BACKOFF_MS * attempt;
      console.log(`  Overpass ${res.status}; retrying in ${wait / 1000}s (attempt ${attempt} of ${RETRIES})`);
      await sleep(wait);
      continue;
    }
    die(
      `Overpass returned ${res.status} ${res.statusText}. ` +
        (TRANSIENT.has(res.status)
          ? `Still failing after ${RETRIES} retries: the public instance is overloaded, try again later.`
          : "Not a transient status, so check the query."),
    );
  }
}

/** The lowercased OSM `brand` values that mark a branch of a known chain. */
async function chainBrands(url: string, key: string): Promise<Set<string>> {
  const res = await fetch(`${url}/rest/v1/chains?select=osm_brands`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) die(`reading chains failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ osm_brands: string[] | null }>;
  const out = new Set<string>();
  for (const r of rows) for (const b of r.osm_brands ?? []) out.add(b.trim().toLowerCase());
  return out;
}

/**
 * The write, through `import_venues` rather than a PostgREST upsert. The
 * migration's section 5 explains why at length; in short, PostgREST could not
 * express the `on conflict` arbiter for a partial index, and its
 * merge-duplicates would have assigned every payload column from EXCLUDED --
 * erasing the curated `neighborhood` and `borough` that half 2 exists to fill
 * on the next monthly run. The RPC coalesces instead: OSM may improve a value,
 * never erase one.
 */
async function upsert(url: string, key: string, rows: readonly VenueRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${url}/rest/v1/rpc/import_venues`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_rows: chunk }),
    });
    if (!res.ok) die(`import_venues on rows ${i}..${i + chunk.length - 1} failed: ${res.status} ${await res.text()}`);
    written += Number(await res.json());
    console.log(`  wrote ${written} / ${rows.length}`);
  }
  return written;
}

async function main(argv: readonly string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const bbox = parseBbox(arg(argv, "bbox"));
  const out = arg(argv, "out") ?? "venues-import.csv";

  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // A dry run reads `chains` to classify brands when it can, but it must work
  // with no credentials at all, so the CSV can be reviewed first.
  const haveCreds = Boolean(url && key);
  if (!dryRun) {
    if (!url) die("SUPABASE_URL is not set");
    if (!key) die("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  console.log(`venues:import: bbox ${bbox.south},${bbox.west},${bbox.north},${bbox.east}${dryRun ? " (dry run)" : ""}`);

  const brands = haveCreds ? await chainBrands(url!, key!) : new Set<string>();
  if (!haveCreds) {
    console.log("  no credentials: every venue will be classified craft (chains are matched from the database)");
  } else {
    console.log(`  ${brands.size} chain brand(s) to match`);
  }

  const elements = await overpass(overpassQuery(bbox));
  console.log(`  ${elements.length} element(s) from Overpass`);

  const result = parseElements(elements, brands);
  const r = report(result);

  writeFileSync(out, toCsv(result.rows));
  console.log(`  wrote ${out}`);
  console.log(`  ${r.total} venue(s): ${r.chain} chain, ${r.craft} craft`);
  console.log(`  hours: ${r.withHours} with a string, ${r.withKnownHours} we can evaluate`);
  for (const [n, c] of r.neighborhoods) console.log(`    ${n}: ${c}`);
  if (r.skipped.length > 0) {
    console.log("  skipped:");
    for (const [reason, c] of r.skipped) console.log(`    ${reason}: ${c}`);
  }
  console.log("  data (c) OpenStreetMap contributors, ODbL");

  if (dryRun) {
    console.log("venues:import: dry run, nothing written to the database");
    return;
  }
  if (result.rows.length === 0) {
    // Not a failure, and not something to "fix" by writing an empty set: an
    // empty result for a small bbox is normal.
    console.log("venues:import: no rows to upsert");
    return;
  }
  const written = await upsert(url!, key!, result.rows);
  console.log(`venues:import: wrote ${written} venue(s)`);
}

await main(process.argv.slice(2));
