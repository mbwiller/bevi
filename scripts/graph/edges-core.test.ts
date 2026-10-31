/**
 * Unit tests for scripts/graph/edges-core.ts -- the pure half of the
 * `bev_edges` builder (A-16 (1)).
 *
 *   npm run test:scripts
 *
 * node:test and node:assert, run with `--experimental-strip-types`, because
 * scripts/ is not an npm workspace and has no test dependency of its own.
 *
 * These tests do NOT re-derive any formula: the numbers they assert are the
 * ones already committed in shared/fixtures/edges.vectors.json (M-24's golden
 * vectors for the 10.1 worked examples), reached through this file's plumbing
 * from catalog-shaped rows. What is actually under test is the plumbing --
 * candidate pairing, canonical orientation, the `components` payload and the
 * top-k union -- which is the part a database cannot be borrowed to check.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGE_MIN_WEIGHT, EDGE_TOP_K, RANKING_VERSION, edgeWeight } from "@bevi/ranking";
import type { FlavorProfile, Taxonomy } from "@bevi/ranking";

import {
  COMPONENT_DECIMALS,
  KNN_CANDIDATES,
  bevFeatures,
  buildTaxonomy,
  candidatePairs,
  edgeRows,
  neighboursOf,
  orientPair,
  pairKey,
  round6,
  selectEdges,
  splitPairKey,
  taxonomyIsFlat,
  treeNodeOf,
  weighPair,
  weighPairs,
} from "./edges-core.ts";
import type { BevRecord, WeightedPair } from "./edges-core.ts";
// Importing the job is safe: it only calls main() when it is argv[1].
import { parseOptions } from "./build-edges.ts";

// ---------------------------------------------------------------------------
// Fixtures: five catalog rows, with ids chosen so that lexical order is
// coke < pepsi < lacroix < diet < redbull.
// ---------------------------------------------------------------------------

const ID = {
  coke: "00000000-0000-4000-8000-00000000a1a1",
  pepsi: "00000000-0000-4000-8000-00000000b2b2",
  lacroix: "00000000-0000-4000-8000-00000000c3c3",
  diet: "00000000-0000-4000-8000-00000000d4d4",
  redbull: "00000000-0000-4000-8000-00000000e5e5",
  absent: "00000000-0000-4000-8000-00000000f6f6",
} as const;

const bev = (
  id: string,
  name: string,
  brand: string | null,
  flavor: string | null,
  categoryId: string,
  priceTier = 1,
  leafCategoryId: string | null = null,
): BevRecord => ({
  id,
  name,
  brand,
  flavor,
  categoryId,
  // A-13: null by default, so every existing case keeps weighing the tree term
  // at the root and its expected weights are unchanged. The leaf cases below
  // pass it explicitly.
  leafCategoryId,
  priceTier,
  isAlcoholic: false,
});

const COKE = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda");
const PEPSI = bev(ID.pepsi, "Pepsi", "Pepsi", "Original", "soda");
const LACROIX = bev(ID.lacroix, "LaCroix Lime", "LaCroix", "Lime", "sparkling_water");
const DIET_COKE = bev(ID.diet, "Diet Coke", "Coca-Cola", "Diet", "diet_soda");
const RED_BULL = bev(ID.redbull, "Red Bull Original Energy Drink", "Red Bull", "Original", "energy");

const CATALOG = [COKE, PEPSI, LACROIX, DIET_COKE, RED_BULL];

/** The pre-A-13 `public.categories`: roots only, every `parent_id` null. */
const CATEGORIES = ["soda", "diet_soda", "sparkling_water", "energy", "water"].map((id) => ({ id }));
const TAXONOMY = buildTaxonomy(CATEGORIES);

/**
 * The A-13 shape: the same roots plus a few of D-04's leaves. `water` stays
 * unsplit, so a Bev there is weighed at its root -- the shape rule's case.
 */
