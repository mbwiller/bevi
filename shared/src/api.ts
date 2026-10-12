// Contract v1: the `BeviApi` surface the app builds against. Implemented by
// `packages/api` (Supabase, Arjun) and `app/src/api/mock.ts` (Matt). Types only.
//
// Each method lists the `ApiError.code` values (./errors) it can throw beyond
// `network` / `unknown`, which any method can throw. Every method other than
// `signUp`, `signIn`, `getSession`, `onAuthChange`, `profile.checkHandle` and
// `meta.getAppConfig` throws 'unauthorized' when signed out.

import type { Bucket, CategoryId, PriceTier } from './enums';
import type {
  AppConfig,
  Bev,
  BevSummary,
  Category,
  Comparison,
  FeaturedBev,
  FeedItem,
  LeaderboardRow,
  Page,
  Profile,
  ProfileRow,
  ProfileStats,
  RankedBev,
  Ranking,
  RecommendationsResult,
  Session,
  UserLeaderboardRow,
  WantToTryItem,
} from './types';

export interface PageParams {
  cursor?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Auth: username + password with a shared invite code (decided 2026-10-11).
// No OAuth, no emails. `packages/api` maps the username to an internal
// synthetic email and keeps the session (tokens) in the `authStorage` adapter
// (localStorage on web). Exposed at the top level of `BeviApi` (`api.signIn`).
// ---------------------------------------------------------------------------

export interface SignUpInput {
  /** Becomes the profile handle; must match `HANDLE_PATTERN` and not be reserved. */
  username: string;
  password: string;
  inviteCode: string;
}

export interface SignInInput {
  username: string;
  password: string;
}

export interface AuthApi {
  /**
   * Creates the account and its profile (`handle = username`) and signs in.
   * @throws 'validation' — wrong invite code (`detail.field = 'inviteCode'`),
   *   malformed or reserved username (`'username'`), weak password (`'password'`);
   *   'conflict' — username taken; 'rate_limited'.
   */
  signUp(input: SignUpInput): Promise<Session>;

  /**
   * @throws 'unauthorized' — wrong username or password; 'rate_limited'.
   */
  signIn(input: SignInInput): Promise<Session>;

  /** The persisted session, or null when signed out. Never throws 'unauthorized'. */
  getSession(): Promise<Session | null>;

  /** Fires on sign-in, sign-out, token expiry and account deletion. Returns unsubscribe. */
  onAuthChange(cb: (session: Session | null) => void): () => void;

  signOut(): Promise<void>;

  /**
   * Deletes rankings, comparisons, follows, Want to Try and the profile; Bevs the
   * user created stay with `createdBy = null`. Signs out.
   * @throws 'unauthorized'.
   */
  deleteAccount(): Promise<void>;
}

// ---------------------------------------------------------------------------

export interface UpdateMeInput {
  displayName?: string;
  /** Also changes the sign-in username. */
  handle?: string;
  timezone?: string;
  onboarded?: boolean;
}

export interface CheckHandleResult {
  available: boolean;
  /** Why it's unavailable, for the field message. */
  reason?: 'taken' | 'invalid' | 'reserved';
}

export interface ProfileApi {
  /** @throws 'unauthorized'. */
  getMe(): Promise<Profile>;

  /**
   * Birthdate is not patchable here (see `setBirthDate`).
   * @throws 'unauthorized'; 'validation' (`detail.field`) — malformed handle,
   *   empty display name, unknown timezone; 'conflict' — handle taken.
   */
  updateMe(patch: UpdateMeInput): Promise<Profile>;

  /**
   * Sets the birthdate once (ISO date, YYYY-MM-DD) and returns the profile with
   * `canSeeAlcohol` recomputed. Under 21 is allowed. Only an admin can change it
   * afterwards.
   * @throws 'unauthorized'; 'validation' — already set, malformed or future date.
   */
  setBirthDate(date: string): Promise<Profile>;

  /** Callable signed out (sign-up form). Never throws 'unauthorized'. */
  checkHandle(handle: string): Promise<CheckHandleResult>;

  /** @throws 'unauthorized', 'not_found'. */
  getUser(id: string): Promise<ProfileRow>;

  /** Matches display name or handle. @throws 'unauthorized'. */
  searchUsers(params: { q: string; limit?: number; cursor?: string }): Promise<Page<ProfileRow>>;
}

export interface StatsApi {
  /** @throws 'unauthorized'. */
  getMine(): Promise<ProfileStats>;

