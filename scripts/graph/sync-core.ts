/**
 * The pure half of the nightly Postgres -> Neo4j sync (TASKS.md A-16 steps 6,
 * 8 and 9; scripts/graph/sync.ts is the I/O half).
 *
 * Everything here is a function of its arguments: no fetch, no environment, no
 * clock, no randomness. `buildGraphPlan` turns the rows Postgres returned into
 * a deterministic PLAN -- every node and relationship the graph must hold after
 * the run, every array sorted by key in code-unit order -- and the statements
 * below are the only Cypher the sync ever sends. `sync-core.test.ts` tests this
 * file directly, which is the only way most of it can be tested at all: the
 * repo has no reachable database.
 *
 * NOTHING HERE REIMPLEMENTS A FORMULA. `normaliseBrand` and `flavorTokens`
 * decide what a brand and a note ARE, `zScoresFromRankings` (through
 * `activeZScores`) decides every z, and `treeNodeOf` decides which category
 * node a Bev hangs from. All four are the functions `bev_edges` and
 * `user_neighbors` were computed with, so the graph cannot disagree with the
 * tables it mirrors.
 *
 * EVERY CYPHER STATEMENT IS A FIXED STRING CONSTANT. Data travels only as
 * parameters (`$rows`, `$syncId`, ...). There is no string interpolation of
 * data into Cypher anywhere, and there must never be.
 *
 * THE FLOAT-COERCION RULE. JSON has no int/float distinction and Neo4j does:
 * the server reads `1` as an Integer and `0.5` as a Float. An edge's `tree`
 * term is very often exactly 1 and an embedding component can be exactly 0, so
 * without coercion one property would hold two types across rows: `s.tree` an
 * Integer on half the edges and a Float on the rest. So every float-valued
 * property is written through `toFloat(...)` (lists:
 * `[x IN row.embedding | toFloat(x)]`) and every integer one through
 * `toInteger(...)`. The verification step reads the types back.
 *
 * Measured on the live 5.27-aura instance, uncoerced: a scalar `1` is stored
 * as INTEGER; a list of whole numbers as LIST<INTEGER>; a list MIXING the two
 * is stored, widened to LIST<FLOAT>. So this server does not reject a mixed
 * list -- it is the scalar and the all-integer list that go wrong, silently.
 *
 * TWO KINDS OF OWNED DATA (A-16 (4)). The MIRRORED labels and types are copied
 * from Postgres and counted by the plan. The COMPUTED ones -- `(:Community)`
 * (a taste family),
 * `[:IN_COMMUNITY]` and five properties on `(:Bev)` -- are derived inside the
 * transaction from the graph as read back (analytics-core.ts), counted by the
 * `GraphStats` that computation returns, and written back to Postgres after
 * the commit (`bev_graph_stats`), so they do not live only in the graph either.
 */

import { TASTE_MIN_ATTR_BEVS, flavorTokens, normaliseBrand } from "@bevi/ranking";

import { CATCH_ALL_FLAVOR } from "./analytics-core.ts";
import type { GraphStats, GraphStatsWrites, Membership } from "./analytics-core.ts";
import { treeNodeOf } from "./edges-core.ts";
import { activeZScores } from "./neighbours-core.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `bev_embeddings.embedding` is `vector(384)` (gte-small) and `bev_embedding_idx` is a 384-d index. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * `LIKES` when z >= +0.25, `DISLIKES` when z <= -0.25, neither in between
 * (docs/graph_db_implementation.md section 1): a drink a user felt nothing
 * about should not propagate taste in either direction.
 */
export const PREFERENCE_DEAD_BAND = 0.25;

/**
 * A `(:Note)` exists only for a token shared by at least this many active
 * Bevs. A one-Bev token is a dead end for traversal; it is the same rule, and
 * the same constant, as the taste catalog's attribute coverage.
 */
export const NOTE_MIN_BEVS = TASTE_MIN_ATTR_BEVS;

/** Rows per request: small node rows, relationship rows, and anything carrying a 384-float embedding. */
export const BATCH = { nodes: 500, relationships: 1000, embeddings: 100 } as const;

/** The labels mirrored from Postgres: the plan holds every node of them. */
export const MIRRORED_LABELS = ["Bev", "Category", "Brand", "Flavor", "Note", "User"] as const;
export type MirroredLabel = (typeof MIRRORED_LABELS)[number];

/** The labels the analytics phase computes from the graph itself (analytics-core.ts). */
export const COMPUTED_LABELS = ["Community"] as const;
export type ComputedLabel = (typeof COMPUTED_LABELS)[number];

/** The labels this job owns: it writes every node of them and sweeps every stale one. NEVER `Meta`. */
export const OWNED_LABELS = [...MIRRORED_LABELS, ...COMPUTED_LABELS] as const;
export type OwnedLabel = (typeof OWNED_LABELS)[number];

/** The relationship types mirrored from Postgres. */
export const MIRRORED_TYPES = [
  "CHILD_OF",
  "IN_CATEGORY",
  "BY_BRAND",
  "TASTES_OF",
  "HAS_NOTE",
  "SIMILAR_TO",
  "RANKED",
  "LIKES",
  "DISLIKES",
] as const;
export type MirroredType = (typeof MIRRORED_TYPES)[number];

/** The relationship types the analytics phase computes. */
export const COMPUTED_TYPES = ["IN_COMMUNITY"] as const;
export type ComputedType = (typeof COMPUTED_TYPES)[number];

/** The relationship types this job owns. */
export const OWNED_TYPES = [...MIRRORED_TYPES, ...COMPUTED_TYPES] as const;
export type OwnedType = (typeof OWNED_TYPES)[number];

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// What the job reads out of Postgres
// ---------------------------------------------------------------------------

export interface SourceCategory {
  id: string;
  name: string;
  /** null on one of the 15 roots, the root's id on one of the 60 leaves. Exactly two levels. */
  parentId: string | null;
  isAlcoholic: boolean;
  sortOrder: number;
}

export interface SourceBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  /** ALWAYS one of the roots. */
  categoryId: string;
  /** A child of `categoryId`, or null. */
  leafCategoryId: string | null;
  priceTier: number;
  /** 'seed' | 'user' | 'featured' */
  source: string;
  isStarter: boolean;
  /** Only 'active' is mirrored; any other row is counted and ignored. */
  status: string;
}

export interface SourceProfile {
  bevId: string;
  base: string;
  carbonated: boolean;
  caffeine: number;
  sweetness: number;
  dairy: boolean;
  alcohol: boolean;
  serve: string;
  /** 'catalog' | 'inferred' */
  source: string;
}

export interface SourceEmbedding {
  bevId: string;
  embedding: readonly number[];
  model: string;
}

export interface SourceEdge {
  src: string;
  dst: string;
  weight: number;
  components: { tree: number; content: number; emb: number; profile: number; cop: number };
  version: string;
  computedAt: string;
}

export interface SourceRanking {
  userId: string;
  bevId: string;
  bucket: number;
  score: number;
  rankedAt: string;
}

export interface GraphSource {
  categories: readonly SourceCategory[];
  bevs: readonly SourceBev[];
  profiles: readonly SourceProfile[];
  embeddings: readonly SourceEmbedding[];
  edges: readonly SourceEdge[];
  rankings: readonly SourceRanking[];
}

// -- the same rows exactly as PostgREST renders them -------------------------

export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_alcoholic: boolean;
  sort_order: number;
}
export interface BevRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  leaf_category_id: string | null;
  price_tier: number;
  source: string;
  is_starter: boolean;
  status: string;
}
export interface ProfileRow {
  bev_id: string;
  base: string;
  carbonated: boolean;
  caffeine: number;
  sweetness: number;
  dairy: boolean;
  alcohol: boolean;
  serve: string;
  source: string;
}
export interface EmbeddingRow {
  bev_id: string;
  embedding: string | number[];
  model: string;
}
export interface BevEdgeRow {
  src_bev_id: string;
  dst_bev_id: string;
  /** `numeric`: PostgREST may render it as a JSON string. */
  weight: number | string;
  components: Record<string, unknown> | null;
  version: string;
  computed_at: string;
}
export interface RankingRow {
  user_id: string;
  bev_id: string;
  bucket: number;
  /** `numeric(4,2)`: a JSON string over PostgREST. */
  score: number | string;
  ranked_at: string;
}
export interface SourceRows {
  categories: readonly CategoryRow[];
  bevs: readonly BevRow[];
  profiles: readonly ProfileRow[];
  embeddings: readonly EmbeddingRow[];
  edges: readonly BevEdgeRow[];
  rankings: readonly RankingRow[];
}

