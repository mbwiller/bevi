// Contract v1 domain types. Field names follow DEVELOPMENT-MATT.md §6/§13 and
// the design system's component props (design/system/project/components/index.d.ts).
// All timestamps are ISO 8601 strings; all scores are 0–10 with 2 dp.

import type { BevStatus, Bucket, CategoryId, FeedEventKind, PhotoStatus, PriceTier } from './enums';

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
  /** age ≥ 21, computed server-side from birthdate. */
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
  /** The actor's score; null for 'SAVED'. */
  score: number | null;
  /** The actor's bucket; null for 'SAVED'. */
  bucket: Bucket | null;
  /** The actor's ranking note; null for 'SAVED'. */
  note: string | null;
  createdAt: string;
  inMyWantToTry: boolean;
}

export interface FeaturedBev {
  bev: BevSummary;
  heroImageUrl: string;
  tagline: string | null;
  startsAt: string;
  endsAt: string | null;
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

export interface AppConfig {
  minAppVersion: string;
  maintenance: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