  /** @throws 'unauthorized', 'not_found'. */
  getUser(id: string): Promise<ProfileStats>;
}

export interface FollowsApi {
  /**
   * Idempotent: following someone already followed resolves without error.
   * @throws 'unauthorized', 'not_found', 'validation' (following yourself), 'rate_limited'.
   */
  follow(id: string): Promise<void>;

  /** Idempotent. @throws 'unauthorized', 'not_found'. */
  unfollow(id: string): Promise<void>;

  /** @throws 'unauthorized', 'not_found'. */
  listFollowers(id: string, page?: PageParams): Promise<Page<ProfileRow>>;

  /** @throws 'unauthorized', 'not_found'. */
  listFollowing(id: string, page?: PageParams): Promise<Page<ProfileRow>>;

  /** Users with the most rankings the caller doesn't follow. @throws 'unauthorized'. */
  suggested(): Promise<ProfileRow[]>;
}

export interface CategoriesApi {
  /** Already age-filtered for the caller. @throws 'unauthorized'. */
  list(): Promise<Category[]>;
}

export interface CreateBevInput {
  name: string;
  brand?: string;
  flavor?: string;
  categoryId: CategoryId;
  /** null with `priceEstimated: true` = "Not sure, estimate it" (server fills the tier). */
  priceTier: PriceTier | null;
  priceEstimated: boolean;
  /** From `media.upload({ kind: 'bev-photo' })`. */
  photoAssetId: string;
  /** From `media.upload({ kind: 'label' })`. */
  labelAssetId?: string;
}

export interface FindDuplicatesInput {
  name: string;
  brand?: string;
  flavor?: string;
  categoryId?: CategoryId;
}

export interface BevsApi {
  /** Age-filtered server-side. @throws 'unauthorized'. */
  search(params: { q: string; categoryId?: CategoryId; limit?: number; cursor?: string }): Promise<Page<BevSummary>>;

  /** @throws 'unauthorized', 'not_found', 'age_restricted'. */
  get(id: string): Promise<Bev>;

  /** Up to 5 likely matches. @throws 'unauthorized'. */
  findLikelyDuplicates(input: FindDuplicatesInput): Promise<BevSummary[]>;

  /**
   * The wizard has already run `findLikelyDuplicates` and the user chose "No, mine
   * is different", so likely (fuzzy) duplicates never fail. Only an exact match
   * on (name, brand, flavor, category), case-insensitive, is a 'conflict', with
   * `detail = { existingBevId }` so the app can jump to ranking that Bev.
   * @throws 'unauthorized'; 'validation' (`detail.field`), incl. an unknown or
   *   unready asset id (an asset that doesn't exist or isn't the caller's upload has
   *   `detail.reason: 'unknown_asset'`, which retrying can't fix); 'age_restricted' — alcoholic category and the caller
   *   can't see alcohol; 'conflict' — exact duplicate; 'rate_limited'.
   */
  create(input: CreateBevInput): Promise<Bev>;

  /** @throws 'unauthorized', 'not_found', 'validation' (unknown reason), 'rate_limited'. */
  report(id: string, reason: string): Promise<void>;

  /**
   * Age-filtered `isStarter` Bevs, at least 30, each with `ratingCount`. The app
   * picks 10 with `selectStarterSet(candidates, { seed: userId })`.
   * @throws 'unauthorized'.
   */
  getStarterCandidates(): Promise<BevSummary[]>;
}

export interface UploadMediaInput {
  kind: 'bev-photo' | 'label';
  /** A web `File` or `Blob` (from the image picker / camera input). */
  file: Blob;
  mimeType: string;
}

export interface UploadMediaResult {
  assetId: string;
  /** Raw upload URL, displayable immediately. */
  url: string;
  /** 'processing' while background removal runs. */
  status: 'processing' | 'ready';
}

export interface MediaApi {
  /** @throws 'unauthorized', 'validation' — unsupported mimeType or too large; 'rate_limited'. */
  upload(input: UploadMediaInput): Promise<UploadMediaResult>;
}

/** What the placement flow produces (`@bevi/ranking` `PlacementResult`) plus an optional note. */
export interface SubmitRankingInput {
  bevId: string;
  bucket: Bucket;
  /** 0 = best; `expectedBucketSize` = append at the bottom. */
  insertIndex: number;
  /**
   * Size of the bucket list the placement searched (`listBucket(bucket).length`).
   * For `rerankBev` it excludes the Bev being moved.
   */
  expectedBucketSize: number;
  /** Every comparison answered, in order. */
  comparisons: Comparison[];
  /** Up to 140 chars. */
  note?: string;
}

export interface SubmitRankingResult {
  ranking: Ranking;
  /** Size of `ranking.bucket` after the write ("#4 of 31 in Loved"). */
  bucketSize: number;
}

export type RankingSort = 'score' | 'recent' | 'name';

export interface RankingsApi {
  /**
   * The caller's rankings. Default sort 'score' = (bucket LOVED→DISLIKED, position).
   * @throws 'unauthorized'.
   */
  listMine(params?: {
    bucket?: Bucket;
    categoryId?: CategoryId;
    sort?: RankingSort;
    page?: PageParams;
  }): Promise<Page<RankedBev>>;

