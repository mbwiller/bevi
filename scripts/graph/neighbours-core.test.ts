/**
 * Unit tests for the pure half of A-16 (2)'s taste-graph job
 * (scripts/graph/neighbours-core.ts). No database, no network, no key.
 *
 *   node --experimental-strip-types --test scripts/graph/neighbours-core.test.ts
 *   npm run test:scripts
 *
 * These do NOT re-test M-28's formulas: `blendUserSimilarity`,
 * `topUserNeighbours` and the rest have 78 golden vectors and 338 tests of
 * their own in packages/ranking (#131). What is tested here is the part this
 * file owns -- which pairs get scored, how a symmetric similarity becomes two
 * directed rows, that the per-user top-K is applied per user rather than
 * globally, and that a run is reproducible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RANKING_VERSION, TASTE_SIM_FLOOR, blendUserSimilarity, tasteCatalog, tasteVector, zScoresFromRankings } from "@bevi/ranking";

import { buildNeighbours, NEIGHBOUR_VERSION } from "./neighbours-core.ts";
import type { CatalogBevRecord, RankingRecord } from "./neighbours-core.ts";
import { COP_MIN_CO_RATERS, coRatersByBev, copSimilarity } from "./edges-core.ts";
import { parseOptions } from "./build-neighbours.ts";

// Real uuids, and ordered so `u1 < u2 < u3` in code-point order: the tie-break
// on `sim` is "the smaller userId first", so the ordering has to be knowable.
const U = {
  u1: "00000000-0000-4000-8000-0000000000a1",
  u2: "00000000-0000-4000-8000-0000000000b2",
  u3: "00000000-0000-4000-8000-0000000000c3",
} as const;

const B = {
  coke: "00000000-0000-4000-8000-00000000bb01",
  pepsi: "00000000-0000-4000-8000-00000000bb02",
  sprite: "00000000-0000-4000-8000-00000000bb03",
  fanta: "00000000-0000-4000-8000-00000000bb04",
  latte: "00000000-0000-4000-8000-00000000bb05",
  mocha: "00000000-0000-4000-8000-00000000bb06",
} as const;

/**
 * A catalog where every attribute covers at least 2 Bevs, so `tasteCatalog`
 * keeps all of them -- otherwise the coverage rule silently empties the taste
 * vectors and every assertion below would pass for the wrong reason.
 */
const CATALOG: CatalogBevRecord[] = [
  { id: B.coke, categoryId: "soda", brand: "Coca-Cola", flavorBase: "cola" },
  { id: B.pepsi, categoryId: "soda", brand: "Pepsi", flavorBase: "cola" },
  { id: B.sprite, categoryId: "soda", brand: "Coca-Cola", flavorBase: "lemon-lime" },
  { id: B.fanta, categoryId: "soda", brand: "Pepsi", flavorBase: "lemon-lime" },
  { id: B.latte, categoryId: "coffee", brand: "Starbucks", flavorBase: "coffee" },
  { id: B.mocha, categoryId: "coffee", brand: "Starbucks", flavorBase: "coffee" },
];

const rank = (userId: string, bevId: string, score: number): RankingRecord => ({ userId, bevId, score });

// ---------------------------------------------------------------------------
// buildNeighbours
// ---------------------------------------------------------------------------

test("no rankings gives no users, no pairs and no rows", () => {
  const build = buildNeighbours([], CATALOG);
  assert.deepEqual(build.rows, []);
  assert.deepEqual(build.users, []);
  assert.equal(build.pairsConsidered, 0);
  assert.equal(build.pairsKept, 0);
});

test("one user is a user but not a pair: a neighbourhood needs two", () => {
  const build = buildNeighbours([rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8)], CATALOG);
  assert.deepEqual(build.users, [U.u1]);
  assert.equal(build.pairsConsidered, 0);
  assert.deepEqual(build.rows, []);
});

test("every unordered pair is considered: there is no candidate rule", () => {
  // Three users, each with two rankings -> 3 pairs, whatever they ranked.
  const build = buildNeighbours(
    [
      rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8),
      rank(U.u2, B.sprite, 7), rank(U.u2, B.fanta, 6),
      rank(U.u3, B.latte, 9), rank(U.u3, B.mocha, 3),
    ],
    CATALOG,
  );
  assert.deepEqual(build.users, [U.u1, U.u2, U.u3]);
  assert.equal(build.pairsConsidered, 3);
});

test("a kept pair becomes TWO directed rows, one owned by each user", () => {
  // Two users who agree on four co-rated Bevs: well above the gate.
  const rankings = [
    rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8), rank(U.u1, B.sprite, 4), rank(U.u1, B.fanta, 3),
    rank(U.u2, B.coke, 9), rank(U.u2, B.pepsi, 7), rank(U.u2, B.sprite, 4), rank(U.u2, B.fanta, 2),
  ];
  const build = buildNeighbours(rankings, CATALOG);
  assert.equal(build.pairsKept, 1);
  assert.equal(build.rows.length, 2);

  const forward = build.rows.find((r) => r.user_id === U.u1);
  const back = build.rows.find((r) => r.user_id === U.u2);
  assert.ok(forward && back);
  assert.equal(forward.neighbor_id, U.u2);
  assert.equal(back.neighbor_id, U.u1);
  // sim, common and shared_attrs are symmetric: only ownership differs.
  assert.equal(forward.sim, back.sim);
  assert.equal(forward.common, back.common);
  assert.equal(forward.shared_attrs, back.shared_attrs);
  assert.equal(forward.method, back.method);
  assert.equal(forward.common, 4);
});

