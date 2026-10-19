// DB row (snake_case) -> `shared/` domain type (camelCase) mappers, plus the
// couple of enum conversions `packages/api` owns (DEVELOPMENT-ARJUN.md §6.2):
// `Bucket` <-> smallint, and the feed `kind` text -> `FeedEventKind`.
//
// There's no generated `shared/src/db.types.ts` yet (needs a live Supabase
// project to `supabase gen types` from -- not done here, see PR description).
// Row shapes below are typed by hand against the migrations instead.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppConfig,
  Bev,
  BevOfPeriod,
  BevPrediction,
  BevSummary,
  Bucket,
  Category,
  CategoryProgress,
  CategoryId,
  Comment,
  FeedEventKind,
  FeedItem,
  FlavorProfile,
  LeaderboardRow,
  PeriodWinner,
  PhotoStatus,
  PriceTier,
  Profile,
  ProfileRow,
  Ranking,
  TasteProfileRow,
  UserLeaderboardRow,
  WantToTryItem,
} from '@bevi/shared';
import { ApiError } from '@bevi/shared';

export function bucketToDb(bucket: Bucket): 1 | 2 | 3 {
  switch (bucket) {
    case 'DISLIKED':
      return 1;
    case 'FINE':
      return 2;
    case 'LOVED':
      return 3;
  }
}

export function bucketFromDb(value: number): Bucket {
  switch (value) {
    case 1:
      return 'DISLIKED';
    case 2:
      return 'FINE';
    case 3:
      return 'LOVED';
    default:
      throw new ApiError('unknown', `Unexpected bucket value from DB: ${value}`);
  }
}

/** Since 20261014000100 'ranked' and 'reranked' are the only kinds that exist. */
export function feedKindFromDb(kind: string): FeedEventKind {
  switch (kind) {
    case 'ranked':
    case 'reranked':
      return 'RANKING';
    default:
      throw new ApiError('unknown', `Unexpected feed_events.kind from DB: ${kind}`);
  }
}

/** `bevs.photo_path`/`avatar_path` etc. are storage paths; the app only ever sees public URLs. */
export function publicUrl(client: SupabaseClient, bucket: string, path: string | null): string | null {
  if (!path) return null;
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// --------------------------------------------------------------------------
// profiles_view row -> Profile / ProfileRow
// --------------------------------------------------------------------------

export interface ProfileViewRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  birth_date: string | null;
  can_see_alcohol: boolean;
  timezone: string;
  onboarded: boolean;
  created_at: string;
}

export function mapProfile(client: SupabaseClient, row: ProfileViewRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: publicUrl(client, 'avatars', row.avatar_path),
    timezone: row.timezone,
    createdAt: row.created_at,
    birthdate: row.birth_date,
    canSeeAlcohol: row.can_see_alcohol,
    onboarded: row.onboarded,
  };
}

export function mapProfileRow(client: SupabaseClient, row: ProfileViewRow, isFollowing: boolean): ProfileRow {
  return { ...mapProfile(client, row), isFollowing };
}

// --------------------------------------------------------------------------
// categories
// --------------------------------------------------------------------------

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  is_alcoholic: boolean;
}

/** `bevCount` comes from `get_category_progress` (20261018000200), not the table. */
export function mapCategory(row: CategoryRow, bevCount: number): Category {
  return {
    id: row.id as CategoryId,
    name: row.name,
    sortOrder: row.sort_order,
    isAlcoholic: row.is_alcoholic,
    bevCount,
  };
}

/** One row of `get_category_progress()`. */
export interface CategoryProgressRow {
  category_id: string;
  ranked: number;
  total: number;
}

export function mapCategoryProgress(row: CategoryProgressRow): CategoryProgress {
  return { categoryId: row.category_id as CategoryId, ranked: row.ranked, total: row.total };
}

/** One row of `get_taste_profile()` (20261019000100). Numerics may arrive as strings. */
export interface TasteProfileRpcRow {
  category_id: string;
  rating_count: number;
  mean_score: number | string;
  affinity_z: number | string;
}

export function mapTasteProfileRow(row: TasteProfileRpcRow): TasteProfileRow {
  return {
    categoryId: row.category_id as CategoryId,
    rankingCount: row.rating_count,
    mean: Number(row.mean_score),
    affinity: Number(row.affinity_z),
  };
}

