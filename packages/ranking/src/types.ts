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

/** The range [lo, hi] and the question asked, captured BEFORE an answer (for undo and the log). */
export interface PlacementStep {
  readonly comparedBevId: BevId;
  readonly answer: ComparisonAnswer;
  readonly lo: number;
  readonly hi: number;
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
}

export interface PlacementPrompt {
  comparedBevId: BevId;
  /** 1-based number of the question being asked. */
  step: number;
  /** maxComparisons(list.length): the most questions this placement can take. */
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
