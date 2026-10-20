// Contract v1 domain types. Field names follow DEVELOPMENT-MATT.md §6/§13 and
// the design system's component props (design/system/project/components/index.d.ts).
// All timestamps are ISO 8601 strings; all scores are 0–10 with 2 dp.

import type {
  BevStatus,
  Bucket,
  CategoryId,
  FeedEventKind,
  FlavorBase,
  FlavorProfileSource,
  FlavorServe,
  PhotoStatus,
  PriceTier,
} from './enums';

/** The signed-in user as the app sees it. Tokens stay inside `packages/api`. */
export interface Session {
  userId: string;
  /** = username (the sign-in name). */
  handle: string;
}

export interface Profile {
  id: string;
  /** = username; lowercase, `HANDLE_PATTERN`. */
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string;
  /** ISO date (YYYY-MM-DD). Only on the caller's own profile; null for other users and before it is set. */
  birthdate: string | null;
  /**
   * age ≥ 21, computed server-side from birthdate. Only meaningful on the caller's own profile:
   * for other users it is always false, so it never reveals whether someone else is over 21.
   */
  canSeeAlcohol: boolean;
  /** Set by the starter screen via `updateMe({ onboarded: true })`. */
  onboarded: boolean;
}

/** A person in a list (followers, following, search, suggested) or on their profile. */
export type ProfileRow = Profile & {
  /** Whether the caller follows this user. Always false for the caller's own row. */
  isFollowing: boolean;
};

export interface ProfileStats {
  followers: number;
  following: number;
  bevdCount: number;
  wantToTryCount: number;
  rankOnBevi: number | null;
  rankPoints: number;
  currentStreak: number;
  longestStreak: number;
  streakAliveToday: boolean;
}

/** Category → icon is mapped client-side by the design system, so there is no icon field. */
export interface Category {
  id: CategoryId;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
  /** Active Bevs in the category (always age-filtered for the caller: an alcoholic category is absent, not 0). */
  bevCount: number;
}

/**
 * The caller's progress through one category ("Soda · 4 of 61 tried"). `total`
 * is the same count as `Category.bevCount`; `ranked` counts only rankings of
 * active Bevs, so `ranked <= total`.
 */
export interface CategoryProgress {
  categoryId: CategoryId;
  ranked: number;
  total: number;
}

/**
 * One category of a user's Taste Profile ("Coffee 8.1 · 9 ranked"): their own
 * ratings there. `affinity` is the recommendation engine's category affinity,
 * Σz / (n + 2) with z against the user's overall stats (LaTeX §4.3,
 * `categoryAffinity` in @bevi/ranking): above 0 they rate the category above
 * their own average.
 */
export interface TasteProfileRow {
  categoryId: CategoryId;
  rankingCount: number;
  /** Mean of the user's scores in the category, 0–10. */
  mean: number;
  affinity: number;
}

/** What `BevRow`, `BevImage`, `PriceTier`, `CompareCard` and `FeedPost` render. */
export interface BevSummary {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  /** null until a photo exists; show `BevArt` placeholder. */
  photoUrl: string | null;
  photoStatus: PhotoStatus;
  /** Always set on reads: when the creator chose "not sure" the server estimates it. */
  priceTier: PriceTier;
  /** true when `priceTier` was estimated (rendered with `~`). */
  priceEstimated: boolean;
  /** Global number of rankings. */
  ratingCount: number;
  /** Global Bayesian score; null below `MIN_RATERS`. */
  bayesScore: number | null;
}

/**
 * A Bev's taste profile: the hand-labelled signal behind the `profile` term of
 * the Bev-graph edge weight (`profileSimilarity` in `@bevi/ranking`, LaTeX
 * §10.1 eq. 17). Field names are the contract between that formula (M-24) and
 * the catalog CSV plus `bev_flavor_profiles` table (A-17); renaming one means
 * relabelling 378 rows, so they are fixed here first.
 */
export interface FlavorProfile {
  base: FlavorBase;
  carbonated: boolean;
  /** 0 none, 1 low, 2 medium, 3 high. */
  caffeine: 0 | 1 | 2 | 3;
  /** 0 unsweetened, 1 low, 2 medium, 3 high. */
  sweetness: 0 | 1 | 2 | 3;
  dairy: boolean;
  alcohol: boolean;
  serve: FlavorServe;
  source: FlavorProfileSource;
}

/** The caller's ranking of a Bev, embedded in `Bev`. */
export interface MyRanking {
  bucket: Bucket;
  /** 0 = best in the bucket. */
  position: number;
  bucketSize: number;
  score: number;
  note: string | null;
}

export interface BevPrediction {
  score: number;
  /** 0–1; below 0.25 the UI shows a locked bubble. */
  confidence: number;
  generatedAt: string;
  /** `RANKING_VERSION` of the @bevi/ranking bundle that produced it. */
  rankingVersion: string;
}

export interface FriendScore {
  profile: Profile;
  score: number;
  bucket: Bucket;
}