/**
 * `Number()` of a value that may be a JSON number or a `numeric` string,
 * rejecting everything that is not a finite number. `Number("")` and
 * `Number(null)` are both 0, which is exactly the silent wrong answer this
 * exists to prevent, so only a non-blank string or a number is converted.
 * `what` must never contain a user id: it ends up in a public log.
 */
export function numeric(value: unknown, what: string): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new RangeError(`${what} is not a finite number: ${JSON.stringify(value)?.slice(0, 40)}`);
  }
  return n;
}

/**
 * pgvector renders over PostgREST as the TEXT form `[0.1,-0.2,...]`, which is
 * valid JSON, so it parses either way -- the same two shapes `parseEmbedding`
 * in build-edges.ts handles. Length and finiteness are checked by
 * `buildGraphPlan`, for active Bevs only.
 */
export function parseEmbedding(value: string | readonly number[], what: string): number[] {
  let vector: unknown = value;
  if (typeof value === "string") {
    try {
      vector = JSON.parse(value);
    } catch {
      throw new RangeError(`${what} is not a numeric vector: ${value.slice(0, 40)}`);
    }
  }
  if (!Array.isArray(vector) || vector.some((x) => typeof x !== "number")) {
    throw new RangeError(`${what} is not a numeric vector: ${JSON.stringify(value)?.slice(0, 40)}`);
  }
  return vector as number[];
}

/** PostgREST rows -> `GraphSource`: snake_case to camelCase, `numeric` strings to numbers, pgvector text to arrays. */
export function sourceFromRows(rows: SourceRows): GraphSource {
  return {
    categories: rows.categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id ?? null,
      isAlcoholic: c.is_alcoholic,
      sortOrder: numeric(c.sort_order, `categories.sort_order of ${c.id}`),
    })),
    bevs: rows.bevs.map((b) => ({
      id: b.id,
      name: b.name,
      brand: b.brand ?? null,
      flavor: b.flavor ?? null,
      categoryId: b.category_id,
      leafCategoryId: b.leaf_category_id ?? null,
      priceTier: numeric(b.price_tier, `bevs.price_tier of ${b.id}`),
      source: b.source,
      isStarter: b.is_starter,
      status: b.status,
    })),
    profiles: rows.profiles.map((p) => ({
      bevId: p.bev_id,
      base: p.base,
      carbonated: p.carbonated,
      caffeine: numeric(p.caffeine, `bev_flavor_profiles.caffeine of ${p.bev_id}`),
      sweetness: numeric(p.sweetness, `bev_flavor_profiles.sweetness of ${p.bev_id}`),
      dairy: p.dairy,
      alcohol: p.alcohol,
      serve: p.serve,
      source: p.source,
    })),
    embeddings: rows.embeddings.map((e) => ({
      bevId: e.bev_id,
      embedding: parseEmbedding(e.embedding, `bev_embeddings.embedding of ${e.bev_id}`),
      model: e.model,
    })),
    edges: rows.edges.map((e) => {
      const what = `bev_edges (${e.src_bev_id}, ${e.dst_bev_id})`;
      const c = e.components ?? {};
      return {
        src: e.src_bev_id,
        dst: e.dst_bev_id,
        weight: numeric(e.weight, `${what} weight`),
        components: {
          tree: numeric(c.tree, `${what} components.tree`),
          content: numeric(c.content, `${what} components.content`),
          emb: numeric(c.emb, `${what} components.emb`),
          profile: numeric(c.profile, `${what} components.profile`),
          cop: numeric(c.cop, `${what} components.cop`),
        },
        version: e.version,
        computedAt: e.computed_at,
      };
    }),
    // No user id in any message: the position in the ordered read names the row.
    rankings: rows.rankings.map((r, i) => ({
      userId: r.user_id,
      bevId: r.bev_id,
      bucket: numeric(r.bucket, `rankings row ${i + 1} (Bev ${r.bev_id}) bucket`),
      score: numeric(r.score, `rankings row ${i + 1} (Bev ${r.bev_id}) score`),
      rankedAt: r.ranked_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface CategoryNode {
  id: string;
  name: string;
  isAlcoholic: boolean;
  sortOrder: number;
  /** 1 for a root, 2 for a leaf. */
  depth: 1 | 2;
  parentId: string | null;
}
export interface BrandNode {
  key: string;
  name: string;
}
export interface FlavorNode {
  name: string;
}
export interface NoteNode {
  token: string;
  bevCount: number;
}
export interface BevNode {
  id: string;
  name: string;
  brand: string | null;
  brandKey: string | null;
  flavor: string | null;
  /** The ROOT category. */
  categoryId: string;
  leafCategoryId: string | null;
  priceTier: number;
  /** The root category's flag. MANDATORY: graph-query treats a Bev without it as alcoholic. */
  isAlcoholic: boolean;
  isStarter: boolean;
  source: string;
  // -- from bev_flavor_profiles; all null when the Bev has no profile ---------
  base: string | null;
  carbonated: boolean | null;
  caffeine: number | null;
  sweetness: number | null;
  dairy: boolean | null;
  alcohol: boolean | null;
  serve: string | null;
  profileSource: string | null;
  // -- from bev_embeddings; both null when the Bev has no embedding -----------
  embedding: number[] | null;
  embeddingModel: string | null;
}
/** `(:User)` carries a pseudonym and NOTHING else. */
export interface UserNode {
  pseudonym: string;
}
/** A property-less relationship, keyed by its endpoints' keys. */
export interface Link {
  from: string;
  to: string;
}
export interface SimilarRel {
  src: string;
  dst: string;
  w: number;
  tree: number;
  content: number;
  emb: number;
  profile: number;
  cop: number;
  version: string;
  computedAt: string;
}
export interface RankedRel {
  pseudonym: string;
  bevId: string;
  score: number;
  z: number;
  bucket: number;
  rankedAt: string;
}
export interface PreferenceRel {
  pseudonym: string;
  bevId: string;
  w: number;
}

export interface GraphPlan {
  rankingVersion: string;
  /** The `version` the mirrored `bev_edges` rows carry (several, comma-joined, if a table ever mixes them). */
  edgesVersion: string;
  nodes: {
    categories: CategoryNode[];
    brands: BrandNode[];
    flavors: FlavorNode[];
    notes: NoteNode[];
    bevs: BevNode[];
    users: UserNode[];
  };
  relationships: {
    childOf: Link[];
    inCategory: Link[];
    byBrand: Link[];
    tastesOf: Link[];
    hasNote: Link[];
    similarTo: SimilarRel[];
    ranked: RankedRel[];
    likes: PreferenceRel[];
    dislikes: PreferenceRel[];
  };
  /** The MIRRORED labels and types only: what the analytics phase adds is counted by its `GraphStats`. */
  counts: {
    nodes: Record<MirroredLabel, number>;
    relationships: Record<MirroredType, number>;
    bevsWithEmbedding: number;
    bevsWithProfile: number;
  };
  /** What the source held that the graph deliberately does not. Counted and logged; none is an error. */
  dropped: {
    inactiveBevs: number;
    profilesOfInactiveBevs: number;
    embeddingsOfInactiveBevs: number;
    /** `bev_edges` rows with an endpoint that is no longer active (hidden since the last edges run). */
    edgesToInactiveBevs: number;
    rankingsOfInactiveBevs: number;
    /** Users whose every ranking is of an inactive Bev: no node. */
    usersWithoutActiveRanking: number;
    /** Tokens carried by fewer than NOTE_MIN_BEVS active Bevs. */
    notesBelowMinimum: number;
    /** Active Bevs whose leaf is not a child of their `category_id`. Mirrored as stored, and flagged. */
    leafParentMismatches: number;
  };
}

export interface PlanOptions {
  /** user id -> stable pseudonym. Injected: the HMAC and its salt live in the I/O half. */
  pseudonymOf: (userId: string) => string;
  rankingVersion: string;
}

/** 'likes' at z >= +0.25, 'dislikes' at z <= -0.25, null inside the dead band. Both bounds are inclusive. */
export function preferenceOf(z: number): "likes" | "dislikes" | null {
  if (z >= PREFERENCE_DEAD_BAND) return "likes";
  if (z <= -PREFERENCE_DEAD_BAND) return "dislikes";
  return null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A timestamptz as Cypher's `datetime()` will accept it. PostgREST's rendering
 * (`2026-11-09T04:51:07.123456+00:00`) passes through untouched, microseconds
 * and all; anything else that still parses is re-rendered as an ISO instant;
 * anything that does not parse throws.
 */
export function instant(value: unknown, what: string): string {
  if (typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) return value;
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) throw new RangeError(`${what} is not a timestamp: ${JSON.stringify(value)?.slice(0, 40)}`);
  return new Date(ms).toISOString();
}

function unit(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${what} must be a finite number in [0, 1], got ${String(value)}`);
  }
  return value;
}

function integerIn(value: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be an integer in ${min}..${max}, got ${String(value)}`);
  }
  return value;
}

/** Throws on the first key seen twice. `what` describes the collection; the key is printed unless `secret`. */
function unique<T>(items: readonly T[], keyOf: (item: T) => string, what: string, secret = false): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) throw new RangeError(`duplicate ${what}${secret ? "" : `: ${key}`}`);
    seen.add(key);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The whole graph, as data.
 *
 * VALIDATION THROWS, before anything is sent: a Bev whose `category_id` or
 * `leaf_category_id` is not in `categories`, a `category_id` that is not a
 * root, a category tree deeper than two levels, an edge with `src >= dst`, a
 * weight or component outside [0, 1] or non-finite, an embedding that is not
 * 384 finite numbers, and a duplicate key anywhere. A thrown plan writes
 * nothing, so yesterday's generation stays in place.
 *
 * WHAT IS DROPPED RATHER THAN THROWN, and counted in `dropped`: everything
 * that hangs off a Bev that is not `active`. `bev_edges` and `bev_embeddings`
 * outlive a Bev's status change until their own next run, and rankings can
 * point at a hidden Bev forever, so those are states, not errors.
 *
 * NO USER ID LEAVES THIS FUNCTION, in the plan or in an error message: the
 * plan holds pseudonyms only, and every throw on a ranking names the Bev.
 */
