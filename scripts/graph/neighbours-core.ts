/**
 * The pure half of A-16 (2)'s nightly taste-graph job: everything between "the
 * rows Postgres returned" and "the rows `replace_user_neighbors` takes".
 *
 * NO FORMULA LIVES HERE. `zScoresFromRankings`, `tasteCatalog`, `tasteVector`,
 * `blendUserSimilarity` and `topUserNeighbours` are all
 * M-28's, in `packages/ranking/src/graph.ts` (#131). This file decides which
 * pairs to ask about, in which order, and how the answers become table rows --
 * the same division `edges-core.ts` keeps against `edges.ts`, and the reason
 * `scripts/` can be reviewed without re-deriving any maths.
 *
 * Split out from `build-neighbours.ts` so it can be unit-tested with no
 * database, no network and no service-role key, which is what
 * `neighbours-core.test.ts` does and what CI runs on every PR.
 */

import {
  RANKING_VERSION,
  TASTE_NEIGHBOUR_K,
  TASTE_SIM_FLOOR,
  blendUserSimilarity,
  tasteCatalog,
  tasteVector,
  topUserNeighbours,
  zScoresFromRankings,
} from "@bevi/ranking";
import type { BevId, NeighbourMethod, TasteBev, TasteCatalog, TasteVector, UserId } from "@bevi/ranking";

// ---------------------------------------------------------------------------
// What the job reads out of Postgres
// ---------------------------------------------------------------------------

/**
 * One row of `ranking_z_inputs()` (20261026000300). `score` is already a
 * float8. EVERY ranking is returned, whatever the Bev's status, because a
 * z-score's mu and sigma come from all of them -- `active` says whether the
 * Bev may also be a co-rated Bev. See `activeZScores`.
 */
export interface RankingRecord {
  userId: UserId;
  bevId: BevId;
  score: number;
  /** `bevs.status = 'active'`. False for `pending_photo`, `hidden` and `merged`. */
  active: boolean;
}

/** One row of `ranking_z_inputs()` exactly as PostgREST returns it. */
export interface RankingZRow {
  user_id: string;
  bev_id: string;
  score: number;
  active: boolean;
}

/**
 * `ranking_z_inputs()` rows as `RankingRecord`s, for both jobs. `active` must
 * be a real boolean: a missing column (the function from before it returned
 * one) would otherwise read as "every Bev is inactive" and silently empty
 * both the taste vectors and the cop term, so it throws instead.
 */
export function rankingRecords(rows: readonly RankingZRow[]): RankingRecord[] {
  return rows.map((r) => {
    if (typeof r.active !== "boolean") {
      throw new TypeError(
        `ranking_z_inputs row (${r.user_id}, ${r.bev_id}) has active = ${JSON.stringify(r.active)}, expected a boolean`,
      );
    }
    return { userId: r.user_id, bevId: r.bev_id, score: Number(r.score), active: r.active };
  });
}

/**
 * One active catalog Bev with the three fields a taste attribute is built
 * from, joined to its flavour profile. `TasteBev` is @bevi/ranking's own shape,
 * so this is an alias rather than a parallel type: a drift between them would
 * be a compile error instead of a silent mismatch.
 */
export type CatalogBevRecord = TasteBev;

/** One row of `public.user_neighbors`, as `replace_user_neighbors` takes it. */
export interface NeighbourRow {
  user_id: UserId;
  neighbor_id: UserId;
  sim: number;
  common: number;
  shared_attrs: number;
  method: NeighbourMethod;
}

/**
 * Code-point order, the tie-break the SQL uses (`collate "C"`) and the one
 * `topUserNeighbours` applies to ties on `sim`. Every id here is a uuid, so
 * plain `<` agrees; this exists so the ordering reads as that rule rather than
 * as an accident.
 */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// z-scores: from every ranking, kept for active Bevs only
// ---------------------------------------------------------------------------

/**
 * Each user's z-scores for ACTIVE Bevs, computed from ALL their rankings.
 *
 * Two steps, and the split between them is the point. `zScoresFromRankings` is
 * called once with every row, active or not (#131's contract), so each user's
 * mu and sigma and the global stats are exactly the ones
 * `get_prediction_snapshot` builds: its `ranked` CTE has no status filter.
 * Then each user's map is cut down to active Bevs, matching the snapshot's
 * `rankings` array, which only carries rows for `visible` (active) Bevs. So a
 * hidden Bev's ranking still moves its rater's other z-scores, as it does in
 * Layer 2, but is never a co-rated Bev: not in `tasteVector`, not in
 * `blendUserSimilarity`'s common set, not in `coRatersByBev`.
 *
 * A user whose every ranking is of an inactive Bev is dropped: their map would
 * be empty, so they have no taste vector and nothing to pair on.
 */
