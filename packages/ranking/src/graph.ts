// Taste neighbourhoods for the taste graph (docs/graph_db_implementation.md §2 approach B, §5 and
// Stage 3; TASKS.md M-28; LaTeX §6.4). A-16 (2)'s nightly job imports these to fill
// `user_neighbors`, and Layer 2's `userSimilarity: 'pearson'` option uses the same Pearson, so the
// in-snapshot fallback and the stored neighbours agree. Nothing here does I/O; "line N" means a
// line of docs/graph_db_implementation.md. Every id and key order here is `compareCodePoints`
// (Unicode code point, SQL `collate "C"`), the leaderboard's order.

import {
  CF_MIN_COMMON,
  CF_SIGNIFICANCE,
  NEIGHBOUR_RELIABILITY_N,
  TASTE_ALPHA,
  TASTE_BRIDGE_KINDS,
  TASTE_K,
  TASTE_MIN_ATTR_BEVS,
  TASTE_MIN_SHARED_ATTRS,
  TASTE_NEIGHBOUR_K,
  TASTE_SHARED_MIN,
  TASTE_SIM_FLOOR,
} from './constants.ts';
import { compareCodePoints as cmp } from './bayesian.ts';
import { normaliseBrand } from './similarity.ts';
import { effectiveUserStats, populationStats, zScore } from './stats.ts';
import type { BevId, CategoryId, Stats, UserId } from './types.ts';

/**
 * One user's z-scores by Bev, z_{u,b} for b ∈ R(u): a Map (what `snapshotContext` holds) or a plain
 * object (what a JSON row decodes to). Build it with `zScoresFromRankings`.
 */
export type ZScores = ReadonlyMap<BevId, number> | Readonly<Record<BevId, number>>;

/** `${kind}:${value}`: 'category:soda', 'brand:coca-cola' (normalised), 'flavor:cola'. */
export type TasteAttribute = string;

/**
 * What the taste vector needs to know about one catalog Bev: a `bevs` row joined to its
 * `bev_flavor_profiles` row. The three fields are the Bev's `:Category`, `:Brand` and `:Flavor`
 * nodes (doc §1).
 */
export interface TasteBev {
  id: BevId;
  categoryId: CategoryId;
  /** `bevs.brand`, raw or already normalised; keyed by `normaliseBrand`, so null, '' or blank means none. */
  brand: string | null;
  /** `bev_flavor_profiles.base` (one of the 24 bases); null or '' when the Bev has no profile. */
  flavorBase: string | null;
}

/** The catalog side of the taste vector, built once per run by `tasteCatalog`. */
export interface TasteCatalog {
  /** Each catalog Bev's attributes that cover at least TASTE_MIN_ATTR_BEVS Bevs, sorted. */
  readonly attributes: ReadonlyMap<BevId, readonly TasteAttribute[]>;
  /** How many catalog Bevs carry each attribute, kept or not. */
  readonly coverage: ReadonlyMap<TasteAttribute, number>;
}

/** t_u: attribute → shrunk mean z (line 255). Keys sorted; attributes the user never touched are absent (0). */
export type TasteVector = Readonly<Record<TasteAttribute, number>>;

/** `user_neighbors.method`: which terms produced `sim` (line 317). */
export type NeighbourMethod = 'pearson' | 'attr' | 'blend';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const clampUnit = (x: number) => Math.min(1, Math.max(-1, x));
/** A Map (or any ReadonlyMap) as is; a plain object's own entries otherwise. JSON objects never hold functions. */
const asMap = (z: ZScores): ReadonlyMap<BevId, number> =>
  typeof (z as { get?: unknown }).get === 'function' && typeof (z as { keys?: unknown }).keys === 'function'
    ? (z as ReadonlyMap<BevId, number>)
    : new Map(Object.entries(z as Record<BevId, number>));
const BRIDGE = new Set<string>(TASTE_BRIDGE_KINDS);

function finite(x: number, what: string): number {
  if (!Number.isFinite(x)) throw new RangeError(`${what} must be finite, got ${x}`);
  return x;
}

