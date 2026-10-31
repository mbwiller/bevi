/**
 * Fills `public.bev_edges` from Postgres: the edge-weight half of A-16 (1)'s
 * pipeline (TASKS.md A-16 steps 1, 3, 4, 5, 7 and 10).
 *
 *   npm run graph:edges                 # read, weigh, write bev_edges
 *   npm run graph:edges -- --dry-run    # read and weigh, write NOTHING, print the probes
 *   npm run graph:edges -- --strict     # refuse to write on a sanity-report breach
 *
 * NEO4J IS NOT INVOLVED. This job reads Postgres and writes Postgres. Steps 6,
 * 8 and 9 of A-16 -- the Cypher `MERGE`, the `RANKED` mirror and the `(:Meta)`
 * keep-alive -- are a later PR, and `bev_edges` is correct and complete without
 * them: the graph only ever MIRRORS this table (docs/graph.md, "the one rule").
 * No `NEO4J_*` variable is read here, so a dead Aura instance cannot stop the
 * app's similarity data from being rebuilt.
 *
 * Conventions follow scripts/catalog/* and scripts/graph/apply-schema.ts: Node
 * 22, run with `--experimental-strip-types`, no build step and NO DEPENDENCIES.
 * That last one is why this talks to PostgREST with `fetch` and a service-role
 * key rather than opening a libpq connection -- and why the two things PostgREST
 * cannot express are `security definer` RPCs in 20261023000300 rather than
 * inline SQL: the pgvector `<=>` KNN probe (there is no REST operator for it)
 * and the whole-table replace, which step 7 requires to be ONE TRANSACTION.
 * One RPC call is one transaction; a sequence of REST calls is not.
 *
 * Credentials, from the environment (supabase/.env locally, Actions secrets in
 * CI -- see .github/workflows/graph-edges.yml and docs/graph.md):
 *
 *   SUPABASE_URL                 the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY    the service-role key. THE ONE SECRET THIS JOB
 *                                NEEDS, and the one this repo does not have yet.
 *
 * Neither has a default and neither is optional: a missing one is a hard exit 1
 * with the name in the message. `graph-keepalive.yml` has reported success
 * every day since 2026-10-15 while doing nothing, because its script exits 0
 * when `NEO4J_URI` is unset. That mistake is not repeated here.
 *
 * IDEMPOTENT AND RESUMABLE. The job is a full rebuild with exactly one write
 * step: `replace_bev_edges` replaces the whole table inside one transaction. So
 * running it twice produces the same table, and a crash anywhere before that
 * call leaves yesterday's edges untouched -- there is no partial state to
 * resume FROM, which is the strongest form of resumable available at this size.
 * The D-11 inference before it is itself idempotent (a Bev that already has a
 * profile is left alone).
 */

import { fileURLToPath } from "node:url";

import {
  EDGE_MIN_WEIGHT,
  EDGE_TOP_K,
  EDGE_WEIGHTS,
  RANKING_VERSION,
} from "@bevi/ranking";
import type { FlavorProfile } from "@bevi/ranking";
import {
  COP_MIN_CO_RATERS,
  KNN_CANDIDATES,
  buildTaxonomy,
  bevFeatures,
  coRatersFromRankings,
  treeNodeOf,
  candidatePairs,
  edgeRows,
  neighboursOf,
  pairKey,
  selectEdges,
  taxonomyIsFlat,
  weighPair,
  weighPairs,
} from "./edges-core.ts";
import type { BevRecord, CategoryRecord, NeighbourRecord, WeighContext, WeightedPair } from "./edges-core.ts";
import { rankingRecords } from "./neighbours-core.ts";
import type { RankingZRow } from "./neighbours-core.ts";

// ---------------------------------------------------------------------------
// The sanity report's thresholds (TASKS.md 1d, docs/graph.md)
// ---------------------------------------------------------------------------