// --------------------------------------------------------------------------
// bevs / bev_stats -> BevSummary, Bev
// --------------------------------------------------------------------------

export interface BevStatsRow {
  rating_count: number | null;
  avg_score: number | null;
  score_stddev: number | null;
  bayes_score: number | null;
}

export interface BevSummaryRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  photo_path: string | null;
  price_tier: number;
  price_estimated: boolean;
  bev_stats?: BevStatsRow | BevStatsRow[] | null;
}

function oneBevStats(stats: BevSummaryRow['bev_stats']): BevStatsRow | null {
  if (!stats) return null;
  return Array.isArray(stats) ? stats[0] ?? null : stats;
}

export function mapBevSummary(client: SupabaseClient, row: BevSummaryRow): BevSummary {
  const stats = oneBevStats(row.bev_stats);
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    flavor: row.flavor,
    categoryId: row.category_id as CategoryId,
    photoUrl: publicUrl(client, 'bev-photos', row.photo_path),
    // Placeholder until the process-photo pipeline (milestone 1.6) exists:
    // there's no column tracking async background-removal state yet, so
    // once a Bev has a photo_path it's treated as 'ready'.
    photoStatus: 'ready' as PhotoStatus,
    priceTier: row.price_tier as PriceTier,
    priceEstimated: row.price_estimated,
    ratingCount: stats?.rating_count ?? 0,
    // bev_stats.bayes_score is only populated once the leaderboard refresh
    // job (milestone 1.7) runs; null until then is correct, not a bug.
    bayesScore: stats?.bayes_score ?? null,
  };
}

export interface BevRow extends BevSummaryRow {
  status: string;
  nutrition_label_path: string | null;
  created_at: string;
  created_by: { id: string; handle: string } | null | Array<{ id: string; handle: string }>;
  is_starter: boolean;
}

export interface FlavorProfileRow {
  base: string;
  carbonated: boolean;
  caffeine: number;
  sweetness: number;
  dairy: boolean;
  alcohol: boolean;
  serve: string;
  source: string;
}

export function mapFlavorProfile(row: FlavorProfileRow): FlavorProfile {
  return {
    base: row.base as FlavorProfile['base'],
    carbonated: row.carbonated,
    caffeine: row.caffeine as FlavorProfile['caffeine'],
    sweetness: row.sweetness as FlavorProfile['sweetness'],
    dairy: row.dairy,
    alcohol: row.alcohol,
    serve: row.serve as FlavorProfile['serve'],
    source: row.source as FlavorProfile['source'],
  };
}

export interface MyRankingRow {
  bucket: number;
  position: number;
  score: number;
  note: string | null;
  bucket_size: number;
}

export function mapBev(
  client: SupabaseClient,
  row: BevRow,
  extras: {
    myRanking: MyRankingRow | null;
    inWantToTry: boolean;
    friends: Array<{ profile: Profile; score: number; bucket: Bucket }>;
    flavorProfile: FlavorProfileRow | null;
    prediction?: BevPrediction | null;
  }
): Bev {
  const createdBy = Array.isArray(row.created_by) ? row.created_by[0] ?? null : row.created_by;
  const stats = oneBevStats(row.bev_stats);
  return {
    ...mapBevSummary(client, row),
    status: row.status as Bev['status'],
    nutritionLabelUrl: publicUrl(client, 'nutrition-labels', row.nutrition_label_path),
    avgScore: stats?.avg_score ?? null,
    scoreStddev: stats?.score_stddev ?? null,
    createdBy: createdBy ? { id: createdBy.id, handle: createdBy.handle } : null,
    createdAt: row.created_at,
    myRanking: extras.myRanking
      ? {
          bucket: bucketFromDb(extras.myRanking.bucket),
          position: extras.myRanking.position,
          bucketSize: extras.myRanking.bucket_size,
          score: extras.myRanking.score,
          note: extras.myRanking.note,
        }
      : null,
    // @bevi/ranking's predictScore over the caller's snapshot (bevs.ts).
    prediction: extras.prediction ?? null,
    inWantToTry: extras.inWantToTry,
    friends: extras.friends,
    isStarter: row.is_starter,
    flavorProfile: extras.flavorProfile ? mapFlavorProfile(extras.flavorProfile) : null,
  };
}

