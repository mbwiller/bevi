// The pairwise placement state machine: after the gut check picks a bucket, binary-search the
// user's ordered list for that bucket with "Which was better?" questions. Pure and immutable:
// every transition returns a new state, so the UI can keep history and undo freely.
//
// Anchored placement (LaTeX §10.1, Algorithm alg:anchored, M-21): when `startPlacement` is given a
// tier per bucket Bev, the members of the most similar non-empty tier are the ANCHORS, and the
// search runs in two phases. Phase 1 binary-searches the anchors only (every question is
// like-for-like); Phase 2 binary-searches the gap between the two anchors the new Bev landed
// between. The state's [lo, hi] is always the candidate insertion range in the full list, so
// `placementResult` is the same function in both modes and `submit_ranking` sees the same shape.
// Without tiers, or when no Bev has a tier, the machine is exactly 1.4.0's plain binary search.

import { EDGE_MIN_WEIGHT, PLACEMENT_TIER } from './constants.ts';
import type {
  BevId,
  Bucket,
  ComparisonAnswer,
  PlacementAnchors,
  PlacementBevKind,
  PlacementListBev,
  PlacementPhase,
  PlacementPrompt,
  PlacementResult,
  PlacementState,
  PlacementStep,
  PlacementTier,
  RankingComparison,
} from './types.ts';

/** Most questions a bucket of n Bevs can need: ceil(log2(n + 1)). n = 100 → 7, n = 1000 → 10. */
export function maxComparisons(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be an integer ≥ 0, got ${n}`);
  return 32 - Math.clz32(n);
}

/**
 * Most questions anchored placement of n Bevs with anchors at `positions` (ascending, in [0, n))
 * can need: ceil(log2(k + 1)) for Phase 1 plus ceil(log2(g_max + 1)) for Phase 2, g_max the widest
 * gap between consecutive anchors (or before the first / after the last). Equals maxComparisons(n)
 * when every Bev is an anchor. `positions` must be strictly ascending integers in [0, n).
 */
export function maxAnchoredComparisons(n: number, positions: readonly number[]): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be an integer ≥ 0, got ${n}`);
  let widest = 0;
  let prev = -1;
  for (const p of positions) {
    if (!Number.isInteger(p) || p <= prev || p >= n) {
      throw new RangeError(`anchor positions must be strictly ascending integers in [0, ${n}), got ${p} after ${prev}`);
    }
    widest = Math.max(widest, p - prev - 1);
    prev = p;
  }
  widest = Math.max(widest, n - prev - 1);
  return maxComparisons(positions.length) + maxComparisons(widest);
}

// ---------------------------------------------------------------- tiers (LaTeX §10.1, D-04 §3)

/**
 * The tier of one bucket Bev relative to the new one (PLACEMENT_TIER; null = none). The taxonomy
 * comes first because it is exact: 1 when both leaves are known and equal; 2 for the same root,
 * which is where a Bev of unknown kind (leaf null) lands against anything under its root, in either
 * direction, so "kind unknown" never reaches the same-leaf tier; 3 when the roots differ but
 * `bev_edges` holds the pair with w ≥ EDGE_MIN_WEIGHT (the stored edge reaches across roots, e.g.
 * Coca-Cola for a new Diet Coke when no diet soda is ranked). Anything else, including a weight
 * below the floor, is null. A leaf belongs to one root, so tier 1 also requires the same root; on
 * inconsistent data (one leaf id under two roots) the root decides.
 */
export function placementTier(newBev: PlacementBevKind, other: PlacementBevKind, weight?: number): PlacementTier {
  if (newBev.categoryId === other.categoryId) {
    const leaf = newBev.leafCategoryId ?? null;
    return leaf !== null && leaf === (other.leafCategoryId ?? null) ? PLACEMENT_TIER.sameLeaf : PLACEMENT_TIER.sameRoot;
  }
  if (weight !== undefined && weight >= EDGE_MIN_WEIGHT) return PLACEMENT_TIER.edge;
  return null;
}

/**
 * A tier per entry of `list` (the user's bucket list, in list order), for `startPlacement`'s
 * `tiers`. `weights` maps a bucket Bev's id to its stored edge weight w(newBev, it)
 * (`bevs.similarities`); omitted or absent means no edge. Without weights the result is the
 * taxonomy rule alone (tiers 1 and 2).
 */
