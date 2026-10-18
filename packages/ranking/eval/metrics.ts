// Ranking and calibration metrics, plus a paired bootstrap over users. Pure functions.

import { BUCKET_ORDER } from '../src/constants.ts';
import { createPrng, randomInt } from '../src/prng.ts';
import type { Bucket } from '../src/types.ts';

/** NDCG gain per bucket (docs/graph_db_implementation.md, Stage 1). */
export const BUCKET_GAIN: Readonly<Record<Bucket, number>> = { LOVED: 3, FINE: 1, DISLIKED: 0 };

/** One comparison's credit: 1 if the winner is predicted higher, 0.5 on a predicted tie, else 0. */
export function pairCredit(winnerPred: number, loserPred: number): number {
  return winnerPred > loserPred ? 1 : winnerPred === loserPred ? 0.5 : 0;
}

/** Ranks (1-based), ties get the average rank. */
export function averageRanks(xs: readonly number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const ranks = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1] as number] === xs[idx[i] as number]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k] as number] = r;
    i = j + 1;
  }
  return ranks;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

/**
 * Spearman ρ (Pearson on average ranks). null when undefined by the LABELS (fewer than 3 items, or
 * every actual equal), so every arm is scored on the same users; 0 when the predictions are constant.
 */
export function spearman(pred: readonly number[], actual: readonly number[]): number | null {
  if (pred.length !== actual.length) throw new RangeError('length mismatch');
  if (actual.length < 3 || actual.every((x) => x === actual[0])) return null;
  return pearson(averageRanks(pred), averageRanks(actual));
}

const discount = (p: number, k: number) => (p < k ? 1 / Math.log2(p + 2) : 0);

/**
 * Tie-aware NDCG@k (McSherry & Najork): Bevs with equal predictions share the mean discount of
 * the positions they span, so a constant predictor gets the expected NDCG of a random order rather
 * than whatever order ties happen to sort in. Linear gain (BUCKET_GAIN). null when the labels make
 * it undefined: fewer than 2 items, or ideal DCG = 0 (nothing but Disliked).
 */
export function ndcgAtK(items: ReadonlyArray<{ pred: number; gain: number }>, k = 10): number | null {
  if (items.length < 2) return null;
  const ideal = items.map((x) => x.gain).sort((a, b) => b - a);
  let idcg = 0;
  ideal.forEach((g, p) => (idcg += g * discount(p, k)));
  if (idcg === 0) return null;
  const sorted = [...items].sort((a, b) => b.pred - a.pred);
  let dcg = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && (sorted[j + 1] as { pred: number }).pred === (sorted[i] as { pred: number }).pred) j++;
    let d = 0;
    let g = 0;
    for (let p = i; p <= j; p++) {
      d += discount(p, k);
      g += (sorted[p] as { gain: number }).gain;
    }
    dcg += g * (d / (j - i + 1));
    i = j + 1;
  }
  return dcg / idcg;
}

export const bucketIndex = (b: Bucket): number => BUCKET_ORDER.indexOf(b);

/** 3×3 counts, rows = actual, columns = predicted, in BUCKET_ORDER (LOVED, FINE, DISLIKED). */
export function emptyConfusion(): number[][] {
  return BUCKET_ORDER.map(() => BUCKET_ORDER.map(() => 0));
}

/** Percentile with linear interpolation between order statistics (type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (h - lo);
}

export interface BootstrapResult {
  /** The statistic on the full sample. */
  point: number[];
  lo: number[];
  hi: number[];
}

/**
 * Paired percentile bootstrap: `iterations` resamples of `units` (users) with replacement, drawn
 * from createPrng(seed); every statistic in the vector is computed on the SAME resample, so a
 * difference between two arms placed in the vector gets a paired interval. NaN statistics in a
 * resample (e.g. no user with a comparison drawn) are skipped for that entry.
 */
export function pairedBootstrap<T>(
  units: readonly T[],
  stat: (sample: readonly T[]) => number[],
  opts: { iterations: number; seed: string; level?: number },
): BootstrapResult {
  const point = stat(units);
  const draws: number[][] = point.map(() => []);
  if (units.length > 0) {
    const rand = createPrng(opts.seed);
    const sample = new Array<T>(units.length);
    for (let it = 0; it < opts.iterations; it++) {
      for (let i = 0; i < units.length; i++) sample[i] = units[randomInt(rand, units.length)] as T;
      stat(sample).forEach((v, i) => {
        if (Number.isFinite(v)) (draws[i] as number[]).push(v);
      });
    }
  }
  const alpha = (1 - (opts.level ?? 0.95)) / 2;
  const lo: number[] = [];
  const hi: number[] = [];
  for (const d of draws) {
    d.sort((a, b) => a - b);
    lo.push(quantile(d, alpha));
    hi.push(quantile(d, 1 - alpha));
  }
  return { point, lo, hi };
}
