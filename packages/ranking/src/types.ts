// Domain types used by @bevi/ranking. They mirror shared/ (contract v0) structurally;
// contract v1 re-exports the ranking-specific ones (PlacementResult, snapshots) through shared/.

export type BevId = string;
export type UserId = string;
export type CategoryId = string;

/** Gut-check bucket. The DB stores smallint 3/2/1; packages/api maps it. */
export type Bucket = 'LOVED' | 'FINE' | 'DISLIKED';

/** One answer to "Which was better?". TIE is "Too close to call". */
export type ComparisonAnswer = 'NEW_BETTER' | 'EXISTING_BETTER' | 'TIE';

/** A logged comparison, exactly as sent to `submitRanking` / `rerankBev`. */
export interface RankingComparison {
  winnerBevId: BevId;
  loserBevId: BevId;
  tie: boolean;
}

/**
 * A bucket Bev's tier in anchored placement (LaTeX §10.1, `placementTiers`): a smaller number is
 * more similar to the new Bev; null is "no tier" (never an anchor). PLACEMENT_TIER names the values.
 */
export type PlacementTier = number | null;

/**
 * What `placementTiers` reads about a Bev: its root category (`bevs.category_id`, one of the 15
 * roots) and its leaf (`bevs.leaf_category_id`), null when no finer placement is known (the
 * unsplit roots `water` and `sports`, a user-created Bev, a Bev the taxonomy left on its parent).
 */
export interface PlacementBevKind {
  categoryId: CategoryId;
  leafCategoryId: CategoryId | null;
}

/** A bucket Bev as `placementTiers` sees it (`rankings.listBucketBevs` joined with `bevs.leaves`). */
export interface PlacementListBev extends PlacementBevKind {
  id: BevId;
}

/** Phase 1 of anchored placement: the binary search over the anchors (LaTeX Algorithm alg:anchored). */
export interface PlacementAnchors {
  /** Positions in `list` of the anchors, ascending: the paper's p_1 < … < p_k, 0-based. */
  readonly positions: readonly number[];
  /**
   * Candidate anchor slots [lo, hi] ⊆ [0, k]. Phase 1 runs while lo < hi; once lo = hi = j*, the
   * state's own [lo, hi] is the gap between anchors j* and j* + 1 and Phase 2 searches it.
   */
  readonly lo: number;
  readonly hi: number;
}

/** The range [lo, hi] and the question asked, captured BEFORE an answer (for undo and the log). */
export interface PlacementStep {
  readonly comparedBevId: BevId;
  readonly answer: ComparisonAnswer;
  readonly lo: number;
  readonly hi: number;
  /** The anchor-slot range before the answer; present exactly when the placement is anchored. */
  readonly anchored?: { readonly lo: number; readonly hi: number };
}

export interface PlacementState {
  readonly bevId: BevId;
  readonly bucket: Bucket;
  /** The user's ordered Bevs in `bucket`, best first, excluding `bevId`. */
  readonly list: readonly BevId[];
  /** Candidate insertion range, 0 ≤ lo ≤ hi ≤ list.length. */
  readonly lo: number;
  readonly hi: number;
  readonly history: readonly PlacementStep[];
  readonly status: 'COMPARING' | 'DONE';
  /**
   * Anchored placement (LaTeX §10.1, M-21). Absent in a plain binary search, which is also what an
   * anchored start with no anchors produces, so a state without this field is exactly 1.4.0's.
   */
  readonly anchored?: PlacementAnchors;
}

/** Which search a question belongs to: the anchors (like-for-like), the gap between two anchors, or a plain search. */
export type PlacementPhase = 'PLAIN' | 'ANCHORS' | 'GAP';

export interface PlacementPrompt {
  comparedBevId: BevId;
  /** 1-based number of the question being asked. */
  step: number;
  /**
   * The most questions this placement can take: maxComparisons(list.length), or for an anchored
   * placement maxAnchoredComparisons(list.length, anchor positions). Constant for the whole placement.
   */
  maxSteps: number;
}

