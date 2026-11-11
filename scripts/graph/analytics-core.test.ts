/**
 * Unit tests for the pure half of the graph-signals phase
 * (scripts/graph/analytics-core.ts). No database, no network, no credentials.
 *
 *   node --experimental-strip-types --test scripts/graph/analytics-core.test.ts
 *   npm run test:scripts
 *
 * These do NOT re-test PageRank, Louvain or the participation coefficient:
 * those have their own vectors in packages/ranking. What is tested here is
 * what this file owns -- which package function feeds which column, that the
 * community graph (the flavour projection, in the sync) is a separate input
 * from the similarity graph, that a community's public id is opaque, what
 * throws, and that the report prints names and nothing else.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  RANKING_VERSION,
  attributeProjection,
  louvainCommunities,
  modularity,
  pageRank,
  participationCoefficient,
} from "@bevi/ranking";

import {
  CATCH_ALL_FLAVOR,
  COMMUNITY_ID_PATTERN,
  categoryPurity,
  computeGraphStats,
  flavourProjection,
  graphStatsDbRows,
  graphStatsReport,
  graphStatsWrites,
} from "./analytics-core.ts";
import type { GraphEdge, GraphStats, ReportBev } from "./analytics-core.ts";
import { buildGraphPlan, expectedMemberships } from "./sync-core.ts";
import type { GraphPlan } from "./sync-core.ts";
import { FIXTURE_BEVS, FIXTURE_PSEUDONYM_SALT, buildFixtureSource } from "./sync-fixture.ts";
import { communityIdentifier, pseudonymiser } from "./sync.ts";

// ---------------------------------------------------------------------------
// Hand graphs
// ---------------------------------------------------------------------------

const communityIdOf = communityIdentifier("a-test-key-of-sixteen-or-more");

/** `computeGraphStats` with ONE graph for both inputs: the simplest case, in which a community is a similarity cluster. */
const statsOf = (nodes: readonly string[], edges: readonly GraphEdge[]): GraphStats =>
  computeGraphStats({ nodes, similarity: edges, partition: { nodes, edges }, communityIdOf });

/**
 * Two triangles joined by one weak edge.
 *
 *   a1 --1-- a2 --1-- a3 --0.1-- b1 --1-- b2
 *    \______0.5______/            \__1__ b3 __1__/ (b2-b3)
 *
 * In the a-triangle a2 has the greatest within-community strength (2 against
 * 1.5 and 1.5); in the b-triangle all three tie at 2 and the smallest id wins.
 */
const TWO_NODES = ["a1", "a2", "a3", "b1", "b2", "b3"];
const TWO_EDGES: GraphEdge[] = [
  { a: "a1", b: "a2", w: 1 },
  { a: "a2", b: "a3", w: 1 },
  { a: "a1", b: "a3", w: 0.5 },
  { a: "b1", b: "b2", w: 1 },
  { a: "b2", b: "b3", w: 1 },
  { a: "b1", b: "b3", w: 1 },
  { a: "a3", b: "b1", w: 0.1 },
];

