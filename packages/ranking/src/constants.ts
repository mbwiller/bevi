import type { Bucket } from './types.ts';

/** Bumped with any formula or constant change; equals the `version` field of every vectors file. */
export const RANKING_VERSION = '1.1.0';

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

// ---------------------------------------------------------------- global score (§8.6)

/** Shrinkage for a Bev's normalised global score: Σz / (n_b + K_G). */
export const K_G = 3;

// ---------------------------------------------------------------- content similarity (§8.8)

/** sim(b, b') = 0.40·sameCategory + 0.30·sameBrand + 0.20·jaccard(flavour tokens) + 0.10·tierCloseness. */
export const SIM_WEIGHTS: Readonly<{ category: number; brand: number; flavor: number; tier: number }> = {
  category: 0.4,
  brand: 0.3,
  flavor: 0.2,
  tier: 0.1,
};
/** Pairs with sim below this are dropped (contribute nothing to content or its mass). */
export const SIM_MIN = 0.1;
/** Largest |tier − tier'| (tiers 1–4). */
export const PRICE_TIER_SPAN = 3;
/** Words removed from flavour tokens ("sizes" are matched by FLAVOR_SIZE_PATTERN). */
export const FLAVOR_STOPWORDS: readonly string[] = [
  'original', 'classic', 'drink', 'can', 'bottle', 'oz', 'fl', 'ml', 'l', 'liter', 'litre', 'pack', 'mini', 'regular', 'large', 'small',
];
/** A size token: "12oz", "500ml", "2l", "20", "1.5". */
export const FLAVOR_SIZE_PATTERN = /^\d+(\.\d+)?(oz|floz|ml|cl|l|ltr|pk|pack|ct)?$/;

// ---------------------------------------------------------------- layer 1 (§8.8)

/** ẑ1 = 0.40·affinity + 0.40·content + 0.20·g_b. */
export const LAYER1_WEIGHTS: Readonly<{ affinity: number; content: number; global: number }> = {
  affinity: 0.4,
  content: 0.4,
  global: 0.2,
};
/** conf1 = min(1, n_u / CONF1_USER_N) · min(1, (n_{u,c} + Σsim) / CONF1_MASS). */
export const CONF1_USER_N = 10;
export const CONF1_MASS = 4;

// ---------------------------------------------------------------- layer 2 (§8.9)

/** Neighbours per prediction. */
export const CF_K = 10;
/** Users need at least this many common items for a non-zero similarity. */
export const CF_MIN_COMMON = 2;
/** Significance weighting: sim' = sim · min(|common|, CF_SIGNIFICANCE) / CF_SIGNIFICANCE. */
export const CF_SIGNIFICANCE = 5;

// ---------------------------------------------------------------- blend (§8.10)

/** λ = LAMBDA_MAX · support / (support + 1) · min(1, n_u / LAMBDA_USER_N). */
export const LAMBDA_MAX = 0.7;
export const LAMBDA_USER_N = 15;
/** Below this confidence the UI shows a locked bubble. */
export const CONFIDENCE_LOCK = 0.25;

// ---------------------------------------------------------------- exploration (§8.11)

/** Share of the list given to exploration picks: round(EPSILON · n) slots. */
export const EPSILON = 0.15;
/** Standard deviation of the ordering-only jitter added to ẑ. */
export const JITTER_SD = 0.15;
/** Default recommendation list length. */
export const RECOMMEND_N = 20;

// ---------------------------------------------------------------- starter set (§8.12)

export const STARTER_K = 10;
export const STARTER_CORE = 6;
export const STARTER_MAX_PER_CATEGORY = 2;
/** The drawn part aims for at least this many distinct categories across the whole set. */
export const STARTER_MIN_CATEGORIES = 5;

// ---------------------------------------------------------------- rank on Bevi (§8.13)

/** points = 1·bevsRanked + 3·currentStreak + 2·bevsCreated. */
export const RANK_POINTS_WEIGHTS: Readonly<{ bevsRanked: number; currentStreak: number; bevsCreated: number }> = {
  bevsRanked: 1,
  currentStreak: 3,
  bevsCreated: 2,
};

// ---------------------------------------------------------------- streaks (§8.14)

/** 'day' is the vision's definition; switching to 'week' is a constant change plus a vector regeneration. */
export const STREAK_PERIOD: 'day' | 'week' = 'day';

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
  kG: K_G,
  rankPointsWeights: RANK_POINTS_WEIGHTS,
  streakPeriod: STREAK_PERIOD,
  simWeights: SIM_WEIGHTS,
  simMin: SIM_MIN,
  layer1Weights: LAYER1_WEIGHTS,
  conf1UserN: CONF1_USER_N,
  conf1Mass: CONF1_MASS,
  cfK: CF_K,
  cfMinCommon: CF_MIN_COMMON,
  cfSignificance: CF_SIGNIFICANCE,
  lambdaMax: LAMBDA_MAX,
  lambdaUserN: LAMBDA_USER_N,
  epsilon: EPSILON,
  jitterSd: JITTER_SD,
} as const;