/** sqrt(a·b), falling back to sqrt(a)·sqrt(b) when the product under- or overflows. */
function rootProduct(a: number, b: number): number {
  const d = Math.sqrt(a * b);
  return d === 0 || !Number.isFinite(d) ? Math.sqrt(a) * Math.sqrt(b) : d;
}

// ---------------------------------------------------------------- z-scores (the job's input)

/**
 * z_{u,b} for every ranking, exactly as `snapshotContext` computes them from a snapshot whose user
 * and global stats are the population stats of its rankings (`effectiveUserStats`: the user's own
 * μ and σ once they have MIN_N_USER rankings, else the global ones; σ floored at SIGMA_FLOOR).
 * This is the "same formulas as context.ts" the doc asks the sync job to use (line 186).
 *
 * Input: every `rankings` row `{ userId, bevId, score }` (the stored 2-dp score). Pass all of
 * them: global stats come from the whole set. Throws on a duplicated (userId, bevId), which the
 * database's unique constraint rules out, and on a non-finite score. Output keeps row order.
 */
export function zScoresFromRankings(rankings: ReadonlyArray<{ userId: UserId; bevId: BevId; score: number }>): Map<UserId, Map<BevId, number>> {
  const byUser = new Map<UserId, Map<BevId, number>>();
  const all: number[] = [];
  for (const r of rankings) {
    finite(r.score, `score of (${r.userId}, ${r.bevId})`);
    let scores = byUser.get(r.userId);
    if (!scores) byUser.set(r.userId, (scores = new Map()));
    if (scores.has(r.bevId)) throw new RangeError(`duplicate ranking (${r.userId}, ${r.bevId})`);
    scores.set(r.bevId, r.score);
    all.push(r.score);
  }
  const global: Stats = populationStats(all);
  const out = new Map<UserId, Map<BevId, number>>();
  for (const [u, scores] of byUser) {
    const eff = effectiveUserStats(populationStats([...scores.values()]), global);
    out.set(u, new Map([...scores].map(([b, s]) => [b, zScore(s, eff)])));
  }
  return out;
}

// ---------------------------------------------------------------- Pearson over the common subset

/**
 * Pearson correlation of two equal-length vectors, each re-centred on its own mean:
 * Σ(x − x̄)(y − ȳ) / √(Σ(x − x̄)² · Σ(y − ȳ)²), clamped to [−1, 1].
 *
 * Defined as 0 when there are fewer than 2 entries or either vector is constant (zero variance:
 * no evidence of co-variation either way). "Constant" is exact: each vector is shifted by its first
 * entry before centring, so equal entries give an exactly zero sum of squares instead of rounding
 * noise that would otherwise correlate at ±1. Throws on unequal lengths or non-finite entries.
 * Symmetric, exactly; negating either vector negates the result, exactly.
 */
export function pearsonCorrelation(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`vector lengths differ: ${a.length} and ${b.length}`);
  const n = a.length;
  for (let i = 0; i < n; i++) {
    finite(a[i] as number, 'entries');
    finite(b[i] as number, 'entries');
  }
  if (n < 2) return 0;
  const a0 = a[0] as number;
  const b0 = b[0] as number;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += (a[i] as number) - a0;
    sb += (b[i] as number) - b0;
  }
  const ma = sa / n;
  const mb = sb / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - a0 - ma;
    const y = (b[i] as number) - b0 - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  if (!Number.isFinite(sab) || !Number.isFinite(saa) || !Number.isFinite(sbb)) throw new RangeError('entries too large: the sums overflow');
  if (saa === 0 || sbb === 0) return 0;
  return clampUnit(sab / rootProduct(saa, sbb));
}

/**
 * The significance weight min(1, |common| / 5) of line 261 (§8.9's min(|common|, 5) / 5, the same
 * number): two users who agree on two Bevs are not yet neighbours of full weight. Non-decreasing,
 * in [0, 1]. Throws on a negative or non-integer count.
 */
export function significanceWeight(common: number): number {
  if (!Number.isInteger(common) || common < 0) throw new RangeError(`common must be a non-negative integer, got ${common}`);
  return Math.min(1, common / CF_SIGNIFICANCE);
}

