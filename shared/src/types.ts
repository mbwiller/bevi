// DRAFT: field names here are a first pass assembled from both sides' per-screen
// data needs (DEVELOPMENT-MATT.md §13). Arjun owns renames/shape changes in the
// real contract/v0 PR after Matt's review — nothing here should be treated as
// final or built against yet.

import type { Bucket, CategoryId, PriceTier, BevStatus } from './enums';

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string;
  canSeeAlcohol: boolean;
  onboarded: boolean;
}

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

export interface Category {
  id: CategoryId;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
}

export interface BevSummary {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  photoUrl: string | null;
  photoStatus: 'processing' | 'ready';
  priceTier: PriceTier;
  priceEstimated: boolean;
  ratingCount: number;
  bayesScore: number | null;
}

export interface Bev extends BevSummary {
  nutritionLabelUrl: string | null;
  avgScore: number | null;
  scoreStddev: number | null;
  createdBy: { id: string; handle: string } | null;
  createdAt: string;
  myRanking: { bucket: Bucket; position: number; bucketSize: number; score: number; note: string | null } | null;
  prediction: { score: number; confidence: number; generatedAt: string } | null;
  inWantToTry: boolean;
  friends: Array<{ profile: Profile; score: number; bucket: Bucket }>;
  isStarter: boolean;
}

export interface Ranking {
  id: string;
  userId: string;
  bevId: string;
  bucket: Bucket;
  position: number;
  score: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comparison {
  winnerBevId: string;
  loserBevId: string;
  tie: boolean;
}

export interface FeedItem {
  id: string;
  type: 'RANKING';
  actor: Profile;
  bev: BevSummary;
  score: number;
  bucket: Bucket;
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

export interface WantToTryItem {
  bev: BevSummary;
  savedAt: string;
  via: Profile | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
