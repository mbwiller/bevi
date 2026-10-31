/**
 * Fills `public.user_neighbors` from Postgres: A-16 (2), Stage 3 of
 * docs/graph_db_implementation.md.
 *
 *   npm run graph:neighbours                 # read, score every pair, write
 *   npm run graph:neighbours -- --dry-run    # read and score, write NOTHING, print the report
 *
 * NEO4J IS NOT INVOLVED, for the same reason `build-edges.ts` does not need it:
 * every float formula is pure TypeScript in @bevi/ranking (M-28, #131), so the
 * doc's `RANKED` edges, HMAC pseudonyms and Cypher aggregation buy nothing at
 * this size. They stay with A-16's deferred steps 6, 8 and 9. No `NEO4J_*`
 * variable is read here, so a paused Aura instance cannot stop taste
 * neighbours from being rebuilt.
 *
 * WHAT CONSUMES THESE ROWS TODAY: nothing, and that is the designed state.
 * Stage 4 -- `get_prediction_snapshot` emitting `(alias, sim, common)` and
 * `layer2()` reading `snapshot.userNeighbors` -- is a separate PR, because
 * `layer2.ts` is Matt's lane and the doc says Stage 4 "crosses both and needs
 * the contract agreed first". Until then `layer2()` falls back to its
 * in-snapshot computation, which is exactly the doc's "3 or more rankings, not
 * yet synced" tier. Writing the table first means Stage 4 is a read change
 * against data that already exists and has already been inspected.
 *
 * EXPECT VERY FEW ROWS, OR NONE. #131's PR says so outright and #122's export
 * measured why: 3 users, 27 rankings, a median of 1 co-rater per rated pair.
 * The alpha gate needs 2 co-rated Bevs and the bridge rule needs 2 bridging
 * attributes through DISTINCT Bevs, so most pairs score 0. An empty result is
 * reported, not treated as a failure -- `replace_user_neighbors` accepts an
 * empty payload for precisely this reason, which is the one way it differs
 * from `replace_bev_edges`.
 *
 * Conventions follow scripts/graph/build-edges.ts exactly: Node 22, run with
 * `--experimental-strip-types`, no build step, NO DEPENDENCIES, PostgREST over
 * `fetch` with a service-role key, and the one thing PostgREST cannot express
 * -- a whole-table replace in ONE TRANSACTION -- is a `security definer` RPC.
 *
 * Credentials, from the environment (supabase/.env locally, Actions secrets in
 * CI -- see .github/workflows/graph-neighbours.yml and docs/graph.md):
 *
 *   SUPABASE_URL                the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY   the service-role key
 *
 * Neither has a default and neither is optional: a missing one is a hard exit 1
 * with the name in the message, for the reason build-edges.ts gives at length
 * (`graph-keepalive.yml` reported success for eight days while doing nothing).
 *
 * IDEMPOTENT. One write step, `replace_user_neighbors`, which replaces the
 * whole table inside one transaction. Running it twice over the same data
 * produces byte-identical rows -- `buildNeighbours` iterates users in
 * code-point order -- and a crash anywhere before that call leaves yesterday's
 * generation untouched, which is what the doc requires of the publication.
 */

import { fileURLToPath } from "node:url";

import { compareCodePoints, RANKING_VERSION, TASTE_NEIGHBOUR_K, TASTE_SIM_FLOOR } from "@bevi/ranking";
import { buildNeighbours } from "./neighbours-core.ts";
import type { CatalogBevRecord, NeighbourRow, RankingRecord } from "./neighbours-core.ts";

const PAGE = 1000;

interface Client {
  select<T>(path: string): Promise<T[]>;
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
  rpcRows<T>(name: string, body: Record<string, unknown>): Promise<T[]>;
}

/**
 * The same minimal PostgREST client `build-edges.ts` uses. Duplicated rather
 * than shared because the two jobs are independent entry points and a shared
 * client would be the first dependency between them; it is 40 lines and the
 * alternative is a module whose only purpose is to be imported twice.
 */
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
    // Every read is ordered server-side (the RPCs' own `order by`, and the
    // `order=` below), because limit/offset paging over an unordered result can
    // repeat or skip rows.
    select: <T>(path: string) => paged<T>(path),
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      return (await request(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) })) as T;
    },
    rpcRows: <T>(name: string, body: Record<string, unknown>) =>
      paged<T>(`/rpc/${name}`, { method: "POST", body: JSON.stringify(body) }),
  };
}

interface RankingZRow {
  user_id: string;
  bev_id: string;
  score: number;
}

interface CatalogRow {
  id: string;
  category_id: string;
  brand: string | null;
  bev_flavor_profiles: { base: string } | Array<{ base: string }> | null;
}

export interface Options {
  dryRun: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
  const opts: Options = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`unknown argument ${arg}. Usage: graph:neighbours [--dry-run]`);
  }
  return opts;
}

/**
 * The embedded flavour profile, which PostgREST renders as an object for a
 * one-to-one embed and as an array when it cannot prove the relationship is
 * one-to-one. Both shapes are handled rather than assumed, the same way
 * `parseEmbedding` in build-edges.ts handles pgvector's two renderings -- a
 * wrong guess here reads as "no Bev has a flavour base", which would silently
 * delete a third of every taste vector.
 */
function flavorBaseOf(row: CatalogRow): string | null {
  const embed = row.bev_flavor_profiles;
  if (embed === null) return null;
  const profile = Array.isArray(embed) ? embed[0] : embed;
  return profile?.base ?? null;
}

