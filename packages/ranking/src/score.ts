import { BANDS } from './constants.ts';
import type { BevId, Bucket, RespacedRanking } from './types.ts';

function assertPosition(index: number, n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`bucket size must be an integer ≥ 1, got ${n}`);
  if (!Number.isInteger(index) || index < 0 || index >= n) {
    throw new RangeError(`index must be an integer in [0, ${n - 1}], got ${index}`);
  }
}

/** floor(a / b) for integers a ≥ 0, b > 0, without float rounding. */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/**
 * Unrounded score of the Bev at `index` (0 = best) in a bucket of `n` Bevs:
 * hi − (hi − lo)·(index + 1)/(n + 1). Always strictly inside (lo, hi).
 * Use for display maths and z-scores of hypothetical positions; storage uses `storedScoreCents`.
 */
export function scoreFromPosition(index: number, n: number, bucket: Bucket): number {
  assertPosition(index, n);
  const [lo, hi] = BANDS[bucket];
  return hi - ((hi - lo) * (index + 1)) / (n + 1);
}

/**
 * The stored score in integer hundredths, computed exactly so JS and SQL always agree.
 *
 *   D = n + 1,  N = 100·(hi·D − (hi − lo)·(index + 1))      (= 100·score·D, an integer)
 *   cents = floor((2N + D) / (2D))                           (round half up)
 *   FINE and DISLIKED exclude their top edge, so cents ≤ hi·100 − 1 there.
 *
 * SQL twin (integer division truncates, all terms are positive):
 *   least((200*(hi*(n+1) - w*(i+1)) + (n+1)) / (2*(n+1)), max_cents)
 * The cap only bites for huge buckets: FINE's top would round up to 7.00 from n = 599, DISLIKED's to 4.00 from n = 799.
 */
export function storedScoreCents(index: number, n: number, bucket: Bucket): number {
  assertPosition(index, n);
  const [lo, hi] = BANDS[bucket];
  const d = n + 1;
  const num = 100 * (hi * d - (hi - lo) * (index + 1));
  const cents = floorDiv(2 * num + d, 2 * d);
  const maxCents = bucket === 'LOVED' ? hi * 100 : hi * 100 - 1;
  return Math.min(cents, maxCents);
}

/** The stored score (2 dp) of the Bev at `index` in a bucket of `n`. */
export function storedScore(index: number, n: number, bucket: Bucket): number {
  return storedScoreCents(index, n, bucket) / 100;
}

/** The bucket a score falls in: ≥ 7 LOVED, ≥ 4 FINE, else DISLIKED. Also the score colour rule. */
export function bucketForScore(score: number): Bucket {
  if (score >= BANDS.LOVED[0]) return 'LOVED';
  if (score >= BANDS.FINE[0]) return 'FINE';
  return 'DISLIKED';
}

function assertUnique(ids: readonly BevId[]): void {
  if (new Set(ids).size !== ids.length) throw new RangeError('bucket list contains duplicate Bev ids');
}

/** Positions and stored scores for every Bev in a bucket, best first. Run after every insert or removal. */
export function respaceBucket(orderedBevIds: readonly BevId[], bucket: Bucket): RespacedRanking[] {
  assertUnique(orderedBevIds);
  const n = orderedBevIds.length;
  return orderedBevIds.map((bevId, position) => ({ bevId, position, score: storedScore(position, n, bucket) }));
}

/** The bucket list with `bevId` inserted at `insertIndex` (0 = best). */
export function insertIntoBucket(orderedBevIds: readonly BevId[], bevId: BevId, insertIndex: number): BevId[] {
  if (orderedBevIds.includes(bevId)) throw new RangeError(`${bevId} is already in the bucket`);
  if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > orderedBevIds.length) {
    throw new RangeError(`insertIndex must be an integer in [0, ${orderedBevIds.length}], got ${insertIndex}`);
  }
  return [...orderedBevIds.slice(0, insertIndex), bevId, ...orderedBevIds.slice(insertIndex)];
}
