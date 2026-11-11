/**
 * Mirrors the Bev graph from Postgres into Neo4j AuraDB Free, nightly
 * (TASKS.md A-16 steps 6, 8 and 9: the Cypher `MERGE`, the `RANKED` mirror and
 * the `(:Meta)` stamp).
 *
 *   npm run graph:sync                 # read Postgres, write the graph, verify, commit
 *   npm run graph:sync -- --dry-run    # everything, then ROLL BACK: nothing is written
 *   npm run graph:sync -- --fixture    # the source is the checked-in catalog, not Postgres;
 *                                      # forces --dry-run and needs only NEO4J_*
 *
 * POSTGRES STAYS THE SYSTEM OF RECORD. Nothing lives only in the graph, and
 * Neo4j is never on a request path (docs/graph.md, "the one rule"): the app
 * reads `bev_edges` in Postgres, which `graph-edges` writes without this job.
 * A red run here costs the app nothing; it leaves yesterday's graph in place.
 *
 * THE WRITE IS ONE EXPLICIT TRANSACTION -- MERGE, stamp, sweep, verify:
 *
 *   1. upsert every node, then every relationship, in batched `UNWIND $rows`
 *      statements, each stamped with this run's `syncId`;
 *   2. sweep: delete every owned relationship and node whose `syncId` is not
 *      this run's (a removed ranking, a hidden Bev). `(:Meta)` is never swept;
 *   3. (the analytics phase of the next PR goes here);
 *   4. verify, still inside the transaction, by reading the graph back: the
 *      count per label and per type must equal the plan EXACTLY, plus the
 *      invariants in `VERIFY_INVARIANTS`. Any mismatch rolls back;
 *   5. stamp `(:Meta)` and commit.
 *
 * So the graph only ever moves from one complete, verified generation to the
 * next. Any error rolls the transaction back, and a reader never sees a
 * half-written night.
 *
 * Conventions follow scripts/graph/build-edges.ts: Node 22,
 * `--experimental-strip-types`, NO DEPENDENCIES, `fetch` only, a pure half
 * (`sync-core.ts`) tested with `node:test`, and this I/O half behind a
 * `process.argv[1]` guard.
 *
 * Credentials for a real run, ALL REQUIRED, with no default and no skip path
 * (`graph-keepalive.yml` reported success for eight days while doing nothing,
 * because its script exits 0 when a secret is unset):
 *
 *   SUPABASE_URL                 the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY    reads every table past RLS
 *   NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE
 *   BEVI_PSEUDONYM_SALT          the HMAC key behind (:User {pseudonym}); at
 *                                least 16 characters. Changing it renames every
 *                                user, so it is set once and kept.
 *
 * THIS REPOSITORY AND ITS ACTIONS LOGS ARE PUBLIC. No line this job prints
 * contains a user id, a pseudonym, a secret, the Neo4j host or its URL.
 * Catalog names and Bev ids are public data and are printed freely; for users
 * the log carries COUNTS ONLY.
 */

import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { RANKING_VERSION } from "@bevi/ranking";

import { createNeo4jClient, isTransient, missingEnv, neo4jConfigFromEnv, NEO4J_ENV } from "./neo4j.ts";
import type { Neo4jClient, Neo4jRunner, Neo4jTransaction } from "./neo4j.ts";
import { createPostgrestClient } from "./postgrest.ts";
import type { PostgrestClient } from "./postgrest.ts";
import {
  COUNT_STAMPED,
  OWNED_LABELS,
  OWNED_TYPES,
  READ_META,
  REPORT_NEIGHBOURS,
  REPORT_TWO_HOP,
  REPORT_VECTOR,
  STAMP_FAILED_ATTEMPT,
  STAMP_META,
  VERIFY_COUNTS,
  VERIFY_INVARIANTS,
  buildGraphPlan,
  chunk,
  findBevByName,
  metaParameters,
  sourceFromRows,
  sweepSteps,
  verificationFailures,
  writeSteps,
} from "./sync-core.ts";
import type {
  BevEdgeRow,
  BevRow,
  CategoryRow,
  EmbeddingRow,
  GraphPlan,
  GraphSource,
  ProfileRow,
  RankingRow,
} from "./sync-core.ts";
import { FIXTURE_PSEUDONYM_SALT, buildFixtureSource } from "./sync-fixture.ts";