export function buildGraphPlan(source: GraphSource, options: PlanOptions): GraphPlan {
  // -- categories -----------------------------------------------------------
  unique(source.categories, (c) => c.id, "category id");
  const categoryById = new Map(source.categories.map((c) => [c.id, c]));
  const categories: CategoryNode[] = source.categories.map((c) => {
    let depth: 1 | 2 = 1;
    if (c.parentId !== null) {
      const parent = categoryById.get(c.parentId);
      if (parent === undefined) throw new RangeError(`category ${c.id} has a parent that is not in categories: ${c.parentId}`);
      if (parent.parentId !== null) {
        throw new RangeError(`category ${c.id} is three levels deep (its parent ${c.parentId} has a parent); the tree is exactly two`);
      }
      depth = 2;
    }
    if (typeof c.isAlcoholic !== "boolean") throw new RangeError(`category ${c.id} has no boolean is_alcoholic`);
    return {
      id: c.id,
      name: c.name,
      isAlcoholic: c.isAlcoholic,
      sortOrder: integerIn(c.sortOrder, -32768, 32767, `category ${c.id} sort_order`),
      depth,
      parentId: c.parentId,
    };
  });
  categories.sort((a, b) => cmp(a.id, b.id));

  // -- Bevs -----------------------------------------------------------------
  unique(source.bevs, (b) => b.id, "Bev id");
  const activeBevs = source.bevs.filter((b) => b.status === "active").sort((a, b) => cmp(a.id, b.id));
  const active = new Set(activeBevs.map((b) => b.id));

  unique(source.profiles, (p) => p.bevId, "flavour profile for Bev");
  unique(source.embeddings, (e) => e.bevId, "embedding for Bev");
  const profileOf = new Map(source.profiles.filter((p) => active.has(p.bevId)).map((p) => [p.bevId, p]));
  const embeddingOf = new Map(source.embeddings.filter((e) => active.has(e.bevId)).map((e) => [e.bevId, e]));

  for (const e of embeddingOf.values()) {
    if (e.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new RangeError(`embedding of Bev ${e.bevId} has ${e.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
    if (e.embedding.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
      throw new RangeError(`embedding of Bev ${e.bevId} has a non-finite component`);
    }
  }

  let leafParentMismatches = 0;
  const tokensOf = new Map<string, string[]>();
  const bevs: BevNode[] = activeBevs.map((b) => {
    const root = categoryById.get(b.categoryId);
    if (root === undefined) throw new RangeError(`Bev ${b.id} has a category_id that is not in categories: ${b.categoryId}`);
    if (root.parentId !== null) throw new RangeError(`Bev ${b.id} has a category_id that is not a root: ${b.categoryId}`);
    if (b.leafCategoryId !== null) {
      const leaf = categoryById.get(b.leafCategoryId);
      if (leaf === undefined) {
        throw new RangeError(`Bev ${b.id} has a leaf_category_id that is not in categories: ${b.leafCategoryId}`);
      }
      if (leaf.parentId !== b.categoryId) leafParentMismatches++;
    }
    const profile = profileOf.get(b.id);
    const embedding = embeddingOf.get(b.id);
    tokensOf.set(b.id, flavorTokens(b.name, b.flavor));
    return {
      id: b.id,
      name: b.name,
      brand: b.brand,
      brandKey: normaliseBrand(b.brand),
      flavor: b.flavor,
      categoryId: b.categoryId,
      leafCategoryId: b.leafCategoryId,
      priceTier: integerIn(b.priceTier, 1, 4, `Bev ${b.id} price_tier`),
      isAlcoholic: root.isAlcoholic,
      isStarter: b.isStarter,
      source: b.source,
      base: profile?.base ?? null,
      carbonated: profile?.carbonated ?? null,
      caffeine: profile === undefined ? null : integerIn(profile.caffeine, 0, 3, `Bev ${b.id} caffeine`),
      sweetness: profile === undefined ? null : integerIn(profile.sweetness, 0, 3, `Bev ${b.id} sweetness`),
      dairy: profile?.dairy ?? null,
      alcohol: profile?.alcohol ?? null,
      serve: profile?.serve ?? null,
      profileSource: profile?.source ?? null,
      embedding: embedding === undefined ? null : [...embedding.embedding],
      embeddingModel: embedding?.model ?? null,
    };
  });

  // -- brands: the key is normaliseBrand's, the name the commonest spelling ---
  const spellings = new Map<string, string[]>();
  for (const b of bevs) if (b.brandKey !== null) push(spellings, b.brandKey, (b.brand as string).trim());
  const brands: BrandNode[] = [...spellings].map(([key, names]) => {
    const tally = new Map<string, number>();
    for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1);
    // Most common first; a tie goes to the smaller spelling in code-unit order.
    const [name] = [...tally].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0] as [string, number];
    return { key, name };
  });
  brands.sort((a, b) => cmp(a.key, b.key));

  // -- flavours and notes ---------------------------------------------------
  const flavors: FlavorNode[] = [...new Set(bevs.flatMap((b) => (b.base === null ? [] : [b.base])))]
    .sort(cmp)
    .map((name) => ({ name }));

  const tokenCount = new Map<string, number>();
  for (const tokens of tokensOf.values()) for (const t of tokens) tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
  const notes: NoteNode[] = [...tokenCount]
    .filter(([, n]) => n >= NOTE_MIN_BEVS)
    .map(([token, bevCount]) => ({ token, bevCount }))
    .sort((a, b) => cmp(a.token, b.token));
  const keptToken = new Set(notes.map((n) => n.token));

  // -- catalog relationships ------------------------------------------------
  const childOf: Link[] = categories.flatMap((c) => (c.parentId === null ? [] : [{ from: c.id, to: c.parentId }]));
  // Exactly ONE per Bev, to the MOST SPECIFIC node: its leaf when it has one,
  // else its root. `treeNodeOf` is the function the tree term of `bev_edges`
  // is measured with, so the graph's shape and the weights agree by construction.
  const inCategory: Link[] = bevs.map((b) => ({ from: b.id, to: treeNodeOf(b) }));
  const byBrand: Link[] = bevs.flatMap((b) => (b.brandKey === null ? [] : [{ from: b.id, to: b.brandKey }]));
  const tastesOf: Link[] = bevs.flatMap((b) => (b.base === null ? [] : [{ from: b.id, to: b.base }]));
  const hasNote: Link[] = bevs.flatMap((b) =>
    (tokensOf.get(b.id) as string[]).filter((t) => keptToken.has(t)).map((t) => ({ from: b.id, to: t })),
  );
  // Bevs are in id order and each one's tokens are sorted, so this is already
  // (from, to) order; sorted anyway so the property does not rest on that.
  hasNote.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));

  // -- SIMILAR_TO: bev_edges, row for row -----------------------------------
  let edgesToInactiveBevs = 0;
  const similarTo: SimilarRel[] = [];
  unique(source.edges, (e) => `${e.src}|${e.dst}`, "bev_edges pair");
  for (const e of source.edges) {
    const what = `bev_edges (${e.src}, ${e.dst})`;
    if (!(e.src < e.dst)) throw new RangeError(`${what} is not oriented src < dst`);
    const rel: SimilarRel = {
      src: e.src,
      dst: e.dst,
      w: unit(e.weight, `${what} weight`),
      tree: unit(e.components.tree, `${what} components.tree`),
      content: unit(e.components.content, `${what} components.content`),
      emb: unit(e.components.emb, `${what} components.emb`),
      profile: unit(e.components.profile, `${what} components.profile`),
      cop: unit(e.components.cop, `${what} components.cop`),
      version: e.version,
      computedAt: instant(e.computedAt, `${what} computed_at`),
    };
    if (!active.has(e.src) || !active.has(e.dst)) {
      edgesToInactiveBevs++;
      continue;
    }
    similarTo.push(rel);
  }
  similarTo.sort((a, b) => cmp(a.src, b.src) || cmp(a.dst, b.dst));
  const edgesVersion = [...new Set(similarTo.map((e) => e.version))].sort(cmp).join(",");

  // -- users: RANKED, LIKES, DISLIKES ---------------------------------------
  // In (user, Bev) order first -- the order of the paged read -- because a mean
  // and a deviation are floating-point sums and depend on the order they are
  // taken in. Sorting here makes every z a function of the SET of rankings.
  const rankings = [...source.rankings].sort((a, b) => cmp(a.userId, b.userId) || cmp(a.bevId, b.bevId));
  // Checked here, with messages that name the Bev only, so the two throws
  // inside `zScoresFromRankings` -- which print the user id -- can never fire.
  unique(rankings, (r) => `${r.userId}|${r.bevId}`, "ranking (one user ranked one Bev twice)", true);
  rankings.forEach((r, i) => {
    const what = `rankings row ${i + 1} (Bev ${r.bevId})`;
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) throw new RangeError(`${what} has a non-finite score`);
    integerIn(r.bucket, 1, 3, `${what} bucket`);
  });

  // z from EVERY ranking, active Bev or not, called ONCE (`activeZScores`
  // documents the rule): a hidden Bev's ranking still moves its rater's mu and
  // sigma, exactly as in `get_prediction_snapshot`, but is never an edge.
  const z = activeZScores(
    rankings.map((r) => ({ userId: r.userId, bevId: r.bevId, score: r.score, active: active.has(r.bevId) })),
  );

  const pseudonyms = new Map<string, string>();
  for (const userId of z.keys()) {
    const pseudonym = options.pseudonymOf(userId);
    if (typeof pseudonym !== "string" || pseudonym === "") throw new RangeError("pseudonymOf returned an empty pseudonym");
    if (pseudonym.includes(userId)) throw new RangeError("pseudonymOf returned a pseudonym that contains the user id");
    pseudonyms.set(userId, pseudonym);
  }
  unique([...pseudonyms.values()], (p) => p, "pseudonym (two users map to one)", true);

  const ranked: RankedRel[] = [];
  const likes: PreferenceRel[] = [];
  const dislikes: PreferenceRel[] = [];
  let rankingsOfInactiveBevs = 0;
  rankings.forEach((r, i) => {
    if (!active.has(r.bevId)) {
      rankingsOfInactiveBevs++;
      return;
    }
    const pseudonym = pseudonyms.get(r.userId) as string;
    const zu = z.get(r.userId)?.get(r.bevId);
    if (zu === undefined || !Number.isFinite(zu)) throw new RangeError(`no finite z for rankings row ${i + 1} (Bev ${r.bevId})`);
    ranked.push({
      pseudonym,
      bevId: r.bevId,
      score: r.score,
      z: zu,
      bucket: r.bucket,
      rankedAt: instant(r.rankedAt, `rankings row ${i + 1} (Bev ${r.bevId}) ranked_at`),
    });
    const preference = preferenceOf(zu);
    if (preference === "likes") likes.push({ pseudonym, bevId: r.bevId, w: zu });
    else if (preference === "dislikes") dislikes.push({ pseudonym, bevId: r.bevId, w: -zu });
  });
  const byUserThenBev = (a: { pseudonym: string; bevId: string }, b: { pseudonym: string; bevId: string }) =>
    cmp(a.pseudonym, b.pseudonym) || cmp(a.bevId, b.bevId);
  ranked.sort(byUserThenBev);
  likes.sort(byUserThenBev);
  dislikes.sort(byUserThenBev);
  const users: UserNode[] = [...pseudonyms.values()].sort(cmp).map((pseudonym) => ({ pseudonym }));

  return {
    rankingVersion: options.rankingVersion,
    edgesVersion,
    nodes: { categories, brands, flavors, notes, bevs, users },
    relationships: { childOf, inCategory, byBrand, tastesOf, hasNote, similarTo, ranked, likes, dislikes },
    counts: {
      nodes: {
        Bev: bevs.length,
        Category: categories.length,
        Brand: brands.length,
        Flavor: flavors.length,
        Note: notes.length,
        User: users.length,
      },
      relationships: {
        CHILD_OF: childOf.length,
        IN_CATEGORY: inCategory.length,
        BY_BRAND: byBrand.length,
        TASTES_OF: tastesOf.length,
        HAS_NOTE: hasNote.length,
        SIMILAR_TO: similarTo.length,
        RANKED: ranked.length,
        LIKES: likes.length,
        DISLIKES: dislikes.length,
      },
      bevsWithEmbedding: bevs.filter((b) => b.embedding !== null).length,
      bevsWithProfile: bevs.filter((b) => b.base !== null).length,
    },
    dropped: {
      inactiveBevs: source.bevs.length - activeBevs.length,
      profilesOfInactiveBevs: source.profiles.length - profileOf.size,
      embeddingsOfInactiveBevs: source.embeddings.length - embeddingOf.size,
      edgesToInactiveBevs,
      rankingsOfInactiveBevs,
      usersWithoutActiveRanking: new Set(source.rankings.map((r) => r.userId)).size - users.length,
      notesBelowMinimum: tokenCount.size - notes.length,
      leafParentMismatches,
    },
  };
}

/**
 * Exact name, then the lowest-id case-insensitive substring match, then
 * nothing: the rule `findBev` in build-edges.ts uses, so "a matcha" resolves to
 * the same Bev in both jobs' reports.
 */
export function findBevByName(bevs: readonly BevNode[], name: string): BevNode | undefined {
  const exact = bevs.find((b) => b.name === name);
  if (exact !== undefined) return exact;
  const needle = name.toLowerCase();
  return bevs.filter((b) => b.name.toLowerCase().includes(needle)).sort((a, b) => cmp(a.id, b.id))[0];
}

/** `rows` in consecutive slices of at most `size`. An empty input is no slices, so nothing is sent for it. */
export function chunk<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Cypher: upserts
// ---------------------------------------------------------------------------
//
// Nodes: `MERGE` on the key, then `SET n = { ... }`, which REPLACES the whole
// property map -- so a property that disappeared in Postgres (a profile
// deleted, an embedding gone) disappears in the graph too. A null in the map is
// simply not stored. Each map carries `syncId`, the stamp the sweep reads.
//
// Relationships: `MATCH` both endpoints, `MERGE` the pattern, replace its
// properties the same way. A row whose endpoint does not exist matches nothing
// and writes nothing; the verification counts are what catch that.

export const UPSERT_CATEGORIES = `
UNWIND $rows AS row
MERGE (c:Category { id: row.id })
SET c = {
  id: row.id,
  name: row.name,
  isAlcoholic: row.isAlcoholic,
  sortOrder: toInteger(row.sortOrder),
  depth: toInteger(row.depth),
  parentId: row.parentId,
  syncId: $syncId
}`;

export const UPSERT_BRANDS = `
UNWIND $rows AS row
MERGE (br:Brand { key: row.key })
SET br = { key: row.key, name: row.name, syncId: $syncId }`;

export const UPSERT_FLAVORS = `
UNWIND $rows AS row
MERGE (f:Flavor { name: row.name })
SET f = { name: row.name, syncId: $syncId }`;

export const UPSERT_NOTES = `
UNWIND $rows AS row
MERGE (n:Note { token: row.token })
SET n = { token: row.token, bevCount: toInteger(row.bevCount), syncId: $syncId }`;

/** `pseudonym` and the sync stamp. NOTHING ELSE is ever written to a `(:User)`. */
export const UPSERT_USERS = `
UNWIND $rows AS row
MERGE (u:User { pseudonym: row.pseudonym })
SET u = { pseudonym: row.pseudonym, syncId: $syncId }`;

export const UPSERT_BEVS = `
UNWIND $rows AS row
MERGE (b:Bev { id: row.id })
SET b = {
  id: row.id,
  name: row.name,
  brand: row.brand,
  brandKey: row.brandKey,
  flavor: row.flavor,
  categoryId: row.categoryId,
  leafCategoryId: row.leafCategoryId,
  priceTier: toInteger(row.priceTier),
  isAlcoholic: row.isAlcoholic,
  isStarter: row.isStarter,
  source: row.source,
  base: row.base,
  carbonated: row.carbonated,
  caffeine: toInteger(row.caffeine),
  sweetness: toInteger(row.sweetness),
  dairy: row.dairy,
  alcohol: row.alcohol,
  serve: row.serve,
  profileSource: row.profileSource,
  embedding: CASE WHEN row.embedding IS NULL THEN null ELSE [x IN row.embedding | toFloat(x)] END,
  embeddingModel: row.embeddingModel,
  syncId: $syncId
}`;

export const UPSERT_CHILD_OF = `
UNWIND $rows AS row
MATCH (c:Category { id: row.from })
MATCH (p:Category { id: row.to })
MERGE (c)-[r:CHILD_OF]->(p)
SET r = { syncId: $syncId }`;

export const UPSERT_IN_CATEGORY = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.from })
MATCH (c:Category { id: row.to })
MERGE (b)-[r:IN_CATEGORY]->(c)
SET r = { syncId: $syncId }`;

export const UPSERT_BY_BRAND = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.from })
MATCH (br:Brand { key: row.to })
MERGE (b)-[r:BY_BRAND]->(br)
SET r = { syncId: $syncId }`;

export const UPSERT_TASTES_OF = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.from })
MATCH (f:Flavor { name: row.to })
MERGE (b)-[r:TASTES_OF]->(f)
SET r = { syncId: $syncId }`;

export const UPSERT_HAS_NOTE = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.from })
MATCH (n:Note { token: row.to })
MERGE (b)-[r:HAS_NOTE]->(n)
SET r = { syncId: $syncId }`;

/** Written ONLY in the direction src.id < dst.id, which the plan has already validated; read undirected. */
export const UPSERT_SIMILAR_TO = `
UNWIND $rows AS row
MATCH (a:Bev { id: row.src })
MATCH (b:Bev { id: row.dst })
MERGE (a)-[s:SIMILAR_TO]->(b)
SET s = {
  w: toFloat(row.w),
  tree: toFloat(row.tree),
  content: toFloat(row.content),
  emb: toFloat(row.emb),
  profile: toFloat(row.profile),
  cop: toFloat(row.cop),
  version: row.version,
  computedAt: datetime(row.computedAt),
  syncId: $syncId
}`;

export const UPSERT_RANKED = `
UNWIND $rows AS row
MATCH (u:User { pseudonym: row.pseudonym })
MATCH (b:Bev { id: row.bevId })
MERGE (u)-[r:RANKED]->(b)
SET r = {
  score: toFloat(row.score),
  z: toFloat(row.z),
  bucket: toInteger(row.bucket),
  rankedAt: datetime(row.rankedAt),
  syncId: $syncId
}`;

export const UPSERT_LIKES = `
UNWIND $rows AS row
MATCH (u:User { pseudonym: row.pseudonym })
MATCH (b:Bev { id: row.bevId })
MERGE (u)-[r:LIKES]->(b)
SET r = { w: toFloat(row.w), syncId: $syncId }`;

export const UPSERT_DISLIKES = `
UNWIND $rows AS row
MATCH (u:User { pseudonym: row.pseudonym })
MATCH (b:Bev { id: row.bevId })
MERGE (u)-[r:DISLIKES]->(b)
SET r = { w: toFloat(row.w), syncId: $syncId }`;

export interface WriteStep {
  name: string;
  statement: string;
  rows: readonly unknown[];
  batchSize: number;
}

/**
 * The upserts in the order they must run: every node label first, then the
 * relationships that MATCH them. Bevs go 100 to a request because each row can
 * carry a 384-float embedding.
 */
export function writeSteps(plan: GraphPlan): WriteStep[] {
  const { nodes, relationships: r } = plan;
  return [
    { name: "Category", statement: UPSERT_CATEGORIES, rows: nodes.categories, batchSize: BATCH.nodes },
    { name: "Brand", statement: UPSERT_BRANDS, rows: nodes.brands, batchSize: BATCH.nodes },
    { name: "Flavor", statement: UPSERT_FLAVORS, rows: nodes.flavors, batchSize: BATCH.nodes },
    { name: "Note", statement: UPSERT_NOTES, rows: nodes.notes, batchSize: BATCH.nodes },
    { name: "User", statement: UPSERT_USERS, rows: nodes.users, batchSize: BATCH.nodes },
    { name: "Bev", statement: UPSERT_BEVS, rows: nodes.bevs, batchSize: BATCH.embeddings },
    { name: "CHILD_OF", statement: UPSERT_CHILD_OF, rows: r.childOf, batchSize: BATCH.relationships },
    { name: "IN_CATEGORY", statement: UPSERT_IN_CATEGORY, rows: r.inCategory, batchSize: BATCH.relationships },
    { name: "BY_BRAND", statement: UPSERT_BY_BRAND, rows: r.byBrand, batchSize: BATCH.relationships },
    { name: "TASTES_OF", statement: UPSERT_TASTES_OF, rows: r.tastesOf, batchSize: BATCH.relationships },
    { name: "HAS_NOTE", statement: UPSERT_HAS_NOTE, rows: r.hasNote, batchSize: BATCH.relationships },
    { name: "SIMILAR_TO", statement: UPSERT_SIMILAR_TO, rows: r.similarTo, batchSize: BATCH.relationships },
    { name: "RANKED", statement: UPSERT_RANKED, rows: r.ranked, batchSize: BATCH.relationships },
    { name: "LIKES", statement: UPSERT_LIKES, rows: r.likes, batchSize: BATCH.relationships },
    { name: "DISLIKES", statement: UPSERT_DISLIKES, rows: r.dislikes, batchSize: BATCH.relationships },
  ];
}

// ---------------------------------------------------------------------------
// Cypher: the analytics phase (A-16 (4))
// ---------------------------------------------------------------------------
//
// After the mirror sweep the transaction holds exactly this generation, and
// the graph is READ BACK: the signals are computed from what the graph holds,
// not from the plan the graph was written from. All three reads are ordered,
// so the rows arrive in the same order every night (the package functions do
// not depend on it; a reader of two logs does).

export const READ_BEV_IDS = `
MATCH (b:Bev)
RETURN b.id AS id
ORDER BY b.id`;

/** Every edge once, in the stored direction `a.id < b.id`. About 4,700 rows in one response. */
export const READ_SIMILAR_TO = `
MATCH (a:Bev)-[s:SIMILAR_TO]->(b:Bev)
RETURN a.id AS a, b.id AS b, s.w AS w
ORDER BY a.id, b.id`;

/**
 * Each Bev's flavour base and notes, as `{ node, attribute }` rows: what the
 * taste families are clustered on (`flavourProjection` in analytics-core.ts).
 * Cypher only EXTRACTS the memberships; the weights of the projection are
 * `attributeProjection`'s in @bevi/ranking.
 *
 * THE CATCH-ALL BASE `other` IS LEFT OUT. It is not a flavour -- it is where a
 * Bev goes when no base fits -- and joining Bevs through it would glue
 * unrelated drinks into one family. A Bev whose base is `other`, or that has
 * no profile at all, is placed by its notes alone.
 *
 * The `UNION ALL` sits in a subquery because an `ORDER BY` after a bare
 * `UNION` orders only its last branch.
 */
export const READ_BEV_ATTRIBUTES = `
CALL () {
  MATCH (b:Bev)-[:TASTES_OF]->(f:Flavor)
  WHERE f.name <> 'other'
  RETURN b.id AS node, 'flavor:' + f.name AS attribute
  UNION ALL
  MATCH (b:Bev)-[:HAS_NOTE]->(n:Note)
  RETURN b.id AS node, 'note:' + n.token AS attribute
}
RETURN node, attribute
ORDER BY node, attribute`;

/**
 * The memberships `READ_BEV_ATTRIBUTES` must hand back for this plan, in
 * (node, attribute) order: one `flavor:<base>` per `TASTES_OF` that is not the
 * catch-all, one `note:<token>` per `HAS_NOTE`. The sync compares the COUNT
 * with what the graph returned before it clusters anything; the tests use the
 * rows as the graph's answer.
 */
export function expectedMemberships(plan: GraphPlan): Membership[] {
  const rows: Membership[] = [
    ...plan.relationships.tastesOf
      .filter((link) => link.to !== CATCH_ALL_FLAVOR)
      .map((link) => ({ node: link.from, attribute: `flavor:${link.to}` })),
    ...plan.relationships.hasNote.map((link) => ({ node: link.from, attribute: `note:${link.to}` })),
  ];
  return rows.sort((x, y) => cmp(x.node, y.node) || cmp(x.attribute, y.attribute));
}

/**
 * The five computed properties of a `(:Bev)`. NOT part of `UPSERT_BEVS`:
 * that statement runs before the graph can be read back, and its `SET b = {}`
 * REPLACES the property map, so each run starts every Bev without these five
 * and this statement sets them afresh. A Bev it does not reach keeps none, and
 * the verification counts it.
 */
export const SET_BEV_GRAPH_STATS = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.id })
SET b.pagerank = toFloat(row.pagerank),
    b.strength = toFloat(row.strength),
    b.degree = toInteger(row.degree),
    b.bridge = toFloat(row.bridge),
    b.community = row.community`;