/**
 * Per-run aliases for the report. The repo is public, so its Actions logs are
 * too, and any signed-in account can turn a profile uuid into a handle; a raw
 * `user_id -> neighbor_id sim=…` line would publish whose taste matches whose,
 * which `rankings_select` deliberately keeps private. `u1`, `u2`, … in
 * code-point order of the ids keep the report readable (who pairs with whom,
 * both directions) without naming anyone, and they mean nothing across runs.
 */
export function aliasUsers(rows: readonly NeighbourRow[]): Map<string, string> {
  const ids = [...new Set(rows.flatMap((r) => [r.user_id, r.neighbor_id]))].sort(compareCodePoints);
  return new Map(ids.map((id, i) => [id, `u${i + 1}`]));
}

/** A row's own line in the report: the sim, the evidence behind it, and which terms produced it. */
function rowLine(row: NeighbourRow, alias: Map<string, string>): string {
  return (
    `  ${alias.get(row.user_id)} -> ${alias.get(row.neighbor_id)}` +
    `  sim=${row.sim.toFixed(4)}` +
    `  common=${row.common}` +
    `  shared_attrs=${row.shared_attrs}` +
    `  method=${row.method}`
  );
}

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
        `  SUPABASE_URL                the project's REST origin, e.g. https://<ref>.supabase.co\n` +
        `  SUPABASE_SERVICE_ROLE_KEY   Project Settings > API. Bypasses RLS, which is what lets this\n` +
        `                              job read every user's rankings through ranking_z_inputs().`,
    );
  }
  const db = client(url as string, key as string);

  // -- read ----------------------------------------------------------------
  // Both reads are RPCs or ordered table reads, and the rankings one has to be
  // an RPC: `rankings_select` is owner-and-followees only, so reading
  // `/rankings` would depend on RLS not applying to the service role, and
  // `ranking_z_inputs()` also casts `score` out of numeric, which PostgREST
  // would otherwise render as a JSON string and `zScoresFromRankings` would
  // reject as non-finite.
  const [rankingRows, catalogRows] = await Promise.all([
    db.rpcRows<RankingZRow>("ranking_z_inputs", {}),
    db.select<CatalogRow>(
      "/bevs?select=id,category_id,brand,bev_flavor_profiles(base)&status=eq.active&order=id",
    ),
  ]);

  const rankings: RankingRecord[] = rankingRows.map((r) => ({
    userId: r.user_id,
    bevId: r.bev_id,
    score: Number(r.score),
  }));
  // The WHOLE active catalog, not just the ranked Bevs: `tasteCatalog` counts
  // coverage over catalog Bevs, so an attribute's "covers at least 2 Bevs" test
  // must not depend on what anyone happens to have ranked.
  const catalogBevs: CatalogBevRecord[] = catalogRows.map((b) => ({
    id: b.id,
    categoryId: b.category_id,
    brand: b.brand,
    flavorBase: flavorBaseOf(b),
  }));

  // A read that came back empty is a broken run, never a real state: prod has
  // rankings and a 378-Bev catalog. Writing its result would empty the table
  // silently, so refuse. "Real data, no pair clears the gate" still writes an
  // empty generation below, which is the case the empty payload exists for.
  if (rankings.length === 0 || catalogBevs.length === 0) {
    throw new Error(
      `read ${rankings.length} ranking(s) and ${catalogBevs.length} active Bev(s); one of the reads is broken. ` +
        `user_neighbors left as it was.`,
    );
  }

  const rankers = new Set(rankings.map((r) => r.userId)).size;
  console.log(
    `rankings: ${rankings.length} over ${rankers} user(s); catalog: ${catalogBevs.length} active Bevs, ` +
      `${catalogBevs.filter((b) => b.flavorBase !== null).length} with a flavour base`,
  );

  // -- score ---------------------------------------------------------------
  const build = buildNeighbours(rankings, catalogBevs);
  console.log(
    `attributes kept: ${build.attributesKept} (covering >= 2 catalog Bevs); ` +
      `pairs: ${build.pairsConsidered} considered, ${build.pairsKept} above the ${TASTE_SIM_FLOOR} floor`,
  );
  console.log(`rows: ${build.rows.length} (both directions, top ${TASTE_NEIGHBOUR_K} per user)`);

  // The whole report, not a sample: at this volume there are a handful of rows
  // and the point of the first runs is to look at every one of them.
  // Aliased: see `aliasUsers`.
  const alias = aliasUsers(build.rows);
  for (const row of build.rows.slice(0, 50)) console.log(rowLine(row, alias));
  if (build.rows.length > 50) console.log(`  ... and ${build.rows.length - 50} more`);

  if (build.rows.length === 0) {
    // Not a warning and not an error. See the header: this is the expected
    // result at current volume, and the gate doing its job is indistinguishable
    // from the gate being too strict until there is more data.
    console.log(
      `no neighbours cleared the gate. That is the expected result at this data volume ` +
        `(#122: 3 users, 27 rankings, median 1 co-rater per rated pair) and not a failure. ` +
        `The table will be emptied so it never serves a stale generation.`,
    );
  }

  // -- write ---------------------------------------------------------------
  if (opts.dryRun) {
    console.log("--dry-run: user_neighbors NOT written.");
    return;
  }

  const written = await db.rpc<number>("replace_user_neighbors", {
    p_rows: build.rows,
    p_version: RANKING_VERSION,
  });
  if (written !== build.rows.length) {
    throw new Error(`replace_user_neighbors wrote ${written} rows, expected ${build.rows.length}`);
  }
  console.log(`wrote ${written} row(s) to user_neighbors at version ${RANKING_VERSION}.`);
}

// Only run when invoked directly, so the test can import `parseOptions`.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
