// Edge weights of the Bev graph (LaTeX §10.1, eqs. 16–18; TASKS.md decision 30, M-24).
// The nightly job (A-16) weights candidate pairs with these and keeps each Bev's top edges;
// nothing here does I/O.

import { EDGE_MIN_WEIGHT, EDGE_TOP_K, EDGE_WEIGHTS, PROFILE_LEVEL_SPAN, PROFILE_WEIGHTS } from './constants.ts';
import type { BevId, CategoryId } from './types.ts';

/**
 * A Bev's flavour profile, structurally the `FlavorProfile` of the shared contract (S-14), minus
 * `serve` and `source`, which eq. (17) does not use. `base` is the contract's `FlavorBase`; it is a
 * plain string here because this package cannot import `@bevi/shared`.
 */
export interface FlavorProfile {
  base: string;
  carbonated: boolean;
  /** 0 none, 1 low, 2 medium, 3 high. */
  caffeine: 0 | 1 | 2 | 3;
  /** 0 unsweetened, 1 low, 2 medium, 3 high. */
  sweetness: 0 | 1 | 2 | 3;
  dairy: boolean;
  alcohol: boolean;
}

/**
 * The category tree as a child → parent map (`Category.parentId`). `null` marks a top-level
 * category; a category that is not a key is also top-level, so `{}` is today's flat list.
 */
export type Taxonomy = Readonly<Record<CategoryId, CategoryId | null>>;

/** The five similarity terms of eq. (18), each in [0, 1]. `cop` defaults to 0 (γ = 0 in v1). */
export interface EdgeComponents {
  tree: number;
  content: number;
  emb: number;
  profile: number;
  cop?: number;
}