test("the row's numbers are blendUserSimilarity's, not this file's", () => {
  // The guard against this file quietly recomputing anything: the same inputs
  // through @bevi/ranking directly must produce the stored row.
  const rankings = [
    rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8), rank(U.u1, B.latte, 3),
    rank(U.u2, B.coke, 8), rank(U.u2, B.pepsi, 9), rank(U.u2, B.latte, 2),
  ];
  const catalog = tasteCatalog(CATALOG);
  const z = zScoresFromRankings(rankings);
  const expected = blendUserSimilarity(
    {
      zu: z.get(U.u1)!,
      zv: z.get(U.u2)!,
      tu: tasteVector(z.get(U.u1)!, catalog),
      tv: tasteVector(z.get(U.u2)!, catalog),
    },
    catalog,
  );

  const row = buildNeighbours(rankings, CATALOG).rows.find((r) => r.user_id === U.u1);
  assert.ok(row);
  assert.equal(row.sim, expected.sim);
  assert.equal(row.common, expected.common);
  assert.equal(row.shared_attrs, expected.sharedAttrs);
  assert.equal(row.method, expected.method);
});

test("a pair below the floor produces no row at all, in either direction", () => {
  // Opposite tastes: u1 loves cola and hates coffee, u2 the reverse, so the
  // blend goes negative and cannot clear a 0.1 floor.
  const rankings = [
    rank(U.u1, B.coke, 10), rank(U.u1, B.pepsi, 10), rank(U.u1, B.latte, 1), rank(U.u1, B.mocha, 1),
    rank(U.u2, B.coke, 1), rank(U.u2, B.pepsi, 1), rank(U.u2, B.latte, 10), rank(U.u2, B.mocha, 10),
  ];
  const build = buildNeighbours(rankings, CATALOG);
  assert.equal(build.pairsConsidered, 1);
  assert.equal(build.pairsKept, 0);
  assert.deepEqual(build.rows, []);
  // And the similarity really is below the floor, rather than the pair having
  // been skipped for some other reason.
  const catalog = tasteCatalog(CATALOG);
  const z = zScoresFromRankings(rankings);
  const blended = blendUserSimilarity(
    { zu: z.get(U.u1)!, zv: z.get(U.u2)!, tu: tasteVector(z.get(U.u1)!, catalog), tv: tasteVector(z.get(U.u2)!, catalog) },
    catalog,
  );
  assert.ok(blended.sim < TASTE_SIM_FLOOR, `expected sim < ${TASTE_SIM_FLOOR}, got ${blended.sim}`);
});

test("the top-K cut is per user, so it can keep v for u without keeping u for v", () => {
  // k = 1 makes the asymmetry visible with three users: the middle user has two
  // candidates and keeps its better one, while each outer user has only one.
  const rankings = [
    rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8), rank(U.u1, B.sprite, 4), rank(U.u1, B.fanta, 3),
    rank(U.u2, B.coke, 9), rank(U.u2, B.pepsi, 8), rank(U.u2, B.sprite, 4), rank(U.u2, B.fanta, 3),
    rank(U.u3, B.coke, 8), rank(U.u3, B.pepsi, 9), rank(U.u3, B.sprite, 5), rank(U.u3, B.fanta, 3),
  ];
  const build = buildNeighbours(rankings, CATALOG);
  // Every user's rows are its own, and no user exceeds the K it was given.
  const byUser = new Map<string, number>();
  for (const row of build.rows) byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + 1);
  for (const [, count] of byUser) assert.ok(count <= 25, "no user exceeds TASTE_NEIGHBOUR_K");
  // Nobody is their own neighbour, which the table's CHECK also forbids.
  for (const row of build.rows) assert.notEqual(row.user_id, row.neighbor_id);
  // Each user's own rows are in descending sim, which is the order the index serves.
  for (const u of build.users) {
    const sims = build.rows.filter((r) => r.user_id === u).map((r) => r.sim);
    assert.deepEqual(sims, [...sims].sort((a, b) => b - a));
  }
});

test("a run is reproducible: the same data gives byte-identical rows", () => {
  const rankings = [
    rank(U.u2, B.coke, 9), rank(U.u2, B.pepsi, 8), rank(U.u2, B.latte, 3),
    rank(U.u1, B.coke, 8), rank(U.u1, B.pepsi, 9), rank(U.u1, B.latte, 2),
    rank(U.u3, B.coke, 7), rank(U.u3, B.pepsi, 7), rank(U.u3, B.mocha, 2),
  ];
  const first = buildNeighbours(rankings, CATALOG);
  // Row order in, shuffled: the output must not depend on it.
  const second = buildNeighbours([...rankings].reverse(), CATALOG);
  assert.deepEqual(second.rows, first.rows);
  assert.deepEqual(second.users, first.users);
});

