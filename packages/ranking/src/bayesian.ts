// Bayesian average for the leaderboard: pulls Bevs with few ratings toward a prior mean so one
// 10/10 from one person can't top the chart.

import { BAYES_CATEGORY_PRIOR_MIN, GLOBAL_FALLBACK, MIN_RATERS } from './constants.ts';
import type { BevId, LeaderboardInputRow, Stats } from './types.ts';

/** (C·m + n·mean) / (C + n), with C = BAYES_C normally. With n = 0 this is the prior m. */
export function bayesianAverage(mean: number, n: number, prior: { m: number; C: number }): number {
  if (n === 0) return prior.m;
  return (prior.C * prior.m + n * mean) / (prior.C + n);
}

/** Prior mean for the overall board: the mean of all stored scores (fallback when there are none). */
export function globalPrior(global: Stats): number {
  return global.n > 0 ? global.mean : GLOBAL_FALLBACK.mean;
}

/** Prior mean for a per-category board: the category's own mean once it has BAYES_CATEGORY_PRIOR_MIN rankings. */
export function categoryPrior(category: Stats, global: Stats): number {
  return category.n >= BAYES_CATEGORY_PRIOR_MIN ? category.mean : globalPrior(global);
}

export function isLeaderboardEligible(n: number): boolean {
  return n >= MIN_RATERS;
}

/** Code-point string order (SQL: `collate "C"`), so JS and Postgres sort names identically. */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Eligible Bevs (n ≥ MIN_RATERS) in leaderboard order: bayes desc, n desc, name asc (code points),
 * then bevId asc so the order is total. Bevs with one rater belong in the "New" strip instead.
 */
export function leaderboardOrder(rows: readonly LeaderboardInputRow[]): BevId[] {
  return rows
    .filter((r) => isLeaderboardEligible(r.n))
    .sort((a, b) => b.bayes - a.bayes || b.n - a.n || compareCodePoints(a.name, b.name) || compareCodePoints(a.bevId, b.bevId))
    .map((r) => r.bevId);
}