/** `id` is the OPAQUE community id (analytics-core.ts). The hub is marked on the relationship, never named here. */
export const UPSERT_COMMUNITIES = `
UNWIND $rows AS row
MERGE (c:Community { id: row.id })
SET c = { id: row.id, size: toInteger(row.size), syncId: $syncId }`;

export const UPSERT_IN_COMMUNITY = `
UNWIND $rows AS row
MATCH (b:Bev { id: row.from })
MATCH (c:Community { id: row.to })
MERGE (b)-[r:IN_COMMUNITY]->(c)
SET r = { hub: row.hub, syncId: $syncId }`;

/** The analytics writes in the order they must run: properties, then the nodes the relationships MATCH. */
export function analyticsWriteSteps(writes: GraphStatsWrites): WriteStep[] {
  return [
    { name: "Bev stats", statement: SET_BEV_GRAPH_STATS, rows: writes.bevs, batchSize: BATCH.nodes },
    { name: "Community", statement: UPSERT_COMMUNITIES, rows: writes.communities, batchSize: BATCH.nodes },
    { name: "IN_COMMUNITY", statement: UPSERT_IN_COMMUNITY, rows: writes.inCommunity, batchSize: BATCH.relationships },
  ];
}

// ---------------------------------------------------------------------------
// Cypher: the sweep
// ---------------------------------------------------------------------------
//
// Everything the upserts touched now carries this run's `syncId`. Whatever of
// an OWNED type or label does not -- a ranking that was removed, a Bev that
// was hidden or merged, a relationship that moved to another node, or anything
// written before stamps existed -- is stale, and goes. Relationships first, so
// the node sweep's DETACH has little left to do. `(:Meta)` is not an owned
// label and no statement here can match it.
//
// THE SWEEP RUNS IN TWO PARTS, AND THE ORDER IS LOAD-BEARING.
//
//   1. `sweepSteps()`, the MIRRORED types and labels, straight after the
//      upserts and BEFORE the analytics phase. The analytics phase reads the
//      graph back, so by then the transaction must hold this generation and
//      nothing else: a Bev hidden yesterday, or an edge that dropped out of
//      `bev_edges`, would otherwise be ranked and clustered with the rest.
//      (That is why "move the whole sweep after the analytics" is wrong.)
//   2. `analyticsSweepSteps()`, `IN_COMMUNITY` and `Community`, AFTER the
//      analytics writes have stamped tonight's. A Bev that changed community
//      keeps its old relationship until this deletes it, and a community that
//      no longer exists (its hub changed, so its id did) keeps its node.
//
// Sweeping the two computed ones in part 1 as well would also work -- nothing
// of them carries this run's stamp yet, so it would delete them all and the
// writes would recreate them -- but it would make "stamp, then sweep what was
// not stamped" mean something different for one label, and it would give
// every `(:Community)` a new node every night instead of keeping the ones
// that survive.