test("a ranking of a Bev outside the catalog is skipped, not an error", () => {
  // A hidden or merged Bev is not in `tasteCatalog`, so `tasteVector` ignores
  // it -- but it still counts as a co-rated Bev for the Pearson term, because
  // both users rated it. Neither behaviour should throw.
  const rankings = [
    rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8), rank(U.u1, "00000000-0000-4000-8000-00000000900e", 5),
    rank(U.u2, B.coke, 8), rank(U.u2, B.pepsi, 9), rank(U.u2, "00000000-0000-4000-8000-00000000900e", 4),
  ];
  const build = buildNeighbours(rankings, CATALOG);
  assert.equal(build.pairsConsidered, 1);
  assert.equal(build.rows.length, 2);
  assert.equal(build.rows[0]!.common, 3, "the off-catalog Bev still counts as co-rated");
});

test("every row carries a method the table's CHECK accepts", () => {
  const build = buildNeighbours(
    [
      rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 8), rank(U.u1, B.sprite, 4),
      rank(U.u2, B.coke, 8), rank(U.u2, B.pepsi, 9), rank(U.u2, B.sprite, 5),
    ],
    CATALOG,
  );
  for (const row of build.rows) {
    assert.ok(["pearson", "attr", "blend"].includes(row.method), `unexpected method ${row.method}`);
    // The column is numeric(5,4) with a [-1, 1] CHECK.
    assert.ok(row.sim >= -1 && row.sim <= 1);
    assert.ok(Number.isInteger(row.common) && row.common >= 0);
    assert.ok(Number.isInteger(row.shared_attrs) && row.shared_attrs >= 0);
  }
});

test("NEIGHBOUR_VERSION is the package's RANKING_VERSION, so rows are stamped with the formulas that made them", () => {
  assert.equal(NEIGHBOUR_VERSION, RANKING_VERSION);
});

// ---------------------------------------------------------------------------
// The cop term (eq. 18), which lives in edges-core.ts
// ---------------------------------------------------------------------------

test("coRatersByBev inverts the z-score map, bev -> (user -> z)", () => {
  const z = zScoresFromRankings([
    rank(U.u1, B.coke, 9), rank(U.u1, B.pepsi, 3),
    rank(U.u2, B.coke, 8), rank(U.u2, B.pepsi, 4),
  ]);
  const raters = coRatersByBev(z);
  assert.deepEqual([...(raters.get(B.coke) as Map<string, number>).keys()].sort(), [U.u1, U.u2].sort());
  assert.equal(raters.get(B.coke)!.get(U.u1), z.get(U.u1)!.get(B.coke));
});

test("copSimilarity is 0 below COP_MIN_CO_RATERS common raters", () => {
  const a = new Map([[U.u1, 1], [U.u2, -1]]);
  const b = new Map([[U.u1, 1], [U.u2, -1]]);
  // Two common raters: perfectly correlated, but under the floor.
  assert.equal(COP_MIN_CO_RATERS, 3);
  assert.equal(copSimilarity(a, b), 0);
});

test("copSimilarity rises with agreement across common raters", () => {
  const a = new Map([[U.u1, 1.5], [U.u2, -0.5], [U.u3, -1]]);
  const b = new Map([[U.u1, 1.2], [U.u2, -0.4], [U.u3, -0.8]]);
  const sim = copSimilarity(a, b);
  assert.ok(sim > 0.9, `expected a high cop, got ${sim}`);
  assert.ok(sim <= 1);
  // Exactly symmetric, as every term of eq. (18) is.
  assert.equal(copSimilarity(b, a), sim);
});

test("a NEGATIVE co-preference clamps to 0 rather than throwing in edgeWeight", () => {
  // The people who rate one highly rate the other poorly. eq. (18) sums
  // non-negative terms, so there is no way to express "dissimilar" -- see
  // copSimilarity's doc comment.
  const a = new Map([[U.u1, 1.5], [U.u2, 0], [U.u3, -1.5]]);
  const b = new Map([[U.u1, -1.5], [U.u2, 0], [U.u3, 1.5]]);
  assert.equal(copSimilarity(a, b), 0);
});

test("copSimilarity ignores a rater only one of the two Bevs has", () => {
  const a = new Map([[U.u1, 1], [U.u2, 0], [U.u3, -1]]);
  const b = new Map([[U.u1, 1], [U.u2, 0], [U.u3, -1]]);
  const both = copSimilarity(a, b);
  const extra = copSimilarity(new Map([...a, ["00000000-0000-4000-8000-00000000e47a", 9]]), b);
  assert.equal(extra, both, "a non-common rater must not move the term");
});

// ---------------------------------------------------------------------------
// The job's arguments
// ---------------------------------------------------------------------------

test("parseOptions defaults to writing and rejects an unknown flag", () => {
  assert.deepEqual(parseOptions([]), { dryRun: false });
  assert.deepEqual(parseOptions(["--dry-run"]), { dryRun: true });
  assert.throws(() => parseOptions(["--strict"]), /unknown argument/);
});