  /** Another user's (or the caller's) rankings, newest first. @throws 'unauthorized', 'not_found'. */
  listUser(id: string, page?: PageParams): Promise<Page<RankedBev>>;

  /**
   * The caller's whole bucket as Bev ids, best first, unpaginated: the list the
   * placement flow searches. Its length is `expectedBucketSize`.
   * @throws 'unauthorized'.
   */
  listBucket(bucket: Bucket): Promise<string[]>;

  /**
   * Inserts a new ranking at `insertIndex`, re-spaces the bucket's scores, stores
   * the comparisons, and posts a feed item, atomically. Removes the Bev from Want
   * to Try.
   * @throws 'unauthorized'; 'not_found' — no such Bev; 'age_restricted';
   *   'conflict' — the server's bucket size ≠ `expectedBucketSize`, or the Bev is
   *   already ranked (use `rerankBev`); 'validation' — `insertIndex` outside
   *   [0, expectedBucketSize], note too long; 'rate_limited'.
   */
  submitRanking(input: SubmitRankingInput): Promise<SubmitRankingResult>;

  /**
   * Moves an existing ranking (bucket may change), atomically; `expectedBucketSize`
   * excludes the Bev being moved. `note` replaces the note when given, else it
   * carries over.
   * @throws 'unauthorized'; 'not_found' — the caller hasn't ranked this Bev;
   *   'conflict' — bucket size (excluding this Bev) ≠ `expectedBucketSize`;
   *   'validation' — `insertIndex` outside [0, expectedBucketSize]; 'rate_limited'.
   */
  rerankBev(input: SubmitRankingInput): Promise<SubmitRankingResult>;

  /** @throws 'unauthorized', 'not_found' — not ranked; 'validation' — too long. */
  updateNote(bevId: string, note: string): Promise<void>;

  /** Other scores in that bucket shift. @throws 'unauthorized', 'not_found'. */
  removeRanking(bevId: string): Promise<void>;
}

export interface WantToTryApi {
  /** Newest first. @throws 'unauthorized'. */
  list(page?: PageParams): Promise<Page<WantToTryItem>>;

  /**
   * Idempotent: saving an already-saved Bev resolves without error. Posts a
   * 'SAVED' feed item the first time.
   * @throws 'unauthorized', 'not_found', 'age_restricted'.
   */
  add(bevId: string, viaUserId?: string): Promise<void>;

  /** Idempotent. @throws 'unauthorized'. */
  remove(bevId: string): Promise<void>;
}

export interface FeedApi {
  /** The caller's and followed users' RANKING and SAVED posts, newest first. @throws 'unauthorized'. */
  getFeed(page?: PageParams): Promise<Page<FeedItem>>;

  /** Age-filtered. @throws 'unauthorized'. */
  getFeatured(): Promise<FeaturedBev[]>;
}

export interface LeaderboardApi {
  /** @throws 'unauthorized'. */
  bevs(params?: { categoryId?: CategoryId; page?: PageParams }): Promise<Page<LeaderboardRow>>;

  /** @throws 'unauthorized'. */
  users(page?: PageParams): Promise<Page<UserLeaderboardRow>>;
}

export interface RecsApi {
  /** Empty `items` below 3 rankings. @throws 'unauthorized'. */
  getRecommendations(params?: { limit?: number }): Promise<RecommendationsResult>;

  /** @throws 'unauthorized', 'rate_limited'. */
  refresh(): Promise<void>;
}

export interface MetaApi {
  /** Callable signed out. */
  getAppConfig(): Promise<AppConfig>;
}

export interface BeviApi extends AuthApi {
  profile: ProfileApi;
  stats: StatsApi;
  follows: FollowsApi;
  categories: CategoriesApi;
  bevs: BevsApi;
  media: MediaApi;
  rankings: RankingsApi;
  wantToTry: WantToTryApi;
  feed: FeedApi;
  leaderboard: LeaderboardApi;
  recs: RecsApi;
  meta: MetaApi;
}