const CATEGORIES_A13 = [
  { id: "soda", parentId: null },
  { id: "diet_soda", parentId: null },
  { id: "sparkling_water", parentId: null },
  { id: "energy", parentId: null },
  { id: "water", parentId: null },
  { id: "cola", parentId: "soda" },
  { id: "citrus_soda", parentId: "soda" },
  { id: "diet_cola", parentId: "diet_soda" },
  { id: "plain_sparkling_water", parentId: "sparkling_water" },
];
const TAXONOMY_A13 = buildTaxonomy(CATEGORIES_A13);

const cola: FlavorProfile = { base: "cola", carbonated: true, caffeine: 2, sweetness: 3, dairy: false, alcohol: false };
/** Chosen so profileSimilarity(cola, sparkling) is exactly 0.4, the 10.1 worked example's profile term. */
const sparkling: FlavorProfile = { base: "citrus", carbonated: true, caffeine: 0, sweetness: 1, dairy: false, alcohol: false };

/** A unit 2-vector at the requested cosine from [1, 0]. `embeddingSimilarity` ignores dimension. */
const atCosine = (c: number): number[] => [c, Math.sqrt(1 - c * c)];
const AXIS = [1, 0];

function context(options: {
  embeddings?: Record<string, readonly number[]>;
  profiles?: Record<string, FlavorProfile>;
  /** A-13: pass a leaf-bearing catalog and its taxonomy to weigh the tree term at leaves. */
  catalog?: readonly BevRecord[];
  taxonomy?: Taxonomy;
} = {}) {
  const catalog = options.catalog ?? CATALOG;
  return {
    taxonomy: options.taxonomy ?? TAXONOMY,
    treeNodes: new Map(catalog.map((b) => [b.id, treeNodeOf(b)])),
    features: new Map(catalog.map((b) => [b.id, bevFeatures(b)])),
    profiles: new Map(Object.entries(options.profiles ?? {})),
    embeddings: new Map<string, readonly number[]>(Object.entries(options.embeddings ?? {})),
  };
}

const pair = (src: string, dst: string, weight: number): WeightedPair => ({
  src,
  dst,
  weight,
  components: { tree: 0, content: 0, emb: 0, profile: 0, cop: 0 },
});

// ---------------------------------------------------------------------------
// The taxonomy and what the tree term degenerates to
// ---------------------------------------------------------------------------

test("buildTaxonomy maps every category to null while categories has no parent_id", () => {
  assert.deepEqual(TAXONOMY, {
    soda: null,
    diet_soda: null,
    sparkling_water: null,
    energy: null,
    water: null,
  });
  assert.equal(taxonomyIsFlat(TAXONOMY), true);
  assert.equal(taxonomyIsFlat(buildTaxonomy([{ id: "coffee" }, { id: "matcha", parentId: "coffee" }])), false);
});

test("with a flat taxonomy the tree term is the [same category] indicator", () => {
  const ctx = context();
  // soda vs soda
  assert.equal(weighPair(ID.coke, ID.pepsi, ctx).components.tree, 1);
  // soda vs diet_soda: siblings only once A-13 gives them a shared parent
  assert.equal(weighPair(ID.coke, ID.diet, ctx).components.tree, 0);
  assert.equal(weighPair(ID.coke, ID.lacroix, ctx).components.tree, 0);
});

// ---------------------------------------------------------------------------
// A-13: the tree term is measured at the leaf, the content term at the root
// ---------------------------------------------------------------------------

test("buildTaxonomy carries parent_id, so the taxonomy is no longer flat", () => {
  assert.equal(taxonomyIsFlat(TAXONOMY_A13), false);
  assert.equal(TAXONOMY_A13.cola, "soda");
  assert.equal(TAXONOMY_A13.soda, null);
});

test("treeNodeOf is the leaf when there is one, the category when there is not", () => {
  assert.equal(treeNodeOf(bev(ID.coke, "Coca-Cola", "Coca-Cola", null, "soda", 1, "cola")), "cola");
  assert.equal(treeNodeOf(bev(ID.coke, "Coca-Cola", "Coca-Cola", null, "soda")), "soda");
});