export const SWEEP_RELATIONSHIPS: Record<OwnedType, string> = {
  CHILD_OF: "MATCH ()-[r:CHILD_OF]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  IN_CATEGORY: "MATCH ()-[r:IN_CATEGORY]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  BY_BRAND: "MATCH ()-[r:BY_BRAND]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  TASTES_OF: "MATCH ()-[r:TASTES_OF]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  HAS_NOTE: "MATCH ()-[r:HAS_NOTE]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  SIMILAR_TO: "MATCH ()-[r:SIMILAR_TO]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  RANKED: "MATCH ()-[r:RANKED]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  LIKES: "MATCH ()-[r:LIKES]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  DISLIKES: "MATCH ()-[r:DISLIKES]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
  IN_COMMUNITY: "MATCH ()-[r:IN_COMMUNITY]->() WHERE r.syncId IS NULL OR r.syncId <> $syncId DELETE r",
};

export const SWEEP_NODES: Record<OwnedLabel, string> = {
  Bev: "MATCH (n:Bev) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  Category: "MATCH (n:Category) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  Brand: "MATCH (n:Brand) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  Flavor: "MATCH (n:Flavor) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  Note: "MATCH (n:Note) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  User: "MATCH (n:User) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
  Community: "MATCH (n:Community) WHERE n.syncId IS NULL OR n.syncId <> $syncId DETACH DELETE n",
};

