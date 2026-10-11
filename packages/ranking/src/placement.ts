// The pairwise placement state machine: after the gut check picks a bucket, binary-search the
// user's ordered list for that bucket with "Which was better?" questions. Pure and immutable:
// every transition returns a new state, so the UI can keep history and undo freely.

import type {
  BevId,
  Bucket,
  ComparisonAnswer,
  PlacementPrompt,
  PlacementResult,
  PlacementState,
  RankingComparison,
} from './types.ts';

/** Most questions a bucket of n Bevs can need: ceil(log2(n + 1)). n = 100 → 7, n = 1000 → 10. */
export function maxComparisons(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be an integer ≥ 0, got ${n}`);
  return 32 - Math.clz32(n);
}

/**
 * Begin placing `bevId` into `bucket`. `orderedBevIds` is the user's list for that bucket, best first.
 * On a re-rank the Bev may still be in it; it is filtered out here. An empty list is DONE at index 0.
 */
export function startPlacement(input: { bevId: BevId; bucket: Bucket; orderedBevIds: readonly BevId[] }): PlacementState {
  const list = input.orderedBevIds.filter((id) => id !== input.bevId);
  if (new Set(list).size !== list.length) throw new RangeError('bucket list contains duplicate Bev ids');
  return {
    bevId: input.bevId,
    bucket: input.bucket,
    list,
    lo: 0,
    hi: list.length,
    history: [],
    status: list.length === 0 ? 'DONE' : 'COMPARING',
  };
}

function mid(s: PlacementState): number {
  return Math.floor((s.lo + s.hi) / 2);
}

export function isDone(s: PlacementState): boolean {
  return s.status === 'DONE';
}

/** The Bev to compare against next, or null when placement is done. */
export function currentPrompt(s: PlacementState): PlacementPrompt | null {
  if (isDone(s)) return null;
  return {
    comparedBevId: s.list[mid(s)] as BevId,
    step: s.history.length + 1,
    maxSteps: maxComparisons(s.list.length),
  };
}

/**
 * Apply an answer to the current prompt.
 * NEW_BETTER → the new Bev goes above the incumbent; EXISTING_BETTER → below it;
 * TIE ("Too close to call") → directly below it, ending the search (the incumbent was ranked first).
 */
export function answer(s: PlacementState, a: ComparisonAnswer): PlacementState {
  if (isDone(s)) throw new Error('placement is already done');
  const m = mid(s);
  const step = { comparedBevId: s.list[m] as BevId, answer: a, lo: s.lo, hi: s.hi };
  let lo = s.lo;
  let hi = s.hi;
  if (a === 'NEW_BETTER') hi = m;
  else if (a === 'EXISTING_BETTER') lo = m + 1;
  else lo = hi = m + 1;
  return { ...s, lo, hi, history: [...s.history, step], status: lo === hi ? 'DONE' : 'COMPARING' };
}

/** Take back the last answer. No-op when nothing has been answered. */
export function undo(s: PlacementState): PlacementState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;
  return { ...s, lo: last.lo, hi: last.hi, history: s.history.slice(0, -1), status: 'COMPARING' };
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
