/**
 * The pure half of `scripts/graph/build-edges.ts` (A-16 (1), steps 3-5 and 7).
 *
 * Everything here is a function of its arguments: no fetch, no environment, no
 * clock. `build-edges.ts` does the I/O and calls into this file, and
 * `edges-core.test.ts` tests this file directly -- which is the only way any of
 * it can be tested at all, since this repo has no reachable database.
 *
 * NOTHING HERE REIMPLEMENTS A FORMULA. `treeSimilarity`, `contentSimilarity`,
 * `embeddingSimilarity`, `profileSimilarity`, `edgeWeight` and `topEdges` all
 * come from @bevi/ranking (M-24, LaTeX 10.1 eqs. 16-18), together with
 * `normaliseBrand` and `flavorTokens`, which define what the content term's
 * brand equality and token set actually are. If a weight looks wrong, the bug
 * is in what this file FEEDS those functions, not in a copy of them.
 */

import {
  EDGE_MIN_WEIGHT,
  EDGE_TOP_K,
  contentSimilarity,
  edgeWeight,
  embeddingSimilarity,
  flavorTokens,
  normaliseBrand,
  pearsonCorrelation,
  profileSimilarity,
  topEdges,
  treeSimilarity,
} from "@bevi/ranking";
import type { BevFeatures, BevId, EdgeComponents, FlavorProfile, Taxonomy, UserId } from "@bevi/ranking";

// ---------------------------------------------------------------------------
// What the job reads out of Postgres
// ---------------------------------------------------------------------------

/** One row of `public.bevs` (status 'active'), with its category's alcohol flag joined on. */
export interface BevRecord {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: string;
  /**
   * A-13: the Bev's leaf under `categoryId`, or null when it sits on the parent
   * (an unsplit root such as `water`/`sports`, or a user-created Bev nobody has
   * relabelled). This is the node the TREE term is measured at; `categoryId`
   * stays the root and is what the CONTENT term reads. See `treeNodeOf`.
   */
  leafCategoryId: string | null;
  priceTier: number;
  isAlcoholic: boolean;
}

/**
 * One row of `public.categories`. `parentId` is still optional on the type so a
 * caller that does not select it (a test, an older snapshot) keeps type-checking;
 * `build-edges.ts` has selected it since A-13.
 */
export interface CategoryRecord {
  id: string;
  /** null on one of the 15 roots, the root's id on one of D-04's 60 leaves (A-13). */
  parentId?: string | null;
}

/** One `(bev, neighbour)` row of the pgvector KNN probe, `distance` = `<=>` (cosine distance). */
export interface NeighbourRecord {
  bevId: string;
  neighbourId: string;
  distance: number;
}

/** A pair that survived weighting, in canonical orientation. */
export interface WeightedPair {
  src: string;
  dst: string;
  weight: number;
  components: Required<EdgeComponents>;
}

/** A row of `public.bev_edges`, exactly as `replace_bev_edges(p_rows, p_version)` expects it. */
export interface EdgeRow {
  src_bev_id: string;
  dst_bev_id: string;
  weight: number;
  components: Required<EdgeComponents>;
}