const rowOf = (stats: GraphStats, bevId: string) => {
  const row = stats.rows.find((r) => r.bevId === bevId);
  assert.ok(row, `no row for ${bevId}`);
  return row;
};
const near = (actual: number, expected: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${what}: ${actual} is not ${expected}`);

test("two cliques joined by a weak edge are two communities, one row per Bev, sorted by id", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  assert.deepEqual(stats.rows.map((r) => r.bevId), TWO_NODES);
  assert.equal(stats.communities.length, 2);
  assert.deepEqual(stats.communities.map((c) => c.size), [3, 3]);
  assert.deepEqual(stats.counts, { bevs: 6, edges: 7, partitionEdges: 7, communities: 2, singletons: 0, isolated: 0 });

  const a = rowOf(stats, "a1").communityId;
  const b = rowOf(stats, "b1").communityId;
  assert.notEqual(a, b);
  for (const id of ["a1", "a2", "a3"]) assert.equal(rowOf(stats, id).communityId, a);
  for (const id of ["b1", "b2", "b3"]) assert.equal(rowOf(stats, id).communityId, b);
  for (const row of stats.rows) assert.equal(row.communitySize, 3);
  assert.ok(stats.modularity > 0.4, `modularity ${stats.modularity}`);
});

test("only the two ends of the joining edge have a non-zero bridge score", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  for (const id of ["a1", "a2", "b2", "b3"]) assert.equal(rowOf(stats, id).bridge, 0, id);
  // a3: 1.5 of its 1.6 stays home, 0.1 crosses. b1: 2 of 2.1 stays, 0.1 crosses.
  near(rowOf(stats, "a3").bridge, 1 - (1.5 / 1.6) ** 2 - (0.1 / 1.6) ** 2, "bridge of a3");
  near(rowOf(stats, "b1").bridge, 1 - (2 / 2.1) ** 2 - (0.1 / 2.1) ** 2, "bridge of b1");
  for (const row of stats.rows) assert.ok(row.bridge >= 0 && row.bridge < 1);
});

test("strength and degree are the Bev's SIMILAR_TO weight and edge count", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  assert.deepEqual(
    stats.rows.map((r) => [r.bevId, r.degree]),
    [["a1", 2], ["a2", 2], ["a3", 3], ["b1", 3], ["b2", 2], ["b3", 2]],
  );
  near(rowOf(stats, "a1").strength, 1.5, "strength of a1");
  near(rowOf(stats, "a3").strength, 1.6, "strength of a3");
  near(rowOf(stats, "b1").strength, 2.1, "strength of b1");
  for (const row of stats.rows) assert.ok(Number.isInteger(row.degree));
});

test("the hub is the member with the greatest within-community strength; a tie goes to the smallest id", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  assert.deepEqual(stats.communities.map((c) => c.hubBevId).sort(), ["a2", "b1"]);
  for (const community of stats.communities) {
    assert.equal(community.id, communityIdOf(community.hubBevId));
    assert.equal(rowOf(stats, community.hubBevId).communityId, community.id);
  }
});

test("pagerank sums to 1 within 1e-9 and is the package's, value for value", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  const total = stats.rows.reduce((sum, row) => sum + row.pagerank, 0);
  assert.ok(Math.abs(total - 1) <= 1e-9, `sum ${total}`);
  const direct = pageRank({ nodes: TWO_NODES, edges: TWO_EDGES });
  for (const row of stats.rows) assert.equal(row.pagerank, direct[row.bevId]);
  // The two cut vertices carry the most.
  assert.ok(rowOf(stats, "b1").pagerank > rowOf(stats, "b2").pagerank);
});

test("a Bev with no edge is a community of its own with strength 0, degree 0 and bridge 0", () => {
  const stats = statsOf([...TWO_NODES, "z9"], TWO_EDGES);
  const lone = rowOf(stats, "z9");
  assert.equal(lone.strength, 0);
  assert.equal(lone.degree, 0);
  assert.equal(lone.bridge, 0);
  assert.equal(lone.communitySize, 1);
  assert.ok(lone.pagerank > 0, "it still gets the teleport share");
  const own = stats.communities.find((c) => c.id === lone.communityId);
  assert.deepEqual(own, { id: communityIdOf("z9"), size: 1, hubBevId: "z9" });
  assert.equal(stats.counts.communities, 3);
  assert.equal(stats.counts.singletons, 1);
  assert.equal(stats.counts.isolated, 1);
  // Largest first: the singleton is last.
  assert.equal(stats.communities.at(-1)?.hubBevId, "z9");
  const total = stats.rows.reduce((sum, row) => sum + row.pagerank, 0);
  assert.ok(Math.abs(total - 1) <= 1e-9);
});

test("a graph with no edges at all is all singletons with modularity 0", () => {
  const stats = statsOf(["p", "q", "r"], []);
  assert.equal(stats.communities.length, 3);
  assert.equal(stats.modularity, 0);
  for (const row of stats.rows) {
    assert.equal(row.communitySize, 1);
    near(row.pagerank, 1 / 3, "pagerank");
  }
});

test("no nodes gives no rows, and nothing to sum", () => {
  const stats = statsOf([], []);
  assert.deepEqual(stats.rows, []);
  assert.deepEqual(stats.communities, []);
  assert.equal(stats.counts.bevs, 0);
});

// ---------------------------------------------------------------------------
// The partition graph is a separate input
// ---------------------------------------------------------------------------

test("communities and hubs come from the partition graph; pagerank, strength and degree from the similarity graph", () => {
  // The same six Bevs, partitioned by a different graph: three pairs.
  const partitionEdges: GraphEdge[] = [
    { a: "a1", b: "b1", w: 1 },
    { a: "a2", b: "a3", w: 1 },
    { a: "b2", b: "b3", w: 1 },
  ];
  const stats = computeGraphStats({
    nodes: TWO_NODES,
    similarity: TWO_EDGES,
    partition: { nodes: TWO_NODES, edges: partitionEdges },
    communityIdOf,
  });
  const same = statsOf(TWO_NODES, TWO_EDGES);

  // Three communities of two, following the partition graph and cutting across the cliques.
  assert.equal(stats.communities.length, 3);
  assert.equal(rowOf(stats, "a1").communityId, rowOf(stats, "b1").communityId);
  assert.equal(rowOf(stats, "a2").communityId, rowOf(stats, "a3").communityId);
  assert.notEqual(rowOf(stats, "a1").communityId, rowOf(stats, "a2").communityId);
  for (const row of stats.rows) assert.equal(row.communitySize, 2);
  // Hubs by strength IN THE PARTITION GRAPH: each pair ties, the smaller id wins.
  assert.deepEqual(stats.communities.map((c) => c.hubBevId).sort(), ["a1", "a2", "b2"]);

  // Centrality does not move: it never looked at the partition.
  for (const row of stats.rows) {
    const before = rowOf(same, row.bevId);
    assert.equal(row.pagerank, before.pagerank);
    assert.equal(row.strength, before.strength);
    assert.equal(row.degree, before.degree);
  }
  assert.deepEqual(stats.counts, { bevs: 6, edges: 7, partitionEdges: 3, communities: 3, singletons: 0, isolated: 0 });
});

test("bridge is the SIMILAR_TO weight spread over the partition's communities", () => {
  const partition = {
    nodes: TWO_NODES,
    edges: [
      { a: "a1", b: "b1", w: 1 },
      { a: "a2", b: "a3", w: 1 },
      { a: "b2", b: "b3", w: 1 },
    ],
  };
  const stats = computeGraphStats({ nodes: TWO_NODES, similarity: TWO_EDGES, partition, communityIdOf });
  // a1's SIMILAR_TO neighbours are a2 and a3, which share one community: 0,
  // although neither is in a1's own.
  assert.equal(rowOf(stats, "a1").bridge, 0);
  // a3: 1 to a2 (its own community), 0.5 to a1 and 0.1 to b1 (both in the other pair's).
  near(rowOf(stats, "a3").bridge, 1 - (1 / 1.6) ** 2 - (0.6 / 1.6) ** 2, "bridge of a3");
  // And it is exactly what the package gives for (similarity, the partition's communities).
  const communityOf = louvainCommunities(partition).communityOf;
  const direct = participationCoefficient({ nodes: TWO_NODES, edges: TWO_EDGES }, communityOf);
  for (const row of stats.rows) assert.equal(row.bridge, direct[row.bevId]);
  // Modularity is the partition's, measured on the partition graph.
  assert.equal(stats.modularity, modularity(partition, communityOf));
});

test("a partition graph over a different set of Bevs is refused", () => {
  assert.throws(
    () => computeGraphStats({ nodes: TWO_NODES, similarity: TWO_EDGES, partition: { nodes: TWO_NODES.slice(1), edges: [] }, communityIdOf }),
    /partition graph has 5 node\(s\) and the similarity graph 6/,
  );
  assert.throws(
    () =>
      computeGraphStats({
        nodes: TWO_NODES,
        similarity: TWO_EDGES,
        partition: { nodes: [...TWO_NODES.slice(1), "zz"], edges: [] },
        communityIdOf,
      }),
    /must be the same set of Bevs/,
  );
});

// ---------------------------------------------------------------------------
// The flavour projection: what the sync passes as the partition
// ---------------------------------------------------------------------------

/**
 * The same six Bevs, with flavours that CUT ACROSS the two similarity cliques:
 * a1 and b1 are colas, a2 and b2 share the note "cherry" (and a base), a3 and
 * b3 are citrus. Each attribute is carried by exactly two Bevs.
 */
const SPLIT_MEMBERSHIPS = [
  { node: "a1", attribute: "flavor:cola" },
  { node: "b1", attribute: "flavor:cola" },
  { node: "a2", attribute: "flavor:berry" },
  { node: "b2", attribute: "flavor:berry" },
  { node: "a2", attribute: "note:cherry" },
  { node: "b2", attribute: "note:cherry" },
  { node: "a3", attribute: "flavor:citrus" },
  { node: "b3", attribute: "flavor:citrus" },
];

test("flavourProjection is the package's attributeProjection of the rows, and computes no weight of its own", () => {
  const { partition, memberships } = flavourProjection(TWO_NODES, SPLIT_MEMBERSHIPS);
  assert.deepEqual(memberships, SPLIT_MEMBERSHIPS);
  assert.deepEqual(partition, attributeProjection(TWO_NODES, SPLIT_MEMBERSHIPS));
  // Three pairs. Two Bevs sharing two attributes weigh twice what a pair sharing one does.
  assert.deepEqual(
    partition.edges.map((e) => [e.a, e.b]),
    [["a1", "b1"], ["a2", "b2"], ["a3", "b3"]],
  );
  const weight = (a: string) => partition.edges.find((e) => e.a === a)?.w as number;
  near(weight("a2"), 2 * weight("a1"), "a pair sharing a base and a note");
  // Extra columns on a row read back from the graph are ignored; the order of rows does not matter.
  const again = flavourProjection([...TWO_NODES].reverse(), [...SPLIT_MEMBERSHIPS].reverse().map((row) => ({ ...row, extra: 1 })));
  assert.deepEqual(again.partition, partition);
});

test("two cliques by similarity, split differently by flavour: families follow the projection, centrality the similarity", () => {
  const { partition } = flavourProjection(TWO_NODES, SPLIT_MEMBERSHIPS);
  const stats = computeGraphStats({ nodes: TWO_NODES, similarity: TWO_EDGES, partition, communityIdOf });
  const bySimilarity = statsOf(TWO_NODES, TWO_EDGES);

  // Three families of two, each with one Bev from each similarity clique.
  assert.equal(stats.communities.length, 3);
  for (const [x, y] of [["a1", "b1"], ["a2", "b2"], ["a3", "b3"]] as const) {
    assert.equal(rowOf(stats, x).communityId, rowOf(stats, y).communityId, `${x} and ${y}`);
  }
  assert.equal(new Set(stats.rows.map((r) => r.communityId)).size, 3);
  // The hub of a family is its hub IN THE PROJECTION: each pair ties, so the smaller id.
  assert.deepEqual(stats.communities.map((c) => c.hubBevId).sort(), ["a1", "a2", "a3"]);
  for (const community of stats.communities) assert.equal(community.id, communityIdOf(community.hubBevId));

  // PageRank, strength and degree are the similarity graph's, untouched by the partition.
  for (const row of stats.rows) {
    const before = rowOf(bySimilarity, row.bevId);
    assert.deepEqual([row.pagerank, row.strength, row.degree], [before.pagerank, before.strength, before.degree]);
  }

  // The bridge score reflects the mismatch. Clustered by similarity, four of the
  // six scored 0; clustered by flavour, EVERY Bev's similarity weight goes mostly
  // to other families, because its clique-mates are all in them.
  assert.equal(bySimilarity.rows.filter((r) => r.bridge === 0).length, 4);
  for (const row of stats.rows) assert.ok(row.bridge > 0.4, `${row.bevId}: ${row.bridge}`);
  // a1: 1 to a2 (the berry family) and 0.5 to a3 (citrus), nothing to its own.
  near(rowOf(stats, "a1").bridge, 1 - (1 / 1.5) ** 2 - (0.5 / 1.5) ** 2, "bridge of a1");
  // And it is exactly participationCoefficient(similarity, the projection's communities).
  const direct = participationCoefficient({ nodes: TWO_NODES, edges: TWO_EDGES }, louvainCommunities(partition).communityOf);
  for (const row of stats.rows) assert.equal(row.bridge, direct[row.bevId]);
  assert.equal(stats.modularity, modularity(partition, louvainCommunities(partition).communityOf));
  assert.equal(stats.counts.partitionEdges, 3);
});

test("a Bev with no membership is a family of its own, and keeps its similarity signals", () => {
  // b3 carries nothing; a3 carries a base nobody shares, which joins nothing either.
  const rows = SPLIT_MEMBERSHIPS.filter((m) => m.node !== "b3");
  const { partition } = flavourProjection(TWO_NODES, rows);
  assert.ok(!partition.edges.some((e) => e.a === "b3" || e.b === "b3" || e.a === "a3" || e.b === "a3"));
  const stats = computeGraphStats({ nodes: TWO_NODES, similarity: TWO_EDGES, partition, communityIdOf });

  for (const id of ["a3", "b3"]) {
    const row = rowOf(stats, id);
    assert.equal(row.communitySize, 1, id);
    assert.deepEqual(stats.communities.find((c) => c.id === row.communityId), { id: communityIdOf(id), size: 1, hubBevId: id });
    // A singleton FAMILY is not an isolated Bev: it still has its edges, its strength and its PageRank ...
    assert.ok(row.degree > 0 && row.strength > 0 && row.pagerank > 0, id);
    // ... and, since every neighbour is in another family, a bridge score well above 0.
    assert.ok(row.bridge > 0, id);
  }
  assert.equal(stats.counts.singletons, 2);
  assert.equal(stats.counts.isolated, 0);
  assert.equal(stats.counts.communities, 4);
});

test("flavourProjection refuses the catch-all base, a malformed row, and what the package refuses", () => {
  assert.equal(CATCH_ALL_FLAVOR, "other");
  assert.throws(
    () => flavourProjection(TWO_NODES, [...SPLIT_MEMBERSHIPS, { node: "a1", attribute: "flavor:other" }]),
    /row 9 \(Bev a1\) carries the catch-all base "other", which is not a flavour/,
  );
  // A NOTE spelled "other" is a word in a name, not the catch-all base.
  assert.doesNotThrow(() => flavourProjection(TWO_NODES, [...SPLIT_MEMBERSHIPS, { node: "a1", attribute: "note:other" }]));
  for (const attribute of ["cola", "flavor:", "note:", "brand:fizz", "", null, 7]) {
    assert.throws(() => flavourProjection(TWO_NODES, [{ node: "a1", attribute }]), /is not "flavor:<base>" or "note:<token>"/, String(attribute));
  }
  assert.throws(() => flavourProjection(TWO_NODES, [{ node: null, attribute: "flavor:cola" }]), /membership row 1 has no Bev id/);
  assert.throws(() => flavourProjection(TWO_NODES, [{ node: "zz", attribute: "flavor:cola" }]), /is not a node/);
  assert.throws(
    () => flavourProjection(TWO_NODES, [{ node: "a1", attribute: "flavor:cola" }, { node: "a1", attribute: "flavor:cola" }]),
    /duplicate membership/,
  );
  // No membership at all is legal: every Bev is a family of one.
  assert.deepEqual(flavourProjection(TWO_NODES, []).partition.edges, []);
});

// ---------------------------------------------------------------------------
// The opaque community id
// ---------------------------------------------------------------------------

test("communityIdentifier is c_ plus 16 hex of a keyed HMAC: stable, keyed, and not the hub", () => {
  const hub = "a767e075-f4bf-5215-a5f4-44cb8df8d420";
  const other = "946588a1-e485-500a-a7c9-afdd321219b2";
  const a = communityIdentifier("a-test-key-of-sixteen-or-more");
  const b = communityIdentifier("another-key-entirely-00000");
  assert.match(a(hub), COMMUNITY_ID_PATTERN);
  assert.equal(a(hub), a(hub), "the same hub gives the same id");
  assert.notEqual(a(hub), a(other), "two hubs give two ids");
  assert.notEqual(a(hub), b(hub), "the id depends on the key, so the catalog cannot be hashed to recover a hub");
  assert.ok(!a(hub).includes(hub));
  assert.ok(!a(hub).includes(hub.replaceAll("-", "").slice(0, 16)));
  // Not the user pseudonym of the same string under the same key: the prefix keeps the two apart.
  assert.ok(!pseudonymiser("a-test-key-of-sixteen-or-more")(hub).startsWith(a(hub).slice(2)));
  // A known vector, so a change of algorithm cannot pass silently: it would
  // rename every community, in the graph and in bev_graph_stats.
  assert.equal(communityIdentifier("0123456789abcdef")("00000000-0000-4000-8000-000000000001"), "c_04fb062b2625f1d5");
});

test("a community id that is not c_ plus 16 hex is refused, without printing it", () => {
  for (const bad of ["", "c_123", "C_0123456789abcdef", "c_0123456789abcdeg", "0123456789abcdef", "c_0123456789abcdef0"]) {
    assert.throws(
      () => computeGraphStats({ nodes: ["x", "y"], similarity: [], partition: { nodes: ["x", "y"], edges: [] }, communityIdOf: () => bad }),
      (error: Error) => {
        assert.match(error.message, /not "c_" plus 16 hex characters/);
        if (bad !== "") assert.ok(!error.message.includes(bad), `the rejected id reached the message: ${bad}`);
        return true;
      },
    );
  }
});

test("two communities that map to one id throw", () => {
  assert.throws(
    () => computeGraphStats({ nodes: TWO_NODES, similarity: TWO_EDGES, partition: { nodes: TWO_NODES, edges: TWO_EDGES }, communityIdOf: () => "c_0123456789abcdef" }),
    /two communities map to one id: the hubs \w+ and \w+ collide/,
  );
});

test("a community id that is itself a Bev id is refused", () => {
  // Only possible when a Bev id happens to have the id's shape; the check is cheap and the consequence is not.
  const nodes = ["c_0123456789abcdef", "c_fedcba9876543210"];
  assert.throws(
    () => computeGraphStats({ nodes, similarity: [], partition: { nodes, edges: [] }, communityIdOf: (hub) => hub }),
    /contains a Bev id/,
  );
});

test("a community id cut from the hub's own hex is refused", () => {
  const nodes = ["a767e075-f4bf-5215-a5f4-44cb8df8d420", "946588a1-e485-500a-a7c9-afdd321219b2"];
  assert.throws(
    () =>
      computeGraphStats({
        nodes,
        similarity: [],
        partition: { nodes, edges: [] },
        communityIdOf: (hub) => `c_${hub.replaceAll("-", "").slice(0, 16)}`,
      }),
    /contains a Bev id/,
  );
});

test("a non-finite result throws rather than being written", () => {
  // Two edges of the largest double: the shared endpoint's strength overflows.
  const nodes = ["a", "b", "c"];
  const edges = [
    { a: "a", b: "b", w: Number.MAX_VALUE },
    { a: "a", b: "c", w: Number.MAX_VALUE },
  ];
  assert.throws(() => statsOf(nodes, edges), /is not a finite number/);
});

test("what the package refuses is refused here: an unknown endpoint, a self-loop, a duplicate pair, a bad weight", () => {
  assert.throws(() => statsOf(["a", "b"], [{ a: "a", b: "zz", w: 1 }]), /not a node/);
  assert.throws(() => statsOf(["a", "b"], [{ a: "a", b: "a", w: 1 }]), /self-loop/);
  assert.throws(() => statsOf(["a", "b"], [{ a: "a", b: "b", w: 1 }, { a: "b", b: "a", w: 1 }]), /duplicate edge/);
  assert.throws(() => statsOf(["a", "b"], [{ a: "a", b: "b", w: 0 }]), /must be > 0/);
  assert.throws(() => statsOf(["a", "a"], []), /duplicate node/);
});

// ---------------------------------------------------------------------------
// The catalog fixture
// ---------------------------------------------------------------------------

const PLAN: GraphPlan = buildGraphPlan(buildFixtureSource(), {
  pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT),
  rankingVersion: RANKING_VERSION,
});
const FIXTURE_NODES = PLAN.nodes.bevs.map((b) => b.id);
const FIXTURE_EDGES: GraphEdge[] = PLAN.relationships.similarTo.map((e) => ({ a: e.src, b: e.dst, w: e.w }));
const fixtureIdOf = communityIdentifier(FIXTURE_PSEUDONYM_SALT);
/** The memberships the graph hands back for the fixture: flavour bases (not `other`) and shared notes. */
const FIXTURE_MEMBERSHIPS = expectedMemberships(PLAN);
/** As the sync computes it: SIMILAR_TO for centrality and bridge, the flavour projection for the families. */
const FIXTURE: GraphStats = computeGraphStats({
  nodes: FIXTURE_NODES,
  similarity: FIXTURE_EDGES,
  partition: flavourProjection(FIXTURE_NODES, FIXTURE_MEMBERSHIPS).partition,
  communityIdOf: fixtureIdOf,
});

test("on the fixture: one row per active Bev, pagerank summing to 1, every value in range", () => {
  assert.equal(FIXTURE.rows.length, PLAN.counts.nodes.Bev);
  assert.deepEqual(FIXTURE.rows.map((r) => r.bevId), [...FIXTURE_NODES].sort());
  assert.equal(FIXTURE.counts.edges, PLAN.counts.relationships.SIMILAR_TO);
  const total = FIXTURE.rows.reduce((sum, row) => sum + row.pagerank, 0);
  assert.ok(Math.abs(total - 1) <= 1e-9, `sum ${total}`);
  for (const row of FIXTURE.rows) {
    assert.ok(row.pagerank > 0 && row.pagerank < 1);
    assert.ok(row.strength >= 0 && Number.isFinite(row.strength));
    assert.ok(Number.isInteger(row.degree) && row.degree >= 0);
    assert.ok(row.bridge >= 0 && row.bridge < 1);
    assert.match(row.communityId, COMMUNITY_ID_PATTERN);
  }
  assert.ok(Number.isFinite(FIXTURE.modularity) && FIXTURE.modularity > 0);
});

test("on the fixture: communitySize is the number of rows carrying that id, and the sizes add up", () => {
  const tally = new Map<string, number>();
  for (const row of FIXTURE.rows) tally.set(row.communityId, (tally.get(row.communityId) ?? 0) + 1);
  for (const row of FIXTURE.rows) assert.equal(row.communitySize, tally.get(row.communityId));
  assert.equal(tally.size, FIXTURE.communities.length);
  for (const community of FIXTURE.communities) assert.equal(community.size, tally.get(community.id));
  assert.equal(FIXTURE.communities.reduce((n, c) => n + c.size, 0), FIXTURE.rows.length);
  // Largest first.
  for (let i = 1; i < FIXTURE.communities.length; i++) {
    assert.ok((FIXTURE.communities[i - 1]?.size ?? 0) >= (FIXTURE.communities[i]?.size ?? 0));
  }
  assert.equal(FIXTURE.counts.singletons, FIXTURE.communities.filter((c) => c.size === 1).length);
});

test("on the fixture: the two Bevs with no SIMILAR_TO edge score 0, and every hub is a member of its family", () => {
  for (const id of [FIXTURE_BEVS.userNoBrand, FIXTURE_BEVS.userBlankBrand]) {
    const row = rowOf(FIXTURE, id);
    assert.deepEqual([row.degree, row.strength, row.bridge], [0, 0, 0]);
  }
  assert.equal(FIXTURE.counts.isolated, 2);
  for (const community of FIXTURE.communities) {
    assert.equal(rowOf(FIXTURE, community.hubBevId).communityId, community.id);
    assert.equal(community.id, fixtureIdOf(community.hubBevId));
  }
  assert.equal(new Set(FIXTURE.communities.map((c) => c.id)).size, FIXTURE.communities.length);
});

test("on the fixture: no Bev id, and no piece of one, appears in any community id", () => {
  const ids = new Set(FIXTURE.rows.map((r) => r.communityId));
  const serialised = [...ids].join("\n");
  for (const bevId of FIXTURE_NODES) {
    assert.ok(!serialised.includes(bevId));
    // Not even the leading 16 hex of the uuid, which is what a lazy truncation would produce.
    assert.ok(!serialised.includes(bevId.replaceAll("-", "").slice(0, 16)));
  }
});

test("on the fixture: the taste families cut across the root categories, and most Bevs bridge", () => {
  // No membership carries the catch-all base, and every one is a flavour or a note.
  assert.ok(FIXTURE_MEMBERSHIPS.length > 1000, `only ${FIXTURE_MEMBERSHIPS.length} memberships`);
  assert.ok(!FIXTURE_MEMBERSHIPS.some((m) => m.attribute === "flavor:other"));
  assert.ok(FIXTURE_MEMBERSHIPS.every((m) => /^(flavor|note):.+$/.test(m.attribute)));
  assert.ok(PLAN.relationships.tastesOf.some((link) => link.to === "other"), "the fixture has Bevs whose base is the catch-all");
  assert.equal(
    FIXTURE_MEMBERSHIPS.length,
    PLAN.relationships.tastesOf.filter((link) => link.to !== "other").length + PLAN.relationships.hasNote.length,
  );

  // About ten broad families rather than one per root category or one per base.
  const families = FIXTURE.communities.filter((c) => c.size > 1);
  assert.ok(families.length >= 6 && families.length <= 16, `${families.length} families`);
  assert.ok(FIXTURE.counts.partitionEdges > FIXTURE.counts.edges, "the projection is denser than SIMILAR_TO");
  // They do not follow the taxonomy: well under the 0.84 that clustering SIMILAR_TO gives on the real graph.
  const purity = categoryPurity(FIXTURE, PLAN.nodes.bevs);
  assert.ok(purity > 0.2 && purity < 0.7, `purity ${purity}`);
  // And so a non-zero bridge score is the rule: SIMILAR_TO follows categories, the families do not.
  const bridging = FIXTURE.rows.filter((r) => r.bridge > 0).length;
  assert.ok(bridging > FIXTURE.rows.length / 2, `${bridging} of ${FIXTURE.rows.length} bridge`);
});

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

test("shuffled nodes, shuffled edges and flipped orientations give the identical result", () => {
  for (const seed of [1, 7, 2026]) {
    const nodes = shuffled(FIXTURE_NODES, seed);
    const edges = shuffled(FIXTURE_EDGES, seed + 1).map((e, i) => (i % 2 === 0 ? e : { a: e.b, b: e.a, w: e.w }));
    const partition = flavourProjection(shuffled(nodes, seed + 2), shuffled(FIXTURE_MEMBERSHIPS, seed + 3)).partition;
    const again = computeGraphStats({ nodes, similarity: edges, partition, communityIdOf: fixtureIdOf });
    assert.deepEqual(again, FIXTURE, `seed ${seed}`);
  }
});

// ---------------------------------------------------------------------------
// What the I/O half writes
// ---------------------------------------------------------------------------

test("graphStatsDbRows is the RPC's payload: snake_case, one row per Bev, nothing else", () => {
  const rows = graphStatsDbRows(FIXTURE);
  assert.equal(rows.length, FIXTURE.rows.length);
  assert.deepEqual(Object.keys(rows[0] ?? {}), ["bev_id", "community_id", "community_size", "pagerank", "strength", "degree", "bridge"]);
  rows.forEach((row, i) => {
    const from = FIXTURE.rows[i];
    assert.deepEqual(row, {
      bev_id: from?.bevId,
      community_id: from?.communityId,
      community_size: from?.communitySize,
      pagerank: from?.pagerank,
      strength: from?.strength,
      degree: from?.degree,
      bridge: from?.bridge,
    });
  });
  // No hub leaves in the payload: Postgres never learns which Bev names a community.
  assert.ok(!JSON.stringify(rows).includes("hub"));
});

test("graphStatsWrites: one IN_COMMUNITY per Bev, exactly one hub per community, communities by id", () => {
  const writes = graphStatsWrites(FIXTURE);
  assert.equal(writes.bevs.length, FIXTURE.rows.length);
  assert.equal(writes.inCommunity.length, FIXTURE.rows.length);
  assert.equal(writes.communities.length, FIXTURE.communities.length);
  assert.deepEqual(writes.communities.map((c) => c.id), [...writes.communities.map((c) => c.id)].sort());
  const hubs = new Map<string, number>();
  for (const link of writes.inCommunity) {
    assert.equal(typeof link.hub, "boolean");
    if (link.hub) hubs.set(link.to, (hubs.get(link.to) ?? 0) + 1);
  }
  for (const community of FIXTURE.communities) assert.equal(hubs.get(community.id), 1, "exactly one hub");
  assert.deepEqual(
    writes.inCommunity.filter((l) => l.hub).map((l) => l.from).sort(),
    FIXTURE.communities.map((c) => c.hubBevId).sort(),
  );
  for (const bev of writes.bevs) assert.deepEqual(Object.keys(bev), ["id", "pagerank", "strength", "degree", "bridge", "community"]);
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const REPORT_BEVS: ReportBev[] = [
  { id: "a1", name: "Cola", brand: "Fizz", flavor: null, base: "cola", categoryId: "soda" },
  { id: "a2", name: "Cola", brand: "Fizz", flavor: "Cherry", base: "cola", categoryId: "soda" },
  { id: "a3", name: "Cherry Soda", brand: "  ", flavor: "cherry", base: "berry", categoryId: "soda" },
  { id: "b1", name: "Lager", brand: "Hops", flavor: null, base: "hop", categoryId: "beer" },
  { id: "b2", name: "Stout", brand: "Hops", flavor: null, base: "grain", categoryId: "beer" },
  { id: "b3", name: "Iced Tea", brand: null, flavor: "Peach", base: null, categoryId: "tea" },
];

test("the report names the communities, the central Bevs and the bridges, and gives the purity", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  const lines = graphStatsReport(stats, REPORT_BEVS);
  const text = lines.join("\n");

  assert.match(lines[0] ?? "", /^modularity Q = 0\.\d{4} over 2 taste families \(0 of one Bev\), Louvain on a partition graph of 7 pairs$/);
  assert.ok((lines[0] ?? "").includes(stats.modularity.toFixed(4)), "the modularity printed is the partition's");
  assert.match(lines[1] ?? "", /^6 Bevs, 7 SIMILAR_TO edges .* 0 Bev\(s\) have no SIMILAR_TO edge$/);
  // One line per family: size, hub, its commonest flavour bases (what it IS),
  // three members, the share in its commonest root category.
  const communityLines = lines.filter((line) => /^\s+\d+\.\s+\d+\s+hub: /.test(line));
  assert.equal(communityLines.length, 2);
  assert.ok(
    communityLines.some((line) => /hub: Cola, Cherry \(Fizz\) {2}\| {2}bases: cola 2, berry 1 {2}\| {2}top: .* {2}\| {2}100% soda$/.test(line)),
    text,
  );
  // A tie between bases goes to the smaller name; a Bev with no profile counts as "(no base)".
  assert.ok(
    communityLines.some((line) => /hub: Lager \(Hops\) {2}\| {2}bases: \(no base\) 1, grain 1, hop 1 {2}\| {2}top: .* {2}\| {2}67% beer$/.test(line)),
    text,
  );
  // The flavour is added only when the name does not already say it; a blank brand is no brand.
  assert.ok(text.includes("Cola, Cherry (Fizz)"));
  assert.ok(text.includes("Cherry Soda [soda]"));
  assert.ok(!text.includes("Cherry Soda, cherry"));
  assert.ok(text.includes("Iced Tea, Peach"));

  assert.ok(lines.includes("the 6 most central Bevs (weighted PageRank)"));
  assert.equal(lines.filter((line) => /^ {4}0\.\d{6} {2}/.test(line)).length, 6);
  assert.ok(
    lines.includes(
      "2 of 6 Bevs have SIMILAR_TO edges into more than one taste family (median bridge 0.0000); the 2 highest bridge scores (participation coefficient)",
    ),
    text,
  );
  const bridgeLines = lines.filter((line) => /^ {4}0\.\d{4} {2}.* in the family of /.test(line));
  assert.equal(bridgeLines.length, 2);
  assert.match(bridgeLines[0] ?? "", /Cherry Soda \[soda\] {2}in the family of Cola, Cherry \(Fizz\)$/);

  // Purity: 3 of 3 in soda, 2 of 3 in beer -> 5/6.
  near(categoryPurity(stats, REPORT_BEVS), 5 / 6, "purity");
  assert.match(lines.at(-1) ?? "", /^category purity 0\.8333: /);
});

test("the report is a function of the stats: the same lines twice, and shuffled catalog rows change nothing", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  assert.deepEqual(graphStatsReport(stats, shuffled(REPORT_BEVS, 5)), graphStatsReport(stats, REPORT_BEVS));
});

test("a Bev with stats but no catalog row is an error, not a blank name", () => {
  const stats = statsOf(TWO_NODES, TWO_EDGES);
  assert.throws(() => graphStatsReport(stats, REPORT_BEVS.slice(1)), /Bev a1 has graph stats but no catalog row/);
  assert.throws(() => categoryPurity(stats, REPORT_BEVS.slice(1)), /Bev a1 has graph stats but no catalog row/);
});

test("on the fixture the report prints catalog names only: no Bev id, no community id, no user", () => {
  const lines = graphStatsReport(FIXTURE, PLAN.nodes.bevs);
  const text = lines.join("\n");
  assert.ok(lines.every((line) => typeof line === "string"));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), "a uuid reached the report");
  assert.ok(!/c_[0-9a-f]{16}/.test(text), "a community id reached the report");
  for (const community of FIXTURE.communities) assert.ok(!text.includes(community.id));
  for (const user of PLAN.nodes.users) assert.ok(!text.includes(user.pseudonym));
  assert.ok(!/[0-9a-f]{64}/.test(text));

  // One line per community, ten central Bevs, at most ten bridges, one purity figure.
  assert.equal(lines.filter((line) => /^\s+\d+\.\s+\d+\s+hub: /.test(line)).length, FIXTURE.communities.length);
  assert.equal(lines.filter((line) => /^ {4}0\.\d{6} {2}/.test(line)).length, 10);
  assert.equal(lines.filter((line) => / in the family of /.test(line)).length, 10);
  assert.ok(lines.filter((line) => / {2}\| {2}bases: /.test(line)).length === FIXTURE.communities.length, "every family line names its bases");
  assert.equal(lines.filter((line) => line.startsWith("category purity ")).length, 1);
  assert.ok(text.includes("Coca-Cola") || text.includes("Shasta"), "catalog names are what it prints");

  const purity = categoryPurity(FIXTURE, PLAN.nodes.bevs);
  assert.ok(purity > 0 && purity <= 1, `purity ${purity}`);
});

// ---------------------------------------------------------------------------
// The rule the header states
// ---------------------------------------------------------------------------

test("every formula is @bevi/ranking's: this file imports exactly six network functions and does no maths of its own", () => {
  const source = readFileSync(fileURLToPath(new URL("./analytics-core.ts", import.meta.url)), "utf8");
  const imports = [...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)];
  assert.deepEqual(
    imports.map((m) => m[3]),
    ["@bevi/ranking"],
    "analytics-core.ts imports from one module",
  );
  const names = (imports[0]?.[2] ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
  assert.deepEqual(names.sort(), [
    "attributeProjection",
    "communityHubs",
    "graphStrength",
    "louvainCommunities",
    "pageRank",
    "participationCoefficient",
  ]);
  // The tools a reimplementation would reach for.
  for (const forbidden of ["Math.sqrt", "Math.log", "Math.exp", "Math.pow", "damping", "gds."]) {
    assert.ok(!source.includes(forbidden), `analytics-core.ts contains ${forbidden}`);
  }
});