/**
 * Coca-Cola <-> Pepsi >= 0.8 and Coca-Cola <-> a sparkling water < 0.4.
 *
 * PRINTED ALWAYS, ENFORCED ONLY UNDER `--strict`, on purpose.
 *
 * M-24 (#86) worked out what the second bound actually depends on: with today's
 * flat categories the tree term is 0 for Coke vs a sparkling water, so
 *
 *   w = 0.25*0 + 0.15*0.1 + 0.30*emb + 0.30*0.4 = 0.135 + 0.30*emb
 *
 * which stays under 0.4 only while the gte-small cosine is <= 0.88. Nobody has
 * ever seen that number: `bev_embeddings` is empty on prod, and the Aura
 * instance this was meant to be judged against has never been reachable. So the
 * first real run is a MEASUREMENT, not a gate. Failing the job on a bound whose
 * derivation says it may legitimately trip would mean `bev_edges` stays empty
 * -- the app loses its similarity data to protect a threshold that is itself
 * under review.
 *
 * The breach is therefore loud (a `::error::` annotation, so Actions shows it
 * on the run) but not fatal unless `--strict` is passed. Once a few nights of
 * reports exist and the thresholds have been re-derived against real vectors,
 * `--strict` belongs in the nightly workflow and this comment can go.
 */
const SANITY_MIN_COKE_PEPSI = 0.8;
const SANITY_MAX_COKE_SPARKLING = 0.4;

/** Catalog names, resolved by exact match then by case-insensitive substring. */
const PROBE_NAMES = [
  "Coca-Cola Classic",
  "Pepsi",
  "Diet Coke",
  "Matcha", // "a matcha": whichever Bev the catalog has
  "Red Bull",
] as const;

const COKE_NAME = "Coca-Cola Classic";
const PEPSI_NAME = "Pepsi";
const SPARKLING_NAME = "LaCroix Lime"; // the 10.1 worked example's sparkling water
const SPARKLING_CATEGORY = "sparkling_water";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  strict: boolean;
  knn: number;
  topK: number;
  minWeight: number;
}

export function parseOptions(argv: readonly string[]): Options {
  const opts: Options = {
    dryRun: false,
    strict: false,
    knn: KNN_CANDIDATES,
    topK: EDGE_TOP_K,
    minWeight: EDGE_MIN_WEIGHT,
  };
  for (const arg of argv) {
    const num = (name: string): number => {
      const value = Number(arg.slice(name.length + 3));
      if (!Number.isFinite(value)) throw new Error(`--${name} needs a number, got "${arg}"`);
      return value;
    };
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--strict") opts.strict = true;
    else if (arg.startsWith("--knn=")) opts.knn = num("knn");
    else if (arg.startsWith("--top-k=")) opts.topK = num("top-k");
    else if (arg.startsWith("--min-weight=")) opts.minWeight = num("min-weight");
    else throw new Error(`unknown argument "${arg}". Accepts --dry-run, --strict, --knn=N, --top-k=N, --min-weight=X.`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// PostgREST
// ---------------------------------------------------------------------------

interface Client {
  select: <T>(path: string) => Promise<T[]>;
  rpc: <T>(name: string, body: Record<string, unknown>) => Promise<T>;
  rpcRows: <T>(name: string, body: Record<string, unknown>) => Promise<T[]>;
}

/**
 * `max_rows = 1000` in supabase/config.toml, and it applies to "a view, table,
 * OR STORED PROCEDURE". So a set-returning RPC is silently truncated at 1000
 * rows exactly like a table read, which is why `rpcRows` pages too: the KNN
 * probe returns about 50 rows per Bev, so at 378 Bevs it is ~19,000 and a
 * single call would quietly return a twentieth of the candidate set.
 */
const PAGE = 1000;

function client(url: string, key: string): Client {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    const text = await response.text();
    if (!response.ok) {
      // The key is in a header, not the URL, so the path is safe to print.
      throw new Error(`${response.status} ${response.statusText} on ${path}\n  ${text.slice(0, 600)}`);
    }
    return text === "" ? null : JSON.parse(text);
  };

  const paged = async <T>(path: string, init?: RequestInit): Promise<T[]> => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const sep = path.includes("?") ? "&" : "?";
      const page = (await request(`${path}${sep}limit=${PAGE}&offset=${offset}`, init)) as T[];
      if (!Array.isArray(page)) throw new Error(`expected an array from ${path}`);
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };

  return {
    // Every table read is ordered in the caller's path, because `limit`/`offset`
    // paging over an unordered result can repeat or skip rows.
    select: <T>(path: string) => paged<T>(path),
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      return (await request(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) })) as T;
    },
    rpcRows: <T>(name: string, body: Record<string, unknown>) =>
      paged<T>(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }),
  };
}