export interface PearsonSimilarity {
  /**
   * pearson(z_u, z_v over common items) (line 261): `pearsonCorrelation` of the two users' z-scores
   * on common(u, v) = R(u) ∩ R(v), re-centred on that subset, so it measures agreement on relative
   * order there and not where the shared Bevs sit against each user's overall mean (line 130).
   * In [−1, 1]; 0 when |common| < CF_MIN_COMMON (2) or either user is constant on common(u, v).
   */
  r: number;
  /** |common(u, v)|, for `user_neighbors.common`. */
  common: number;
  /** r · significanceWeight(common): the term the blend and Layer 2 use. |sim| ≤ |r|. */
  sim: number;
}

/**
 * Pearson similarity of two users over the Bevs both ranked.
 *
 * Input: each user's z-scores by Bev (all their rankings; extra Bevs are ignored). The common Bevs
 * are taken in bevId order (code point, SQL `collate "C"`), which makes the result exactly symmetric
 * and independent of insertion order.
 */
export function pearsonSimilarity(zu: ZScores, zv: ZScores): PearsonSimilarity {
  const mu = asMap(zu);
  const mv = asMap(zv);
  const ids = [...mu.keys()].filter((b) => mv.has(b)).sort(cmp);
  const common = ids.length;
  if (common < CF_MIN_COMMON) {
    for (const b of ids) {
      finite(mu.get(b) as number, `z of ${b}`);
      finite(mv.get(b) as number, `z of ${b}`);
    }
    return { r: 0, common, sim: 0 };
  }
  const r = pearsonCorrelation(
    ids.map((b) => mu.get(b) as number),
    ids.map((b) => mv.get(b) as number),
  );
  return { r, common, sim: r * significanceWeight(common) };
}

// ---------------------------------------------------------------- taste vectors

/**
 * The attribute keys of one Bev, sorted: `category:<categoryId>`; `brand:<normaliseBrand(brand)>`
 * when it has a brand; `flavor:<base>` when it has a flavour profile. Coverage is not applied here
 * (see `tasteCatalog`). Throws on an empty categoryId.
 */
export function tasteAttributes(bev: Pick<TasteBev, 'categoryId' | 'brand' | 'flavorBase'>): TasteAttribute[] {
  if (typeof bev.categoryId !== 'string' || bev.categoryId === '') throw new RangeError('categoryId must be a non-empty string');
  const out: TasteAttribute[] = [`category:${bev.categoryId}`];
  const brand = normaliseBrand(bev.brand);
  if (brand !== null) out.push(`brand:${brand}`);
  const base = (bev.flavorBase ?? '').trim();
  if (base !== '') out.push(`flavor:${base}`);
  return out.sort(cmp);
}

/**
 * Builds the catalog side of the taste vectors from every active catalog Bev (line 269: attributes
 * covering fewer than TASTE_MIN_ATTR_BEVS = 2 catalog Bevs are excluded, so a one-off brand
 * bridges nobody). Pass the whole catalog, not only ranked Bevs: coverage counts catalog Bevs.
 * Throws on a duplicate id.
 */
export function tasteCatalog(bevs: readonly TasteBev[]): TasteCatalog {
  const raw = new Map<BevId, TasteAttribute[]>();
  const coverage = new Map<TasteAttribute, number>();
  for (const b of bevs) {
    if (raw.has(b.id)) throw new RangeError(`duplicate Bev ${b.id}`);
    const attrs = tasteAttributes(b);
    raw.set(b.id, attrs);
    for (const a of attrs) coverage.set(a, (coverage.get(a) ?? 0) + 1);
  }
  const attributes = new Map<BevId, readonly TasteAttribute[]>();
  for (const [id, attrs] of raw) attributes.set(id, attrs.filter((a) => (coverage.get(a) as number) >= TASTE_MIN_ATTR_BEVS));
  return { attributes, coverage };
}

