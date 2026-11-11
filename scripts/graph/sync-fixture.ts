/**
 * A `GraphSource` built from the checked-in catalog, for the sync's unit tests
 * and for `npm run graph:sync -- --fixture` (which forces a dry run).
 *
 * This machine and CI have no Postgres to read, so this is the only way to
 * push a full-sized, realistically shaped graph through the real Cypher on the
 * real instance -- inside a transaction that is rolled back. It is NOT a copy
 * of prod: the embeddings and the users are synthetic, and the edges are what
 * the real `edges-core.ts` pipeline produces FROM those synthetic embeddings.
 *
 * Deterministic: it reads `data/catalog` and nothing else. No network, no
 * environment, no clock, and every "random" number comes from `createPrng`
 * with a fixed seed, so two calls return deep-equal sources.
 *
 * What it holds:
 *   - the catalog: every row of bevs.csv as an active 'seed' Bev (ids from
 *     `catalogBevId`), categories.json, flavor-profiles.csv;
 *   - a 384-d embedding per catalog Bev, clustered by category so the edges
 *     look like edges, with components set to EXACTLY 0 and 1 on some Bevs --
 *     JSON renders those as integers, which is what the float coercion is for;
 *   - `bev_edges` rows from the real `candidatePairs` / `weighPairs` /
 *     `selectEdges` / `edgeRows` (the `tree` term is very often exactly 1);
 *   - three Bevs the catalog does not have: two active user-created ones (no
 *     profile, no embedding; one with no brand, one with a blank brand) and a
 *     HIDDEN one that still has a profile, an embedding, an edge and a ranking
 *     -- everything the sync must drop;
 *   - six synthetic users whose rankings land above, below, inside and exactly
 *     on the +-0.25 dead band, plus one ranking of a Bev that does not exist.
 */

import { RANKING_VERSION, createPrng } from "@bevi/ranking";
import type { FlavorProfile } from "@bevi/ranking";

import { catalogBevId, loadBevRows, loadCategories, loadFlavorProfileRows } from "../catalog/catalog.ts";
import { bevFeatures, buildTaxonomy, candidatePairs, edgeRows, selectEdges, treeNodeOf, weighPairs } from "./edges-core.ts";
import type { BevRecord } from "./edges-core.ts";
import { EMBEDDING_DIMENSIONS } from "./sync-core.ts";
import type {
  GraphSource,
  SourceBev,
  SourceCategory,
  SourceEdge,
  SourceEmbedding,
  SourceProfile,
  SourceRanking,
} from "./sync-core.ts";

/** Not a secret: `--fixture` pseudonymises six made-up uuids with it, in a transaction that is rolled back. */
export const FIXTURE_PSEUDONYM_SALT = "bevi-fixture-salt-not-a-secret";

/** PostgREST's rendering of a timestamptz, microseconds and offset included. */
const FIXTURE_COMPUTED_AT = "2026-11-09T04:51:07.123456+00:00";

export const FIXTURE_BEVS = {
  /** Active, user-created, no brand, no leaf, no profile, no embedding. */
  userNoBrand: "00000000-0000-4000-8000-0000000fb001",
  /** Active, user-created, a whitespace-only brand, no profile, no embedding. */
  userBlankBrand: "00000000-0000-4000-8000-0000000fb002",
  /** HIDDEN. Still has a profile, an embedding, an edge and a ranking. */
  hidden: "00000000-0000-4000-8000-0000000fb003",
  /** In no table at all: a ranking points at it. */
  missing: "00000000-0000-4000-8000-0000000fb004",
} as const;

export const FIXTURE_USERS = {
  /** Scores 5.00 / 5.25 / 4.75: sigma floors at 1, so z is exactly 0, +0.25 and -0.25. */
  onTheBand: "00000000-0000-4000-8000-0000000fa001",
  /** A wide spread: z well above, well below and inside the band. */
  wide: "00000000-0000-4000-8000-0000000fa002",
  /** Two rankings, so the global mu and sigma apply (below MIN_N_USER). */
  newcomer: "00000000-0000-4000-8000-0000000fa003",
  /** Ranks only the hidden Bev: no node. */
  onlyHidden: "00000000-0000-4000-8000-0000000fa004",
  /** Ranks active Bevs, the hidden one and the missing one. */
  mixed: "00000000-0000-4000-8000-0000000fa005",
  /** One ranking. */
  single: "00000000-0000-4000-8000-0000000fa006",
} as const;

/** `count` floats in [-1, 1) from a seeded generator. */
function noise(seed: string, count: number): number[] {
  const rand = createPrng(seed);
  return Array.from({ length: count }, () => rand() * 2 - 1);
}

/**
 * A deterministic stand-in for a gte-small vector: mostly the Bev's root
 * category, partly its leaf, a little of its own. So two colas are closer than
 * a cola and a root beer, which are closer than a cola and a stout -- enough
 * structure for the `emb` term to do something.
 */