export interface PlacementResult {
  bevId: BevId;
  bucket: Bucket;
  /** 0 = best in the bucket, expectedBucketSize = append at the bottom. */
  insertIndex: number;
  /** Length of the list that was searched; the server answers `conflict` if its count differs. */
  expectedBucketSize: number;
  comparisons: RankingComparison[];
}

export interface RespacedRanking {
  bevId: BevId;
  position: number;
  /** Stored score, 2 dp. */
  score: number;
}

export interface Stats {
  n: number;
  mean: number;
  stddev: number;
}

export interface MeanStd {
  mean: number;
  stddev: number;
}

export interface ScoredRanking {
  bevId: BevId;
  categoryId: CategoryId;
  score: number;
}

export interface UserStats {
  overall: Stats;
  byCategory: Record<CategoryId, Stats>;
}

export interface LeaderboardInputRow {
  bevId: BevId;
  bayes: number;
  n: number;
  name: string;
}

// ---------------------------------------------------------------- predictions (§8.8–§8.11, §9)

export type PriceTier = 1 | 2 | 3 | 4;

/** What prediction needs to know about a Bev. `brandKey` and `flavorTokens` are pre-normalised by the snapshot builder. */
export interface BevFeatures {
  id: BevId;
  categoryId: CategoryId;
  /** Normalised brand (see `normaliseBrand`); null or '' when unknown. */
  brandKey: string | null;
  /** See `flavorTokens(name, flavor)`. */
  flavorTokens: string[];
  priceTier: PriceTier;
  ratingCount: number;
  mean: number;
  stddev: number;
  isAlcoholic: boolean;
}

export interface UserSnapshot {
  id: UserId;
  /** Overall stats over ALL the user's stored scores (population stddev). */
  stats: Stats;
  categoryStats: Record<CategoryId, Stats>;
  canSeeAlcohol: boolean;
}

/**
 * One stored Bev-graph edge (`bev_edges`, LaTeX §10.1): the weight w(a, b) of an unordered pair.
 * `a` and `b` may come in either orientation (`bev_edges` stores src < dst); `w` is in [0, 1].
 */
export interface BevEdge {
  a: BevId;
  b: BevId;
  w: number;
}

/** Everything `predictScore` / `recommend` read. Treated as immutable once passed in. */
export interface PredictionSnapshot {
  /** Must equal RANKING_VERSION of the consuming bundle; otherwise the functions throw. */
  version: string;
  /** ISO; informational only. */
  generatedAt: string;
  /**
   * `byCategoryMean` (the mean stored score per category) is read by no prediction formula: Layer 1
   * uses affinity in z-units, and `categoryPrior` needs the category's n as well as its mean. It is
   * kept because the eval harness's `category-mean` baseline reads it (TASKS.md M-26), and because
   * dropping it would change `get_prediction_snapshot` and packages/api (Arjun's lane) for no gain.
   */
  global: { mean: number; stddev: number; byCategoryMean: Record<CategoryId, number> };
  bevs: Record<BevId, BevFeatures>;
  users: Record<UserId, UserSnapshot>;
  /** Stored scores; z-scores are computed inside. */
  rankings: Array<{ userId: UserId; bevId: BevId; score: number }>;
  /**
   * The stored Bev-graph edges that `bevSimilarity: 'edges'` reads (TASKS.md S-21): every
   * `bev_edges` row with at least one endpoint among the Bevs ranked by a user whose predictions
   * will be computed (the viewer, in the app), each unordered pair once. A pair absent from a present
   * array has no stored edge and weighs 0. Absent (undefined or null) means "not provided": edges
   * mode then falls back to the computed content similarity. Rows whose Bevs are not in `bevs` are
   * allowed and ignored. Read lazily, only in edges mode.
   */
  edges?: BevEdge[] | null;
}

export interface Layer1Result {
  z: number;
  confidence: number;
  parts: { affinity: number; content: number; global: number };
}