test("with leaves the tree term separates same leaf, sibling leaves and a Bev on its parent", () => {
  // Every Bev keeps its ROOT in `categoryId`, which is what A-13 preserves, and
  // carries its leaf alongside.
  const coke = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda", 1, "cola");
  const pepsi = bev(ID.pepsi, "Pepsi", "Pepsi", "Original", "soda", 1, "cola");
  // A citrus soda: a sibling leaf of cola under the same root.
  const sprite = bev(ID.absent, "Sprite", "Sprite", "Original", "soda", 1, "citrus_soda");
  // Diet Coke is under `diet_soda`, a DIFFERENT root, which is D-04's deliberate
  // choice: diet soda's leaves mirror soda's rather than nesting under them.
  const diet = bev(ID.diet, "Diet Coke", "Coca-Cola", "Diet", "diet_soda", 1, "diet_cola");
  // On an unsplit root, so it is weighed one level up (the shape rule).
  const dasani = bev(ID.redbull, "Dasani", "Dasani", null, "water");
  const catalog = [coke, pepsi, sprite, diet, dasani];
  const ctx = { ...context({ catalog, taxonomy: TAXONOMY_A13 }) };

  // Same leaf: Wu-Palmer 2*2/(2+2).
  assert.equal(weighPair(coke.id, pepsi.id, ctx).components.tree, 1);
  // Sibling leaves under one root: 2*1/(2+2).
  assert.equal(weighPair(coke.id, sprite.id, ctx).components.tree, 0.5);
  // Different roots: no common ancestor but the implicit one.
  assert.equal(weighPair(coke.id, diet.id, ctx).components.tree, 0);
  // A leaf against a Bev sitting on an unrelated root is still 0.
  assert.equal(weighPair(coke.id, dasani.id, ctx).components.tree, 0);
});

test("a leaf against a Bev on its OWN parent gives 0.667, D-04's fourth value", () => {
  const coke = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda", 1, "cola");
  // Same root, no leaf: depth 1 against the leaf's depth 2, so 2*1/(1+2).
  const generic = bev(ID.pepsi, "Store Brand Soda", null, null, "soda");
  const ctx = context({ catalog: [coke, generic], taxonomy: TAXONOMY_A13 });
  assert.equal(weighPair(coke.id, generic.id, ctx).components.tree, 0.666667);
});

test("the content term reads the ROOT, so leaves do not change it", () => {
  // The same two Bevs, once without leaves and once with. `contentSimilarity`
  // must give the same answer both times: its own same-category indicator is a
  // coarse shelf signal, and handing it the leaf would drop Coke vs a citrus
  // soda to 0 on that term while the tree term already carries the difference.
  const flatCoke = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda");
  const flatSprite = bev(ID.absent, "Sprite", "Sprite", "Original", "soda");
  const leafCoke = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda", 1, "cola");
  const leafSprite = bev(ID.absent, "Sprite", "Sprite", "Original", "soda", 1, "citrus_soda");

  const flat = weighPair(
    ID.coke,
    ID.absent,
    context({ catalog: [flatCoke, flatSprite], taxonomy: TAXONOMY_A13 }),
  );
  const leafed = weighPair(
    ID.coke,
    ID.absent,
    context({ catalog: [leafCoke, leafSprite], taxonomy: TAXONOMY_A13 }),
  );

  assert.equal(leafed.components.content, flat.components.content);
  // Only the tree term moved, and it moved DOWN: two sodas were "the same
  // category" before A-13 and are sibling leaves now, which is the finer and
  // more honest answer.
  assert.equal(flat.components.tree, 1);
  assert.equal(leafed.components.tree, 0.5);
});

test("candidatePairs' same-category arm is D-04's same-parent-subtree arm, since category_id stayed the root", () => {
  const coke = bev(ID.coke, "Coca-Cola Classic", "Coca-Cola", "Original", "soda", 1, "cola");
  const sprite = bev(ID.absent, "Sprite", "Sprite", "Original", "soda", 1, "citrus_soda");
  const diet = bev(ID.diet, "Diet Coke", "Coca-Cola", "Diet", "diet_soda", 1, "diet_cola");
  const pairs = candidatePairs([coke, sprite, diet]);
  // Two different leaves of `soda` are still candidates for each other.
  assert.equal(pairs.has(pairKey(coke.id, sprite.id)), true);
  // Coke and Diet Coke are candidates through the BRAND arm, not the category
  // one -- they are under different roots.
  assert.equal(pairs.has(pairKey(coke.id, diet.id)), true);
  // Sprite and Diet Coke share neither a root nor a brand.
  assert.equal(pairs.has(pairKey(sprite.id, diet.id)), false);
});