/** Everything `weighPair` needs, precomputed once per Bev rather than once per pair. */
export interface WeighContext {
  taxonomy: Taxonomy;
  features: ReadonlyMap<string, BevFeatures>;
  /**
   * A-13: bev id -> the category node its TREE term is measured at, which is
   * `leafCategoryId ?? categoryId` (`treeNodeOf`). Separate from `features`
   * because `BevFeatures.categoryId` belongs to `contentSimilarity` and must
   * stay the root -- see `weighPair`.
   *
   * A bev missing from this map falls back to its `features.categoryId`, so an
   * older caller that does not build it still weighs every pair at the root.
   */
  treeNodes?: ReadonlyMap<string, string>;
  profiles: ReadonlyMap<string, FlavorProfile>;
  embeddings: ReadonlyMap<string, readonly number[]>;
  /**
   * A-16 (2): bev id -> (user id -> that user's z for the Bev), from
   * `coRatersByBev` below. The cop term of eq. (18) is
   * computed from it; omitted, every pair's `cop` is 0, which is what every
   * run before A-16 (2) stored.
   */
  coRaters?: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** The candidate rule's third arm: "the 50 nearest by embedding cosine" (A-16 step 3). */
export const KNN_CANDIDATES = 50;

/**
 * Component terms and weights are rounded to this many decimals before they are
 * stored, so that `edgeWeight(components) === weight` holds exactly for every
 * row in `bev_edges` -- see `weighPair`.
 */
export const COMPONENT_DECIMALS = 6;

const SCALE = 10 ** COMPONENT_DECIMALS;

/** Rounds to COMPONENT_DECIMALS. A value in [0, 1] stays in [0, 1]. */
export function round6(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`cannot round ${x}`);
  return Math.round(x * SCALE) / SCALE;
}

// ---------------------------------------------------------------------------
// The taxonomy, and what the tree term degenerates to today
// ---------------------------------------------------------------------------

/**
 * The `Taxonomy` argument of `treeSimilarity`: a child -> parent map over the
 * rows of `public.categories`.
 *
 * TODAY EVERY VALUE IS `null`, because `categories` has no `parent_id` column
 * (20261009000200: `id, name, sort_order, is_alcoholic, emoji`). A-13 adds it
 * after D-04, and the only change needed here is that `parentId` starts
 * arriving non-null -- this function already passes it through.
 *
 * With an all-`null` map `treeSimilarity` has every category at depth 1 under
 * the implicit root, so
 *
 *   same category  -> 2*1 / (1 + 1) = 1
 *   any other pair -> 2*0 / (1 + 1) = 0        (their only common ancestor is
 *                                               the implicit root, depth 0)
 *
 * i.e. **the tree term degenerates to the `[same category]` indicator of
 * eq. (5)**, and contributes exactly 0.25 or 0. It is built from the rows
 * rather than passed as `{}` (which `treeSimilarity` treats identically) so
 * that the degeneracy is a property of today's DATA and visible in the log,
 * not a hard-coded assumption in the job.
 */
export function buildTaxonomy(categories: readonly CategoryRecord[]): Taxonomy {
  const taxonomy: Record<string, string | null> = {};
  for (const c of categories) taxonomy[c.id] = c.parentId ?? null;
  return taxonomy;
}

/** True when no category in the taxonomy has a parent, i.e. the tree term is the same-category indicator. */
export function taxonomyIsFlat(taxonomy: Taxonomy): boolean {
  return Object.values(taxonomy).every((parent) => parent === null || parent === undefined);
}