/** Part 1, before the analytics phase: every MIRRORED relationship type, then every MIRRORED label. */
export function sweepSteps(): Array<{ name: string; statement: string }> {
  return [
    ...MIRRORED_TYPES.map((type) => ({ name: type, statement: SWEEP_RELATIONSHIPS[type] })),
    ...MIRRORED_LABELS.map((label) => ({ name: label, statement: SWEEP_NODES[label] })),
  ];
}

/** Part 2, after the analytics writes: the COMPUTED relationship type, then the COMPUTED label. */
export function analyticsSweepSteps(): Array<{ name: string; statement: string }> {
  return [
    ...COMPUTED_TYPES.map((type) => ({ name: type, statement: SWEEP_RELATIONSHIPS[type] })),
    ...COMPUTED_LABELS.map((label) => ({ name: label, statement: SWEEP_NODES[label] })),
  ];
}

// ---------------------------------------------------------------------------
// Cypher: verification (read back inside the transaction, before the commit)
// ---------------------------------------------------------------------------

/**
 * One row per owned label and type: what the graph holds right now.
 *
 * Every branch aggregates in a `WITH` that has NO grouping key and only then
 * names the row. `RETURN 'x' AS name, count(n) AS n` groups by the literal,
 * and a grouped aggregation over zero matches returns zero ROWS rather than a
 * row saying 0 -- so "no users yet", or an invariant with no violations,
 * would read as a check that never answered. (Measured against 5.27-aura: the
 * first live dry run failed on exactly that.)
 */
