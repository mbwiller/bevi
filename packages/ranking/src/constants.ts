import type { Bucket, TasteAttributeKind } from './types.ts';

/** Bumped with any formula or constant change; equals the `version` field of every vectors file. */
export const RANKING_VERSION = '1.3.0';

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

// ---------------------------------------------------------------- Bev-graph edges (LaTeX §10.1)

/**
 * w = 0.25·tree + 0.15·content + 0.30·emb + 0.30·profile + 0·cop (eq. 18, decided 2026-10-14).
 * Switching cop on renormalises the other four; that is a constant change and a version bump.
 */
export const EDGE_WEIGHTS: Readonly<{ tree: number; content: number; emb: number; profile: number; cop: number }> = {
  tree: 0.25,
  content: 0.15,
  emb: 0.3,
  profile: 0.3,
  cop: 0,
};
/** Edges kept per Bev (K_E). */
export const EDGE_TOP_K = 20;
/** Edges lighter than this are not kept. */
export const EDGE_MIN_WEIGHT = 0.3;
/** Profile similarity (eq. 17): base family, flags, and closeness on the 0–3 caffeine and sweetness scales. */
export const PROFILE_WEIGHTS: Readonly<{
  base: number;
  carbonated: number;
  dairy: number;
  alcohol: number;
  caffeine: number;
  sweetness: number;
}> = {
  base: 0.4,
  carbonated: 0.15,
  dairy: 0.1,
  alcohol: 0.05,
  caffeine: 0.15,
  sweetness: 0.15,
};
/** Largest |Δcaffeine| or |Δsweetness| (levels 0–3). */
export const PROFILE_LEVEL_SPAN = 3;

// ---------------------------------------------------------------- taste neighbourhoods (graph.ts)
// docs/graph_db_implementation.md §2 approach B, §5 and Stage 3 (TASKS.md M-28); "line N" below is
// that file's line. The Pearson term reuses CF_MIN_COMMON (2) and CF_SIGNIFICANCE (5) above: the
// doc's "α = 0 below 2 common items" and its min(1, |common| / 5) are §8.9's two numbers, and
// sharing them keeps Layer 2's in-snapshot Pearson and the nightly job's identical.

/** Shrinkage of a taste-vector entry: t_u[a] = Σz / (n_{u,a} + TASTE_K). The doc's K_T = 2 (line 255). */
export const TASTE_K = 2;
/** Attributes covering fewer catalog Bevs than this are left out of every taste vector (line 269). */
export const TASTE_MIN_ATTR_BEVS = 2;
/** α, the Pearson weight of the blend when |common| ≥ CF_MIN_COMMON; α = 0 below that (line 264). */
export const TASTE_ALPHA = 0.5;
/** An attribute is shared by two users when both |t| are at least this (line 274). */
export const TASTE_SHARED_MIN = 0.2;
/** The attribute term counts only for pairs sharing at least this many bridging attributes (line 274). */
export const TASTE_MIN_SHARED_ATTRS = 2;
/**
 * The attribute kinds that bridge two users. The doc's candidate query (line 393) matches
 * `a:Flavor OR a:Brand`; categories stay in the taste vector but are too coarse to bridge on
 * their own (15 of them, so most users share one).
 */
export const TASTE_BRIDGE_KINDS: readonly TasteAttributeKind[] = ['brand', 'flavor'];
/** Neighbours below this similarity are not kept (line 274's "similarity floor"). */
export const TASTE_SIM_FLOOR = 0.1;
/** Neighbours kept per user in `user_neighbors` (line 275). Layer 2 still uses the top CF_K of them per Bev. */
export const TASTE_NEIGHBOUR_K = 25;
/**
 * N₀ of the reliability weight min(1, n_v / N₀) (line 419). The doc leaves it open; 15 is chosen to
 * equal LAMBDA_USER_N, the history at which Layer 2 is trusted fully for the user themself, so a
 * neighbour earns full weight at the same point. A user fresh from onboarding (10 starter Bevs)
 * counts 2/3 and one at MIN_N_USER = 3 counts 1/5. Tune it with the eval harness, like the others.
 */
export const NEIGHBOUR_RELIABILITY_N = 15;

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
  edgeWeights: EDGE_WEIGHTS,
  edgeTopK: EDGE_TOP_K,
  edgeMinWeight: EDGE_MIN_WEIGHT,
  profileWeights: PROFILE_WEIGHTS,
  profileLevelSpan: PROFILE_LEVEL_SPAN,
  tasteK: TASTE_K,
  tasteMinAttrBevs: TASTE_MIN_ATTR_BEVS,
  tasteAlpha: TASTE_ALPHA,
  tasteSharedMin: TASTE_SHARED_MIN,
  tasteMinSharedAttrs: TASTE_MIN_SHARED_ATTRS,
  tasteBridgeKinds: TASTE_BRIDGE_KINDS,
  tasteSimFloor: TASTE_SIM_FLOOR,
  tasteNeighbourK: TASTE_NEIGHBOUR_K,
  neighbourReliabilityN: NEIGHBOUR_RELIABILITY_N,
} as const;