// ---------------------------------------------------------------------------
// Canonical orientation
// ---------------------------------------------------------------------------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `bev_edges` keeps ONE ROW PER UNORDERED PAIR oriented `src_bev_id <
 * dst_bev_id` (20261019000500, enforced by `check (src_bev_id < dst_bev_id)`),
 * which is also the direction the Cypher `MERGE` will write.
 *
 * The comparison is JS `<` on the uuid TEXT. For the canonical lowercase-hex
 * form Postgres renders, text code-unit order, `collate "C"` byte order and the
 * `uuid` type's own byte order all agree, so this orientation is the one the
 * CHECK accepts and the one `order by b.id` reproduces (the tie-break
 * `topEdges` uses; M-24's note on `collate "C"`). Uppercase hex would break
 * that agreement, so it is rejected rather than silently lowercased.
 */
export function orientPair(a: string, b: string): { src: string; dst: string } {
  if (a === b) throw new RangeError(`a Bev cannot be its own neighbour: ${a}`);
  if (/[A-F]/.test(a) || /[A-F]/.test(b)) {
    throw new RangeError(`uuids must be lowercase hex so JS order matches collate "C": ${a}, ${b}`);
  }
  return a < b ? { src: a, dst: b } : { src: b, dst: a };
}

/** A stable key for an unordered pair: the canonical orientation, joined. */
export function pairKey(a: string, b: string): string {
  const { src, dst } = orientPair(a, b);
  return `${src}|${dst}`;
}

/** Inverse of `pairKey`. */
export function splitPairKey(key: string): { src: string; dst: string } {
  const i = key.indexOf("|");
  if (i < 0) throw new RangeError(`not a pair key: ${key}`);
  return { src: key.slice(0, i), dst: key.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Candidate pairs (A-16 step 3)
// ---------------------------------------------------------------------------

/**
 * `BevFeatures` for `contentSimilarity`, which reads only `categoryId`,
 * `brandKey`, `flavorTokens` and `priceTier` (eq. 5 / 8.8). The three
 * prediction fields it does not read (`ratingCount`, `mean`, `stddev`) are set
 * to 0 rather than fetched: this job never predicts a score, and pulling
 * `bev_stats` in to fill fields the formula ignores would invite someone to
 * start using them.
 */
/**
 * The category node a Bev's TREE term is measured at (A-13): its leaf when it
 * has one, else its category.
 *
 * Why this is not simply `categoryId`: `treeSimilarity` is Wu-Palmer over the
 * two-level taxonomy, so measuring at the leaf is what makes two colas score 1
 * and a cola against a root beer 0.5 -- the whole point of D-04. Measuring at
 * the root would leave the term at the pre-A-13 same-category indicator and the
 * hierarchy would change nothing.
 *
 * And why `contentSimilarity` keeps the ROOT (see `weighPair`): its own
 * same-category indicator is a coarse "these belong to the same shelf" signal,
 * and D-04 flagged the consequence of handing it the leaf -- Coke vs Fanta
 * would drop from 0.40 to 0 on that term. The tree term already carries
 * leaf-level closeness, so passing the leaf to both would double-count the
 * taxonomy in `edgeWeight` and lose the shelf signal at the same time.
 */
export function treeNodeOf(bev: BevRecord): string {
  return bev.leafCategoryId ?? bev.categoryId;
}

export function bevFeatures(bev: BevRecord): BevFeatures {
  return {
    id: bev.id,
    categoryId: bev.categoryId,
    brandKey: normaliseBrand(bev.brand),
    flavorTokens: flavorTokens(bev.name, bev.flavor),
    priceTier: Math.min(4, Math.max(1, Math.round(bev.priceTier))) as 1 | 2 | 3 | 4,
    ratingCount: 0,
    mean: 0,
    stddev: 0,
    isAlcoholic: bev.isAlcoholic,
  };
}

/**
 * The candidate set: **same category union same brand union the 50 nearest by
 * embedding cosine** (A-16 step 3). "Same category subtree" in the task text is
 * "same category" today, for the same reason the tree term degenerates: there
 * is no subtree until A-13.
 *
 * Returns canonical pair keys, so the three arms are deduplicated by
 * construction and a pair found by two arms is weighted once.
 *
 * `nearest` rows whose endpoint is not in `bevs` are dropped: the KNN probe
 * reads `bev_embeddings`, whose rows outlive a Bev's status change until the
 * next run, so a neighbour can legitimately be a Bev this run is not
 * considering.
 *
 * Cost: the first two arms are quadratic WITHIN a group. At the catalog's size
 * (378 Bevs, 15 categories, biggest brand a few dozen rows) that is a few
 * thousand pairs; it is the growth to watch if the catalog multiplies, and the
 * place where A-13's subtree arm will need a depth bound.
 */
export function candidatePairs(
  bevs: readonly BevRecord[],
  nearest: readonly NeighbourRecord[] = []
): Set<string> {
  const known = new Set(bevs.map((b) => b.id));
  const pairs = new Set<string>();

  const addGroup = (group: readonly string[]) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) pairs.add(pairKey(group[i] as string, group[j] as string));
    }
  };

  const byCategory = new Map<string, string[]>();
  const byBrand = new Map<string, string[]>();
  for (const bev of bevs) {
    push(byCategory, bev.categoryId, bev.id);
    // A null brand key is not a brand: `contentSimilarity` scores two unbranded
    // Bevs as "different brand", so grouping them would manufacture candidates
    // the content term then declines to reward.
    const brand = normaliseBrand(bev.brand);
    if (brand !== null) push(byBrand, brand, bev.id);
  }
  for (const group of byCategory.values()) addGroup(group);
  for (const group of byBrand.values()) addGroup(group);

  for (const n of nearest) {
    if (n.bevId === n.neighbourId) continue;
    if (!known.has(n.bevId) || !known.has(n.neighbourId)) continue;
    pairs.add(pairKey(n.bevId, n.neighbourId));
  }

  return pairs;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

// ---------------------------------------------------------------------------
// Weighting (A-16 step 4)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The cop term of eq. (18) (LaTeX section 10.1), A-16 (2)
// ---------------------------------------------------------------------------

/**
 * Minimum common raters before `sim_cop` says anything. The paper: "0 while
 * fewer than 3 users have ranked both".
 *
 * Not in `@bevi/ranking`'s constants, because the term's weight there
 * (`EDGE_WEIGHTS.cop`) is still 0 and switching it on is Matt's constant change
 * plus a `RANKING_VERSION` bump. This job computes and STORES the term so the
 * number is already measured when he does; until then it rides in
 * `bev_edges.components.cop` and contributes 0 to every weight.
 */
export const COP_MIN_CO_RATERS = 3;

/**
 * `sim_cop(b, b')`: the cosine of two Bevs' z-score vectors over their common
 * raters, 0 below `COP_MIN_CO_RATERS` of them.
 *
 * Reuses `pearsonCorrelation` from @bevi/ranking rather than writing a cosine:
 * the vectors are z-scores, which are already centred per USER, and the paper
 * asks for the cosine over common raters. Centring them again per BEV is what
 * makes the measure "do these two Bevs move together across the people who
 * rated both", independent of either Bev being generally liked -- the same
 * correction M-28 applied to the user-user case, and the reason the two agree.
 *
 * CLAMPED AT 0, which is a decision worth naming: a correlation is in [-1, 1],
 * `edgeWeight` requires every term in [0, 1] (`unit()` throws otherwise), and a
 * NEGATIVE co-preference -- the people who rate Coke highly rate this one
 * poorly -- is evidence of dissimilarity that eq. (18) has no way to express,
 * since it sums non-negative terms into a similarity. So negative becomes 0,
 * "no positive co-preference evidence", rather than being allowed to throw or
 * to be rescaled into a fake positive. Flagged for Matt in the PR: if the term
 * should instead be (1 + r)/2, that is a formula change in his lane.
 */
export function copSimilarity(
  ratersA: ReadonlyMap<UserId, number>,
  ratersB: ReadonlyMap<UserId, number>,
): number {
  // Common raters in code-point order, so the result is exactly symmetric and
  // independent of insertion order -- the same rule `pearsonSimilarity` uses
  // for its common Bevs.
  const common = [...ratersA.keys()].filter((u) => ratersB.has(u)).sort(cmp);
  if (common.length < COP_MIN_CO_RATERS) return 0;
  const r = pearsonCorrelation(
    common.map((u) => ratersA.get(u) as number),
    common.map((u) => ratersB.get(u) as number),
  );
  return r <= 0 ? 0 : Math.min(1, r);
}

/**
 * bev id -> (user id -> that user's z for the Bev), the input `copSimilarity`
 * takes, from the same `zScoresFromRankings` output the neighbour build uses.
 *
 * Built once per run and handed to `weighPair` through `WeighContext.coRaters`,
 * so the cop term costs one map lookup per pair rather than a scan.
 */
export function coRatersByBev(z: ReadonlyMap<UserId, ReadonlyMap<BevId, number>>): Map<BevId, Map<UserId, number>> {
  const out = new Map<BevId, Map<UserId, number>>();
  for (const u of [...z.keys()].sort(cmp)) {
    for (const [bev, zu] of z.get(u) as ReadonlyMap<BevId, number>) {
      let raters = out.get(bev);
      if (!raters) out.set(bev, (raters = new Map()));
      raters.set(u, zu);
    }
  }
  return out;
}

/**
 * One candidate's five terms and its weight, eq. (18) through `edgeWeight`.
 *
 * The terms:
 *   tree     `treeSimilarity` over `buildTaxonomy`, measured at each Bev's LEAF
 *            (A-13/D-04): 1 for two colas, 0.5 for sibling leaves, 0.667 for a
 *            leaf against a Bev sitting on its own parent, 0 across roots.
 *   content  `contentSimilarity` over the catalog row (ROOT category, brand,
 *            flavour tokens, tier) -- deliberately the root, see `treeNodeOf`.
 *   emb      `embeddingSimilarity` over the two `bev_embeddings` vectors.
 *            **0 when either Bev has no embedding yet** -- the honest value for
 *            "no evidence", and the reason a run before the embed pipeline has
 *            filled the table reports low weights rather than failing.
 *   profile  `profileSimilarity` over `bev_flavor_profiles`. 0 when either is
 *            missing, including when D-11's inference declined below its 0.6 floor.
 *   cop      `copSimilarity` over the two Bevs' z-scores across their common
 *            raters (A-16 (2)), 0 below 3 of them and 0 when `ctx.coRaters` is
 *            absent. **It contributes nothing to the weight today**, because
 *            `EDGE_WEIGHTS.cop` is still 0 -- switching gamma on renormalises
 *            the other four and is a constant change plus a RANKING_VERSION
 *            bump in Matt's lane. It is computed and STORED now so the number
 *            is already measured when he does.
 *
 * The emb term is recomputed from the vectors, never derived from the KNN
 * `distance`: the HNSW probe is a candidate SELECTOR, so an approximate index
 * can change which pairs are considered but never what a pair weighs.
 *
 * Rounding: each term is rounded to COMPONENT_DECIMALS and the weight is then
 * computed FROM THE ROUNDED TERMS. So `edgeWeight(row.components) ===
 * row.weight` for every row that reaches `bev_edges`, and the stored breakdown
 * is a verifiable derivation rather than a decoration. It also makes the
 * selection reproducible from the stored data -- at the cost of more exact
 * ties, which is precisely why `topEdges`' `bevId` tie-break matters (M-24).
 */
export function weighPair(a: string, b: string, ctx: WeighContext): WeightedPair {
  const { src, dst } = orientPair(a, b);
  const fa = ctx.features.get(src);
  const fb = ctx.features.get(dst);
  if (fa === undefined || fb === undefined) throw new RangeError(`no features for ${fa === undefined ? src : dst}`);

  const ea = ctx.embeddings.get(src);
  const eb = ctx.embeddings.get(dst);
  const pa = ctx.profiles.get(src);
  const pb = ctx.profiles.get(dst);
  const ra = ctx.coRaters?.get(src);
  const rb = ctx.coRaters?.get(dst);

  // A-13: the tree term is measured at each Bev's LEAF (`treeNodes`), while
  // `contentSimilarity` below reads `fa.categoryId`, still the root. See
  // `treeNodeOf` for why the two differ.
  const ta = ctx.treeNodes?.get(src) ?? fa.categoryId;
  const tb = ctx.treeNodes?.get(dst) ?? fb.categoryId;

  const components: Required<EdgeComponents> = {
    tree: round6(treeSimilarity(ta, tb, ctx.taxonomy)),
    content: round6(contentSimilarity(fa, fb)),
    emb: ea === undefined || eb === undefined ? 0 : round6(embeddingSimilarity(ea, eb)),
    profile: pa === undefined || pb === undefined ? 0 : round6(profileSimilarity(pa, pb)),
    cop: ra === undefined || rb === undefined ? 0 : round6(copSimilarity(ra, rb)),
  };

  return { src, dst, weight: round6(edgeWeight(components)), components };
}

/** `weighPair` over a candidate set, in sorted pair order so the log is reproducible. */
export function weighPairs(pairs: Iterable<string>, ctx: WeighContext): WeightedPair[] {
  const out: WeightedPair[] = [];
  for (const key of [...pairs].sort(cmp)) {
    const { src, dst } = splitPairKey(key);
    out.push(weighPair(src, dst, ctx));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selection (A-16 step 5) and the write payload (step 7)
// ---------------------------------------------------------------------------

/**
 * "Keep the top 20 per Bev with w >= 0.3", via `topEdges` -- which is where the
 * threshold, the cap and the tie-break all live (defaults EDGE_TOP_K and
 * EDGE_MIN_WEIGHT).
 *
 * A pair is kept when **either** endpoint keeps it. That union is what
 * `get_similar_bevs` already documents ("an unordered pair survives if EITHER
 * end wants it", which is why its limit is clamped to 50 rather than 20), and
 * it is the only choice that makes the stored set symmetric: an intersection
 * would silently drop a small Bev's single best neighbour because a popular Bev
 * has twenty better ones.
 *
 * Each endpoint's candidate list is `topEdges`' own input shape, with the pair
 * riding along as an extra field -- `topEdges` preserves it, and it throws on a
 * duplicate `bevId`, which a canonical pair set cannot produce.
 */
export function selectEdges(
  weighted: readonly WeightedPair[],
  k: number = EDGE_TOP_K,
  min: number = EDGE_MIN_WEIGHT
): WeightedPair[] {
  const byBev = new Map<string, Array<{ bevId: string; w: number; pair: WeightedPair }>>();
  for (const pair of weighted) {
    push(byBev, pair.src, { bevId: pair.dst, w: pair.weight, pair });
    push(byBev, pair.dst, { bevId: pair.src, w: pair.weight, pair });
  }

  const kept = new Set<WeightedPair>();
  for (const candidates of byBev.values()) {
    for (const candidate of topEdges(candidates, k, min)) kept.add(candidate.pair);
  }

  return [...kept].sort((x, y) => cmp(x.src, y.src) || cmp(x.dst, y.dst));
}

/** The top `n` neighbours of one Bev among the kept pairs, heaviest first, for the dry-run report. */
export function neighboursOf(
  bevId: string,
  kept: readonly WeightedPair[],
  n = 5
): Array<{ bevId: string; weight: number; components: Required<EdgeComponents> }> {
  const candidates = kept
    .filter((p) => p.src === bevId || p.dst === bevId)
    .map((p) => ({ bevId: p.src === bevId ? p.dst : p.src, w: p.weight, components: p.components }));
  // min 0, not -Infinity: `topEdges` requires a finite minimum, and every pair
  // in `kept` has already cleared the real threshold.
  return topEdges(candidates, n, 0).map((c) => ({
    bevId: c.bevId,
    weight: c.w,
    components: c.components,
  }));
}

/**
 * The `replace_bev_edges` payload. Snake-cased to match the table's columns
 * (20261019000500), because the function reads the array with
 * `jsonb_to_recordset` against that column list.
 */
export function edgeRows(kept: readonly WeightedPair[]): EdgeRow[] {
  return kept.map((p) => ({
    src_bev_id: p.src,
    dst_bev_id: p.dst,
    weight: p.weight,
    components: p.components,
  }));
}