export const VERIFY_COUNTS = `
MATCH (n:Bev) WITH count(n) AS n RETURN 'nodes.Bev' AS name, n
UNION ALL MATCH (n:Category) WITH count(n) AS n RETURN 'nodes.Category' AS name, n
UNION ALL MATCH (n:Brand) WITH count(n) AS n RETURN 'nodes.Brand' AS name, n
UNION ALL MATCH (n:Flavor) WITH count(n) AS n RETURN 'nodes.Flavor' AS name, n
UNION ALL MATCH (n:Note) WITH count(n) AS n RETURN 'nodes.Note' AS name, n
UNION ALL MATCH (n:User) WITH count(n) AS n RETURN 'nodes.User' AS name, n
UNION ALL MATCH (n:Community) WITH count(n) AS n RETURN 'nodes.Community' AS name, n
UNION ALL MATCH ()-[r:CHILD_OF]->() WITH count(r) AS n RETURN 'relationships.CHILD_OF' AS name, n
UNION ALL MATCH ()-[r:IN_CATEGORY]->() WITH count(r) AS n RETURN 'relationships.IN_CATEGORY' AS name, n
UNION ALL MATCH ()-[r:BY_BRAND]->() WITH count(r) AS n RETURN 'relationships.BY_BRAND' AS name, n
UNION ALL MATCH ()-[r:TASTES_OF]->() WITH count(r) AS n RETURN 'relationships.TASTES_OF' AS name, n
UNION ALL MATCH ()-[r:HAS_NOTE]->() WITH count(r) AS n RETURN 'relationships.HAS_NOTE' AS name, n
UNION ALL MATCH ()-[r:SIMILAR_TO]->() WITH count(r) AS n RETURN 'relationships.SIMILAR_TO' AS name, n
UNION ALL MATCH ()-[r:RANKED]->() WITH count(r) AS n RETURN 'relationships.RANKED' AS name, n
UNION ALL MATCH ()-[r:LIKES]->() WITH count(r) AS n RETURN 'relationships.LIKES' AS name, n
UNION ALL MATCH ()-[r:DISLIKES]->() WITH count(r) AS n RETURN 'relationships.DISLIKES' AS name, n
UNION ALL MATCH ()-[r:IN_COMMUNITY]->() WITH count(r) AS n RETURN 'relationships.IN_COMMUNITY' AS name, n`;

/**
 * The invariants a count cannot see. Every row but `bevs with an embedding` is
 * a count of VIOLATIONS and must be 0.
 *
 * The `stored` rows are the float-coercion rule, read back: a value written
 * without `toFloat`/`toInteger` would be stored with whatever type its JSON
 * rendering happened to have, and these would count it.
 *
 * The last seven are the analytics phase's (A-16 (4)). The PageRank one is a
 * count of violations like the rest: the single row holding the sum survives
 * the `WHERE` only when the sum is more than 1e-6 from 1, and the count over
 * what survives is 0 or 1. Neo4j adds the 385 floats in its own order, which
 * is why the bound is 1e-6 here and 1e-9 in analytics-core.ts.
 */
export const VERIFY_INVARIANTS = `
MATCH (a:Bev)-[:SIMILAR_TO]->(b:Bev) WHERE a.id >= b.id
WITH count(*) AS n RETURN 'SIMILAR_TO not oriented src.id < dst.id' AS name, n
UNION ALL
MATCH (b:Bev) WHERE b.isAlcoholic IS NULL
WITH count(b) AS n RETURN 'Bevs without isAlcoholic' AS name, n
UNION ALL
MATCH (b:Bev) WHERE COUNT { (b)-[:IN_CATEGORY]->(:Category) } <> 1
WITH count(b) AS n RETURN 'Bevs without exactly one IN_CATEGORY' AS name, n
UNION ALL
MATCH (b:Bev) WHERE b.embedding IS NOT NULL
WITH count(b) AS n RETURN 'bevs with an embedding' AS name, n
UNION ALL
MATCH (b:Bev) WHERE b.embedding IS NOT NULL
  AND (size(b.embedding) <> 384 OR NOT b.embedding IS :: LIST<FLOAT NOT NULL> NOT NULL)
WITH count(b) AS n RETURN 'embeddings not stored as 384 floats' AS name, n
UNION ALL
MATCH (u:User) WHERE any(k IN keys(u) WHERE NOT k IN ['pseudonym', 'syncId'])
WITH count(u) AS n RETURN 'Users with a property other than pseudonym and syncId' AS name, n
UNION ALL
MATCH ()-[s:SIMILAR_TO]->()
WHERE NOT (s.w IS :: FLOAT NOT NULL AND s.tree IS :: FLOAT NOT NULL AND s.content IS :: FLOAT NOT NULL
  AND s.emb IS :: FLOAT NOT NULL AND s.profile IS :: FLOAT NOT NULL AND s.cop IS :: FLOAT NOT NULL)
WITH count(s) AS n RETURN 'SIMILAR_TO terms not stored as floats' AS name, n
UNION ALL
MATCH ()-[r:RANKED]->()
WHERE NOT (r.score IS :: FLOAT NOT NULL AND r.z IS :: FLOAT NOT NULL AND r.bucket IS :: INTEGER NOT NULL)
WITH count(r) AS n RETURN 'RANKED score, z or bucket stored with the wrong type' AS name, n
UNION ALL
MATCH (b:Bev) WHERE COUNT { (b)-[:IN_COMMUNITY]->(:Community) } <> 1
WITH count(b) AS n RETURN 'Bevs without exactly one IN_COMMUNITY' AS name, n
UNION ALL
MATCH (c:Community) WHERE COUNT { (:Bev)-[:IN_COMMUNITY { hub: true }]->(c) } <> 1
WITH count(c) AS n RETURN 'Communities without exactly one hub' AS name, n
UNION ALL
MATCH (c:Community) WHERE NOT c.size IS :: INTEGER NOT NULL OR c.size <> COUNT { (:Bev)-[:IN_COMMUNITY]->(c) }
WITH count(c) AS n RETURN 'Communities whose size is not their member count' AS name, n
UNION ALL
MATCH (b:Bev)-[:IN_COMMUNITY]->(c:Community) WHERE b.community IS NULL OR b.community <> c.id
WITH count(b) AS n RETURN 'Bevs whose community property is not their IN_COMMUNITY target' AS name, n
UNION ALL
MATCH (b:Bev)
WHERE NOT (b.pagerank IS :: FLOAT NOT NULL AND b.strength IS :: FLOAT NOT NULL AND b.bridge IS :: FLOAT NOT NULL
  AND b.degree IS :: INTEGER NOT NULL AND b.community IS :: STRING NOT NULL)
WITH count(b) AS n RETURN 'Bev pagerank, strength, bridge, degree or community stored with the wrong type' AS name, n
UNION ALL
MATCH ()-[r:IN_COMMUNITY]->() WHERE NOT r.hub IS :: BOOLEAN NOT NULL
WITH count(r) AS n RETURN 'IN_COMMUNITY hub not stored as a boolean' AS name, n
UNION ALL
MATCH (b:Bev) WITH sum(b.pagerank) AS total WHERE abs(total - 1.0) > 0.000001
WITH count(*) AS n RETURN 'Bev pagerank not summing to 1 within 1e-6' AS name, n`;

/** One count per owned label and type: the plan's for the mirrored ones, the analytics phase's for the computed. */
export function ownedCounts(plan: GraphPlan, stats: GraphStats): Record<OwnedLabel | OwnedType, number> {
  return {
    ...plan.counts.nodes,
    ...plan.counts.relationships,
    Community: stats.counts.communities,
    // Exactly one per Bev the analytics phase saw.
    IN_COMMUNITY: stats.counts.bevs,
  };
}

/**
 * Every name the two verification statements return, with the number each
 * must equal: the plan's counts for what was mirrored, `stats`' for what the
 * analytics phase computed from the graph.
 */
export function expectedVerification(plan: GraphPlan, stats: GraphStats): Record<string, number> {
  const counts = ownedCounts(plan, stats);
  const expected: Record<string, number> = {};
  for (const label of OWNED_LABELS) expected[`nodes.${label}`] = counts[label];
  for (const type of OWNED_TYPES) expected[`relationships.${type}`] = counts[type];
  expected["SIMILAR_TO not oriented src.id < dst.id"] = 0;
  expected["Bevs without isAlcoholic"] = 0;
  expected["Bevs without exactly one IN_CATEGORY"] = 0;
  expected["bevs with an embedding"] = plan.counts.bevsWithEmbedding;
  expected["embeddings not stored as 384 floats"] = 0;
  expected["Users with a property other than pseudonym and syncId"] = 0;
  expected["SIMILAR_TO terms not stored as floats"] = 0;
  expected["RANKED score, z or bucket stored with the wrong type"] = 0;
  expected["Bevs without exactly one IN_COMMUNITY"] = 0;
  expected["Communities without exactly one hub"] = 0;
  expected["Communities whose size is not their member count"] = 0;
  expected["Bevs whose community property is not their IN_COMMUNITY target"] = 0;
  expected["Bev pagerank, strength, bridge, degree or community stored with the wrong type"] = 0;
  expected["IN_COMMUNITY hub not stored as a boolean"] = 0;
  expected["Bev pagerank not summing to 1 within 1e-6"] = 0;
  return expected;
}

