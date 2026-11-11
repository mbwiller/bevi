/**
 * Unit tests for the pure half of the Postgres -> Neo4j sync
 * (scripts/graph/sync-core.ts) and for its catalog fixture. No database, no
 * network, no credentials.
 *
 *   node --experimental-strip-types --test scripts/graph/sync-core.test.ts
 *   npm run test:scripts
 *
 * These do NOT re-test `normaliseBrand`, `flavorTokens` or
 * `zScoresFromRankings`: those have their own vectors in packages/ranking.
 * What is tested here is what this file owns -- which rows become which nodes
 * and relationships, what is dropped, what throws, that no user id survives
 * into the plan, and that the Cypher keeps the rules its comments state.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RANKING_VERSION, flavorTokens, zScoresFromRankings } from "@bevi/ranking";

import {
  ALL_STATEMENTS,
  BATCH,
  EMBEDDING_DIMENSIONS,
  OWNED_LABELS,
  OWNED_TYPES,
  STAMP_FAILED_ATTEMPT,
  STAMP_META,
  SWEEP_NODES,
  SWEEP_RELATIONSHIPS,
  UPSERT_BEVS,
  UPSERT_USERS,
  VERIFY_COUNTS,
  VERIFY_INVARIANTS,
  buildGraphPlan,
  chunk,
  expectedVerification,
  findBevByName,
  instant,
  metaParameters,
  numeric,
  parseEmbedding,
  preferenceOf,
  sourceFromRows,
  sweepSteps,
  verificationFailures,
  writeSteps,
} from "./sync-core.ts";
import type {
  GraphPlan,
  GraphSource,
  SourceBev,
  SourceCategory,
  SourceEdge,
  SourceProfile,
  SourceRanking,
} from "./sync-core.ts";
import { FIXTURE_BEVS, FIXTURE_PSEUDONYM_SALT, FIXTURE_USERS, buildFixtureSource } from "./sync-fixture.ts";
import { pseudonymiser } from "./sync.ts";

// ---------------------------------------------------------------------------
// A small hand-built source
// ---------------------------------------------------------------------------

const B = {
  coke: "00000000-0000-4000-8000-00000000bb01",
  cherry: "00000000-0000-4000-8000-00000000bb02",
  pepsi: "00000000-0000-4000-8000-00000000bb03",
  mug: "00000000-0000-4000-8000-00000000bb04",
  modelo: "00000000-0000-4000-8000-00000000bb05",
  tap: "00000000-0000-4000-8000-00000000bb06",
  blank: "00000000-0000-4000-8000-00000000bb07",
  hidden: "00000000-0000-4000-8000-00000000bb08",
  nowhere: "00000000-0000-4000-8000-00000000bb99",
} as const;

const U = {
  ann: "00000000-0000-4000-8000-0000000000a1",
  bob: "00000000-0000-4000-8000-0000000000b2",
  cy: "00000000-0000-4000-8000-0000000000c3",
} as const;

/** A recognisable stand-in for the HMAC: it must never contain the user id. */
const pseudonymOf = (userId: string): string => `p-${userId.slice(-2)}-${"f".repeat(8)}`;
const OPTIONS = { pseudonymOf, rankingVersion: "9.9.9" };

const vector = (first: number): number[] => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.5);
  v[0] = first;
  return v;
};

const bev = (id: string, over: Partial<SourceBev>): SourceBev => ({
  id,
  name: "Unnamed",
  brand: null,
  flavor: null,
  categoryId: "soda",
  leafCategoryId: null,
  priceTier: 1,
  source: "seed",
  isStarter: false,
  status: "active",
  ...over,
});

const edge = (src: string, dst: string, over: Partial<SourceEdge> = {}): SourceEdge => ({
  src,
  dst,
  weight: 0.9,
  components: { tree: 1, content: 0.5, emb: 0.8, profile: 1, cop: 0 },
  version: "1.6.0",
  computedAt: "2026-11-09T04:51:07.123456+00:00",
  ...over,
});

const ranking = (userId: string, bevId: string, score: number, bucket = 2): SourceRanking => ({
  userId,
  bevId,
  bucket,
  score,
  rankedAt: "2026-11-01T12:00:00+00:00",
});

/** `GraphSource` with its arrays writable, so a test can break one thing at a time. */
interface MutableSource {
  categories: SourceCategory[];
  bevs: SourceBev[];
  profiles: SourceProfile[];
  embeddings: Array<{ bevId: string; embedding: number[]; model: string }>;
  edges: SourceEdge[];
  rankings: SourceRanking[];
}

function smallSource(): MutableSource {
  return {
    categories: [
      { id: "soda", name: "Soda", parentId: null, isAlcoholic: false, sortOrder: 1 },
      { id: "cola", name: "Cola", parentId: "soda", isAlcoholic: false, sortOrder: 1 },
      { id: "root_beer", name: "Root beer", parentId: "soda", isAlcoholic: false, sortOrder: 2 },
      { id: "beer", name: "Beer", parentId: null, isAlcoholic: true, sortOrder: 2 },
      { id: "lager", name: "Lager", parentId: "beer", isAlcoholic: true, sortOrder: 1 },
      { id: "water", name: "Water", parentId: null, isAlcoholic: false, sortOrder: 3 },
    ],
    bevs: [
      bev(B.coke, { name: "Coca-Cola Classic", brand: "Coca-Cola", flavor: "Original", leafCategoryId: "cola", isStarter: true }),
      bev(B.cherry, { name: "Cherry Coke", brand: "Coca-Cola", flavor: "Cherry", leafCategoryId: "cola" }),
      bev(B.pepsi, { name: "Pepsi Wild Cherry", brand: "Pepsi", flavor: "Cherry", leafCategoryId: "cola" }),
      bev(B.mug, { name: "Mug Root Beer", brand: "Mug", leafCategoryId: "root_beer" }),
      bev(B.modelo, { name: "Modelo Especial", brand: "Modelo", categoryId: "beer", leafCategoryId: "lager", priceTier: 2 }),
      bev(B.tap, { name: "Tap Water", brand: null, categoryId: "water", source: "user" }),
      bev(B.blank, { name: "Spring Water", brand: "   ", categoryId: "water", source: "user" }),
      bev(B.hidden, { name: "Taken Down Cherry Cola", brand: "Coca-Cola", leafCategoryId: "cola", status: "hidden" }),
    ],
    profiles: [
      { bevId: B.coke, base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "catalog" },
      { bevId: B.cherry, base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "catalog" },
      { bevId: B.pepsi, base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "inferred" },
      { bevId: B.mug, base: "root-beer", carbonated: true, caffeine: 0, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "catalog" },
      { bevId: B.modelo, base: "grain", carbonated: true, caffeine: 0, sweetness: 0, dairy: false, alcohol: true, serve: "cold", source: "catalog" },
      { bevId: B.hidden, base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "catalog" },
    ],
    embeddings: [
      { bevId: B.coke, embedding: vector(0), model: "gte-small" },
      { bevId: B.cherry, embedding: vector(1), model: "gte-small" },
      { bevId: B.pepsi, embedding: vector(0.25), model: "gte-small" },
      { bevId: B.hidden, embedding: vector(0.75), model: "gte-small" },
    ],
    edges: [edge(B.coke, B.cherry), edge(B.coke, B.pepsi, { weight: 1 }), edge(B.cherry, B.pepsi), edge(B.coke, B.hidden)],
    rankings: [
      // ann: mu 5, sigma floored to 1 -> z = 0, +0.25, -0.25 exactly.
      ranking(U.ann, B.coke, 5.0),
      ranking(U.ann, B.cherry, 5.25),
      ranking(U.ann, B.pepsi, 4.75),
      // bob: three rankings, one of the hidden Bev and one of a Bev in no table.
      ranking(U.bob, B.coke, 9.0, 3),
      ranking(U.bob, B.hidden, 2.0, 1),
      ranking(U.bob, B.nowhere, 4.0, 2),
      // cy: only the hidden Bev -> no node.
      ranking(U.cy, B.hidden, 8.0, 3),
    ],
  };
}