export interface Layer2Result {
  z: number;
  support: number;
  /** The neighbours used, most similar first. */
  neighbours: UserId[];
}

export interface Prediction {
  bevId: BevId;
  /** Blended ẑ in z-units (un-jittered). */
  z: number;
  /** clamp(μ* + σ*·ẑ, 0, 10), unrounded; the UI shows 1 dp with "~". */
  score: number;
  /** max(conf1, min(1, support)); the UI locks below CONFIDENCE_LOCK. */
  confidence: number;
  lambda: number;
  layer1: Layer1Result;
  layer2: Layer2Result;
}

export type RecommendationReason = 'CATEGORY' | 'SIMILAR' | 'NEIGHBOURS' | 'POPULAR';

export interface Recommendation {
  bevId: BevId;
  /** Un-jittered predicted score. */
  score: number;
  confidence: number;
  reason: RecommendationReason;
  isExploration: boolean;
}

/**
 * The user–user similarity Layer 2 weights neighbours by. 'cosine' is §8.9's cosine of the z-scores
 * on the common Bevs, the live engine. 'pearson' re-centres both users on the common Bevs first
 * (`pearsonSimilarity` in graph.ts, docs/graph_db_implementation.md Stage 3); it is off by default
 * until the eval harness has a real export to judge it on.
 */
export type UserSimilarityKind = 'cosine' | 'pearson';

/**
 * The Bev–Bev similarity Layer 1's content term weights the user's ranked Bevs by. 'content' is
 * §8.8's sim(b, b′) (`contentSimilarity`), computed from the snapshot's features: the live engine.
 * 'edges' is the stored Bev-graph weight w(b, b′) from `snapshot.edges` (LaTeX §10.1), with 0 for a
 * pair that has no stored edge; it falls back to 'content' when the snapshot carries no `edges`
 * field. Off by default until the eval harness has a real export to judge it on (TASKS.md M-27 (a)).
 */
export type BevSimilarityKind = 'content' | 'edges';

/** Options of `layer1`, `layer2`, `userSimilarity` and `predictScore`. Omitted means today's engine. */
export interface PredictOptions {
  /** Layer 2's user–user similarity. Default 'cosine'. */
  userSimilarity?: UserSimilarityKind;
  /** Layer 1's Bev–Bev similarity in the content term. Default 'content'. */
  bevSimilarity?: BevSimilarityKind;
}

export interface RecommendOptions extends PredictOptions {
  /** List length. */
  n: number;
  /** PRNG seed; the caller derives it from userId + local day so a day's list is stable. */
  seed: string;
  /** Exploration share; default EPSILON. */
  epsilon?: number;
  excludeBevIds?: BevId[];
}

// ---------------------------------------------------------------- taste neighbourhoods (graph.ts)

/** The taste vector's attribute nodes: `:Category`, `:Brand` and `:Flavor` in the graph. */
export type TasteAttributeKind = 'category' | 'brand' | 'flavor';

// ---------------------------------------------------------------- starter set, rank, streaks (§8.12–§8.14)

/** Structurally satisfied by shared's BevSummary. */
export interface StarterCandidate {
  id: BevId;
  name: string;
  categoryId: CategoryId;
  ratingCount: number;
}

export interface StarterOptions {
  k?: number;
  core?: number;
  maxPerCategory?: number;
  seed: string;
  excludeCategoryIds?: CategoryId[];
}

export interface RankPointsInput {
  bevsRanked: number;
  currentStreak: number;
  bevsCreated: number;
}

export interface RankUsersRow extends RankPointsInput {
  userId: UserId;
  /** ISO timestamp of account creation (tie-break: earlier first). */
  createdAt: string;
}

export interface RankedUser {
  userId: UserId;
  points: number;
  rank: number;
}

export type StreakPeriod = 'day' | 'week';

export interface StreakResult {
  current: number;
  longest: number;
  /** Latest period key on or before today, or null. */
  lastKey: string | null;
}