export function placementTiers(
  newBev: PlacementBevKind,
  list: readonly PlacementListBev[],
  weights?: ReadonlyMap<BevId, number>,
): PlacementTier[] {
  return list.map((b) => placementTier(newBev, b, weights?.get(b.id)));
}

// ---------------------------------------------------------------- the state machine

/**
 * Begin placing `bevId` into `bucket`. `orderedBevIds` is the user's list for that bucket, best first.
 * On a re-rank the Bev may still be in it; it is filtered out here. An empty list is DONE at index 0.
 *
 * `tiers` (optional) makes the placement anchored: one PlacementTier per entry of `orderedBevIds`
 * (`placementTiers`). The anchors are the entries of the smallest tier present, in list order. With
 * no tiers, or with no tiered entry, the result is the plain state of 1.4.0, field for field.
 */
export function startPlacement(input: {
  bevId: BevId;
  bucket: Bucket;
  orderedBevIds: readonly BevId[];
  tiers?: readonly PlacementTier[];
}): PlacementState {
  const list = input.orderedBevIds.filter((id) => id !== input.bevId);
  if (new Set(list).size !== list.length) throw new RangeError('bucket list contains duplicate Bev ids');
  const plain: PlacementState = {
    bevId: input.bevId,
    bucket: input.bucket,
    list,
    lo: 0,
    hi: list.length,
    history: [],
    status: list.length === 0 ? 'DONE' : 'COMPARING',
  };
  if (input.tiers === undefined) return plain;
  const positions = anchorPositions(input.orderedBevIds, input.bevId, input.tiers);
  if (positions.length === 0) return plain;
  return { ...plain, anchored: { positions, lo: 0, hi: positions.length } };
}

/** Positions in the filtered list of the Bevs in the smallest tier present (the paper's p_1 < … < p_k). */
function anchorPositions(orderedBevIds: readonly BevId[], bevId: BevId, tiers: readonly PlacementTier[]): number[] {
  if (tiers.length !== orderedBevIds.length) {
    throw new RangeError(`tiers has ${tiers.length} entries for a list of ${orderedBevIds.length}`);
  }
  // The smallest tier among the OTHER Bevs: on a re-rank the list still holds `bevId`, and its tier
  // against itself (1, or 2 with an unknown leaf) must not decide the anchors.
  let best = Infinity;
  tiers.forEach((t, i) => {
    if (orderedBevIds[i] === bevId || t === null || t === undefined) return;
    if (typeof t !== 'number' || Number.isNaN(t)) throw new RangeError(`a tier must be a number or null, got ${String(t)}`);
    if (t < best) best = t;
  });
  const positions: number[] = [];
  let p = 0;
  orderedBevIds.forEach((id, i) => {
    if (id === bevId) return;
    if (tiers[i] === best) positions.push(p);
    p++;
  });
  return positions;
}

/** Phase 1 is running: anchored, with more than one candidate anchor slot. */
function inAnchorPhase(s: PlacementState): s is PlacementState & { anchored: PlacementAnchors } {
  return s.anchored !== undefined && s.anchored.lo < s.anchored.hi;
}

/** The position in `list` of the Bev the current question is about. */
function comparedPosition(s: PlacementState): number {
  if (inAnchorPhase(s)) return s.anchored.positions[Math.floor((s.anchored.lo + s.anchored.hi) / 2)] as number;
  return Math.floor((s.lo + s.hi) / 2);
}

export function isDone(s: PlacementState): boolean {
  return s.status === 'DONE';
}

/**
 * Which search the current question belongs to ('ANCHORS' is Phase 1, every question like-for-like;
 * 'GAP' is Phase 2; 'PLAIN' has no anchors). Once done, the phase of the last question.
 */
export function placementPhase(s: PlacementState): PlacementPhase {
  if (s.anchored === undefined) return 'PLAIN';
  if (!isDone(s)) return inAnchorPhase(s) ? 'ANCHORS' : 'GAP';
  const last = s.history[s.history.length - 1];
  return last?.anchored !== undefined && last.anchored.lo < last.anchored.hi ? 'ANCHORS' : 'GAP';
}

