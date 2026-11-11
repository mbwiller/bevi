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
  BevLeaf,
  BevOfPeriod,
  BevPrediction,
  BevSimilarity,
  BevSummary,
  Borough,
  Bucket,
  BucketBev,
  Category,
  CategoryNode,
  CategoryProgress,
  CategoryId,
  Comment,
  ExplorePost,
  FeedEventKind,
  FeedItem,
  FlavorProfile,
  FriendScore,
  LeaderboardRow,
  PeriodWinner,
  PhotoStatus,
  PriceTier,
  Profile,
  ProfileRow,
  Ranking,
  SuggestedProfile,
  TasteProfileRow,
  UserLeaderboardRow,
  Venue,
  VenueDetail,
  VenueKind,
  VenuePin,
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

/**
 * Another user's profile as the social-context functions embed it in jsonb
 * (20261111000100: `feed_also_bevd`'s items and `get_followed_by`'s
 * `followed_by`). `created_at` is the profile's.
 */
export interface EmbeddedProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_path: string | null;
  timezone: string;
  onboarded: boolean;
  created_at: string;
}

export function mapEmbeddedProfile(client: SupabaseClient, row: EmbeddedProfileRow): Profile {
  return {
    id: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: publicUrl(client, 'avatars', row.avatar_path),
    timezone: row.timezone,
    createdAt: row.created_at,
    // Same rule as profiles_view (and mapComment): these are never the
    // caller, so no birthdate and no canSeeAlcohol. The functions do not
    // return either.
    birthdate: null,
    canSeeAlcohol: false,
    onboarded: row.onboarded,
  };
}

/** One row of `get_followed_by` (20261111000100): who the caller follows that follows `user_id`. */
export interface FollowedByRpcRow {
  user_id: string;
  followed_by_count: number;
  /** At most two, the most recent follower first. */
  followed_by: EmbeddedProfileRow[];
}

/** `context` is undefined for someone `get_followed_by` returned no row for: nobody, so 0 and []. */
export function mapSuggestedProfile(
  client: SupabaseClient,
  row: ProfileRow,
  context: FollowedByRpcRow | undefined,
): SuggestedProfile {
  return {
    ...row,
    followedBy: (context?.followed_by ?? []).map((p) => mapEmbeddedProfile(client, p)),
    followedByCount: context?.followed_by_count ?? 0,
  };
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

/**
 * One row of `get_category_tree()` (20261026000100). A-13.
 *
 * Distinct from `CategoryRow` on purpose: the tree carries `parent_id` and the
 * root's `emoji` but no Bev count, while `categories.list()` carries the count
 * and only ever sees roots.
 */
export interface CategoryNodeRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_alcoholic: boolean;
  emoji: string | null;
}