export function activeZScores(rankings: readonly RankingRecord[]): Map<UserId, Map<BevId, number>> {
  const active = new Set<string>();
  for (const r of rankings) if (r.active) active.add(`${r.userId}|${r.bevId}`);
  const all = zScoresFromRankings(rankings);
  const out = new Map<UserId, Map<BevId, number>>();
  for (const [u, scores] of all) {
    const kept = new Map([...scores].filter(([b]) => active.has(`${u}|${b}`)));
    if (kept.size > 0) out.set(u, kept);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Taste neighbours (the doc's Stage 3)
// ---------------------------------------------------------------------------

/** What `buildNeighbours` worked out, for the job's log and its sanity report. */
export interface NeighbourBuild {
  rows: NeighbourRow[];
  /** Users with at least one ranking of an active Bev, i.e. the ones with a taste vector. */
  users: UserId[];
  /** Unordered pairs considered: users·(users−1)/2. Every pair is scored; there is no candidate rule. */
  pairsConsidered: number;
  /** Pairs that cleared TASTE_SIM_FLOOR for at least one of the two users. */
  pairsKept: number;
  /** Attributes the catalog kept, i.e. those covering at least TASTE_MIN_ATTR_BEVS Bevs. */
  attributesKept: number;
}

/**
 * Every user pair's blended similarity, reduced to the rows
 * `replace_user_neighbors` stores.
 *
 * EVERY PAIR IS SCORED. There is no candidate rule, unlike `bev_edges`, and
 * #131's PR is explicit about why: the doc's own Cypher candidate query "skips
 * the coverage rule and the distinct-Bev bridge", so computing all pairs in
 * TypeScript is both cheaper at our size and more correct. At n users this is
 * n(n−1)/2 calls to `blendUserSimilarity`; at the 200 users the doc sizes for
 * that is 19,900, which is milliseconds.
 *
 * BOTH DIRECTIONS ARE EMITTED, independently. `topUserNeighbours` is applied
 * per user, so v can be in u's top 25 while u is not in v's -- see the
 * migration's note on why the table is not canonically oriented. A pair that
 * clears the floor for neither user produces no row at all.
 *
 * Deterministic: users are iterated in code-point order and each user's
 * neighbours come back from `topUserNeighbours` in its own total order, so two
 * runs over the same data produce byte-identical rows.
 */
export function buildNeighbours(
  rankings: readonly RankingRecord[],
  catalogBevs: readonly CatalogBevRecord[],
): NeighbourBuild {
  const catalog = tasteCatalog(catalogBevs);
  // z from EVERY ranking (global and per-user stats over the whole set, called
  // once, never per user), then restricted to active Bevs -- `activeZScores`.
  const z = activeZScores(rankings);

  const users = [...z.keys()].sort(cmp);
  const vectors = new Map<UserId, TasteVector>();
  for (const u of users) vectors.set(u, tasteVector(z.get(u) as ReadonlyMap<BevId, number>, catalog));

  // Each user's own candidate list, filled as pairs are scored. Both halves of
  // a pair are pushed, because the selection below is per user.
  const perUser = new Map<UserId, Array<NeighbourRow & { userId: UserId }>>();
  for (const u of users) perUser.set(u, []);

  let pairsConsidered = 0;
  let pairsKept = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i] as UserId;
    for (let j = i + 1; j < users.length; j++) {
      const v = users[j] as UserId;
      pairsConsidered++;
      const result = blendUserSimilarity(
        {
          zu: z.get(u) as ReadonlyMap<BevId, number>,
          zv: z.get(v) as ReadonlyMap<BevId, number>,
          tu: vectors.get(u) as TasteVector,
          tv: vectors.get(v) as TasteVector,
        },
        catalog,
      );
      // The floor is applied by `topUserNeighbours` per user; this only avoids
      // carrying obviously-dead candidates through the sort.
      if (result.sim < TASTE_SIM_FLOOR) continue;
      pairsKept++;
      // `sim`, `common` and `shared_attrs` are symmetric, so both rows carry
      // the same numbers; only the ownership differs.
      const shared = {
        sim: result.sim,
        common: result.common,
        shared_attrs: result.sharedAttrs,
        method: result.method,
      };
      (perUser.get(u) as Array<NeighbourRow & { userId: UserId }>).push({
        userId: v,
        user_id: u,
        neighbor_id: v,
        ...shared,
      });
      (perUser.get(v) as Array<NeighbourRow & { userId: UserId }>).push({
        userId: u,
        user_id: v,
        neighbor_id: u,
        ...shared,
      });
    }
  }

  const rows: NeighbourRow[] = [];
  for (const u of users) {
    // `topUserNeighbours` applies the floor (inclusive), the top-K cut and the
    // `sim desc, userId asc` order. `userId` is the field it reads, which is
    // why each candidate carries it alongside the row's own columns.
    for (const kept of topUserNeighbours(perUser.get(u) as Array<NeighbourRow & { userId: UserId }>, TASTE_NEIGHBOUR_K)) {
      rows.push({
        user_id: kept.user_id,
        neighbor_id: kept.neighbor_id,
        sim: kept.sim,
        common: kept.common,
        shared_attrs: kept.shared_attrs,
        method: kept.method,
      });
    }
  }

  return {
    rows,
    users,
    pairsConsidered,
    pairsKept,
    attributesKept: new Set([...catalog.attributes.values()].flat()).size,
  };
}

/** The version every row of a run is stamped with. Re-exported so the job and its test agree. */
export const NEIGHBOUR_VERSION = RANKING_VERSION;

export type { TasteCatalog };