/** Bev detail (`bevs.get`). */
export interface Bev extends BevSummary {
  status: BevStatus;
  nutritionLabelUrl: string | null;
  avgScore: number | null;
  scoreStddev: number | null;
  createdBy: { id: string; handle: string } | null;
  createdAt: string;
  myRanking: MyRanking | null;
  /** null when the caller has ranked it, or has < 3 rankings. */
  prediction: BevPrediction | null;
  inWantToTry: boolean;
  /** Followed users who ranked it. */
  friends: FriendScore[];
  isStarter: boolean;
  /** null until the Bev is labelled (A-17 covers the 378 seeds). */
  flavorProfile: FlavorProfile | null;
}

export interface Ranking {
  id: string;
  userId: string;
  bevId: string;
  bucket: Bucket;
  /** 0 = best in the bucket. */
  position: number;
  score: number;
  note: string | null;
  /** When first ranked ("Ranked Oct 3"). */
  createdAt: string;
  updatedAt: string;
}

/** A ranking with the Bev it ranks: Bev'd list rows and profile Activity posts. */
export type RankedBev = Ranking & { bev: BevSummary };

/**
 * One answer from the placement flow, structurally identical to
 * `@bevi/ranking`'s `RankingComparison`. Every comparison is sent.
 */
export interface Comparison {
  winnerBevId: string;
  loserBevId: string;
  /** "Too close to call". */
  tie: boolean;
}

export interface FeedItem {
  id: string;
  type: FeedEventKind;
  actor: Profile;
  bev: BevSummary;
  /** The actor's score for this Bev. */
  score: number;
  /** The actor's bucket for this Bev. */
  bucket: Bucket;
  /** The actor's ranking note, if they wrote one. */
  note: string | null;
  createdAt: string;
  inMyWantToTry: boolean;
  /** Total likes on this post. */
  likeCount: number;
  /** Whether the caller has liked it. */
  likedByMe: boolean;
  /** Total comments on this post, excluding deleted ones. */
  commentCount: number;
  /**
   * The first seven comments (at most), oldest first. With `commentCount` of
   * seven or fewer this is the whole thread, so the post shows every comment
   * inline without a second call; above seven the app collapses to "View all
   * N comments" (previewing some of these if it likes) and fetches the thread
   * with `comments.list`.
   */
  comments: Comment[];
}

export interface Comment {
  id: string;
  author: Profile;
  body: string;
  createdAt: string;
}

export interface FeaturedBev {
  bev: BevSummary;
  heroImageUrl: string;
  tagline: string | null;
  startsAt: string;
  endsAt: string | null;
}

/**
 * One period's winner (LaTeX §10.3): among the Bevs ranked at least once in the period, the one
 * with the highest current Bayesian score; ties go to more rankings in the period, then more
 * raters overall, then name (code points), then id. Periods are America/New_York calendar days
 * and ISO weeks (Monday start). `bev.bayesScore` is the score the winner was picked by, so it
 * is set even for a Bev with a single rating.
 */
export interface PeriodWinner {
  bev: BevSummary;
  /** First day of the period, `YYYY-MM-DD` in New York: the day itself, or the week's Monday. */
  periodStart: string;
  /** Rankings of `bev` created in the period. */
  rankingsInPeriod: number;
  /** false when nothing was ranked in the current period and this is the latest one that had rankings. */
  isCurrent: boolean;
}

/** Both cards at the top of the feed; a side is null only when nothing the caller may see was ever ranked. */
export interface BevOfPeriod {
  day: PeriodWinner | null;
  week: PeriodWinner | null;
}

export interface LeaderboardRow {
  rank: number;
  bev: BevSummary;
  bayesScore: number;
  ratingCount: number;
  /** The caller's own score, if ranked. */
  myScore: number | null;
}

export interface UserLeaderboardRow {
  rank: number;
  profile: Profile;
  points: number;
  bevsRanked: number;
  currentStreak: number;
}

export interface Recommendation {
  bev: BevSummary;
  predictedScore: number;
  confidence: number;
  reason: 'CATEGORY' | 'SIMILAR' | 'NEIGHBOURS' | 'POPULAR';
  isExploration: boolean;
  generatedAt: string;
}

export interface RecommendationsResult {
  items: Recommendation[];
  generatedAt: string;
  /** Number of the caller's rankings the run used ("Based on N Bevs you've ranked"). */
  basedOnCount: number;
  rankingVersion: string;
}

export interface WantToTryItem {
  bev: BevSummary;
  savedAt: string;
  /** "Saved from @arjun" when saved from someone's post. */
  via: Profile | null;
}

/**
 * An Explore post: a `FeedItem` by someone the caller does NOT follow, so it
 * carries no engagement at all (D-15). It is deliberately a `FeedItem` minus
 * `likeCount`, `likedByMe`, `commentCount` and `comments` rather than those
 * fields nulled, so a screen cannot render a heart or a count by accident —
 * `get_explore` does not return them either.
 */
export type ExplorePost = Omit<FeedItem, 'likeCount' | 'likedByMe' | 'commentCount' | 'comments'>;

export interface AppConfig {
  minAppVersion: string;
  maintenance: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
