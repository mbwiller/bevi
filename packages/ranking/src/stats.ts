// Per-Bev and per-user statistics, z-scores and category affinity.
// Every standard deviation is POPULATION (divide by n, SQL stddev_pop): n = 1 gives 0, not NULL.

import { GLOBAL_FALLBACK, K_AFF, MIN_N_CAT, MIN_N_USER, SIGMA_FLOOR } from './constants.ts';
import type { CategoryId, MeanStd, ScoredRanking, Stats, UserStats } from './types.ts';

/**
 * n, mean and population stddev. For n = 0 returns mean 0 and stddev 0; callers check n
 * (SQL returns NULL there, so the vectors don't cover n = 0).
 */
export function populationStats(values: readonly number[]): Stats {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, stddev: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return { n, mean, stddev: Math.sqrt(sq / n) };
}

/** The global stats to normalise against: the GLOBAL_FALLBACK only when the system has no rankings. */
export function effectiveGlobalStats(global: Stats): MeanStd {
  if (global.n === 0) return { mean: GLOBAL_FALLBACK.mean, stddev: Math.max(GLOBAL_FALLBACK.stddev, SIGMA_FLOOR) };
  return { mean: global.mean, stddev: Math.max(global.stddev, SIGMA_FLOOR) };
}

/** A user's own stats once they have MIN_N_USER rankings, else the global ones; stddev floored at SIGMA_FLOOR. */
export function effectiveUserStats(user: Stats, global: Stats): MeanStd {
  if (user.n >= MIN_N_USER) return { mean: user.mean, stddev: Math.max(user.stddev, SIGMA_FLOOR) };
  return effectiveGlobalStats(global);
}

/**
 * Per-category stats for display ("Your Soda average"), falling back to the user's effective
 * overall stats below MIN_N_CAT rankings. Not on the prediction path (Layer 1 uses affinity
 * against the OVERALL stats), and nothing in app/, packages/api or SQL calls it today: the Taste
 * Profile shows raw means (paper §10.2). Kept (M-22 decision) as the display helper, as the eval
 * harness's `user-category-mean` baseline, and because `user-stats.vectors.json` pins it.
 */
export function effectiveCategoryStats(category: Stats, userEffective: MeanStd): MeanStd {
  if (category.n >= MIN_N_CAT) return { mean: category.mean, stddev: Math.max(category.stddev, SIGMA_FLOOR) };
  return userEffective;
}

/** z = (score − mean) / stddev. Pass effective stats, whose stddev is already floored. */
export function zScore(score: number, stats: MeanStd): number {
  if (!(stats.stddev > 0)) throw new RangeError(`stddev must be > 0, got ${stats.stddev}`);
  return (score - stats.mean) / stats.stddev;
}

/**
 * A user's affinity for a category: the mean of their z-scores there, shrunk toward 0 (neutral):
 * Σz / (n + K_AFF). The z-scores must use the user's OVERALL stats; per-category z-scores would
 * make every affinity 0 by construction.
 */
export function categoryAffinity(zs: readonly number[]): number {
  let sum = 0;
  for (const z of zs) sum += z;
  return sum / (zs.length + K_AFF);
}

/** A user's overall and per-category stats from their stored scores. */
export function userStats(rankings: readonly ScoredRanking[]): UserStats {
  const byCat = new Map<CategoryId, number[]>();
  for (const r of rankings) {
    const list = byCat.get(r.categoryId);
    if (list) list.push(r.score);
    else byCat.set(r.categoryId, [r.score]);
  }
  const byCategory: Record<CategoryId, Stats> = {};
  for (const id of [...byCat.keys()].sort()) byCategory[id] = populationStats(byCat.get(id) as number[]);
  return { overall: populationStats(rankings.map((r) => r.score)), byCategory };
}