/**
 * Compares what the graph answered with what the plan requires. Returns one
 * line per failing check, naming it and BOTH numbers; an empty array is a
 * pass. A check the graph did not answer at all is a failure too.
 */
export function verificationFailures(
  plan: GraphPlan,
  stats: GraphStats,
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const actual = new Map<string, unknown>();
  for (const row of rows) actual.set(String(row.name), row.n);
  const failures: string[] = [];
  for (const [name, expected] of Object.entries(expectedVerification(plan, stats))) {
    const got = actual.get(name);
    if (got === undefined) failures.push(`${name}: the graph returned no row, expected ${expected}`);
    else if (got !== expected) failures.push(`${name}: the graph has ${String(got)}, the plan has ${expected}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Cypher: (:Meta)
// ---------------------------------------------------------------------------

/**
 * The last statement before the commit. Individual `SET`s, not a map replace:
 * `lastKeepAliveAt` belongs to keepalive.ts and must survive.
 */
export const STAMP_META = `
MERGE (m:Meta { key: 'singleton' })
SET m.lastSyncAt = datetime(),
    m.lastAttemptAt = datetime(),
    m.lastAttemptOk = true,
    m.syncId = $syncId,
    m.rankingVersion = $rankingVersion,
    m.edgesVersion = $edgesVersion,
    m.bevCount = toInteger($counts.Bev),
    m.categoryCount = toInteger($counts.Category),
    m.brandCount = toInteger($counts.Brand),
    m.flavorCount = toInteger($counts.Flavor),
    m.noteCount = toInteger($counts.Note),
    m.userCount = toInteger($counts.User),
    m.childOfCount = toInteger($counts.CHILD_OF),
    m.inCategoryCount = toInteger($counts.IN_CATEGORY),
    m.byBrandCount = toInteger($counts.BY_BRAND),
    m.tastesOfCount = toInteger($counts.TASTES_OF),
    m.hasNoteCount = toInteger($counts.HAS_NOTE),
    m.similarToCount = toInteger($counts.SIMILAR_TO),
    m.rankedCount = toInteger($counts.RANKED),
    m.likesCount = toInteger($counts.LIKES),
    m.dislikesCount = toInteger($counts.DISLIKES),
    m.communityCount = toInteger($counts.Community),
    m.inCommunityCount = toInteger($counts.IN_COMMUNITY),
    m.modularity = toFloat($modularity),
    m.analyticsVersion = $analyticsVersion`;

/**
 * The parameters `STAMP_META` takes. `analyticsVersion` is the RANKING_VERSION
 * whose network.ts produced the signals: the same value as `rankingVersion`
 * today, kept as its own property so "which formulas made these communities"
 * has one obvious place to be read.
 */
export function metaParameters(plan: GraphPlan, syncId: string, stats: GraphStats): Record<string, unknown> {
  return {
    syncId,
    rankingVersion: plan.rankingVersion,
    edgesVersion: plan.edgesVersion,
    counts: ownedCounts(plan, stats),
    modularity: stats.modularity,
    analyticsVersion: plan.rankingVersion,
  };
}

/**
 * After a final failure, in its own implicit transaction. A failing sync is
 * still activity, so Aura's 72-hour auto-pause is not triggered by a bad week,
 * and `lastAttemptOk = false` beside a stale `lastSyncAt` says what happened.
 */
export const STAMP_FAILED_ATTEMPT = `
MERGE (m:Meta { key: 'singleton' })
SET m.lastAttemptAt = datetime(), m.lastAttemptOk = false`;

export const READ_META = `
MATCH (m:Meta { key: 'singleton' })
RETURN m.syncId AS syncId, toString(m.lastSyncAt) AS lastSyncAt`;

/** After a dry run's rollback: nothing of this run may be left. */
export const COUNT_STAMPED = `
MATCH (n) WHERE n.syncId = $syncId
RETURN count(n) AS n`;

// ---------------------------------------------------------------------------
// Cypher: the read-back report
// ---------------------------------------------------------------------------

// The three report statements never return an alcoholic Bev's name or brand
// (a node without `isAlcoholic` counts as alcoholic, as in graph-query): the
// log they are printed to is public, and "X's nearest neighbour is <a wine>"
// is the relation the age gate withholds. The row says `isAlcoholic` instead,
// and the report prints a placeholder.

export const REPORT_NEIGHBOURS = `
MATCH (b:Bev { id: $bevId })-[s:SIMILAR_TO]-(o:Bev)
RETURN CASE WHEN coalesce(o.isAlcoholic, true) THEN null ELSE o.name END AS name,
       CASE WHEN coalesce(o.isAlcoholic, true) THEN null ELSE o.brand END AS brand,
       coalesce(o.isAlcoholic, true) AS isAlcoholic, o.categoryId AS categoryId, s.w AS w
ORDER BY s.w DESC, o.id ASC
LIMIT 5`;

/**
 * The traversal `bev_edges` cannot answer: Bevs that share a flavour base AND
 * at least one note with this one, yet have NO direct `SIMILAR_TO` to it.
 */
export const REPORT_TWO_HOP = `
MATCH (b:Bev { id: $bevId })-[:TASTES_OF]->(f:Flavor)<-[:TASTES_OF]-(o:Bev)
WHERE o <> b AND NOT (b)-[:SIMILAR_TO]-(o)
MATCH (b)-[:HAS_NOTE]->(n:Note)<-[:HAS_NOTE]-(o)
WITH o, f, n ORDER BY n.token
WITH o, f, collect(n.token) AS notes
RETURN CASE WHEN coalesce(o.isAlcoholic, true) THEN null ELSE o.name END AS name,
       CASE WHEN coalesce(o.isAlcoholic, true) THEN null ELSE o.brand END AS brand,
       coalesce(o.isAlcoholic, true) AS isAlcoholic, f.name AS flavor, notes
ORDER BY size(notes) DESC, o.id ASC
LIMIT 5`;

export const REPORT_VECTOR = `
MATCH (b:Bev { id: $bevId })
WHERE b.embedding IS NOT NULL
CALL db.index.vector.queryNodes('bev_embedding_idx', 5, b.embedding) YIELD node, score
RETURN CASE WHEN coalesce(node.isAlcoholic, true) THEN null ELSE node.name END AS name,
       CASE WHEN coalesce(node.isAlcoholic, true) THEN null ELSE node.brand END AS brand,
       coalesce(node.isAlcoholic, true) AS isAlcoholic, score
ORDER BY score DESC, node.id ASC`;

/** Every statement the sync can send, for the tests that hold the rules above down. */
export const ALL_STATEMENTS: Record<string, string> = {
  UPSERT_CATEGORIES,
  UPSERT_BRANDS,
  UPSERT_FLAVORS,
  UPSERT_NOTES,
  UPSERT_USERS,
  UPSERT_BEVS,
  UPSERT_CHILD_OF,
  UPSERT_IN_CATEGORY,
  UPSERT_BY_BRAND,
  UPSERT_TASTES_OF,
  UPSERT_HAS_NOTE,
  UPSERT_SIMILAR_TO,
  UPSERT_RANKED,
  UPSERT_LIKES,
  UPSERT_DISLIKES,
  READ_BEV_IDS,
  READ_SIMILAR_TO,
  READ_BEV_ATTRIBUTES,
  SET_BEV_GRAPH_STATS,
  UPSERT_COMMUNITIES,
  UPSERT_IN_COMMUNITY,
  ...Object.fromEntries(Object.entries(SWEEP_RELATIONSHIPS).map(([type, s]) => [`SWEEP_RELATIONSHIPS.${type}`, s])),
  ...Object.fromEntries(Object.entries(SWEEP_NODES).map(([label, s]) => [`SWEEP_NODES.${label}`, s])),
  VERIFY_COUNTS,
  VERIFY_INVARIANTS,
  STAMP_META,
  STAMP_FAILED_ATTEMPT,
  READ_META,
  COUNT_STAMPED,
  REPORT_NEIGHBOURS,
  REPORT_TWO_HOP,
  REPORT_VECTOR,
};