// ---------------------------------------------------------------------------
// Reads (A-16 step 1)
// ---------------------------------------------------------------------------

interface BevRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  leaf_category_id: string | null;
  price_tier: number;
}
interface CategoryRow {
  id: string;
  parent_id: string | null;
  is_alcoholic: boolean;
}
interface ProfileRow {
  bev_id: string;
  base: string;
  carbonated: boolean;
  caffeine: number;
  sweetness: number;
  dairy: boolean;
  alcohol: boolean;
}
interface EmbeddingRow {
  bev_id: string;
  embedding: string | number[];
}
interface NeighbourRow {
  bev_id: string;
  neighbour_id: string;
  distance: number;
}
/** One row of `bev_co_rater_counts()` (20261026000300). */
interface CoRaterRow {
  bev_id: string;
  rater_count: number;
}

/**
 * pgvector renders over PostgREST as the text form `[0.1,-0.2,...]`, which is
 * valid JSON, so it parses either way -- but the string form is what a
 * `vector` column actually produces, and assuming the array form is how this
 * silently reads zero embeddings.
 */
function parseEmbedding(value: string | number[]): number[] {
  const vector = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(vector) || vector.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
    throw new Error(`not a numeric vector: ${JSON.stringify(value).slice(0, 80)}`);
  }
  return vector as number[];
}