/** A weighted candidate edge from one Bev to `bevId`. Extra fields (the components) ride along. */
export interface EdgeCandidate {
  bevId: BevId;
  w: number;
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `category` and its ancestors, nearest first, ending at a top-level category.
 * Throws on a cycle.
 */
function ancestry(category: CategoryId, taxonomy: Taxonomy): CategoryId[] {
  const path: CategoryId[] = [];
  const seen = new Set<CategoryId>();
  let c: CategoryId | null = category;
  while (c !== null) {
    if (seen.has(c)) throw new RangeError(`taxonomy has a cycle through "${c}"`);
    seen.add(c);
    path.push(c);
    c = has(taxonomy, c) ? (taxonomy[c] ?? null) : null;
  }
  return path;
}

/**
 * Wu–Palmer similarity, eq. (16): 2·depth(lca) / (depth(a) + depth(b)).
 *
 * Depth is measured from an implicit root above the top-level categories, which has depth 0, so a
 * top-level category has depth 1. Hence the same category gives 1, two categories whose only common
 * ancestor is the implicit root give 0 (with a flat taxonomy this is the `[same category]`
 * indicator of eq. 5), and siblings under a top-level parent give 2·1 / (2 + 2) = 0.5.
 */
export function treeSimilarity(catA: CategoryId, catB: CategoryId, taxonomy: Taxonomy): number {
  const a = ancestry(catA, taxonomy);
  const b = ancestry(catB, taxonomy);
  const inA = new Set(a);
  let lcaDepth = 0;
  for (let i = 0; i < b.length; i++) {
    if (inA.has(b[i] as CategoryId)) {
      lcaDepth = b.length - i;
      break;
    }
  }
  return (2 * lcaDepth) / (a.length + b.length);
}

function level(v: number, name: string): number {
  if (!Number.isInteger(v) || v < 0 || v > PROFILE_LEVEL_SPAN) {
    throw new RangeError(`${name} must be an integer in [0, ${PROFILE_LEVEL_SPAN}], got ${v}`);
  }
  return v;
}

/** Profile weights in hundredths, so eq. (17) is evaluated as one integer over 100·span. */
const P = {
  base: Math.round(PROFILE_WEIGHTS.base * 100),
  carbonated: Math.round(PROFILE_WEIGHTS.carbonated * 100),
  dairy: Math.round(PROFILE_WEIGHTS.dairy * 100),
  alcohol: Math.round(PROFILE_WEIGHTS.alcohol * 100),
  caffeine: Math.round(PROFILE_WEIGHTS.caffeine * 100),
  sweetness: Math.round(PROFILE_WEIGHTS.sweetness * 100),
};

/**
 * Profile similarity, eq. (17):
 *   0.40·[base] + 0.15·[carbonated] + 0.10·[dairy] + 0.05·[alcohol]
 *   + 0.15·(1 − |Δcaffeine| / 3) + 0.15·(1 − |Δsweetness| / 3).
 * Evaluated exactly as N / 300 with N an integer, so identical profiles give exactly 1 and the
 * result is the correctly rounded double of the true value. `serve` and `source` are ignored.
 */
export function profileSimilarity(a: FlavorProfile, b: FlavorProfile): number {
  const dCaff = Math.abs(level(a.caffeine, 'caffeine') - level(b.caffeine, 'caffeine'));
  const dSweet = Math.abs(level(a.sweetness, 'sweetness') - level(b.sweetness, 'sweetness'));
  const flags =
    P.base * (a.base === b.base ? 1 : 0) +
    P.carbonated * (a.carbonated === b.carbonated ? 1 : 0) +
    P.dairy * (a.dairy === b.dairy ? 1 : 0) +
    P.alcohol * (a.alcohol === b.alcohol ? 1 : 0);
  const n = PROFILE_LEVEL_SPAN * flags + P.caffeine * (PROFILE_LEVEL_SPAN - dCaff) + P.sweetness * (PROFILE_LEVEL_SPAN - dSweet);
  return n / (100 * PROFILE_LEVEL_SPAN);
}

/**
 * Embedding similarity: max(0, cosine(a, b)), clamped to [0, 1]. For the unit-norm `gte-small`
 * vectors of §10.1 this is max(0, e_a · e_b); the norms are divided out anyway so an unnormalised
 * vector is safe. A zero vector has similarity 0 with everything.
 */
export function embeddingSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`embedding lengths differ: ${a.length} and ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!Number.isFinite(dot) || !Number.isFinite(na) || !Number.isFinite(nb)) {
    throw new RangeError('embeddings must be finite');
  }
  if (na === 0 || nb === 0) return 0;
  let denom = Math.sqrt(na * nb);
  if (denom === 0 || !Number.isFinite(denom)) denom = Math.sqrt(na) * Math.sqrt(nb);
  return Math.min(1, Math.max(0, dot / denom));
}

function unit(v: number, name: string): number {
  if (!(v >= 0 && v <= 1)) throw new RangeError(`${name} must be in [0, 1], got ${v}`);
  return v;
}

/**
 * Edge weight, eq. (18): w = α·tree + β·content + δ·emb + η·profile + γ·cop with
 * (α, β, δ, η, γ) = EDGE_WEIGHTS = (0.25, 0.15, 0.30, 0.30, 0). The weights already sum to 1;
 * the renormalisation in §10.1 happens when γ is switched on, as a constant change and a version
 * bump, not per pair. Summed in that order and clamped to [0, 1] against rounding.
 */
export function edgeWeight(c: EdgeComponents): number {
  const w =
    EDGE_WEIGHTS.tree * unit(c.tree, 'tree') +
    EDGE_WEIGHTS.content * unit(c.content, 'content') +
    EDGE_WEIGHTS.emb * unit(c.emb, 'emb') +
    EDGE_WEIGHTS.profile * unit(c.profile, 'profile') +
    EDGE_WEIGHTS.cop * unit(c.cop ?? 0, 'cop');
  return Math.min(1, Math.max(0, w));
}

/**
 * The edges one Bev keeps: those with w ≥ `min`, heaviest first, at most `k`.
 * Ties on w go to the smaller `bevId` (code-unit order, SQL `collate "C"` for ASCII ids).
 * Throws on a duplicate `bevId` or a non-finite weight. Returns a new array; inputs are untouched.
 */
export function topEdges<T extends EdgeCandidate>(candidates: readonly T[], k: number = EDGE_TOP_K, min: number = EDGE_MIN_WEIGHT): T[] {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k must be a non-negative integer, got ${k}`);
  if (!Number.isFinite(min)) throw new RangeError(`min must be finite, got ${min}`);
  const seen = new Set<BevId>();
  for (const c of candidates) {
    if (seen.has(c.bevId)) throw new RangeError(`duplicate candidate ${c.bevId}`);
    seen.add(c.bevId);
    if (!Number.isFinite(c.w)) throw new RangeError(`weight of ${c.bevId} must be finite, got ${c.w}`);
  }
  return candidates
    .filter((c) => c.w >= min)
    .sort((a, b) => b.w - a.w || cmp(a.bevId, b.bevId))
    .slice(0, k);
}