// --------------------------------------------------------------------------
// rankings
// --------------------------------------------------------------------------

export interface RankingRow {
  id: string;
  user_id: string;
  bev_id: string;
  bucket: number;
  position: number;
  score: number;
  note: string | null;
  ranked_at: string;
  updated_at: string;
}

export function mapRanking(row: RankingRow): Ranking {
  return {
    id: row.id,
    userId: row.user_id,
    bevId: row.bev_id,
    bucket: bucketFromDb(row.bucket),
    position: row.position,
    score: Number(row.score),
    note: row.note,
    createdAt: row.ranked_at,
    updatedAt: row.updated_at,
  };
}

// --------------------------------------------------------------------------
// get_feed RPC row -> FeedItem
// --------------------------------------------------------------------------

export interface FeedRpcRow {
  id: number;
  kind: string;
  created_at: string;
  actor_id: string;
  actor_handle: string;
  actor_display_name: string;
  actor_avatar_path: string | null;
  bev_id: string | null;
  bev_name: string | null;
  bev_brand: string | null;
  bev_flavor: string | null;
  bev_category_id: string | null;
  bev_thumb_path: string | null;
  bev_price_tier: number | null;
  bev_price_estimated: boolean | null;
  bev_status: string | null;
  bev_rating_count: number | null;
  bev_bayes_score: number | null;
  score: number | null;
  bucket: number | null;
  note: string | null;
  in_my_want_to_try: boolean;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  /** `get_feed` builds the first seven, oldest first, with `jsonb_build_object`. */
  comments: CommentRpcRow[];
}

export interface CommentRpcRow {
  id: number;
  created_at: string;
  body: string;
  author_id: string;
  author_handle: string;
  author_display_name: string;
  author_avatar_path: string | null;
  author_timezone: string;
  author_onboarded: boolean;
  author_created_at: string;
}

export function mapComment(client: SupabaseClient, row: CommentRpcRow): Comment {
  return {
    id: String(row.id),
    author: {
      id: row.author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
      avatarUrl: publicUrl(client, 'avatars', row.author_avatar_path),
      timezone: row.author_timezone,
      createdAt: row.author_created_at,
      // Same rule as profiles_view: a birthdate is only ever the caller's own,
      // and canSeeAlcohol is false for everyone else so it reveals nothing.
      birthdate: null,
      canSeeAlcohol: false,
      onboarded: row.author_onboarded,
    },
    body: row.body,
    createdAt: row.created_at,
  };
}

export function mapFeedItem(client: SupabaseClient, row: FeedRpcRow, actor: Profile): FeedItem {
  if (!row.bev_id || !row.bev_name || !row.bev_category_id) {
    throw new ApiError('unknown', `get_feed row ${row.id} is missing its Bev (actor_id=${row.actor_id})`);
  }
  // Every feed item is a ranking now, so the joined ranking is always there.
  if (row.score === null || row.bucket === null) {
    throw new ApiError('unknown', `get_feed row ${row.id} is missing its ranking (actor_id=${row.actor_id})`);
  }
  return {
    id: String(row.id),
    type: feedKindFromDb(row.kind),
    actor,
    bev: {
      id: row.bev_id,
      name: row.bev_name,
      brand: row.bev_brand,
      flavor: row.bev_flavor,
      categoryId: row.bev_category_id as CategoryId,
      photoUrl: publicUrl(client, 'bev-photos', row.bev_thumb_path),
      photoStatus: 'ready',
      priceTier: (row.bev_price_tier ?? 1) as PriceTier,
      priceEstimated: row.bev_price_estimated ?? true,
      ratingCount: row.bev_rating_count ?? 0,
      bayesScore: row.bev_bayes_score,
    },
    score: row.score,
    bucket: bucketFromDb(row.bucket),
    note: row.note,
    createdAt: row.created_at,
    inMyWantToTry: row.in_my_want_to_try,
    likeCount: row.like_count,
    likedByMe: row.liked_by_me,
    commentCount: row.comment_count,
    comments: row.comments.map((c) => mapComment(client, c)),
  };
}

// --------------------------------------------------------------------------
// get_bev_of_period RPC rows -> BevOfPeriod
// --------------------------------------------------------------------------