// ---------------------------------------------------------------------------
// Canonical orientation
// ---------------------------------------------------------------------------

test("orientPair puts the smaller id first, whichever way it is asked", () => {
  assert.deepEqual(orientPair(ID.coke, ID.pepsi), { src: ID.coke, dst: ID.pepsi });
  assert.deepEqual(orientPair(ID.pepsi, ID.coke), { src: ID.coke, dst: ID.pepsi });
});

test("orientPair rejects a self-edge, which the table's CHECK also forbids", () => {
  assert.throws(() => orientPair(ID.coke, ID.coke), RangeError);
});

test("orientPair rejects uppercase hex, where JS order and collate \"C\" would disagree", () => {
  assert.throws(() => orientPair(ID.coke.toUpperCase(), ID.pepsi), RangeError);
});

test("pairKey is orientation-independent and splitPairKey inverts it", () => {
  assert.equal(pairKey(ID.pepsi, ID.coke), pairKey(ID.coke, ID.pepsi));
  assert.deepEqual(splitPairKey(pairKey(ID.pepsi, ID.coke)), { src: ID.coke, dst: ID.pepsi });
});

// ---------------------------------------------------------------------------
// Candidate pairing
// ---------------------------------------------------------------------------

test("candidate pairs are same category union same brand union the nearest by cosine", () => {
  const pairs = candidatePairs(CATALOG, [
    { bevId: ID.coke, neighbourId: ID.redbull, distance: 0.2 },
  ]);
  assert.deepEqual(
    [...pairs].sort(),
    [
      pairKey(ID.coke, ID.diet), // same brand (Coca-Cola), different category
      pairKey(ID.coke, ID.pepsi), // same category (soda)
      pairKey(ID.coke, ID.redbull), // KNN only
    ].sort()
  );
});

test("the same brand in different spellings is one group, and an empty brand is not a brand", () => {
  const rows = [
    bev("00000000-0000-4000-8000-000000000001", "A", "  Dr   Pepper ", null, "soda"),
    bev("00000000-0000-4000-8000-000000000002", "B", "dr pepper", null, "energy"),
    bev("00000000-0000-4000-8000-000000000003", "C", "   ", null, "energy"),
    bev("00000000-0000-4000-8000-000000000004", "D", null, null, "water"),
  ];
  const pairs = candidatePairs(rows);
  // 1-2 by brand (normaliseBrand collapses the whitespace), 2-3 by category.
  // 3-4 would only exist if "whitespace only" and null counted as a shared brand.
  assert.deepEqual(
    [...pairs].sort(),
    [
      pairKey(rows[0]!.id, rows[1]!.id),
      pairKey(rows[1]!.id, rows[2]!.id),
    ].sort()
  );
});

test("a pair found by two arms is listed once, and a KNN row to an unknown or self id is dropped", () => {
  const pairs = candidatePairs(CATALOG, [
    { bevId: ID.coke, neighbourId: ID.pepsi, distance: 0.05 }, // also same category
    { bevId: ID.coke, neighbourId: ID.coke, distance: 0 }, // self
    { bevId: ID.coke, neighbourId: ID.absent, distance: 0.1 }, // not an active Bev
  ]);
  assert.equal([...pairs].filter((k) => k === pairKey(ID.coke, ID.pepsi)).length, 1);
  assert.equal(pairs.has(pairKey(ID.coke, ID.absent)), false);
  // Only the two structural pairs: coke-pepsi (soda) and coke-diet (Coca-Cola).
  assert.equal(pairs.size, 2);
});

test("the KNN arm's width is the documented 50", () => {
  assert.equal(KNN_CANDIDATES, 50);
});

// ---------------------------------------------------------------------------
// Features fed to contentSimilarity
// ---------------------------------------------------------------------------