const plan = (source: GraphSource = smallSource()): GraphPlan => buildGraphPlan(source, OPTIONS);

let fixturePlanCache: GraphPlan | undefined;
const fixturePlan = (): GraphPlan =>
  (fixturePlanCache ??= buildGraphPlan(buildFixtureSource(), {
    pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT),
    rankingVersion: RANKING_VERSION,
  }));

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

test("a small source produces exactly the expected counts per label and type", () => {
  const p = plan();
  assert.deepEqual(p.counts.nodes, { Bev: 7, Category: 6, Brand: 4, Flavor: 3, Note: 2, User: 2 });
  assert.deepEqual(p.counts.relationships, {
    CHILD_OF: 3,
    IN_CATEGORY: 7,
    BY_BRAND: 5,
    TASTES_OF: 5,
    // cherry: cherry-coke + pepsi-wild-cherry; water: tap + spring.
    HAS_NOTE: 4,
    SIMILAR_TO: 3,
    RANKED: 4,
    LIKES: 2,
    DISLIKES: 1,
  });
  assert.equal(p.counts.bevsWithEmbedding, 3);
  assert.equal(p.counts.bevsWithProfile, 5);
  assert.equal(p.rankingVersion, "9.9.9");
  assert.equal(p.edgesVersion, "1.6.0");
});

test("counts are the lengths of the arrays they describe, on the full fixture too", () => {
  for (const p of [plan(), fixturePlan()]) {
    assert.equal(p.counts.nodes.Bev, p.nodes.bevs.length);
    assert.equal(p.counts.nodes.Category, p.nodes.categories.length);
    assert.equal(p.counts.nodes.Brand, p.nodes.brands.length);
    assert.equal(p.counts.nodes.Flavor, p.nodes.flavors.length);
    assert.equal(p.counts.nodes.Note, p.nodes.notes.length);
    assert.equal(p.counts.nodes.User, p.nodes.users.length);
    assert.equal(p.counts.relationships.CHILD_OF, p.relationships.childOf.length);
    assert.equal(p.counts.relationships.IN_CATEGORY, p.relationships.inCategory.length);
    assert.equal(p.counts.relationships.BY_BRAND, p.relationships.byBrand.length);
    assert.equal(p.counts.relationships.TASTES_OF, p.relationships.tastesOf.length);
    assert.equal(p.counts.relationships.HAS_NOTE, p.relationships.hasNote.length);
    assert.equal(p.counts.relationships.SIMILAR_TO, p.relationships.similarTo.length);
    assert.equal(p.counts.relationships.RANKED, p.relationships.ranked.length);
    assert.equal(p.counts.relationships.LIKES, p.relationships.likes.length);
    assert.equal(p.counts.relationships.DISLIKES, p.relationships.dislikes.length);
  }
});

test("the fixture is the whole catalog plus its three extra Bevs", () => {
  const source = buildFixtureSource();
  const p = fixturePlan();
  // 378 catalog Bevs + 2 active user-created; the hidden one is not mirrored.
  assert.equal(source.bevs.length, 381);
  assert.equal(p.counts.nodes.Bev, 380);
  assert.equal(p.counts.nodes.Category, 75);
  assert.equal(p.counts.relationships.CHILD_OF, 60);
  assert.equal(p.nodes.categories.filter((c) => c.depth === 1).length, 15);
  assert.equal(p.counts.bevsWithProfile, 378);
  assert.equal(p.counts.bevsWithEmbedding, 378);
  assert.equal(p.counts.relationships.TASTES_OF, 378);
  assert.ok(p.counts.relationships.SIMILAR_TO > 1000, `only ${p.counts.relationships.SIMILAR_TO} edges`);
  // Six users in the source; one ranks only the hidden Bev.
  assert.equal(p.counts.nodes.User, 5);
  assert.equal(p.dropped.usersWithoutActiveRanking, 1);
  assert.equal(p.dropped.inactiveBevs, 1);
  assert.equal(p.dropped.edgesToInactiveBevs, 1);
  assert.equal(p.dropped.rankingsOfInactiveBevs, 3);
  assert.equal(p.dropped.profilesOfInactiveBevs, 1);
  assert.equal(p.dropped.embeddingsOfInactiveBevs, 1);
  assert.equal(p.dropped.leafParentMismatches, 0);
});