// ---------------------------------------------------------------------------
// CLI and environment
// ---------------------------------------------------------------------------

export interface Options {
  dryRun: boolean;
  fixture: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
  const opts: Options = { dryRun: false, fixture: false };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--fixture") opts.fixture = true;
    else throw new Error(`unknown argument "${arg}". Usage: graph:sync [--dry-run] [--fixture]`);
  }
  // The fixture is synthetic. It must never become the graph.
  if (opts.fixture) opts.dryRun = true;
  return opts;
}

export const PSEUDONYM_SALT_MIN_LENGTH = 16;

const SOURCE_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const SALT_ENV = "BEVI_PSEUDONYM_SALT";

/**
 * Every variable this run needs, checked at once, so ONE error names every
 * missing one. `--fixture` reads no Postgres and pseudonymises made-up users,
 * so it needs the four `NEO4J_*` and nothing else.
 */
export function checkEnvironment(env: Readonly<Record<string, string | undefined>>, opts: Options): void {
  const required = opts.fixture ? [...NEO4J_ENV] : [...SOURCE_ENV, ...NEO4J_ENV, SALT_ENV];
  const missing = missingEnv(env, required);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")}. This job cannot run without them and will not pretend it did.\n` +
        `  Locally: put them in supabase/.env (gitignored).\n` +
        `  In CI: SUPABASE_URL is a repository variable; the rest are repository secrets.\n` +
        `  See docs/graph.md and .github/workflows/graph-sync.yml.`,
    );
  }
  if (!opts.fixture && (env[SALT_ENV] as string).length < PSEUDONYM_SALT_MIN_LENGTH) {
    throw new Error(
      `${SALT_ENV} is shorter than ${PSEUDONYM_SALT_MIN_LENGTH} characters. It is the only thing between a ` +
        `(:User).pseudonym and a profile id, so a short one is refused.`,
    );
  }
}

/**
 * `hmac-sha256(salt, user_id)`, hex. Stable across runs, so co-rating
 * accumulates on one node; not reversible without the salt, which lives in
 * Actions secrets and nowhere the app or an Edge Function can reach.
 */
export function pseudonymiser(salt: string): (userId: string) => string {
  return (userId: string) => createHmac("sha256", salt).update(userId).digest("hex");
}