/**
 * A user's taste vector, line 255:
 *
 *   t_u[a] = Σ_{b ∈ R(u), b—a} z_{u,b} / (n_{u,a} + K_T),   K_T = TASTE_K = 2,
 *
 * over the attributes a (category, brand, flavour base) that `catalog` keeps, where n_{u,a} counts
 * u's ranked Bevs carrying a. A shrunk mean, not a sum, so prolific raters don't dominate; signed z,
 * so a shared dislike agrees and opposite signs disagree. The category entries equal
 * `categoryAffinity` (§8.5, K_AFF = 2) for every category the catalog keeps.
 *
 * Input: the user's z-scores by Bev (all their rankings). Bevs missing from the catalog (hidden or
 * merged since) are skipped. Bevs are summed in bevId order, so the result does not depend on row
 * order. Throws on a non-finite z.
 */
export function tasteVector(z: ZScores, catalog: TasteCatalog): TasteVector {
  const m = asMap(z);
  const sums = new Map<TasteAttribute, { s: number; n: number }>();
  for (const bev of [...m.keys()].sort(cmp)) {
    const zb = finite(m.get(bev) as number, `z of ${bev}`);
    for (const a of catalog.attributes.get(bev) ?? []) {
      const e = sums.get(a);
      if (e) {
        e.s += zb;
        e.n++;
      } else sums.set(a, { s: zb, n: 1 });
    }
  }
  const out: Record<TasteAttribute, number> = {};
  for (const a of [...sums.keys()].sort(cmp)) {
    const e = sums.get(a) as { s: number; n: number };
    out[a] = e.s / (e.n + TASTE_K);
  }
  return out;
}

function sortedKeys(t: TasteVector): string[] {
  return Object.keys(t).sort(cmp);
}

/**
 * Attribute similarity, cosine(t_u, t_v) (line 262): the cosine of two taste vectors as sparse
 * vectors over the union of their attributes (a missing attribute is 0). In [−1, 1]; 0 when either
 * vector is all zeros. Summed in attribute order, so it is exactly symmetric and a non-zero vector
 * has similarity exactly 1 with itself. Throws on a non-finite entry.
 */
export function attributeSimilarity(a: TasteVector, b: TasteVector): number {
  const ka = sortedKeys(a);
  const kb = sortedKeys(b);
  let na = 0;
  let nb = 0;
  let dot = 0;
  for (const k of ka) {
    const x = finite(a[k] as number, `t[${k}]`);
    na += x * x;
    if (has(b, k)) dot += x * (b[k] as number);
  }
  for (const k of kb) {
    const y = finite(b[k] as number, `t[${k}]`);
    nb += y * y;
  }
  if (!Number.isFinite(na) || !Number.isFinite(nb) || !Number.isFinite(dot)) throw new RangeError('taste vector entries too large: the sums overflow');
  if (na === 0 || nb === 0) return 0;
  return clampUnit(dot / rootProduct(na, nb));
}

/** One pair of users, as the nightly job holds them. */
export interface UserPairInput {
  /** u's and v's z-scores by Bev, all their rankings (e.g. from `zScoresFromRankings`). */
  zu: ZScores;
  zv: ZScores;
  /** `tasteVector(zu, catalog)` and `tasteVector(zv, catalog)`, with the catalog passed alongside. */
  tu: TasteVector;
  tv: TasteVector;
}

/** For one user: each bridging-kind attribute they reach → the ranked catalog Bevs carrying it. */
function bridgeBevs(z: ReadonlyMap<BevId, number>, catalog: TasteCatalog): Map<TasteAttribute, BevId[]> {
  const out = new Map<TasteAttribute, BevId[]>();
  for (const bev of [...z.keys()].sort(cmp)) {
    for (const a of catalog.attributes.get(bev) ?? []) {
      if (!BRIDGE.has(a.slice(0, a.indexOf(':')))) continue;
      const list = out.get(a);
      if (list) list.push(bev);
      else out.set(a, [bev]);
    }
  }
  return out;
}

/** Some b ∈ bu and b′ ∈ bv with b ≠ b′: false only when both are the same single Bev. */
function distinctPair(bu: readonly BevId[], bv: readonly BevId[]): boolean {
  return bu.length > 1 || bv.length > 1 || (bu.length === 1 && bv.length === 1 && bu[0] !== bv[0]);
}