function profileOf(row: ProfileRow): FlavorProfile {
  return {
    base: row.base,
    carbonated: row.carbonated,
    caffeine: row.caffeine as 0 | 1 | 2 | 3,
    sweetness: row.sweetness as 0 | 1 | 2 | 3,
    dairy: row.dairy,
    alcohol: row.alcohol,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const pct = (x: number) => x.toFixed(4);

function label(bev: BevRecord | undefined, id: string): string {
  if (bev === undefined) return id;
  return `${bev.name}${bev.brand ? ` (${bev.brand})` : ""} [${bev.categoryId}]`;
}

function componentLine(pair: WeightedPair): string {
  const c = pair.components;
  const weights = EDGE_WEIGHTS;
  return (
    `w=${pct(pair.weight)}` +
    `  tree=${pct(c.tree)}*${weights.tree}` +
    `  content=${pct(c.content)}*${weights.content}` +
    `  emb=${pct(c.emb)}*${weights.emb}` +
    `  profile=${pct(c.profile)}*${weights.profile}` +
    `  cop=${pct(c.cop)}*${weights.cop}`
  );
}

/**
 * Exact name, then the lowest-id case-insensitive substring match, then
 * nothing. Seed Bev ids are deterministic (`catalogBevId` in
 * scripts/catalog/catalog.ts), so "a matcha" resolves to the same Bev on every
 * run and the report is comparable night to night.
 */
function findBev(bevs: readonly BevRecord[], name: string, categoryId?: string): BevRecord | undefined {
  const pool = categoryId === undefined ? bevs : bevs.filter((b) => b.categoryId === categoryId);
  const exact = pool.find((b) => b.name === name);
  if (exact !== undefined) return exact;
  const needle = name.toLowerCase();
  const near = pool.filter((b) => b.name.toLowerCase().includes(needle)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return near[0];
}

/** Any Bev in a category, lowest id first: the sanity report's fallback sparkling water. */
function firstInCategory(bevs: readonly BevRecord[], categoryId: string): BevRecord | undefined {
  return bevs.filter((b) => b.categoryId === categoryId).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    ["SUPABASE_URL", url],
    ["SUPABASE_SERVICE_ROLE_KEY", key],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")}. This job cannot run without them and will not pretend it did.\n` +
        `  Locally: put them in supabase/.env (gitignored).\n` +
        `  In CI: SUPABASE_SERVICE_ROLE_KEY is a repository secret and SUPABASE_URL a repository variable.\n` +
        `  See docs/graph.md and .github/workflows/graph-edges.yml.`
    );
  }
  const db = client(url as string, key as string);

  // -- step 1: read ---------------------------------------------------------
  const [categoryRows, bevRows] = await Promise.all([
    db.select<CategoryRow>("/categories?select=id,parent_id,is_alcoholic&order=id"),
    db.select<BevRow>(
      "/bevs?select=id,name,brand,flavor,category_id,leaf_category_id,price_tier&status=eq.active&order=id"
    ),
  ]);

  // A-13: `bevs.category_id` is always one of the 15 ROOTS, so the alcohol
  // lookup needs no walking -- `category_is_alcoholic()` exists for callers
  // holding a leaf, which this job never is for the gate. A leaf's own row
  // carries its root's flag anyway (the catalog validator enforces it), so
  // either key would answer.
  const alcoholic = new Map(categoryRows.map((c) => [c.id, c.is_alcoholic]));
  const categories: CategoryRecord[] = categoryRows.map((c) => ({ id: c.id, parentId: c.parent_id }));
  const bevs: BevRecord[] = bevRows.map((b) => ({
    id: b.id,
    name: b.name,
    brand: b.brand,
    flavor: b.flavor,
    categoryId: b.category_id,
    leafCategoryId: b.leaf_category_id,
    priceTier: b.price_tier,
    isAlcoholic: alcoholic.get(b.category_id) ?? true, // fail closed, as graph-query does
  }));
  const byId = new Map(bevs.map((b) => [b.id, b]));

  const taxonomy = buildTaxonomy(categories);
  // A-13: the tree term is measured at each Bev's leaf. `candidatePairs` still
  // groups by `categoryId`, which IS D-04's "same parent subtree" arm, because
  // `category_id` stayed the root.
  const treeNodes = new Map(bevs.map((b) => [b.id, treeNodeOf(b)]));
  const withLeaf = bevs.filter((b) => b.leafCategoryId !== null).length;
  console.log(`bevs: ${bevs.length} active; categories: ${categories.length}`);
  console.log(
    taxonomyIsFlat(taxonomy)
      ? `taxonomy: FLAT (no categories.parent_id), so the tree term is the [same category] indicator: ${EDGE_WEIGHTS.tree} or 0`
      : `taxonomy: hierarchical, ${Object.values(taxonomy).filter((p) => p !== null).length} categories with a parent; ` +
        `${withLeaf}/${bevs.length} Bevs weighed at a leaf, ${bevs.length - withLeaf} at their root`
  );

  // -- step 1 (continued): profiles, D-11 inference, embeddings -------------
  let profileRows = await db.select<ProfileRow>(
    "/bev_flavor_profiles?select=bev_id,base,carbonated,caffeine,sweetness,dairy,alcohol&order=bev_id"
  );
  const haveProfile = new Set(profileRows.map((p) => p.bev_id));
  const needProfile = bevs.filter((b) => !haveProfile.has(b.id));

  if (needProfile.length === 0) {
    console.log("flavour profiles: every active Bev has one");
  } else if (opts.dryRun) {
    console.log(
      `flavour profiles: ${needProfile.length} active Bev(s) have none; --dry-run writes nothing, so D-11 inference is SKIPPED and their profile term is 0`
    );
  } else {
    // D-11 (20261023000200). One call per Bev, because the function's choice is
    // per Bev and the number of user-created Bevs without a profile is small;
    // each call is independent, so a failure here is reported and the run
    // continues with a 0 profile term rather than losing every edge.
    const outcomes = new Map<string, number>();
    for (const bev of needProfile) {
      try {
        const rows = await db.rpc<Array<{ outcome: string }>>("infer_bev_flavor_profile", { p_bev_id: bev.id });
        const outcome = rows[0]?.outcome ?? "no_row";
        outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
      } catch (error: unknown) {
        console.log(`::warning::D-11 inference failed for ${label(bev, bev.id)}: ${String(error)}`);
        outcomes.set("error", (outcomes.get("error") ?? 0) + 1);
      }
    }
    console.log(
      `flavour profiles: D-11 inference over ${needProfile.length} Bev(s) without one -> ${[...outcomes]
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
    profileRows = await db.select<ProfileRow>(
      "/bev_flavor_profiles?select=bev_id,base,carbonated,caffeine,sweetness,dairy,alcohol&order=bev_id"
    );
  }

  const profiles = new Map<string, FlavorProfile>();
  for (const row of profileRows) if (byId.has(row.bev_id)) profiles.set(row.bev_id, profileOf(row));

  const embeddingRows = await db.select<EmbeddingRow>("/bev_embeddings?select=bev_id,embedding&order=bev_id");
  const embeddings = new Map<string, readonly number[]>();
  for (const row of embeddingRows) if (byId.has(row.bev_id)) embeddings.set(row.bev_id, parseEmbedding(row.embedding));

  const withoutEmbedding = bevs.length - embeddings.size;
  console.log(`embeddings: ${embeddings.size}/${bevs.length} active Bevs; profiles: ${profiles.size}/${bevs.length}`);
  if (withoutEmbedding > 0) {
    // Not fatal: the emb term is 0 and every weight is lower than it should be.
    // The sanity report below is what makes that visible, and it is why the
    // first run after the embed pipeline lands is the one worth reading.
    console.log(
      `::warning::${withoutEmbedding} active Bev(s) have no embedding, so their emb term is 0 and their weights are understated. Run the embed pipeline first.`
    );
  }

  // -- step 3: candidates ---------------------------------------------------
  let nearest: NeighbourRecord[] = [];
  if (embeddings.size > 1) {
    const rows = await db.rpcRows<NeighbourRow>("nearest_bev_embeddings", { p_limit: opts.knn });
    nearest = rows.map((r) => ({ bevId: r.bev_id, neighbourId: r.neighbour_id, distance: r.distance }));
  }
  const pairs = candidatePairs(bevs, nearest);
  console.log(
    `candidates: ${pairs.size} unordered pairs from same-category union same-brand union the ${opts.knn} nearest by cosine (${nearest.length} KNN rows)`
  );

  // -- steps 4 and 5: weigh and keep ---------------------------------------
  const features = new Map(bevs.map((b) => [b.id, bevFeatures(b)]));
  // -- step 1 (continued): the cop term's input (A-16 (2)) ----------------
  // `sim_cop(b, b')` is the cosine of two Bevs' z-scores over their COMMON
  // RATERS, clamped at 0, and 0 below 3 of them (LaTeX section 10.1).
  // `EDGE_WEIGHTS.cop` is still 0, so this changes no weight -- it fills in
  // `components.cop` so the number is already measured and inspectable when
  // Matt renormalises and switches gamma on.
  //
  // `bev_co_rater_counts` is read first and only to decide whether to bother:
  // below 3 rankings on a Bev the term is 0 for every pair it is in, so with
  // today's data (#122: 27 rankings over 3 users) the usual answer is "no Bev
  // qualifies" and the rankings read is skipped entirely.
  const coRated = await db.rpcRows<CoRaterRow>("bev_co_rater_counts", { p_min_raters: COP_MIN_CO_RATERS });
  let coRaters: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined;
  if (coRated.length === 0) {
    console.log(
      `cop: no active Bev has ${COP_MIN_CO_RATERS} or more raters, so sim_cop is 0 for every pair ` +
        `(its weight is ${EDGE_WEIGHTS.cop} regardless). Skipping the rankings read.`
    );
  } else {
    const rankingRows = await db.rpcRows<RankingZRow>("ranking_z_inputs", {});
    // The same z-scores the taste graph uses, from the same functions, so the
    // two jobs can never disagree about what a user's z is: computed from
    // EVERY ranking (mu and sigma as `get_prediction_snapshot` has them), then
    // restricted to active Bevs, so an inactive Bev is never a co-rated one.
    coRaters = coRatersFromRankings(rankingRecords(rankingRows));
    console.log(
      `cop: ${coRated.length} Bev(s) with >= ${COP_MIN_CO_RATERS} raters, ${rankingRows.length} rankings read; ` +
        `sim_cop will be non-zero only for pairs sharing ${COP_MIN_CO_RATERS}+ raters ` +
        `(weight ${EDGE_WEIGHTS.cop}, so no stored weight changes)`
    );
  }

  const ctx: WeighContext = { taxonomy, treeNodes, features, profiles, embeddings, coRaters };
  const weighted = weighPairs(pairs, ctx);
  const kept = selectEdges(weighted, opts.topK, opts.minWeight);
  const covered = new Set<string>();
  for (const p of kept) {
    covered.add(p.src);
    covered.add(p.dst);
  }
  console.log(
    `edges: ${kept.length} kept of ${weighted.length} weighed (top ${opts.topK} per Bev, w >= ${opts.minWeight}); ${covered.size}/${bevs.length} Bevs have at least one`
  );

  // -- step 10: the sanity report ------------------------------------------
  const breaches = sanityReport(bevs, ctx);
  report(breaches);
  // The gate, when it is opted into, comes BEFORE the write: the point of
  // --strict is not to label a bad generation after publishing it, it is to
  // refuse to publish one. bev_edges keeps yesterday's values, which is what
  // docs/graph.md promises on failure.
  if (opts.strict && breaches.length > 0) {
    throw new Error(`--strict: ${breaches.length} sanity-report breach(es); bev_edges was not written`);
  }

  // -- the dry-run probes (A-16 "Failure modes") ---------------------------
  if (opts.dryRun) {
    console.log("\n--- top 5 neighbours (dry run) ---");
    for (const name of PROBE_NAMES) {
      const bev = findBev(bevs, name);
      if (bev === undefined) {
        console.log(`${name}: not in the catalog`);
        continue;
      }
      console.log(`${label(bev, bev.id)}  ${bev.id}`);
      const rows = neighboursOf(bev.id, kept, 5);
      if (rows.length === 0) console.log("    (no edge survived the threshold)");
      for (const row of rows) {
        console.log(`    ${pct(row.weight)}  ${label(byId.get(row.bevId), row.bevId)}`);
      }
    }
    console.log(`\n--dry-run: nothing written. ${kept.length} row(s) would have replaced public.bev_edges.`);
    return;
  }

  // -- step 7: write back, in one transaction ------------------------------
  const rows = edgeRows(kept);
  // `replace_bev_edges` refuses an empty array, and this says why before the
  // round trip. Zero kept edges over a 378-Bev catalog is a broken run -- no
  // embeddings, a failed read, a mistyped --min-weight -- and the right
  // outcome is a red X with yesterday's edges intact, not an empty mirror.
  if (rows.length === 0) {
    throw new Error(
      "no edge cleared the threshold, so there is nothing to write. bev_edges is left as it was. " +
        "Check the embedding count above and --min-weight."
    );
  }
  const written = await db.rpc<number>("replace_bev_edges", { p_rows: rows, p_version: RANKING_VERSION });
  console.log(`bev_edges: replaced with ${written} row(s) at version ${RANKING_VERSION}, in one transaction`);
  if (written !== rows.length) {
    throw new Error(`replace_bev_edges inserted ${written} of ${rows.length} rows`);
  }
}

/**
 * The sanity report (TASKS.md 1d). Both pairs are weighed DIRECTLY rather than
 * looked up among the kept edges, so the report says what the formula gives even
 * when the pair fell below the threshold -- which is the whole point for the
 * Coke/sparkling-water line, whose expected weight is BELOW 0.4 and so is
 * expected not to be stored at all.
 *
 * Every component term is printed, not just the total: a breach is only
 * actionable if you can see which term moved.
 */
function sanityReport(bevs: readonly BevRecord[], ctx: WeighContext): string[] {
  const coke = findBev(bevs, COKE_NAME);
  const pepsi = findBev(bevs, PEPSI_NAME);
  const sparkling = findBev(bevs, SPARKLING_NAME, SPARKLING_CATEGORY) ?? firstInCategory(bevs, SPARKLING_CATEGORY);
  const breaches: string[] = [];

  console.log("\n--- sanity report (TASKS.md 1d) ---");
  const line = (
    a: BevRecord | undefined,
    b: BevRecord | undefined,
    expectation: string,
    ok: (w: number) => boolean
  ): void => {
    if (a === undefined || b === undefined || a.id === b.id) {
      const note = `cannot measure ${expectation}: ${a === undefined || b === undefined ? "a Bev is missing from the catalog" : "both names resolved to the same Bev"}`;
      console.log(`::warning::${note}`);
      breaches.push(note);
      return;
    }
    const pair = weighPair(a.id, b.id, ctx);
    console.log(`${label(a, a.id)}  <->  ${label(b, b.id)}`);
    console.log(`    ${componentLine(pair)}`);
    console.log(`    expected ${expectation}  ->  ${ok(pair.weight) ? "ok" : "BREACH"}`);
    if (!ok(pair.weight)) {
      breaches.push(`${a.name} <-> ${b.name}: w=${pct(pair.weight)}, expected ${expectation}`);
    }
  };

  line(coke, pepsi, `w >= ${SANITY_MIN_COKE_PEPSI}`, (w) => w >= SANITY_MIN_COKE_PEPSI);
  line(coke, sparkling, `w < ${SANITY_MAX_COKE_SPARKLING}`, (w) => w < SANITY_MAX_COKE_SPARKLING);
  // Where to go and look: the canonical orientation of the first pair, which is
  // the primary key of its row in bev_edges.
  if (coke !== undefined && pepsi !== undefined && coke.id !== pepsi.id) {
    console.log(`(Coca-Cola <-> Pepsi is stored in bev_edges as ${pairKey(coke.id, pepsi.id).replace("|", " -> ")})`);
  }
  return breaches;
}

/** Loud either way; fatal only under `--strict`, which `main` applies. See SANITY_MIN_COKE_PEPSI. */
function report(breaches: readonly string[]): void {
  if (breaches.length === 0) {
    console.log("sanity report: both lines within their bounds.");
    return;
  }
  for (const breach of breaches) console.log(`::error::sanity report breach: ${breach}`);
  console.log(
    `\nsanity report: ${breaches.length} breach(es). The weights are suspect and this run should be treated as such.\n` +
      `The bounds are NOT a gate by default: the < 0.4 line holds only while the gte-small cosine stays <= 0.88 (M-24), a number no run has measured yet.\n` +
      `Pass --strict to make a breach fail the job (without writing) once the thresholds have been re-derived against real embeddings.`
  );
}

// Only when run directly, so edges-core.test.ts can import `parseOptions` from
// here without opening a connection (the guard apply-schema.ts uses).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`graph:edges failed\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