/** A timestamp plus random hex: unique per run, and sortable by eye in `(:Meta).syncId`. */
export function newSyncId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[-:.]/g, "")}-${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Reading Postgres
// ---------------------------------------------------------------------------

/**
 * Six ordered, paged table reads with the service role, which bypasses RLS.
 *
 * `bev_flavor_profiles` is read on its own rather than embedded in `/bevs`: it
 * has two foreign keys to `bevs`, so an embed is ambiguous. `rankings` is read
 * ONCE, so every z and every `RANKED` edge come from the same snapshot.
 */
export async function readSource(db: PostgrestClient): Promise<GraphSource> {
  const [categories, bevs, profiles, embeddings, edges, rankings] = await Promise.all([
    db.select<CategoryRow>("/categories?select=id,name,parent_id,is_alcoholic,sort_order&order=id"),
    db.select<BevRow>(
      "/bevs?select=id,name,brand,flavor,category_id,leaf_category_id,price_tier,source,is_starter,status&status=eq.active&order=id",
    ),
    db.select<ProfileRow>(
      "/bev_flavor_profiles?select=bev_id,base,carbonated,caffeine,sweetness,dairy,alcohol,serve,source&order=bev_id",
    ),
    db.select<EmbeddingRow>("/bev_embeddings?select=bev_id,embedding,model&order=bev_id"),
    db.select<BevEdgeRow>(
      "/bev_edges?select=src_bev_id,dst_bev_id,weight,components,version,computed_at&order=src_bev_id,dst_bev_id",
    ),
    db.select<RankingRow>("/rankings?select=user_id,bev_id,bucket,score,ranked_at&order=user_id,bev_id"),
  ]);
  return sourceFromRows({ categories, bevs, profiles, embeddings, edges, rankings });
}

/**
 * Zero active Bevs, zero categories or zero `bev_edges` rows is a BROKEN READ,
 * never a state: prod has all three, and syncing an empty read would sweep the
 * whole graph away. Refused before a transaction is opened. Zero rankings is a
 * real state (a fresh database) and only warns.
 */
export function assertSourceNotEmpty(source: GraphSource, log: Log): void {
  const activeBevs = source.bevs.filter((b) => b.status === "active").length;
  const empty = [
    ["active Bevs", activeBevs],
    ["categories", source.categories.length],
    ["bev_edges rows", source.edges.length],
  ].filter(([, n]) => n === 0);
  if (empty.length > 0) {
    throw new Error(
      `the source read came back with zero ${empty.map(([name]) => name).join(" and zero ")}. ` +
        `That is a broken read, not a state, and syncing it would empty the graph. Nothing was sent to Neo4j.`,
    );
  }
  if (source.rankings.length === 0) {
    log("::warning::zero rankings read: the graph will hold no (:User), RANKED, LIKES or DISLIKES after this run.");
  }
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

export type Log = (line: string) => void;

/** The verification read the graph back and it does not match the plan. Never transient: retrying cannot help. */
export class VerificationError extends Error {
  readonly failures: readonly string[];
  constructor(failures: readonly string[]) {
    super(
      `verification failed, so the transaction was rolled back and the graph is as it was:\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
    this.name = "VerificationError";
    this.failures = failures;
  }
}

export interface SyncOptions {
  syncId: string;
  dryRun: boolean;
  /** Whole-sync attempts on a TRANSIENT error. */
  maxAttempts?: number;
  /** The pause before attempt n+1 is `backoffMs * n`. */
  backoffMs?: number;
  /** How often to ask the vector index again after a commit, and how long to wait between. */
  vectorProbeAttempts?: number;
  vectorProbeDelayMs?: number;
}

export interface SyncDeps {
  client: Neo4jClient;
  log: Log;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 5000;

/**
 * The next PR (`be/graph-stats`) computes centrality and communities inside
 * this same transaction, after the sweep and before the verification, so its
 * output is published atomically with the generation it was computed from.
 * Until then this does nothing.
 */
async function analyticsPhase(_tx: Neo4jRunner, _plan: GraphPlan, _syncId: string): Promise<void> {}

/** Steps 1-5 on an open transaction. Throws on any failure; the caller owns commit and rollback. */
async function writeGeneration(tx: Neo4jRunner, plan: GraphPlan, syncId: string, log: Log): Promise<void> {
  // 1. upsert nodes, then relationships
  for (const step of writeSteps(plan)) {
    const batches = chunk(step.rows, step.batchSize);
    for (const rows of batches) await tx.run(step.statement, { rows, syncId });
    log(`  upsert ${step.name.padEnd(12)} ${String(step.rows.length).padStart(6)} row(s) in ${batches.length} request(s)`);
  }

  // 2. sweep whatever this run did not stamp
  for (const step of sweepSteps()) await tx.run(step.statement, { syncId });
  log(`  sweep  ${OWNED_TYPES.length} relationship types and ${OWNED_LABELS.length} labels not stamped ${syncId}`);

  // --- analytics phase (be/graph-stats) goes here ---
  await analyticsPhase(tx, plan, syncId);

  // 4. verify, by reading the graph back inside the transaction
  const answered = [...(await tx.run(VERIFY_COUNTS)), ...(await tx.run(VERIFY_INVARIANTS))];
  const failures = verificationFailures(plan, answered);
  if (failures.length > 0) throw new VerificationError(failures);
  log(`  verify ${answered.length} checks read back from the graph: all equal the plan`);

  // 5. stamp (:Meta). The commit is the caller's.
  await tx.run(STAMP_META, metaParameters(plan, syncId));
}

/**
 * One attempt: one explicit transaction. Commits a verified generation, or --
 * under `dryRun` -- runs exactly the same statements, prints the read-back
 * report from inside the transaction, and rolls back. Any error rolls back
 * (best effort) and rethrows, so yesterday's generation stays in place.
 */
export async function syncOnce(plan: GraphPlan, options: SyncOptions, deps: SyncDeps): Promise<void> {
  const tx: Neo4jTransaction = await deps.client.beginTransaction();
  try {
    await writeGeneration(tx, plan, options.syncId, deps.log);
    if (options.dryRun) {
      // The committed graph will never hold this generation, so the report is
      // read here, through the transaction that can still see it.
      await readBackReport(tx, plan, { ...options, vectorProbeAttempts: 1 }, deps, "uncommitted");
      await tx.rollback();
      deps.log("--dry-run: the transaction was ROLLED BACK. Nothing was written to the graph.");
    } else {
      await tx.commit();
      deps.log(`committed generation ${options.syncId}`);
    }
  } catch (error: unknown) {
    try {
      await tx.rollback();
    } catch {
      // Best effort: an unreachable server expires the transaction by itself.
    }
    throw error;
  }
}

/**
 * The whole job against Neo4j: up to `maxAttempts` whole-sync attempts on a
 * TRANSIENT error (each in a fresh transaction), then the post-commit
 * confirmation and the read-back report.
 *
 * After a final failure of a real run it stamps `(:Meta).lastAttemptAt` and
 * `lastAttemptOk = false` in a separate implicit transaction, best effort, and
 * rethrows. A dry run stamps nothing: it promised to write nothing.
 */
export async function runSync(plan: GraphPlan, options: SyncOptions, deps: SyncDeps): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      deps.log(`attempt ${attempt}/${maxAttempts}: one transaction, syncId ${options.syncId}${options.dryRun ? " (dry run)" : ""}`);
      await syncOnce(plan, options, deps);
      break;
    } catch (error: unknown) {
      if (isTransient(error) && attempt < maxAttempts) {
        const wait = backoffMs * attempt;
        deps.log(`::warning::attempt ${attempt} failed with a transient error and was rolled back; retrying in ${wait} ms\n${message(error)}`);
        await deps.sleep(wait);
        continue;
      }
      if (!options.dryRun) {
        try {
          await deps.client.query(STAMP_FAILED_ATTEMPT);
          deps.log("stamped (:Meta).lastAttemptAt with lastAttemptOk = false");
        } catch {
          deps.log("::warning::could not stamp (:Meta).lastAttemptAt either; the instance may be paused (docs/graph.md)");
        }
      }
      throw error;
    }
  }

  // Reads of the committed graph. The generation is already published, so a
  // network blip here is retried on its own rather than failing a good sync.
  const committed: Neo4jRunner = {
    async run(statement, parameters) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await deps.client.query(statement, parameters);
        } catch (error: unknown) {
          if (!isTransient(error) || attempt >= maxAttempts) throw error;
          await deps.sleep(backoffMs * attempt);
        }
      }
    },
  };
  if (options.dryRun) {
    // Proof of the rollback, from outside the transaction.
    const [meta] = await committed.run(READ_META);
    const [stamped] = await committed.run(COUNT_STAMPED, { syncId: options.syncId });
    if (meta?.syncId === options.syncId || stamped?.n !== 0) {
      throw new Error("the dry run left something behind: the committed graph carries this run's syncId");
    }
    deps.log(`confirmed from outside the transaction: 0 nodes carry this run's syncId, (:Meta).syncId is unchanged`);
    return;
  }

  const [meta] = await committed.run(READ_META);
  if (meta?.syncId !== options.syncId) {
    throw new Error(`the commit was acknowledged but (:Meta).syncId is ${JSON.stringify(meta?.syncId ?? null)}, not ${options.syncId}`);
  }
  deps.log(`confirmed: (:Meta).syncId = ${options.syncId}, lastSyncAt = ${String(meta.lastSyncAt)}`);
  await readBackReport(committed, plan, options, deps, "committed");
}

// ---------------------------------------------------------------------------
// The read-back report
// ---------------------------------------------------------------------------

/** Catalog names, resolved the way `findBev` in build-edges.ts does. */
const PROBE_NAMES = ["Coca-Cola Classic", "Pepsi", "Matcha", "Red Bull"] as const;
const COKE_NAME = "Coca-Cola Classic";

const fixed = (value: unknown): string => (typeof value === "number" ? value.toFixed(4) : String(value));
const named = (row: { name?: unknown; brand?: unknown }): string =>
  `${String(row.name)}${typeof row.brand === "string" && row.brand.trim() !== "" ? ` (${row.brand})` : ""}`;

/**
 * The proof that the graph ANSWERS, produced by Cypher against the graph
 * itself rather than by re-reading the plan: the top-5 `SIMILAR_TO` neighbours
 * of four probes, one two-hop traversal `bev_edges` cannot express, and a
 * vector-index probe.
 *
 * Catalog names are public and printed. For users: COUNTS ONLY -- never a
 * pseudonym, never an id.
 */
export async function readBackReport(
  runner: Neo4jRunner,
  plan: GraphPlan,
  options: SyncOptions,
  deps: SyncDeps,
  state: "committed" | "uncommitted",
): Promise<void> {
  const { log } = deps;
  log(`\n--- read-back report (Cypher against the ${state} graph) ---`);

  for (const name of PROBE_NAMES) {
    const bev = findBevByName(plan.nodes.bevs, name);
    if (bev === undefined) {
      log(`${name}: not in the graph`);
      continue;
    }
    log(`${named(bev)} [${bev.categoryId}]  ${bev.id}`);
    const rows = await runner.run(REPORT_NEIGHBOURS, { bevId: bev.id });
    if (rows.length === 0) log("    (no SIMILAR_TO edge)");
    for (const row of rows) log(`    ${fixed(row.w)}  ${named(row)} [${String(row.categoryId)}]`);
  }

  const coke = findBevByName(plan.nodes.bevs, COKE_NAME);
  if (coke !== undefined) {
    log(`two hops from ${coke.name}: same (:Flavor) AND a shared (:Note), but NO direct SIMILAR_TO`);
    const rows = await runner.run(REPORT_TWO_HOP, { bevId: coke.id });
    if (rows.length === 0) log("    (none)");
    for (const row of rows) {
      log(`    ${named(row)}  via flavor=${String(row.flavor)} notes=${(row.notes as unknown[]).join("+")}`);
    }

    // The vector index is updated asynchronously after a commit, and not at
    // all for uncommitted writes, so an empty answer is a warning.
    log(`vector index bev_embedding_idx, 5 nearest to ${coke.name}'s embedding`);
    const attempts = options.vectorProbeAttempts ?? 6;
    let nearest: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      nearest = await runner.run(REPORT_VECTOR, { bevId: coke.id });
      if (nearest.length > 0 || attempt === attempts) break;
      await deps.sleep(options.vectorProbeDelayMs ?? 2000);
    }
    if (nearest.length === 0) {
      log(
        state === "uncommitted"
          ? "    (no answer: the index does not see an uncommitted transaction. Expected in a dry run.)"
          : coke.embedding === null
            ? "    (the probe Bev has no embedding)"
            : "::warning::the vector index returned nothing yet; it populates asynchronously after the commit.",
      );
    }
    for (const row of nearest) log(`    ${fixed(row.score)}  ${named(row)}`);
  }

  const c = plan.counts;
  log(
    `users (counts only): ${c.nodes.User} (:User), ${c.relationships.RANKED} RANKED, ` +
      `${c.relationships.LIKES} LIKES, ${c.relationships.DISLIKES} DISLIKES`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function logPlan(plan: GraphPlan, log: Log): void {
  log("plan:");
  for (const label of OWNED_LABELS) log(`  (:${label})`.padEnd(18) + String(plan.counts.nodes[label]).padStart(6));
  for (const type of OWNED_TYPES) log(`  [:${type}]`.padEnd(18) + String(plan.counts.relationships[type]).padStart(6));
  log(
    `  ${plan.counts.bevsWithEmbedding}/${plan.counts.nodes.Bev} Bevs carry an embedding, ` +
      `${plan.counts.bevsWithProfile}/${plan.counts.nodes.Bev} a flavour profile; ` +
      `edges version ${plan.edgesVersion || "(none)"}, ranking version ${plan.rankingVersion}`,
  );
  const d = plan.dropped;
  log(
    `dropped (not errors): ${d.edgesToInactiveBevs} bev_edges row(s) touching a non-active Bev, ` +
      `${d.rankingsOfInactiveBevs} ranking(s) of a non-active Bev (still in mu/sigma), ` +
      `${d.usersWithoutActiveRanking} user(s) with no ranking of an active Bev, ` +
      `${d.notesBelowMinimum} token(s) on a single Bev, ` +
      `${d.inactiveBevs} non-active Bev row(s), ${d.profilesOfInactiveBevs} profile(s) and ` +
      `${d.embeddingsOfInactiveBevs} embedding(s) of non-active Bevs`,
  );
  if (d.leafParentMismatches > 0) {
    log(`::warning::${d.leafParentMismatches} active Bev(s) have a leaf that is not a child of their category_id; mirrored as stored.`);
  }
}

async function main(): Promise<void> {
  const log: Log = (line) => console.log(line);
  const opts = parseOptions(process.argv.slice(2));
  checkEnvironment(process.env, opts);

  let source: GraphSource;
  let salt: string;
  if (opts.fixture) {
    log("--fixture: the source is data/catalog plus synthetic users, NOT Postgres. Forcing --dry-run.");
    source = buildFixtureSource();
    salt = FIXTURE_PSEUDONYM_SALT;
  } else {
    const db = createPostgrestClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    source = await readSource(db).catch((error: unknown) => {
      throw new Error(`reading Postgres failed, so nothing was sent to Neo4j and the graph is as it was.\n${message(error)}`);
    });
    salt = process.env.BEVI_PSEUDONYM_SALT as string;
  }
  log(
    `source: ${source.bevs.length} Bevs, ${source.categories.length} categories, ${source.profiles.length} flavour profiles, ` +
      `${source.embeddings.length} embeddings, ${source.edges.length} bev_edges rows, ${source.rankings.length} rankings`,
  );
  assertSourceNotEmpty(source, log);

  const plan = buildGraphPlan(source, { pseudonymOf: pseudonymiser(salt), rankingVersion: RANKING_VERSION });
  logPlan(plan, log);

  const client = createNeo4jClient(neo4jConfigFromEnv(process.env));
  await runSync(
    plan,
    { syncId: newSyncId(), dryRun: opts.dryRun },
    { client, log, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  );
  log(opts.dryRun ? "\ngraph:sync dry run complete. The graph is unchanged." : "\ngraph:sync complete.");
}

// Only when run directly, so sync.test.ts can import the orchestration.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`graph:sync failed\n${message(error)}`);
    process.exit(1);
  });
}