export function mapCategoryNode(row: CategoryNodeRow): CategoryNode {
  return {
    id: row.id,
    name: row.name,
    // A leaf's parent is always one of the 15, so the cast is the same claim
    // the database's two-level guard makes.
    parentId: row.parent_id === null ? null : (row.parent_id as CategoryId),
    sortOrder: row.sort_order,
    isAlcoholic: row.is_alcoholic,
    emoji: row.emoji,
  };
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
    // Since 20261101000300 every write path refreshes bev_stats.bayes_score,
    // and it is null exactly when rating_count is 0 -- no Bayesian score is
    // defined with no ratings. So null is correct here, not a stale row
    // waiting on a job.
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

// --------------------------------------------------------------------------
// The Bev graph: get_bev_similarities / list_bucket_bevs rows (A-16, S-14)
// --------------------------------------------------------------------------

/** `get_bev_similarities` (20261019000500). `weight` arrives as a numeric. */
export interface BevSimilarityRow {
  bev_id: string;
  weight: number | string;
}

export function mapBevSimilarity(row: BevSimilarityRow): BevSimilarity {
  return { bevId: row.bev_id, weight: Number(row.weight) };
}

/** `get_bev_leaves` (20261026000100). A-13. */
export interface BevLeafRow {
  bev_id: string;
  leaf_category_id: string | null;
}

export function mapBevLeaf(row: BevLeafRow): BevLeaf {
  return { bevId: row.bev_id, leafCategoryId: row.leaf_category_id };
}

/** `list_bucket_bevs` (20261019000500). */
export interface BucketBevRow {
  id: string;
  category_id: string;
  /** Already `normaliseBrand`d by SQL; null when the Bev has no brand. */
  brand_key: string | null;
}

export function mapBucketBev(row: BucketBevRow): BucketBev {
  return { id: row.id, categoryId: row.category_id as CategoryId, brandKey: row.brand_key };
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
// get_feed / get_explore RPC rows -> FeedItem / ExplorePost
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
  /**
   * `feed_also_bevd` (20261111000100): the caller's followees, other than the
   * actor, who ranked this Bev. Optional because a database that has not had
   * that migration yet does not return the column at all; see `mapFeedItem`.
   */
  also_bevd?: AlsoBevdRpc | null;
}

/** `count` is everyone; `items` is the three who ranked most recently, newest first. */
export interface AlsoBevdRpc {
  count: number;
  items: AlsoBevdRpcItem[];
}

/** A friend's profile with their own ranking of the Bev. `score` is a numeric inside jsonb. */
export interface AlsoBevdRpcItem extends EmbeddedProfileRow {
  score: number | string;
  bucket: number;
}

/**
 * `get_explore`'s row (20261019000300): get_feed's columns minus the four
 * engagement ones, which the function does not return at all (D-15), and
 * minus `also_bevd`, which only the feed functions compute.
 */
export type ExploreRpcRow = Omit<
  FeedRpcRow,
  'like_count' | 'liked_by_me' | 'comment_count' | 'comments' | 'also_bevd'
>;

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

/**
 * The part of a post every surface shares: get_explore returns exactly this,
 * and get_feed returns it plus the four engagement fields (D-15).
 */
export function mapExplorePost(client: SupabaseClient, row: ExploreRpcRow, actor: Profile): ExplorePost {
  if (!row.bev_id || !row.bev_name || !row.bev_category_id) {
    throw new ApiError('unknown', `feed row ${row.id} is missing its Bev (actor_id=${row.actor_id})`);
  }
  // Every feed item is a ranking now, so the joined ranking is always there.
  if (row.score === null || row.bucket === null) {
    throw new ApiError('unknown', `feed row ${row.id} is missing its ranking (actor_id=${row.actor_id})`);
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
  };
}

export function mapAlsoBevdItem(client: SupabaseClient, item: AlsoBevdRpcItem): FriendScore {
  return {
    profile: mapEmbeddedProfile(client, item),
    score: Number(item.score),
    bucket: bucketFromDb(item.bucket),
  };
}

export function mapFeedItem(client: SupabaseClient, row: FeedRpcRow, actor: Profile): FeedItem {
  // A database without 20261111000100 returns no `also_bevd` column. That is
  // the state between this client shipping and the migration being pushed, if
  // they happen in that order, and the feed must keep loading through it: no
  // column reads as "nobody", which is what the older server could tell us.
  // Once the migration is in, the column is never null (feed_also_bevd always
  // returns an object), so this branch is dead from then on.
  const also = row.also_bevd ?? { count: 0, items: [] };
  return {
    ...mapExplorePost(client, row, actor),
    likeCount: row.like_count,
    likedByMe: row.liked_by_me,
    commentCount: row.comment_count,
    comments: row.comments.map((c) => mapComment(client, c)),
    alsoBevdBy: also.items.map((item) => mapAlsoBevdItem(client, item)),
    alsoBevdCount: also.count,
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
  // The score the winner was picked by. bev_of_period_at recomputes it from
  // the same inputs bev_stats holds (sum_score, rating_count, bayes_prior(null))
  // rather than reading bev_stats.bayes_score, because that column is stored
  // as numeric(4,2) and the winner has to be picked on the UNROUNDED value --
  // two Bevs that round to the same 2 dp are separated by n_period next, not
  // by chance. The rounding happens once, here at the RPC boundary
  // (20261101000300). The only other difference is one accepted race, which
  // that migration documents: a refresh_global_stats tick landing between
  // refresh_bev_stats reading the prior and its upsert leaves that row on the
  // previous prior until the next tick.
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

/**
 * One row of `get_friends_leaderboard` (20261111000100): get_user_leaderboard's
 * columns that `mapUserLeaderboardRow` reads, with `friend_rank` -- the rank
 * among the caller and the people they follow -- where the global board has
 * `bevi_rank`.
 */
export type FriendsLeaderboardRpcRow = Omit<UserLeaderboardRpcRow, 'bevi_rank'> & { friend_rank: number };

// Same shape and the same competition ranking as the global board's row; only
// the set the rank is counted in differs.
export function mapFriendsLeaderboardRow(client: SupabaseClient, row: FriendsLeaderboardRpcRow): UserLeaderboardRow {
  return mapUserLeaderboardRow(client, { ...row, bevi_rank: row.friend_rank });
}

export function placeholderAppConfig(): AppConfig {
  // No versioning/maintenance-flag infra exists yet; this is a fixed
  // placeholder, not a read from the DB, until that's built.
  return { minAppVersion: '0.1.0', maintenance: false };
}

// --------------------------------------------------------------------------
// venues (S-10 + A-08, half 2)
// --------------------------------------------------------------------------

/** One row of `venues_in_view` (20261102000400). Numerics may arrive as strings. */
export interface VenuePinRow {
  id: string;
  name: string;
  kind: string;
  lat: number | string;
  lng: number | string;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  hours_osm: string | null;
  hours_known: boolean;
  website: string | null;
  best_score: number | string | null;
  predicted_score: number | string | null;
  open_now: boolean | null;
  bev_count: number;
}

const numOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

function mapVenueFromPin(row: VenuePinRow): Venue {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as VenueKind,
    lat: Number(row.lat),
    lng: Number(row.lng),
    address: row.address,
    // Null for every venue today: OSM has no `addr:suburb` in New York, so the
    // column is ours to fill. Not an error, and not worth a fallback string.
    neighborhood: row.neighborhood,
    borough: row.borough as Borough | null,
    hoursOsm: row.hours_osm,
    hoursKnown: row.hours_known,
    website: row.website,
  };
}

export function mapVenuePin(row: VenuePinRow): VenuePin {
  return {
    venue: mapVenueFromPin(row),
    bestScore: numOrNull(row.best_score),
    predictedScore: numOrNull(row.predicted_score),
    // The RPC leaves this null whenever `hours_known` is false, so the app has
    // one thing to test rather than two.
    openNow: row.open_now,
    bevCount: row.bev_count,
  };
}

/**
 * One row of `venue_detail` (20261102000400). The RPC returns the venue's
 * columns repeated on every assortment row, which is the shape a single
 * round trip can have; `mapVenueDetail` folds them back into one object.
 */
export interface VenueDetailRow {
  venue_id: string;
  name: string;
  kind: string;
  lat: number | string;
  lng: number | string;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  hours_osm: string | null;
  hours_known: boolean;
  website: string | null;
  open_now: boolean | null;
  bev_id: string;
  bev_name: string;
  bev_brand: string | null;
  bev_flavor: string | null;
  bev_category_id: string;
  bev_photo_path: string | null;
  bev_price_tier: number;
  bev_price_estimated: boolean;
  bev_rating_count: number;
  bev_bayes_score: number | string | null;
}

export function mapVenueDetail(client: SupabaseClient, rows: VenueDetailRow[]): VenueDetail {
  // The RPC raises BEVI_NOT_FOUND rather than returning an empty set, so a
  // caller that got here has at least one row.
  const first = rows[0];
  if (!first) throw new ApiError('not_found', 'Venue has no visible assortment');

  return {
    venue: {
      id: first.venue_id,
      name: first.name,
      kind: first.kind as VenueKind,
      lat: Number(first.lat),
      lng: Number(first.lng),
      address: first.address,
      neighborhood: first.neighborhood,
      borough: first.borough as Borough | null,
      hoursOsm: first.hours_osm,
      hoursKnown: first.hours_known,
      website: first.website,
    },
    openNow: first.open_now,
    bevs: rows.map((row) =>
      mapBevSummary(client, {
        id: row.bev_id,
        name: row.bev_name,
        brand: row.bev_brand,
        flavor: row.bev_flavor,
        category_id: row.bev_category_id,
        photo_path: row.bev_photo_path,
        price_tier: row.bev_price_tier,
        price_estimated: row.bev_price_estimated,
        bev_stats: {
          rating_count: row.bev_rating_count,
          avg_score: null,
          score_stddev: null,
          bayes_score: numOrNull(row.bev_bayes_score),
        },
      }),
    ),
  };
}