/**
 * The number of bridging attributes two users share (line 274, `user_neighbors.shared_attrs`): the
 * attributes a of a TASTE_BRIDGE_KINDS kind (brand, flavour; the doc's candidate query, line 393)
 * such that
 * - both |t_u[a]| and |t_v[a]| are at least TASTE_SHARED_MIN = 0.2 (either sign: a strong shared
 *   opinion is evidence either way, and attributeSimilarity carries the sign), and
 * - u and v reach a through DIFFERENT Bevs: some b ∈ R(u) and b′ ∈ R(v) carry a with b ≠ b′. The
 *   doc's path is user → b → a → b′ → user (line 273), so an attribute both users reach only through
 *   one Bev they co-rated is that Bev, not a bridge.
 *
 * Input: the pair (`zu`, `zv` give the ranked Bevs, `tu`, `tv` the taste values) and the catalog the
 * taste vectors were built with. Bevs outside the catalog are skipped, as in `tasteVector`.
 * Exactly symmetric in (u, v).
 */
export function sharedAttributeCount(pair: UserPairInput, catalog: TasteCatalog): number {
  const bu = bridgeBevs(asMap(pair.zu), catalog);
  const bv = bridgeBevs(asMap(pair.zv), catalog);
  let n = 0;
  for (const [a, listU] of bu) {
    const listV = bv.get(a);
    if (!listV || !has(pair.tu, a) || !has(pair.tv, a)) continue;
    if (Math.abs(pair.tu[a] as number) < TASTE_SHARED_MIN || Math.abs(pair.tv[a] as number) < TASTE_SHARED_MIN) continue;
    if (distinctPair(listU, listV)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- the blend

export interface BlendOptions {
  /**
   * The Pearson weight α for a pair with |common| ≥ CF_MIN_COMMON; default TASTE_ALPHA = 0.5.
   * Below CF_MIN_COMMON α is 0 whatever this says (line 264). 1 gives the Pearson-only arm
   * (`method` 'pearson'), 0 the attribute-only arm. Must be in [0, 1].
   */
  alpha?: number;
}

export interface BlendedUserSimilarity {
  /** α·pearsonSim + (1 − α)·attributeSim, in [−1, 1]: `user_neighbors.sim`. */
  sim: number;
  /** 'blend' when 0 < α < 1, 'attr' when α = 0, 'pearson' when α = 1. */
  method: NeighbourMethod;
  /** The α used for this pair. */
  alpha: number;
  /** |common(u, v)|: `user_neighbors.common`. */
  common: number;
  /** Raw Pearson r over the common Bevs (`pearsonSimilarity(zu, zv).r`). */
  pearson: number;
  /** r · significanceWeight(common), the Pearson term. */
  pearsonSim: number;
  /** cosine(t_u, t_v), before the bridge gate. */
  attribute: number;
  /** Bridging attributes shared through distinct Bevs (`sharedAttributeCount`): `user_neighbors.shared_attrs`. */
  sharedAttrs: number;
  /**
   * The attribute term: `attribute`, except 0 for a pair with fewer than CF_MIN_COMMON common Bevs
   * that shares fewer than TASTE_MIN_SHARED_ATTRS (2) bridging attributes (the bridge gate).
   */
  attributeSim: number;
}

/**
 * The blended user–user similarity of approach B (line 261):
 *
 *   sim(u, v) = α · pearson(z_u, z_v over common) · min(1, |common| / 5) + (1 − α) · cos(t_u, t_v),
 *   α = 0.5 when |common| ≥ 2, α = 0 otherwise,
 *
 * plus the doc's weak-multi-hop guard (line 274), the bridge gate: a pair with fewer than 2 common
 * Bevs is reachable only by the two-hop path user → b → attribute → b′ → user with b ≠ b′, and it
 * counts only if it shares at least 2 such bridging attributes with |t| ≥ 0.2
 * (`sharedAttributeCount`; a cosine ignores magnitude, so two faint taste vectors can still point
 * the same way, and one co-rated Bev is not a path); otherwise its sim is 0. A pair with 2 or
 * more common Bevs is reached directly and takes the formula as written, so two users who agree on
 * five co-rated Bevs are not halved for having faint taste vectors.
 *
 * Double counting (line 434). The weights α and 1 − α sum to 1, so co-rated agreement can never
 * add up past what either term says on its own: sim lies between the two terms and in [−1, 1].
 * Below 2 common Bevs α = 0, so the attribute term replaces Pearson rather than adding to it, and
 * at 2 or more the doc's α = 0.5 splits the weight. The taste vectors still include the co-rated
 * Bevs (one vector per user, as the doc's Cypher builds them); that overlap is inside the convex
 * blend, never on top of it. Consumers must use `sim` as the whole similarity and not add
 * `attribute` again (Stage 4's Layer 2 reads `user_neighbors.sim` in place of sim'(u, v)).
 *
 * Input: the pair and the catalog its taste vectors were built with (the bridge test needs to know
 * which ranked Bevs carry each attribute). Exactly symmetric in (u, v). The reliability weight
 * min(1, n_v / N₀) is NOT folded in: it is
 * per neighbour and asymmetric, and Layer 2 applies it when it reads the rows (Stage 4,
 * `neighbourReliability`).
 */
export function blendUserSimilarity(pair: UserPairInput, catalog: TasteCatalog, opts: BlendOptions = {}): BlendedUserSimilarity {
  const requested = opts.alpha ?? TASTE_ALPHA;
  if (!(requested >= 0 && requested <= 1)) throw new RangeError(`alpha must be in [0, 1], got ${requested}`);
  const p = pearsonSimilarity(pair.zu, pair.zv);
  const attribute = attributeSimilarity(pair.tu, pair.tv);
  const sharedAttrs = sharedAttributeCount(pair, catalog);
  const direct = p.common >= CF_MIN_COMMON;
  const attributeSim = direct || sharedAttrs >= TASTE_MIN_SHARED_ATTRS ? attribute : 0;
  const alpha = direct ? requested : 0;
  const sim = clampUnit(alpha * p.sim + (1 - alpha) * attributeSim);
  const method: NeighbourMethod = alpha === 0 ? 'attr' : alpha === 1 ? 'pearson' : 'blend';
  return { sim, method, alpha, common: p.common, pearson: p.r, pearsonSim: p.sim, attribute, sharedAttrs, attributeSim };
}

// ---------------------------------------------------------------- neighbour selection

/** A scored neighbour of one user. Extra fields (the `BlendedUserSimilarity` breakdown) ride along. */
export interface NeighbourCandidate {
  userId: UserId;
  sim: number;
}

/**
 * The neighbours one user keeps in `user_neighbors` (line 274): sim ≥ `min` (TASTE_SIM_FLOOR = 0.1,
 * inclusive), most similar first, at most `k` (TASTE_NEIGHBOUR_K = 25). Ties on sim go to the
 * smaller userId (code-point order, SQL `collate "C"`). Throws on a duplicate userId
 * or a non-finite sim. Returns a new array; inputs are untouched.
 */
export function topUserNeighbours<T extends NeighbourCandidate>(candidates: readonly T[], k: number = TASTE_NEIGHBOUR_K, min: number = TASTE_SIM_FLOOR): T[] {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k must be a non-negative integer, got ${k}`);
  if (!Number.isFinite(min)) throw new RangeError(`min must be finite, got ${min}`);
  const seen = new Set<UserId>();
  for (const c of candidates) {
    if (seen.has(c.userId)) throw new RangeError(`duplicate candidate ${c.userId}`);
    seen.add(c.userId);
    finite(c.sim, `sim of ${c.userId}`);
  }
  return candidates
    .filter((c) => c.sim >= min)
    .sort((a, b) => b.sim - a.sim || cmp(a.userId, b.userId))
    .slice(0, k);
}

/**
 * Reliability of a neighbour with n_v rankings, min(1, n_v / N₀) with N₀ = NEIGHBOUR_RELIABILITY_N
 * = 15 (line 419; N₀ is this package's choice, see constants.ts), so a neighbour with three
 * rankings does not count like one with eighty. Stage 4's Layer 2 multiplies it into each
 * neighbour's weight; it is not part of `user_neighbors.sim`. Throws on a negative or non-finite n.
 */
export function neighbourReliability(n: number): number {
  if (!(Number.isFinite(n) && n >= 0)) throw new RangeError(`n must be a non-negative number, got ${n}`);
  return Math.min(1, n / NEIGHBOUR_RELIABILITY_N);
}
