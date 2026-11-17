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

/**
 * Unicode code-point string order (SQL: `collate "C"` on UTF-8, i.e. byte order), so JS and
 * Postgres sort names identically. JS `<` compares UTF-16 code units, which puts every astral
 * character (a surrogate pair, 0xD800–0xDFFF) before U+E000–U+FFFF: "😀" (U+1F600) < "�" in
 * JS but not under C. This walks both strings a code point at a time instead; a lone surrogate
 * counts as its own code unit. Returns −1, 0 or 1. (Fixed in 1.3.0; it used `<` before.)
 */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(i) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1; // equal code points span the same units in both strings
  }
  return i < a.length ? 1 : i < b.length ? -1 : 0;
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