export interface BevOfPeriodRpcRow {
  period: string;
  period_start: string;
  is_current: boolean;
  rankings_in_period: number;
  bev_id: string;
  bev_name: string;
  bev_brand: string | null;
  bev_flavor: string | null;
  bev_category_id: string;
  bev_thumb_path: string | null;
  bev_price_tier: number;
  bev_price_estimated: boolean;
  bev_rating_count: number;
  bev_bayes_score: number | string;
}

function mapPeriodWinner(client: SupabaseClient, row: BevOfPeriodRpcRow): PeriodWinner {
  // The score the winner was picked by (live, like get_bev_leaderboard), not
  // bev_stats.bayes_score, which the 15-minute refresh may not have caught up on.
  const bayes = Number(row.bev_bayes_score);
  return {
    bev: mapBevSummary(client, {
      id: row.bev_id,
      name: row.bev_name,
      brand: row.bev_brand,
      flavor: row.bev_flavor,
      category_id: row.bev_category_id,
      photo_path: row.bev_thumb_path,
      price_tier: row.bev_price_tier,
      price_estimated: row.bev_price_estimated,
      bev_stats: { rating_count: row.bev_rating_count, avg_score: null, score_stddev: null, bayes_score: bayes },
    }),
    periodStart: row.period_start,
    rankingsInPeriod: row.rankings_in_period,
    isCurrent: row.is_current,
  };
}

/** Zero, one or two rows ('day', 'week'); a missing period maps to null. */
export function mapBevOfPeriod(client: SupabaseClient, rows: readonly BevOfPeriodRpcRow[]): BevOfPeriod {
  const day = rows.find((r) => r.period === 'day');
  const week = rows.find((r) => r.period === 'week');
  return {
    day: day ? mapPeriodWinner(client, day) : null,
    week: week ? mapPeriodWinner(client, week) : null,
  };
}

// --------------------------------------------------------------------------
// want_to_try
// --------------------------------------------------------------------------

export function mapWantToTryItem(bev: BevSummary, createdAt: string, via: Profile | null): WantToTryItem {
  return { bev, savedAt: createdAt, via };
}

// --------------------------------------------------------------------------
// leaderboards
// --------------------------------------------------------------------------

export interface BevLeaderboardRpcRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  photo_path: string | null;
  price_tier: number;
  rating_count: number;
  avg_score: number | null;
  bayes_score: number;
}

export function mapBevLeaderboardRow(
  client: SupabaseClient,
  row: BevLeaderboardRpcRow,
  rank: number,
  myScore: number | null
): LeaderboardRow {
  return {
    rank,
    bev: {
      id: row.id,
      name: row.name,
      brand: row.brand,
      flavor: row.flavor,
      categoryId: row.category_id as CategoryId,
      photoUrl: publicUrl(client, 'bev-photos', row.photo_path),
      photoStatus: 'ready',
      priceTier: row.price_tier as PriceTier,
      priceEstimated: false,
      ratingCount: row.rating_count,
      bayesScore: row.bayes_score,
    },
    bayesScore: row.bayes_score,
    ratingCount: row.rating_count,
    myScore,
  };
}

export interface UserLeaderboardRpcRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  timezone: string;
  created_at: string;
  onboarded: boolean;
  can_see_alcohol: boolean;
  points: number;
  bevi_rank: number;
  rating_count: number | null;
  current_streak_days: number | null;
}

// rank is `rank() over (order by points desc)` from SQL -- competition
// ranking, ties share a rank -- not the row's position in this page.
export function mapUserLeaderboardRow(client: SupabaseClient, row: UserLeaderboardRpcRow): UserLeaderboardRow {
  return {
    rank: row.bevi_rank,
    profile: {
      id: row.user_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: publicUrl(client, 'avatars', row.avatar_path),
      timezone: row.timezone,
      createdAt: row.created_at,
      // Never this row's own birth_date, only whether it clears 21 --
      // same rule profiles_view applies for any profile but the caller's.
      birthdate: null,
      canSeeAlcohol: row.can_see_alcohol,
      onboarded: row.onboarded,
    },
    points: row.points,
    bevsRanked: row.rating_count ?? 0,
    currentStreak: row.current_streak_days ?? 0,
  };
}

export function placeholderAppConfig(): AppConfig {
  // No versioning/maintenance-flag infra exists yet; this is a fixed
  // placeholder, not a read from the DB, until that's built.
  return { minAppVersion: '0.1.0', maintenance: false };
}
