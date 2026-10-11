// DRAFT: this is the first-pass `BeviApi` surface assembled from both sides'
// per-screen data needs (DEVELOPMENT-MATT.md §13). Method names, parameter
// shapes, and grouping are all expected to change once Matt reviews this
// against the screens. Nothing here is implemented — types only.

import type { Bucket, CategoryId } from './enums';
// Every method below is documented with the `ApiError.code` values
// (see ./errors) it's expected to throw, where obvious.
import type {
  Bev,
  BevSummary,
  Category,
  Comparison,
  FeaturedBev,
  FeedItem,
  LeaderboardRow,
  Page,
  Profile,
  ProfileStats,
  Recommendation,
  UserLeaderboardRow,
  WantToTryItem,
} from './types';

export interface PageParams {
  cursor?: string;
  limit?: number;
}

export interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthApi {
  /**
   * @throws {ApiErrorCode} 'validation' if email/password fail basic checks,
   * 'conflict' if the email is already registered, 'network'.
   */
  signUp(email: string, password: string): Promise<Session>;

  /**
   * @throws {ApiErrorCode} 'unauthorized' on bad credentials, 'rate_limited'
   * after repeated failures, 'network'.
   */
  signIn(email: string, password: string): Promise<Session>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  signOut(): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  getSession(): Promise<Session | null>;

  onAuthStateChange(cb: (session: Session | null) => void): () => void;

  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  deleteAccount(): Promise<void>;
}

export interface ProfileApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  getMe(): Promise<Profile>;

  /**
   * @throws {ApiErrorCode} 'unauthorized', 'validation' (e.g. handle taken or
   * malformed), 'age_restricted' if birthdate implies under the drinking age
   * and the patch would otherwise grant alcohol visibility, 'network'.
   */
  updateMe(
    patch: Partial<Pick<Profile, 'displayName' | 'handle' | 'timezone'>> & { birthdate?: string }
  ): Promise<Profile>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  checkHandle(handle: string): Promise<{ available: boolean }>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  getUser(id: string): Promise<Profile>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  searchUsers(params: { q: string; limit?: number }): Promise<Page<Profile>>;
}

export interface StatsApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  getMine(): Promise<ProfileStats>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  getUser(id: string): Promise<ProfileStats>;
}

export interface FollowsApi {
  /**
   * @throws {ApiErrorCode} 'not_found' if the target user doesn't exist,
   * 'conflict' if already following, 'network'.
   */
  follow(id: string): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  unfollow(id: string): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  listFollowers(id: string, page?: PageParams): Promise<Page<Profile>>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  listFollowing(id: string, page?: PageParams): Promise<Page<Profile>>;

  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  suggested(): Promise<Profile[]>;
}

export interface CategoriesApi {
  /**
   * @throws {ApiErrorCode} 'network'.
   */
  list(): Promise<Category[]>;
}

export interface CreateBevInput {
  name: string;
  brand?: string;
  flavor?: string;
  categoryId: CategoryId;
}

export interface BevsApi {
  /**
   * @throws {ApiErrorCode} 'network'.
   */
  search(params: { q: string; categoryId?: CategoryId; limit?: number }): Promise<Page<BevSummary>>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  get(id: string): Promise<Bev>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  findLikelyDuplicates(input: {
    name: string;
    brand?: string;
    flavor?: string;
    categoryId?: CategoryId;
  }): Promise<BevSummary[]>;

  /**
   * @throws {ApiErrorCode} 'validation', 'age_restricted' if categoryId is
   * alcoholic and the caller can't see alcohol, 'conflict' if a likely
   * duplicate exists and the caller should confirm via
   * `findLikelyDuplicates` first, 'network'.
   */
  create(input: CreateBevInput): Promise<Bev>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'validation', 'network'.
   */
  report(id: string, reason: string): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  listStarterCandidates(): Promise<BevSummary[]>;
}

export interface UploadMediaInput {
  kind: 'bev-photo' | 'label';
  uri: string;
  mimeType: string;
}

export interface UploadMediaResult {
  url: string;
}

export interface MediaApi {
  /**
   * @throws {ApiErrorCode} 'validation' for an unsupported mimeType,
   * 'rate_limited', 'network'.
   */
  upload(input: UploadMediaInput): Promise<UploadMediaResult>;
}

export interface SubmitRankingInput {
  bevId: string;
  bucket: Bucket;
  insertIndex: number;
  comparisons: Comparison[];
  note?: string;
  replaceExisting?: boolean;
}

export interface RankingsApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  listMine(params?: { bucket?: Bucket; categoryId?: CategoryId; page?: PageParams }): Promise<Page<Bev>>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  listUser(id: string, page?: PageParams): Promise<Page<Bev>>;

  /**
   * @throws {ApiErrorCode} 'not_found' if bevId doesn't exist,
   * 'age_restricted' if the bev is alcoholic and the caller can't see
   * alcohol, 'conflict' if a ranking already exists for this bev and
   * `replaceExisting` wasn't set, or if the bucket/ordering changed
   * concurrently (stale `comparisons`), 'validation', 'network'.
   */
  submitRanking(input: SubmitRankingInput): Promise<Bev>;

  /**
   * @throws {ApiErrorCode} 'not_found' if there's no ranking for this bev,
   * 'network'.
   */
  updateNote(bevId: string, note: string): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  removeRanking(bevId: string): Promise<void>;
}

export interface WantToTryApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  list(page?: PageParams): Promise<Page<WantToTryItem>>;

  /**
   * @throws {ApiErrorCode} 'not_found' if bevId doesn't exist, 'conflict' if
   * already saved, 'network'.
   */
  add(bevId: string, viaUserId?: string): Promise<void>;

  /**
   * @throws {ApiErrorCode} 'not_found', 'network'.
   */
  remove(bevId: string): Promise<void>;
}

export interface FeedApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  getFeed(page?: PageParams): Promise<Page<FeedItem>>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  getFeatured(): Promise<FeaturedBev[]>;
}

export interface LeaderboardApi {
  /**
   * @throws {ApiErrorCode} 'network'.
   */
  bevs(params?: { categoryId?: CategoryId; page?: PageParams }): Promise<Page<LeaderboardRow>>;

  /**
   * @throws {ApiErrorCode} 'network'.
   */
  users(page?: PageParams): Promise<Page<UserLeaderboardRow>>;
}

export interface RecsApi {
  /**
   * @throws {ApiErrorCode} 'unauthorized', 'network'.
   */
  getRecommendations(params?: { limit?: number }): Promise<Recommendation[]>;

  /**
   * @throws {ApiErrorCode} 'unauthorized', 'rate_limited', 'network'.
   */
  refresh(): Promise<void>;
}

export interface MetaApi {
  /**
   * @throws {ApiErrorCode} 'network'.
   */
  getAppConfig(): Promise<{ minAppVersion: string; maintenance: boolean }>;
}

export interface BeviApi {
  auth: AuthApi;
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