test("the fixture exercises the float coercion: integers in embeddings and in edge terms", () => {
  const source = buildFixtureSource();
  const json = JSON.stringify(source.embeddings[0]?.embedding);
  assert.match(json, /^\[0,1,/, "the first embedding starts with the integers 0 and 1");
  assert.ok(source.embeddings.every((e) => e.embedding.length === EMBEDDING_DIMENSIONS));
  const p = fixturePlan();
  assert.ok(p.relationships.similarTo.some((e) => e.tree === 1), "an edge whose tree term is exactly 1");
  assert.ok(p.relationships.similarTo.some((e) => e.cop === 0), "an edge whose cop term is exactly 0");
  assert.ok(p.relationships.similarTo.some((e) => !Number.isInteger(e.tree)), "and one whose tree term is fractional");
});

test("the fixture's users land above, below, inside and exactly on the dead band", () => {
  const p = fixturePlan();
  const z = p.relationships.ranked.map((r) => r.z);
  assert.ok(z.includes(0.25) && z.includes(-0.25) && z.includes(0), "exactly +0.25, -0.25 and 0");
  assert.ok(z.some((x) => x > 1) && z.some((x) => x < -1), "well outside the band");
  assert.ok(z.some((x) => x !== 0 && Math.abs(x) < 0.25), "strictly inside the band");
  assert.equal(p.relationships.likes.length + p.relationships.dislikes.length < p.relationships.ranked.length, true);
});

// ---------------------------------------------------------------------------
// Categories and IN_CATEGORY
// ---------------------------------------------------------------------------

test("a category has depth 1 as a root and 2 as a leaf, and a CHILD_OF only as a leaf", () => {
  const p = plan();
  const byId = new Map(p.nodes.categories.map((c) => [c.id, c]));
  assert.deepEqual(byId.get("soda"), { id: "soda", name: "Soda", isAlcoholic: false, sortOrder: 1, depth: 1, parentId: null });
  assert.deepEqual(byId.get("cola"), { id: "cola", name: "Cola", isAlcoholic: false, sortOrder: 1, depth: 2, parentId: "soda" });
  assert.deepEqual(p.relationships.childOf, [
    { from: "cola", to: "soda" },
    { from: "lager", to: "beer" },
    { from: "root_beer", to: "soda" },
  ]);
});

test("IN_CATEGORY targets the leaf when the Bev has one, else its root", () => {
  const target = new Map(plan().relationships.inCategory.map((l) => [l.from, l.to]));
  assert.equal(target.get(B.coke), "cola");
  assert.equal(target.get(B.mug), "root_beer");
  assert.equal(target.get(B.modelo), "lager");
  assert.equal(target.get(B.tap), "water");
});

test("every Bev has exactly one IN_CATEGORY, and categoryId stays the root", () => {
  for (const p of [plan(), fixturePlan()]) {
    assert.deepEqual(
      p.relationships.inCategory.map((l) => l.from),
      p.nodes.bevs.map((b) => b.id),
    );
    const roots = new Set(p.nodes.categories.filter((c) => c.depth === 1).map((c) => c.id));
    for (const b of p.nodes.bevs) assert.ok(roots.has(b.categoryId), `${b.name} has a non-root categoryId`);
    const target = new Map(p.relationships.inCategory.map((l) => [l.from, l.to]));
    for (const b of p.nodes.bevs) assert.equal(target.get(b.id), b.leafCategoryId ?? b.categoryId);
  }
  // The fixture has both kinds.
  const f = fixturePlan();
  assert.ok(f.nodes.bevs.some((b) => b.leafCategoryId !== null));
  assert.ok(f.nodes.bevs.some((b) => b.leafCategoryId === null));
});

test("a leaf that is not a child of the Bev's category is mirrored as stored and counted", () => {
  const source = smallSource();
  (source.bevs[0] as SourceBev).leafCategoryId = "lager";
  const p = plan(source);
  assert.equal(p.dropped.leafParentMismatches, 1);
  assert.equal(p.relationships.inCategory.find((l) => l.from === B.coke)?.to, "lager");
});

// ---------------------------------------------------------------------------
// Bevs
// ---------------------------------------------------------------------------

test("only active Bevs are mirrored", () => {
  const p = plan();
  assert.ok(!p.nodes.bevs.some((b) => b.id === B.hidden));
  assert.equal(p.dropped.inactiveBevs, 1);
  assert.equal(p.dropped.profilesOfInactiveBevs, 1);
  assert.equal(p.dropped.embeddingsOfInactiveBevs, 1);
  for (const status of ["pending_photo", "merged", "hidden"]) {
    const source = smallSource();
    (source.bevs[5] as SourceBev).status = status;
    assert.ok(!plan(source).nodes.bevs.some((b) => b.id === B.tap), status);
  }
});

test("isAlcoholic is a boolean on every Bev, from its root category, and true for a beer", () => {
  const p = plan();
  for (const b of p.nodes.bevs) assert.equal(typeof b.isAlcoholic, "boolean");
  assert.equal(p.nodes.bevs.find((b) => b.id === B.modelo)?.isAlcoholic, true);
  assert.equal(p.nodes.bevs.find((b) => b.id === B.coke)?.isAlcoholic, false);

  const f = fixturePlan();
  const alcoholicRoots = new Set(f.nodes.categories.filter((c) => c.depth === 1 && c.isAlcoholic).map((c) => c.id));
  assert.ok(alcoholicRoots.has("beer"));
  for (const b of f.nodes.bevs) {
    assert.equal(typeof b.isAlcoholic, "boolean");
    assert.equal(b.isAlcoholic, alcoholicRoots.has(b.categoryId), b.name);
  }
  assert.ok(f.nodes.bevs.filter((b) => b.categoryId === "beer").length > 0);
});

test("a Bev with a profile carries all eight profile properties", () => {
  const coke = plan().nodes.bevs.find((b) => b.id === B.coke);
  assert.deepEqual(
    {
      base: coke?.base,
      carbonated: coke?.carbonated,
      caffeine: coke?.caffeine,
      sweetness: coke?.sweetness,
      dairy: coke?.dairy,
      alcohol: coke?.alcohol,
      serve: coke?.serve,
      profileSource: coke?.profileSource,
    },
    { base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", profileSource: "catalog" },
  );
  assert.equal(plan().nodes.bevs.find((b) => b.id === B.pepsi)?.profileSource, "inferred");
});

test("a Bev without a profile has null profile properties and no TASTES_OF", () => {
  const p = plan();
  const tap = p.nodes.bevs.find((b) => b.id === B.tap);
  for (const key of ["base", "carbonated", "caffeine", "sweetness", "dairy", "alcohol", "serve", "profileSource"] as const) {
    assert.equal(tap?.[key], null, key);
  }
  assert.ok(!p.relationships.tastesOf.some((l) => l.from === B.tap));
  // `carbonated: false` must survive as false, not collapse to null.
  const source = smallSource();
  (source.profiles[0] as { carbonated: boolean }).carbonated = false;
  assert.equal(plan(source).nodes.bevs.find((b) => b.id === B.coke)?.carbonated, false);
});

test("a Bev without an embedding has a null embedding and model", () => {
  const p = plan();
  const mug = p.nodes.bevs.find((b) => b.id === B.mug);
  assert.equal(mug?.embedding, null);
  assert.equal(mug?.embeddingModel, null);
  const coke = p.nodes.bevs.find((b) => b.id === B.coke);
  assert.equal(coke?.embedding?.length, EMBEDDING_DIMENSIONS);
  assert.equal(coke?.embeddingModel, "gte-small");
  const f = fixturePlan();
  for (const id of [FIXTURE_BEVS.userNoBrand, FIXTURE_BEVS.userBlankBrand]) {
    const b = f.nodes.bevs.find((x) => x.id === id);
    assert.equal(b?.embedding, null);
    assert.equal(b?.base, null);
  }
});

test("Flavor nodes are the distinct bases of active Bevs' profiles", () => {
  assert.deepEqual(plan().nodes.flavors, [{ name: "cola" }, { name: "grain" }, { name: "root-beer" }]);
});

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

test("a null or blank brand yields no Brand and no BY_BRAND, and the raw value stays on the Bev", () => {
  const p = plan();
  assert.deepEqual(
    p.nodes.brands.map((b) => b.key),
    ["coca-cola", "modelo", "mug", "pepsi"],
  );
  for (const id of [B.tap, B.blank]) {
    assert.ok(!p.relationships.byBrand.some((l) => l.from === id));
    assert.equal(p.nodes.bevs.find((b) => b.id === id)?.brandKey, null);
  }
  assert.equal(p.nodes.bevs.find((b) => b.id === B.tap)?.brand, null);
  assert.equal(p.nodes.bevs.find((b) => b.id === B.blank)?.brand, "   ");

  const f = fixturePlan();
  assert.ok(!f.relationships.byBrand.some((l) => l.from === FIXTURE_BEVS.userNoBrand || l.from === FIXTURE_BEVS.userBlankBrand));
  assert.equal(f.counts.relationships.BY_BRAND, f.nodes.bevs.filter((b) => b.brandKey !== null).length);
});

test("a Brand's name is the most common raw spelling; a tie goes to the smaller in code-unit order", () => {
  const source = smallSource();
  source.bevs = [
    bev(B.coke, { name: "A", brand: "coca-cola" }),
    bev(B.cherry, { name: "B", brand: "Coca-Cola" }),
    bev(B.pepsi, { name: "C", brand: " Coca-Cola " }),
    // A tie: one each. "PEPSI" < "Pepsi" in code-unit order.
    bev(B.mug, { name: "D", brand: "Pepsi" }),
    bev(B.modelo, { name: "E", brand: "PEPSI" }),
  ];
  source.profiles = [];
  source.embeddings = [];
  source.edges = [];
  source.rankings = [];
  assert.deepEqual(plan(source).nodes.brands, [
    { key: "coca-cola", name: "Coca-Cola" },
    { key: "pepsi", name: "PEPSI" },
  ]);
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test("only a token shared by at least two active Bevs becomes a Note", () => {
  const p = plan();
  assert.deepEqual(p.nodes.notes, [
    { token: "cherry", bevCount: 2 },
    { token: "water", bevCount: 2 },
  ]);
  assert.deepEqual(p.relationships.hasNote, [
    { from: B.cherry, to: "cherry" },
    { from: B.pepsi, to: "cherry" },
    { from: B.tap, to: "water" },
    { from: B.blank, to: "water" },
  ]);
  assert.ok(p.dropped.notesBelowMinimum > 0);
  // The hidden Bev's tokens do not count: it would have made "cola" a pair
  // with nothing, and it does not make "cherry" three.
  assert.ok(!p.nodes.notes.some((n) => n.token === "taken"));
});

test("on the fixture every Note has bevCount >= 2 and exactly that many HAS_NOTE", () => {
  const p = fixturePlan();
  const incoming = new Map<string, number>();
  for (const l of p.relationships.hasNote) incoming.set(l.to, (incoming.get(l.to) ?? 0) + 1);
  assert.ok(p.nodes.notes.length > 50);
  for (const note of p.nodes.notes) {
    assert.ok(note.bevCount >= 2, note.token);
    assert.equal(incoming.get(note.token), note.bevCount, note.token);
  }
  // And each HAS_NOTE is one of that Bev's own flavorTokens.
  const byId = new Map(p.nodes.bevs.map((b) => [b.id, b]));
  for (const l of p.relationships.hasNote.slice(0, 200)) {
    const b = byId.get(l.from);
    assert.ok(b !== undefined && flavorTokens(b.name, b.flavor).includes(l.to));
  }
});

// ---------------------------------------------------------------------------
// SIMILAR_TO
// ---------------------------------------------------------------------------

test("SIMILAR_TO is bev_edges row for row, oriented src < dst", () => {
  const p = plan();
  assert.deepEqual(p.relationships.similarTo[0], {
    src: B.coke,
    dst: B.cherry,
    w: 0.9,
    tree: 1,
    content: 0.5,
    emb: 0.8,
    profile: 1,
    cop: 0,
    version: "1.6.0",
    computedAt: "2026-11-09T04:51:07.123456+00:00",
  });
  for (const q of [p, fixturePlan()]) {
    for (const e of q.relationships.similarTo) assert.ok(e.src < e.dst, `${e.src} >= ${e.dst}`);
    const ids = new Set(q.nodes.bevs.map((b) => b.id));
    for (const e of q.relationships.similarTo) assert.ok(ids.has(e.src) && ids.has(e.dst));
  }
});

test("an edge that touches a non-active Bev is dropped and counted, not an error", () => {
  const p = plan();
  assert.equal(p.dropped.edgesToInactiveBevs, 1);
  assert.ok(!p.relationships.similarTo.some((e) => e.src === B.hidden || e.dst === B.hidden));
  assert.equal(p.relationships.similarTo.length, 3);

  const f = fixturePlan();
  assert.ok(!f.relationships.similarTo.some((e) => e.src === FIXTURE_BEVS.hidden || e.dst === FIXTURE_BEVS.hidden));
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

test("RANKED exists only for rankings of active Bevs, and a user with none gets no node", () => {
  const p = plan();
  assert.deepEqual(
    p.nodes.users.map((u) => u.pseudonym),
    [pseudonymOf(U.ann), pseudonymOf(U.bob)].sort(),
  );
  assert.equal(p.relationships.ranked.length, 4);
  assert.ok(!p.relationships.ranked.some((r) => r.bevId === B.hidden || r.bevId === B.nowhere));
  assert.equal(p.dropped.rankingsOfInactiveBevs, 3);
  assert.equal(p.dropped.usersWithoutActiveRanking, 1);
  const bob = p.relationships.ranked.find((r) => r.pseudonym === pseudonymOf(U.bob));
  assert.equal(bob?.bucket, 3);
  assert.equal(bob?.score, 9);
  assert.equal(bob?.rankedAt, "2026-11-01T12:00:00+00:00");
});

test("z comes from EVERY ranking, including those of inactive Bevs", () => {
  const source = smallSource();
  const p = plan(source);
  const all = zScoresFromRankings(source.rankings.map((r) => ({ userId: r.userId, bevId: r.bevId, score: r.score })));
  const bob = p.relationships.ranked.find((r) => r.pseudonym === pseudonymOf(U.bob));
  assert.equal(bob?.z, all.get(U.bob)?.get(B.coke));

  // The wrong rule -- z over active Bevs' rankings only -- gives another number.
  const activeOnly = zScoresFromRankings(
    source.rankings
      .filter((r) => r.bevId !== B.hidden && r.bevId !== B.nowhere)
      .map((r) => ({ userId: r.userId, bevId: r.bevId, score: r.score })),
  );
  assert.notEqual(bob?.z, activeOnly.get(U.bob)?.get(B.coke));
});

test("LIKES at z >= +0.25 with w = z, DISLIKES at z <= -0.25 with w = -z, neither in between", () => {
  assert.equal(preferenceOf(0.25), "likes");
  assert.equal(preferenceOf(-0.25), "dislikes");
  assert.equal(preferenceOf(0.2499999), null);
  assert.equal(preferenceOf(-0.2499999), null);
  assert.equal(preferenceOf(0), null);
  assert.equal(preferenceOf(3), "likes");
  assert.equal(preferenceOf(-3), "dislikes");

  const p = plan();
  const ann = pseudonymOf(U.ann);
  const z = new Map(p.relationships.ranked.filter((r) => r.pseudonym === ann).map((r) => [r.bevId, r.z]));
  assert.equal(z.get(B.coke), 0);
  assert.equal(z.get(B.cherry), 0.25);
  assert.equal(z.get(B.pepsi), -0.25);
  // Exactly on the bounds: both inclusive.
  assert.deepEqual(
    p.relationships.likes.filter((l) => l.pseudonym === ann),
    [{ pseudonym: ann, bevId: B.cherry, w: 0.25 }],
  );
  assert.deepEqual(
    p.relationships.dislikes.filter((l) => l.pseudonym === ann),
    [{ pseudonym: ann, bevId: B.pepsi, w: 0.25 }],
  );
  // And every derived edge agrees with its RANKED edge.
  for (const q of [p, fixturePlan()]) {
    const zOf = new Map(q.relationships.ranked.map((r) => [`${r.pseudonym}|${r.bevId}`, r.z]));
    for (const l of q.relationships.likes) assert.equal(l.w, zOf.get(`${l.pseudonym}|${l.bevId}`));
    for (const l of q.relationships.dislikes) assert.equal(l.w, -(zOf.get(`${l.pseudonym}|${l.bevId}`) as number));
    for (const l of [...q.relationships.likes, ...q.relationships.dislikes]) assert.ok(l.w >= 0.25);
    const expected = q.relationships.ranked.filter((r) => Math.abs(r.z) >= 0.25).length;
    assert.equal(q.relationships.likes.length + q.relationships.dislikes.length, expected);
  }
});

test("no user id appears anywhere in the serialised plan", () => {
  const small = JSON.stringify(plan());
  for (const id of Object.values(U)) assert.ok(!small.includes(id), `the plan contains ${id}`);

  const source = buildFixtureSource();
  const serialised = JSON.stringify(fixturePlan());
  const userIds = new Set(source.rankings.map((r) => r.userId));
  assert.equal(userIds.size, Object.keys(FIXTURE_USERS).length);
  for (const id of userIds) assert.ok(!serialised.includes(id), "the fixture plan contains a source user_id");
});

test("a User node is a pseudonym and nothing else", () => {
  for (const p of [plan(), fixturePlan()]) {
    for (const u of p.nodes.users) assert.deepEqual(Object.keys(u), ["pseudonym"]);
  }
  for (const u of fixturePlan().nodes.users) assert.match(u.pseudonym, /^[0-9a-f]{64}$/);
});

test("a pseudonymOf that leaks the id, returns nothing, or collides is refused without printing an id", () => {
  const leak = () => buildGraphPlan(smallSource(), { pseudonymOf: (id) => `user-${id}`, rankingVersion: "x" });
  const empty = () => buildGraphPlan(smallSource(), { pseudonymOf: () => "", rankingVersion: "x" });
  const collide = () => buildGraphPlan(smallSource(), { pseudonymOf: () => "same", rankingVersion: "x" });
  for (const [fn, pattern] of [
    [leak, /contains the user id/],
    [empty, /empty pseudonym/],
    [collide, /duplicate pseudonym/],
  ] as const) {
    assert.throws(fn, (error: Error) => {
      assert.match(error.message, pattern);
      for (const id of Object.values(U)) assert.ok(!error.message.includes(id));
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** A seeded shuffle, so a failure reproduces. */
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

const shuffleSource = (source: GraphSource, seed: number): GraphSource => ({
  categories: shuffled(source.categories, seed),
  bevs: shuffled(source.bevs, seed + 1),
  profiles: shuffled(source.profiles, seed + 2),
  embeddings: shuffled(source.embeddings, seed + 3),
  edges: shuffled(source.edges, seed + 4),
  rankings: shuffled(source.rankings, seed + 5),
});

test("shuffled input produces the identical plan", () => {
  const reference = JSON.stringify(plan());
  for (const seed of [1, 7, 42]) assert.equal(JSON.stringify(plan(shuffleSource(smallSource(), seed))), reference);

  const fixtureOptions = { pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT), rankingVersion: RANKING_VERSION };
  assert.equal(
    JSON.stringify(buildGraphPlan(shuffleSource(buildFixtureSource(), 99), fixtureOptions)),
    JSON.stringify(fixturePlan()),
  );
});

test("the fixture is deterministic: two builds are deep-equal", () => {
  assert.deepEqual(buildFixtureSource(), buildFixtureSource());
});

test("every array of the plan is sorted by its key in code-unit order", () => {
  const sorted = (keys: string[]) => assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const p of [plan(), fixturePlan()]) {
    sorted(p.nodes.categories.map((c) => c.id));
    sorted(p.nodes.brands.map((b) => b.key));
    sorted(p.nodes.flavors.map((f) => f.name));
    sorted(p.nodes.notes.map((n) => n.token));
    sorted(p.nodes.bevs.map((b) => b.id));
    sorted(p.nodes.users.map((u) => u.pseudonym));
    sorted(p.relationships.hasNote.map((l) => `${l.from}|${l.to}`));
    sorted(p.relationships.similarTo.map((e) => `${e.src}|${e.dst}`));
    sorted(p.relationships.ranked.map((r) => `${r.pseudonym}|${r.bevId}`));
  }
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function throwsWith(mutate: (source: MutableSource) => void, pattern: RegExp): void {
  const source = smallSource();
  mutate(source);
  assert.throws(() => plan(source), pattern);
}

test("a Bev whose category_id is not in categories throws", () => {
  throwsWith((s) => ((s.bevs[0] as SourceBev).categoryId = "nope"), /category_id that is not in categories: nope/);
});

test("a Bev whose leaf_category_id is not in categories throws", () => {
  throwsWith((s) => ((s.bevs[0] as SourceBev).leafCategoryId = "nope"), /leaf_category_id that is not in categories: nope/);
});

test("a Bev whose category_id is a leaf throws", () => {
  throwsWith((s) => ((s.bevs[0] as SourceBev).categoryId = "cola"), /category_id that is not a root: cola/);
});

test("an inactive Bev's bad category does not throw: it is not mirrored", () => {
  const source = smallSource();
  (source.bevs[7] as SourceBev).categoryId = "nope";
  assert.equal(plan(source).counts.nodes.Bev, 7);
});

test("a category with an unknown parent, or three levels deep, throws", () => {
  throwsWith((s) => s.categories.push({ id: "x", name: "X", parentId: "nope", isAlcoholic: false, sortOrder: 9 }), /parent that is not in categories/);
  throwsWith((s) => s.categories.push({ id: "x", name: "X", parentId: "cola", isAlcoholic: false, sortOrder: 9 }), /three levels deep/);
});

test("an edge with src >= dst throws", () => {
  throwsWith((s) => s.edges.push(edge(B.pepsi, B.coke)), /not oriented src < dst/);
  throwsWith((s) => s.edges.push(edge(B.mug, B.mug)), /not oriented src < dst/);
});

test("a weight or component outside [0, 1], or non-finite, throws", () => {
  throwsWith((s) => ((s.edges[0] as SourceEdge).weight = 1.0001), /weight must be a finite number in \[0, 1\]/);
  throwsWith((s) => ((s.edges[0] as SourceEdge).weight = -0.1), /weight must be a finite number/);
  throwsWith((s) => ((s.edges[0] as SourceEdge).weight = Number.NaN), /weight must be a finite number/);
  for (const term of ["tree", "content", "emb", "profile", "cop"] as const) {
    throwsWith((s) => ((s.edges[0] as SourceEdge).components = { ...edge("a", "b").components, [term]: 2 }), new RegExp(`components\\.${term} must be`));
    throwsWith(
      (s) => ((s.edges[0] as SourceEdge).components = { ...edge("a", "b").components, [term]: Number.POSITIVE_INFINITY }),
      new RegExp(`components\\.${term} must be`),
    );
  }
  // Even on a row that would be dropped for touching an inactive Bev.
  throwsWith((s) => ((s.edges[3] as SourceEdge).weight = 7), /weight must be a finite number/);
});

test("an embedding that is not 384 finite numbers throws, for an active Bev only", () => {
  throwsWith((s) => ((s.embeddings[0] as MutableSource["embeddings"][number]).embedding = [0.1, 0.2]), /has 2 dimensions, expected 384/);
  throwsWith((s) => ((s.embeddings[0] as MutableSource["embeddings"][number]).embedding = vector(Number.NaN)), /non-finite component/);
  throwsWith((s) => ((s.embeddings[0] as MutableSource["embeddings"][number]).embedding = vector(Number.POSITIVE_INFINITY)), /non-finite component/);
  const source = smallSource();
  (source.embeddings[3] as MutableSource["embeddings"][number]).embedding = [1];
  assert.equal(plan(source).counts.bevsWithEmbedding, 3);
});

test("a duplicate key anywhere throws", () => {
  throwsWith((s) => s.categories.push({ ...(s.categories[0] as SourceCategory) }), /duplicate category id: soda/);
  throwsWith((s) => s.bevs.push(bev(B.coke, {})), /duplicate Bev id/);
  throwsWith((s) => s.profiles.push({ ...(s.profiles[0] as SourceProfile) }), /duplicate flavour profile for Bev/);
  throwsWith((s) => s.embeddings.push({ bevId: B.coke, embedding: vector(0), model: "m" }), /duplicate embedding for Bev/);
  throwsWith((s) => s.edges.push(edge(B.coke, B.cherry)), /duplicate bev_edges pair/);
});

test("a duplicate or malformed ranking throws without printing the user id", () => {
  const cases: Array<[(s: MutableSource) => void, RegExp]> = [
    [(s) => s.rankings.push(ranking(U.ann, B.coke, 6)), /duplicate ranking/],
    [(s) => ((s.rankings[0] as SourceRanking).score = Number.NaN), /non-finite score/],
    [(s) => ((s.rankings[0] as SourceRanking).bucket = 4), /bucket must be an integer in 1\.\.3/],
    [(s) => ((s.rankings[0] as SourceRanking).rankedAt = "yesterday"), /ranked_at is not a timestamp/],
  ];
  for (const [mutate, pattern] of cases) {
    const source = smallSource();
    mutate(source);
    assert.throws(
      () => plan(source),
      (error: Error) => {
        assert.match(error.message, pattern);
        for (const id of Object.values(U)) assert.ok(!error.message.includes(id), "the message names a user");
        return true;
      },
    );
  }
});

test("out-of-range integers throw", () => {
  throwsWith((s) => ((s.bevs[0] as SourceBev).priceTier = 5), /price_tier must be an integer in 1\.\.4/);
  throwsWith((s) => ((s.bevs[0] as SourceBev).priceTier = 1.5), /price_tier must be an integer/);
  throwsWith((s) => ((s.profiles[0] as { caffeine: number }).caffeine = 4), /caffeine must be an integer in 0\.\.3/);
  throwsWith((s) => ((s.edges[0] as SourceEdge).computedAt = "not a date"), /computed_at is not a timestamp/);
});

// ---------------------------------------------------------------------------
// PostgREST rows
// ---------------------------------------------------------------------------

test("sourceFromRows converts numeric strings, pgvector text and snake_case", () => {
  const source = sourceFromRows({
    categories: [{ id: "soda", name: "Soda", parent_id: null, is_alcoholic: false, sort_order: 1 }],
    bevs: [
      { id: B.coke, name: "Coke", brand: "Coca-Cola", flavor: null, category_id: "soda", leaf_category_id: null, price_tier: 1, source: "seed", is_starter: true, status: "active" },
      { id: B.pepsi, name: "Pepsi", brand: null, flavor: null, category_id: "soda", leaf_category_id: null, price_tier: 2, source: "user", is_starter: false, status: "active" },
    ],
    profiles: [{ bev_id: B.coke, base: "cola", carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, serve: "cold", source: "catalog" }],
    embeddings: [
      { bev_id: B.coke, embedding: JSON.stringify(vector(0)), model: "gte-small" },
      { bev_id: B.pepsi, embedding: vector(1), model: "gte-small" },
    ],
    edges: [
      {
        src_bev_id: B.coke,
        dst_bev_id: B.pepsi,
        weight: "0.903317",
        components: { tree: 1, content: "0.5", emb: 0.8, profile: 1, cop: 0 },
        version: "1.6.0",
        computed_at: "2026-11-09T04:51:07.123456+00:00",
      },
    ],
    rankings: [{ user_id: U.ann, bev_id: B.coke, bucket: 3, score: "8.75", ranked_at: "2026-11-01T12:00:00+00:00" }],
  });
  assert.equal(source.edges[0]?.weight, 0.903317);
  assert.equal(source.edges[0]?.components.content, 0.5);
  assert.equal(source.rankings[0]?.score, 8.75);
  assert.equal(source.embeddings[0]?.embedding.length, EMBEDDING_DIMENSIONS);
  assert.deepEqual(source.embeddings[0]?.embedding, source.embeddings[1]?.embedding.map((x, i) => (i === 0 ? 0 : x)));
  assert.equal(source.bevs[0]?.isStarter, true);
  assert.equal(source.categories[0]?.parentId, null);

  const p = buildGraphPlan(source, OPTIONS);
  assert.equal(p.counts.relationships.SIMILAR_TO, 1);
  assert.equal(p.counts.relationships.RANKED, 1);
});

test("numeric rejects what Number() would silently turn into 0 or NaN", () => {
  assert.equal(numeric("0.5", "x"), 0.5);
  assert.equal(numeric(1, "x"), 1);
  for (const bad of ["", "  ", null, undefined, "abc", Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
    assert.throws(() => numeric(bad, "the value"), /the value is not a finite number/);
  }
});

test("a missing edge component or a non-numeric score is refused at the boundary, without a user id", () => {
  const rows = {
    categories: [],
    bevs: [],
    profiles: [],
    embeddings: [],
    edges: [{ src_bev_id: "a", dst_bev_id: "b", weight: 0.5, components: { tree: 1, content: 1, emb: 1, profile: 1 }, version: "v", computed_at: "t" }],
    rankings: [],
  };
  assert.throws(() => sourceFromRows(rows), /components\.cop is not a finite number/);
  assert.throws(
    () => sourceFromRows({ ...rows, edges: [], rankings: [{ user_id: U.ann, bev_id: B.coke, bucket: 1, score: "n/a", ranked_at: "t" }] }),
    (error: Error) => {
      assert.match(error.message, /rankings row 1 .* score is not a finite number/);
      assert.ok(!error.message.includes(U.ann));
      return true;
    },
  );
});

test("parseEmbedding handles the text and the array form, and rejects the rest", () => {
  assert.deepEqual(parseEmbedding("[0.1,-0.2,3]", "e"), [0.1, -0.2, 3]);
  assert.deepEqual(parseEmbedding([1, 2], "e"), [1, 2]);
  assert.throws(() => parseEmbedding("not json", "the embedding"), /the embedding is not a numeric vector/);
  assert.throws(() => parseEmbedding('["a"]', "the embedding"), /not a numeric vector/);
  assert.throws(() => parseEmbedding("{}", "the embedding"), /not a numeric vector/);
});

test("instant keeps PostgREST's rendering and normalises anything else that parses", () => {
  assert.equal(instant("2026-11-09T04:51:07.123456+00:00", "t"), "2026-11-09T04:51:07.123456+00:00");
  assert.equal(instant("2026-11-09T04:51:07Z", "t"), "2026-11-09T04:51:07Z");
  assert.equal(instant("2026-11-09 04:51:07+00", "t"), "2026-11-09T04:51:07.000Z");
  assert.throws(() => instant("soon", "computed_at"), /computed_at is not a timestamp/);
  assert.throws(() => instant(null, "computed_at"), /not a timestamp/);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test("chunk slices in order and sends nothing for an empty input", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2], 2), [[1, 2]]);
  assert.deepEqual(chunk([], 100), []);
  assert.throws(() => chunk([1], 0), /positive integer/);
  assert.throws(() => chunk([1], 1.5), /positive integer/);
});

test("findBevByName: exact name first, then the lowest-id substring match", () => {
  const bevs = fixturePlan().nodes.bevs;
  assert.equal(findBevByName(bevs, "Coca-Cola Classic")?.name, "Coca-Cola Classic");
  assert.equal(findBevByName(bevs, "Pepsi")?.name, "Pepsi");
  const matcha = findBevByName(bevs, "Matcha");
  assert.ok(matcha !== undefined && matcha.name.toLowerCase().includes("matcha"));
  const lowest = bevs.filter((b) => b.name.toLowerCase().includes("matcha")).map((b) => b.id).sort()[0];
  assert.equal(matcha.id, lowest);
  assert.ok(findBevByName(bevs, "Red Bull")?.name.startsWith("Red Bull"));
  assert.equal(findBevByName(bevs, "no such drink at all"), undefined);
});

// ---------------------------------------------------------------------------
// The write plan
// ---------------------------------------------------------------------------

test("writeSteps upserts every label before any relationship, with the right batch sizes", () => {
  const steps = writeSteps(fixturePlan());
  assert.deepEqual(
    steps.map((s) => s.name),
    ["Category", "Brand", "Flavor", "Note", "User", "Bev", ...OWNED_TYPES],
  );
  assert.deepEqual([...steps.slice(0, 6).map((s) => s.name)].sort(), [...OWNED_LABELS].sort());
  const size = new Map(steps.map((s) => [s.name, s.batchSize]));
  assert.equal(size.get("Bev"), 100);
  assert.equal(BATCH.embeddings, 100);
  for (const label of ["Category", "Brand", "Flavor", "Note", "User"]) assert.equal(size.get(label), 500);
  for (const type of OWNED_TYPES) assert.equal(size.get(type), 1000);
  // Whatever carries an embedding goes 100 to a request.
  for (const step of steps) {
    if (step.rows.some((row) => Array.isArray((row as { embedding?: unknown }).embedding))) assert.equal(step.batchSize, 100);
  }
  // Every row of the plan is in exactly one step.
  const p = fixturePlan();
  const total = Object.values(p.counts.nodes).reduce((a, b) => a + b, 0) + Object.values(p.counts.relationships).reduce((a, b) => a + b, 0);
  assert.equal(steps.reduce((n, s) => n + s.rows.length, 0), total);
});

test("the sweep covers every owned type and label, relationships first, and never Meta", () => {
  const steps = sweepSteps();
  assert.deepEqual(
    steps.map((s) => s.name),
    [...OWNED_TYPES, ...OWNED_LABELS],
  );
  assert.ok(!(OWNED_LABELS as readonly string[]).includes("Meta"));
  for (const type of OWNED_TYPES) {
    assert.equal(SWEEP_RELATIONSHIPS[type], `MATCH ()-[r:${type}]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r`);
  }
  for (const label of OWNED_LABELS) {
    assert.equal(SWEEP_NODES[label], `MATCH (n:${label}) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n`);
  }
  for (const step of steps) assert.ok(!step.statement.includes("Meta"), step.name);
});

// ---------------------------------------------------------------------------
// The Cypher
// ---------------------------------------------------------------------------

const upserts = Object.entries(ALL_STATEMENTS).filter(([name]) => name.startsWith("UPSERT_"));

test("every float-valued property is written through toFloat", () => {
  const expected: Record<string, string[]> = {
    UPSERT_SIMILAR_TO: ["w", "tree", "content", "emb", "profile", "cop"],
    UPSERT_RANKED: ["score", "z"],
    UPSERT_LIKES: ["w"],
    UPSERT_DISLIKES: ["w"],
  };
  for (const [name, properties] of Object.entries(expected)) {
    for (const property of properties) {
      assert.ok((ALL_STATEMENTS[name] as string).includes(`${property}: toFloat(row.${property})`), `${name} writes ${property} uncoerced`);
    }
  }
  assert.ok(UPSERT_BEVS.includes("[x IN row.embedding | toFloat(x)]"));

  // And the general rule: a float-valued row field is never referenced bare.
  const floats = ["w", "tree", "content", "emb", "profile", "cop", "score", "z"];
  for (const [name, statement] of upserts) {
    for (const property of floats) {
      const bare = new RegExp(`(?<!toFloat\\()row\\.${property}\\b`);
      assert.ok(!bare.test(statement), `${name} references row.${property} without toFloat`);
    }
    assert.ok(!/(?<!IN |WHEN )row\.embedding\b(?! IS NULL)/.test(statement), `${name} stores row.embedding uncoerced`);
  }
});

test("every integer-valued property is written through toInteger", () => {
  const integers = ["sortOrder", "depth", "bevCount", "priceTier", "caffeine", "sweetness", "bucket"];
  let seen = 0;
  for (const [name, statement] of upserts) {
    for (const property of integers) {
      if (!new RegExp(`row\\.${property}\\b`).test(statement)) continue;
      seen++;
      assert.ok(statement.includes(`${property}: toInteger(row.${property})`), `${name} writes ${property} uncoerced`);
    }
  }
  assert.equal(seen, integers.length);
  for (const key of [...OWNED_LABELS, ...OWNED_TYPES]) assert.ok(STAMP_META.includes(`toInteger($counts.${key})`), key);
});

test("no statement calls a gds procedure, and none depends on APOC", () => {
  for (const [name, statement] of Object.entries(ALL_STATEMENTS)) {
    assert.ok(!/gds\./i.test(statement), `${name} calls gds`);
    assert.ok(!/apoc\./i.test(statement), `${name} calls apoc`);
  }
});

test("every statement is a fixed string: data travels only as parameters", () => {
  for (const [name, statement] of Object.entries(ALL_STATEMENTS)) {
    assert.equal(typeof statement, "string");
    assert.ok(!statement.includes("${"), `${name} has an unexpanded interpolation`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(statement), `${name} contains an id`);
  }
  // Building a plan does not change a statement, and writeSteps hands out the constants.
  const before = JSON.stringify(ALL_STATEMENTS);
  const steps = writeSteps(fixturePlan());
  assert.equal(JSON.stringify(ALL_STATEMENTS), before);
  for (const step of steps) assert.ok(Object.values(ALL_STATEMENTS).includes(step.statement));
  for (const [name, statement] of upserts) {
    assert.ok(statement.includes("UNWIND $rows AS row"), name);
    assert.ok(statement.includes("syncId: $syncId"), `${name} does not stamp syncId`);
    assert.ok(statement.includes("MERGE "), name);
  }
});

test("node upserts replace the property map; the Meta stamp does not", () => {
  for (const name of ["UPSERT_CATEGORIES", "UPSERT_BRANDS", "UPSERT_FLAVORS", "UPSERT_NOTES", "UPSERT_USERS", "UPSERT_BEVS"]) {
    assert.match(ALL_STATEMENTS[name] as string, /\nSET \w+ = \{/, `${name} does not use replace semantics`);
  }
  // (:Meta) keeps lastKeepAliveAt, so it is individual SETs and never a replace.
  for (const statement of [STAMP_META, STAMP_FAILED_ATTEMPT]) {
    assert.ok(!/SET m = /.test(statement));
    assert.ok(!statement.includes("lastKeepAliveAt"));
    assert.ok(statement.includes("MERGE (m:Meta { key: 'singleton' })"));
  }
  assert.ok(STAMP_FAILED_ATTEMPT.includes("m.lastAttemptOk = false"));
});

test("a User is written with a pseudonym and the sync stamp, and nothing else", () => {
  assert.ok(UPSERT_USERS.includes("SET u = { pseudonym: row.pseudonym, syncId: $syncId }"));
});

test("every verification branch aggregates without a grouping key, so zero matches is a row saying 0", () => {
  for (const statement of [VERIFY_COUNTS, VERIFY_INVARIANTS]) {
    const branches = statement.split("UNION ALL");
    for (const branch of branches) {
      assert.match(branch, /WITH count\([^)]*\) AS n RETURN '[^']+' AS name, n\s*$/, branch.trim().slice(0, 60));
    }
  }
  assert.equal(VERIFY_COUNTS.split("UNION ALL").length, OWNED_LABELS.length + OWNED_TYPES.length);
});

test("the verification statements return exactly the names expectedVerification knows", () => {
  const names = [...`${VERIFY_COUNTS}\n${VERIFY_INVARIANTS}`.matchAll(/RETURN '([^']+)' AS name/g)].map((m) => m[1] as string);
  assert.deepEqual([...names].sort(), Object.keys(expectedVerification(fixturePlan())).sort());
  assert.equal(new Set(names).size, names.length);
});

const answersFor = (p: GraphPlan): Array<Record<string, unknown>> =>
  Object.entries(expectedVerification(p)).map(([name, n]) => ({ name, n }));

test("verificationFailures passes an exact match and names the check and both numbers otherwise", () => {
  const p = fixturePlan();
  assert.deepEqual(verificationFailures(p, answersFor(p)), []);

  const short = answersFor(p).map((row) => (row.name === "relationships.SIMILAR_TO" ? { ...row, n: (row.n as number) - 2 } : row));
  assert.deepEqual(verificationFailures(p, short), [
    `relationships.SIMILAR_TO: the graph has ${p.counts.relationships.SIMILAR_TO - 2}, the plan has ${p.counts.relationships.SIMILAR_TO}`,
  ]);

  const extra = answersFor(p).map((row) => (row.name === "nodes.User" ? { ...row, n: (row.n as number) + 1 } : row));
  assert.equal(verificationFailures(p, extra).length, 1);

  const misoriented = answersFor(p).map((row) => (String(row.name).startsWith("SIMILAR_TO not oriented") ? { ...row, n: 3 } : row));
  assert.deepEqual(verificationFailures(p, misoriented), ["SIMILAR_TO not oriented src.id < dst.id: the graph has 3, the plan has 0"]);

  const missing = answersFor(p).filter((row) => row.name !== "Bevs without isAlcoholic");
  assert.deepEqual(verificationFailures(p, missing), ["Bevs without isAlcoholic: the graph returned no row, expected 0"]);

  // A count that came back as a string is not the number.
  const stringly = answersFor(p).map((row) => (row.name === "nodes.Bev" ? { ...row, n: String(row.n) } : row));
  assert.equal(verificationFailures(p, stringly).length, 1);
});

test("metaParameters carries the versions and one count per label and type", () => {
  const p = fixturePlan();
  const parameters = metaParameters(p, "sync-1");
  assert.equal(parameters.syncId, "sync-1");
  assert.equal(parameters.rankingVersion, RANKING_VERSION);
  assert.equal(parameters.edgesVersion, RANKING_VERSION);
  assert.deepEqual(Object.keys(parameters.counts as object).sort(), [...OWNED_LABELS, ...OWNED_TYPES].sort());
  assert.equal((parameters.counts as Record<string, number>).SIMILAR_TO, p.counts.relationships.SIMILAR_TO);
});
