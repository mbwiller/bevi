import type { Bucket } from './types.ts';

/** Bumped with any formula or constant change; equals the `version` field of every vectors file. */
export const RANKING_VERSION = '1.0.0';

/**
 * Score band per bucket as integer [lo, hi] edges on the 0–10 scale (Beli-style 7 / 4, decided 2026-10-09).
 * LOVED is [7, 10]; FINE [4, 7) and DISLIKED [0, 4) exclude their top edge.
 * Integer edges let stored scores be computed exactly (see score.ts).
 */
export const BANDS: Readonly<Record<Bucket, readonly [lo: number, hi: number]>> = {
  DISLIKED: [0, 4],
  FINE: [4, 7],
  LOVED: [7, 10],
};

/** Best bucket first: the order of a user's full list. */
export const BUCKET_ORDER: readonly Bucket[] = ['LOVED', 'FINE', 'DISLIKED'];

/** DB encoding (smallint), for SQL harnesses reading the vectors. The app never sees these. */
export const BUCKET_DB: Readonly<Record<Bucket, number>> = { LOVED: 3, FINE: 2, DISLIKED: 1 };

/** Floor on any standard deviation used for z-scores, on the 0–10 scale. */
export const SIGMA_FLOOR = 1.0;
/** Below this many rankings a user's z-scores use the global stats. */
export const MIN_N_USER = 3;
/** Below this many rankings in a category, per-category stats fall back to the user's overall stats. */
export const MIN_N_CAT = 3;
/** Only when there are zero rankings in the whole system. */
export const GLOBAL_FALLBACK: Readonly<{ mean: number; stddev: number }> = { mean: 5.0, stddev: 2.5 };

/** Shrinkage for category affinity: Σz / (n + K_AFF). */
export const K_AFF = 2;

/** Bayesian leaderboard prior weight, in equivalent ratings. Raise to 5 once the median rating_count passes 10. */
export const BAYES_C = 3;
/** A category's own mean becomes its prior once it has this many rankings. */
export const BAYES_CATEGORY_PRIOR_MIN = 30;
/** Leaderboard eligibility; Bevs below it appear in the "New" strip. */
export const MIN_RATERS = 2;

/** Everything a SQL twin or the vectors need, in one object. */
export const RANKING_CONSTANTS = {
  version: RANKING_VERSION,
  bands: BANDS,
  bucketOrder: BUCKET_ORDER,
  bucketDb: BUCKET_DB,
  sigmaFloor: SIGMA_FLOOR,
  minNUser: MIN_N_USER,
  minNCat: MIN_N_CAT,
  globalFallback: GLOBAL_FALLBACK,
  kAff: K_AFF,
  bayesC: BAYES_C,
  bayesCategoryPriorMin: BAYES_CATEGORY_PRIOR_MIN,
  minRaters: MIN_RATERS,
} as const;