test("bevFeatures normalises the brand key and tokenises name+flavor", () => {
  const f = bevFeatures(bev(ID.coke, "Coca-Cola Classic", "  Coca-Cola  ", "Original", "soda", 2));
  assert.equal(f.brandKey, "coca-cola");
  // `original` and `classic` are stoplisted; the apostrophe-free word split keeps coca and cola.
  assert.deepEqual(f.flavorTokens, ["coca", "cola"]);
  assert.equal(f.priceTier, 2);
  // contentSimilarity never reads these, so they are not fetched.
  assert.deepEqual([f.ratingCount, f.mean, f.stddev], [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// The components payload
// ---------------------------------------------------------------------------

test("round6 keeps COMPONENT_DECIMALS and leaves [0, 1] inside [0, 1]", () => {
  assert.equal(COMPONENT_DECIMALS, 6);
  assert.equal(round6(1 / 3), 0.333333);
  assert.equal(round6(0.9999999), 1);
  assert.equal(round6(0), 0);
  assert.throws(() => round6(Number.NaN), RangeError);
});

test("every stored row satisfies edgeWeight(components) === weight", () => {
  const ctx = context({
    profiles: { [ID.coke]: cola, [ID.pepsi]: cola, [ID.lacroix]: sparkling, [ID.diet]: cola },
    embeddings: { [ID.coke]: AXIS, [ID.pepsi]: atCosine(0.9), [ID.lacroix]: atCosine(0.6), [ID.diet]: atCosine(0.95) },
  });
  const weighed = weighPairs(candidatePairs(CATALOG), ctx);
  assert.ok(weighed.length > 0);
  for (const p of weighed) {
    assert.equal(edgeWeight(p.components), p.weight, `${p.src}|${p.dst}`);
    assert.deepEqual(Object.keys(p.components).sort(), ["content", "cop", "emb", "profile", "tree"]);
    assert.equal(p.components.cop, 0); // gamma = 0 in v1; co-rating is A-16 (2)
  }
});

test("Coca-Cola <-> Pepsi reproduces the 10.1 worked example at 0.895", () => {
  const ctx = context({
    profiles: { [ID.coke]: cola, [ID.pepsi]: cola },
    embeddings: { [ID.coke]: AXIS, [ID.pepsi]: atCosine(0.9) },
  });
  const p = weighPair(ID.pepsi, ID.coke, ctx);
  assert.deepEqual(p.components, { tree: 1, content: 0.5, emb: 0.9, profile: 1, cop: 0 });
  assert.equal(p.weight, 0.895);
  assert.ok(p.weight >= 0.8, "the sanity report's first line");
  assert.deepEqual([p.src, p.dst], [ID.coke, ID.pepsi]);
});

test("Coca-Cola <-> a sparkling water reproduces 0.315, and 0.89 is where it breaches 0.4", () => {
  const profiles = { [ID.coke]: cola, [ID.lacroix]: sparkling };
  const at = (cosine: number) =>
    weighPair(ID.coke, ID.lacroix, context({ profiles, embeddings: { [ID.coke]: AXIS, [ID.lacroix]: atCosine(cosine) } }));

  const worked = at(0.6);
  assert.deepEqual(worked.components, { tree: 0, content: 0.1, emb: 0.6, profile: 0.4, cop: 0 });
  assert.equal(worked.weight, 0.315);
  assert.ok(worked.weight < 0.4, "the sanity report's second line");

  // M-24's warning, executable: with a flat taxonomy this pair is
  // w = 0.135 + 0.30*emb, so the < 0.4 bound holds only while the cosine stays
  // <= 0.88. That is why a breach is reported and not fatal by default.
  assert.equal(at(0.88).weight, 0.399);
  assert.equal(at(0.89).weight, 0.402);
  assert.ok(at(0.89).weight >= 0.4);
});

test("a missing embedding or profile contributes 0 rather than being guessed", () => {
  const p = weighPair(ID.coke, ID.pepsi, context({ profiles: { [ID.coke]: cola } }));
  assert.equal(p.components.emb, 0);
  assert.equal(p.components.profile, 0);
  // tree 1 + content 0.5 only: 0.25 + 0.075
  assert.equal(p.weight, 0.325);
});

test("weighPair refuses a Bev it has no features for", () => {
  assert.throws(() => weighPair(ID.coke, ID.absent, context()), RangeError);
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test("selectEdges keeps a pair when EITHER endpoint wants it", () => {
  const [a, b, c] = [ID.coke, ID.pepsi, ID.lacroix];
  const kept = selectEdges([pair(a, b, 0.9), pair(a, c, 0.5), pair(b, c, 0.35)], 1, 0.3);
  // With k = 1: a and b both keep a-b; c's best is a-c (0.5 > 0.35), so a-c
  // survives on c's vote alone. b-c is wanted by nobody.
  assert.deepEqual(
    kept.map((p) => `${p.src}|${p.dst}`),
    [pairKey(a, b), pairKey(a, c)]
  );
});

test("selectEdges drops everything below the minimum weight", () => {
  assert.deepEqual(selectEdges([pair(ID.coke, ID.pepsi, 0.299)], EDGE_TOP_K, 0.3), []);
  assert.equal(selectEdges([pair(ID.coke, ID.pepsi, 0.3)], EDGE_TOP_K, 0.3).length, 1);
  assert.equal(EDGE_MIN_WEIGHT, 0.3);
  assert.equal(EDGE_TOP_K, 20);
});

test("selectEdges returns pairs in canonical order, sorted, with no duplicates", () => {
  const kept = selectEdges([pair(ID.coke, ID.pepsi, 0.9), pair(ID.coke, ID.lacroix, 0.8)]);
  assert.deepEqual(
    kept.map((p) => [p.src, p.dst]),
    [
      [ID.coke, ID.pepsi],
      [ID.coke, ID.lacroix],
    ].sort((x, y) => (x[1]! < y[1]! ? -1 : 1))
  );
  for (const p of kept) assert.ok(p.src < p.dst);
});

test("neighboursOf breaks ties on bevId in code-unit order, as topEdges does", () => {
  const kept = [pair(ID.coke, ID.redbull, 0.5), pair(ID.coke, ID.pepsi, 0.5), pair(ID.coke, ID.lacroix, 0.5)];
  assert.deepEqual(
    neighboursOf(ID.coke, kept, 2).map((n) => n.bevId),
    [ID.pepsi, ID.lacroix]
  );
});

// ---------------------------------------------------------------------------
// The job's CLI
// ---------------------------------------------------------------------------

test("parseOptions defaults to the package's constants and rejects an unknown flag", () => {
  assert.deepEqual(parseOptions([]), {
    dryRun: false,
    strict: false,
    knn: KNN_CANDIDATES,
    topK: EDGE_TOP_K,
    minWeight: EDGE_MIN_WEIGHT,
  });
  assert.deepEqual(parseOptions(["--dry-run", "--strict", "--knn=10", "--top-k=3", "--min-weight=0.5"]), {
    dryRun: true,
    strict: true,
    knn: 10,
    topK: 3,
    minWeight: 0.5,
  });
  // A typo must not silently become a full write to prod.
  assert.throws(() => parseOptions(["--dryrun"]), /unknown argument/);
  assert.throws(() => parseOptions(["--knn=lots"]), /needs a number/);
});

// ---------------------------------------------------------------------------
// The write payload
// ---------------------------------------------------------------------------

test("edgeRows is the table's column list, oriented src < dst", () => {
  const ctx = context({
    profiles: { [ID.coke]: cola, [ID.pepsi]: cola },
    embeddings: { [ID.coke]: AXIS, [ID.pepsi]: atCosine(0.9) },
  });
  const rows = edgeRows(selectEdges([weighPair(ID.pepsi, ID.coke, ctx)]));
  assert.deepEqual(rows, [
    {
      src_bev_id: ID.coke,
      dst_bev_id: ID.pepsi,
      weight: 0.895,
      components: { tree: 1, content: 0.5, emb: 0.9, profile: 1, cop: 0 },
    },
  ]);
  assert.ok(rows[0]!.src_bev_id < rows[0]!.dst_bev_id, "the orientation CHECK of 20261019000500");
  // The version the job stamps is the package's, never a literal.
  assert.match(RANKING_VERSION, /^\d+\.\d+\.\d+$/);
});