function fixtureEmbedding(slug: string, root: string, leaf: string | null, index: number): number[] {
  const rootVec = noise(`fixture:root:${root}`, EMBEDDING_DIMENSIONS);
  const leafVec = noise(`fixture:leaf:${leaf ?? root}`, EMBEDDING_DIMENSIONS);
  const own = noise(`fixture:bev:${slug}`, EMBEDDING_DIMENSIONS);
  const vector = rootVec.map((x, i) => 0.55 * x + 0.3 * (leafVec[i] as number) + 0.15 * (own[i] as number));
  // Integers on purpose. JSON.stringify(0) is "0" and JSON.stringify(1) is "1",
  // which Neo4j reads as Integers; the upsert must store them as Floats.
  if (index % 5 === 0) vector[0] = 0;
  if (index % 7 === 0) vector[1] = 1;
  if (index % 11 === 0) vector[EMBEDDING_DIMENSIONS - 1] = -1;
  return vector;
}

let cached: GraphSource | undefined;

/** The fixture. Built once per process; callers get a fresh deep copy so a test may mutate its own. */
export function buildFixtureSource(): GraphSource {
  cached ??= build();
  return structuredClone(cached);
}

function build(): GraphSource {
  const categories: SourceCategory[] = loadCategories().map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    isAlcoholic: c.isAlcoholic,
    sortOrder: c.sortOrder,
  }));
  const alcoholic = new Map(categories.map((c) => [c.id, c.isAlcoholic]));

  const catalogRows = loadBevRows();
  const bevs: SourceBev[] = catalogRows.map((row) => ({
    id: catalogBevId(row.slug),
    name: row.name,
    brand: row.brand === "" ? null : row.brand,
    flavor: row.flavor === "" ? null : row.flavor,
    categoryId: row.category,
    leafCategoryId: row.leaf === "" ? null : row.leaf,
    priceTier: Number(row.price_tier),
    source: "seed",
    isStarter: row.is_starter === "true",
    status: "active",
  }));

  const idBySlug = new Map(catalogRows.map((row) => [row.slug, catalogBevId(row.slug)]));
  const profiles: SourceProfile[] = loadFlavorProfileRows().flatMap((row) => {
    const bevId = idBySlug.get(row.slug);
    if (bevId === undefined) return [];
    return [
      {
        bevId,
        base: row.base,
        carbonated: row.carbonated === "true",
        caffeine: Number(row.caffeine),
        sweetness: Number(row.sweetness),
        dairy: row.dairy === "true",
        alcohol: row.alcohol === "true",
        serve: row.serve,
        source: "catalog",
      },
    ];
  });

  const embeddings: SourceEmbedding[] = catalogRows.map((row, i) => ({
    bevId: catalogBevId(row.slug),
    embedding: fixtureEmbedding(row.slug, row.category, row.leaf === "" ? null : row.leaf, i),
    model: "fixture-prng",
  }));

  // -- the edges, from the real pipeline ------------------------------------
  // Over the catalog Bevs only, as a real `graph-edges` run that predates the
  // three extra Bevs below would have left the table.
  const records: BevRecord[] = bevs.map((b) => ({
    id: b.id,
    name: b.name,
    brand: b.brand,
    flavor: b.flavor,
    categoryId: b.categoryId,
    leafCategoryId: b.leafCategoryId,
    priceTier: b.priceTier,
    isAlcoholic: alcoholic.get(b.categoryId) ?? true,
  }));
  const profileOf = new Map<string, FlavorProfile>(
    profiles.map((p) => [
      p.bevId,
      {
        base: p.base,
        carbonated: p.carbonated,
        caffeine: p.caffeine as 0 | 1 | 2 | 3,
        sweetness: p.sweetness as 0 | 1 | 2 | 3,
        dairy: p.dairy,
        alcohol: p.alcohol,
      },
    ]),
  );
  const kept = selectEdges(
    weighPairs(candidatePairs(records), {
      taxonomy: buildTaxonomy(categories.map((c) => ({ id: c.id, parentId: c.parentId }))),
      treeNodes: new Map(records.map((b) => [b.id, treeNodeOf(b)])),
      features: new Map(records.map((b) => [b.id, bevFeatures(b)])),
      profiles: profileOf,
      embeddings: new Map(embeddings.map((e) => [e.bevId, e.embedding])),
    }),
  );
  const edges: SourceEdge[] = edgeRows(kept).map((row) => ({
    src: row.src_bev_id,
    dst: row.dst_bev_id,
    weight: row.weight,
    components: row.components,
    version: RANKING_VERSION,
    computedAt: FIXTURE_COMPUTED_AT,
  }));

  // -- three Bevs the catalog does not have ---------------------------------
  const coke = catalogBevId("coca-cola-classic");
  const pepsi = catalogBevId("pepsi");
  // Eight other catalog Bevs for the users to rank, in catalog order.
  const anchors = bevs
    .map((b) => b.id)
    .filter((id) => id !== coke && id !== pepsi)
    .slice(0, 8);
  bevs.push(
    {
      id: FIXTURE_BEVS.userNoBrand,
      name: "Corner Deli House Lemonade",
      brand: null,
      flavor: null,
      categoryId: "juice",
      leafCategoryId: null,
      priceTier: 2,
      source: "user",
      isStarter: false,
      status: "active",
    },
    {
      id: FIXTURE_BEVS.userBlankBrand,
      name: "Homemade Iced Tea",
      brand: "   ",
      flavor: "Peach",
      categoryId: "tea",
      leafCategoryId: null,
      priceTier: 1,
      source: "user",
      isStarter: false,
      status: "active",
    },
    {
      id: FIXTURE_BEVS.hidden,
      name: "Taken Down Cola",
      brand: "Coca-Cola",
      flavor: "Cherry",
      categoryId: "soda",
      leafCategoryId: "cola",
      priceTier: 1,
      source: "user",
      isStarter: false,
      status: "hidden",
    },
  );
  profiles.push({
    bevId: FIXTURE_BEVS.hidden,
    base: "cola",
    carbonated: true,
    caffeine: 1,
    sweetness: 3,
    dairy: false,
    alcohol: false,
    serve: "cold",
    source: "inferred",
  });
  embeddings.push({
    bevId: FIXTURE_BEVS.hidden,
    embedding: fixtureEmbedding("taken-down-cola", "soda", "cola", 1),
    model: "fixture-prng",
  });
  // The edges run before the takedown wrote this row; the sync must drop it.
  // Its terms are integers on purpose (see `fixtureEmbedding`).
  const [src, dst] = coke < FIXTURE_BEVS.hidden ? [coke, FIXTURE_BEVS.hidden] : [FIXTURE_BEVS.hidden, coke];
  edges.push({
    src,
    dst,
    weight: 1,
    components: { tree: 1, content: 1, emb: 1, profile: 1, cop: 0 },
    version: RANKING_VERSION,
    computedAt: FIXTURE_COMPUTED_AT,
  });

  // -- six users ------------------------------------------------------------
  const at = (day: number) => `2026-11-0${day}T18:30:00.5+00:00`;
  const rank = (userId: string, bevId: string, score: number, bucket: number, day = 1): SourceRanking => ({
    userId,
    bevId,
    bucket,
    score,
    rankedAt: at(day),
  });
  const [a0, a1, a2, a3, a4, a5, a6, a7] = anchors as [string, string, string, string, string, string, string, string];
  const rankings: SourceRanking[] = [
    // mu = 5.00 exactly, population sigma ~0.20 -> floored to 1.0, so
    // z = +0.25, -0.25 and 0: a LIKES, a DISLIKES and nothing, on the bounds.
    rank(FIXTURE_USERS.onTheBand, coke, 5.25, 2),
    rank(FIXTURE_USERS.onTheBand, pepsi, 4.75, 2),
    rank(FIXTURE_USERS.onTheBand, a2, 5.0, 2),
    // A wide spread around 5.5: far above, far below, and three inside the band.
    rank(FIXTURE_USERS.wide, coke, 9.5, 3, 2),
    rank(FIXTURE_USERS.wide, a3, 1.5, 1, 2),
    rank(FIXTURE_USERS.wide, a4, 5.6, 2, 2),
    rank(FIXTURE_USERS.wide, a5, 5.4, 2, 2),
    // Below MIN_N_USER, so the global mean and deviation apply.
    rank(FIXTURE_USERS.newcomer, pepsi, 8.75, 3, 3),
    rank(FIXTURE_USERS.newcomer, FIXTURE_BEVS.userNoBrand, 2.0, 1, 3),
    // No ranking of an active Bev: no (:User) node.
    rank(FIXTURE_USERS.onlyHidden, FIXTURE_BEVS.hidden, 7.0, 3, 4),
    // The hidden and the missing Bev move this user's mu and sigma but are
    // never RANKED edges.
    rank(FIXTURE_USERS.mixed, a6, 8.0, 3, 5),
    rank(FIXTURE_USERS.mixed, a7, 3.0, 1, 5),
    rank(FIXTURE_USERS.mixed, FIXTURE_BEVS.userBlankBrand, 6.5, 2, 5),
    rank(FIXTURE_USERS.mixed, FIXTURE_BEVS.hidden, 9.0, 3, 5),
    rank(FIXTURE_USERS.mixed, FIXTURE_BEVS.missing, 1.0, 1, 5),
    rank(FIXTURE_USERS.single, a0, 6.0, 2, 6),
    rank(FIXTURE_USERS.wide, a1, 5.5, 2, 2),
  ];

  return { categories, bevs, profiles, embeddings, edges, rankings };
}