/** The Bev to compare against next, or null when placement is done. */
export function currentPrompt(s: PlacementState): PlacementPrompt | null {
  if (isDone(s)) return null;
  return {
    comparedBevId: s.list[comparedPosition(s)] as BevId,
    step: s.history.length + 1,
    maxSteps: s.anchored === undefined ? maxComparisons(s.list.length) : maxAnchoredComparisons(s.list.length, s.anchored.positions),
  };
}

/**
 * Apply an answer to the current prompt.
 * NEW_BETTER → the new Bev goes above the incumbent; EXISTING_BETTER → below it;
 * TIE ("Too close to call") → directly below it, ending the search (the incumbent was ranked first).
 * In Phase 1 the answer moves the anchor-slot range and [lo, hi] follows it (Algorithm alg:anchored
 * line 5); a Phase 1 tie ends the whole placement at p_j + 1 (line 3). Phase 2 is the plain search.
 */
export function answer(s: PlacementState, a: ComparisonAnswer): PlacementState {
  if (isDone(s)) throw new Error('placement is already done');
  if (inAnchorPhase(s)) return answerAnchor(s, a);
  const m = comparedPosition(s);
  const step: PlacementStep = { comparedBevId: s.list[m] as BevId, answer: a, lo: s.lo, hi: s.hi, ...anchoredStep(s) };
  let lo = s.lo;
  let hi = s.hi;
  if (a === 'NEW_BETTER') hi = m;
  else if (a === 'EXISTING_BETTER') lo = m + 1;
  else lo = hi = m + 1;
  return { ...s, lo, hi, history: [...s.history, step], status: lo === hi ? 'DONE' : 'COMPARING' };
}

function anchoredStep(s: PlacementState): { anchored?: PlacementStep['anchored'] } {
  return s.anchored === undefined ? {} : { anchored: { lo: s.anchored.lo, hi: s.anchored.hi } };
}

function answerAnchor(s: PlacementState & { anchored: PlacementAnchors }, a: ComparisonAnswer): PlacementState {
  const { positions, lo: aLo, hi: aHi } = s.anchored;
  const j = Math.floor((aLo + aHi) / 2);
  const p = positions[j] as number;
  const step: PlacementStep = { comparedBevId: s.list[p] as BevId, answer: a, lo: s.lo, hi: s.hi, anchored: { lo: aLo, hi: aHi } };
  let lo: number;
  let hi: number;
  let nextLo = aLo;
  let nextHi = aHi;
  if (a === 'TIE') {
    nextLo = nextHi = j + 1;
    lo = hi = p + 1;
  } else {
    if (a === 'NEW_BETTER') nextHi = j;
    else nextLo = j + 1;
    lo = nextLo === 0 ? 0 : (positions[nextLo - 1] as number) + 1;
    hi = nextHi === positions.length ? s.list.length : (positions[nextHi] as number);
  }
  return {
    ...s,
    lo,
    hi,
    history: [...s.history, step],
    status: lo === hi ? 'DONE' : 'COMPARING',
    anchored: { positions, lo: nextLo, hi: nextHi },
  };
}

/** Take back the last answer. No-op when nothing has been answered. Crosses the phase boundary. */
export function undo(s: PlacementState): PlacementState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;
  const back: PlacementState = { ...s, lo: last.lo, hi: last.hi, history: s.history.slice(0, -1), status: 'COMPARING' };
  if (s.anchored === undefined || last.anchored === undefined) return back;
  return { ...back, anchored: { positions: s.anchored.positions, lo: last.anchored.lo, hi: last.anchored.hi } };
}

/** What `submitRanking` / `rerankBev` sends. Every comparison is included, in the order asked. */
export function placementResult(s: PlacementState): PlacementResult {
  if (!isDone(s)) throw new Error('placement is not done');
  const comparisons: RankingComparison[] = s.history.map((h) =>
    h.answer === 'NEW_BETTER'
      ? { winnerBevId: s.bevId, loserBevId: h.comparedBevId, tie: false }
      : { winnerBevId: h.comparedBevId, loserBevId: s.bevId, tie: h.answer === 'TIE' },
  );
  return {
    bevId: s.bevId,
    bucket: s.bucket,
    insertIndex: s.lo,
    expectedBucketSize: s.list.length,
    comparisons,
  };
}

/** The bucket list without `bevId` (removal; also the list a re-rank searches). */
export function removeFromBucket(orderedBevIds: readonly BevId[], bevId: BevId): BevId[] {
  return orderedBevIds.filter((id) => id !== bevId);
}
