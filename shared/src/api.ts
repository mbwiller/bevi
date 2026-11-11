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
  BevLeaf,
  BevOfPeriod,
  BevSimilarity,
  BevSummary,
  BucketBev,
  Category,
  CategoryNode,
  CategoryProgress,
  Comment,
  Comparison,
  ExplorePost,
  FeaturedBev,
  FeedItem,
  LatLngBounds,
  LeaderboardRow,
  Page,
  Profile,
  ProfileRow,
  ProfileStats,
  RankedBev,
  Ranking,
  RecommendationsResult,
  Session,
  SuggestedProfile,
  TasteProfileRow,
  UserLeaderboardRow,
  VenueDetail,
  VenueFilters,
  VenuePin,
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
  /**
   * The profile photo: an `assetId` from `media.upload({ kind: 'avatar' })`, or
   * null to remove the photo (the Avatar falls back to initials). Omitted =
   * unchanged. Shows as `Profile.avatarUrl` everywhere a profile appears.
   */
  avatarAssetId?: string | null;
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
   *   empty display name, unknown timezone, or an `avatarAssetId` that isn't
   *   the caller's own avatar upload (`detail.reason: 'unknown_asset'`);
   *   'conflict' — handle taken.
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

  /**
   * The caller's ranked count per category, one row per category they can see
   * (ranked 0 included; alcoholic categories only for 21+), in `sortOrder`.
   * @throws 'unauthorized'.
   */
  getCategoryProgress(): Promise<CategoryProgress[]>;

  /**
   * Any user's average score per category they've ranked, highest mean first.
   * Means aren't private, so any signed-in caller may read anyone's. Alcoholic
   * categories are left out for a caller under 21 (and for an owner under 21).
   * @throws 'unauthorized', 'not_found' (no such user).
   */
  getTasteProfile(userId: string): Promise<TasteProfileRow[]>;
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

  /**
   * Users with the most rankings the caller doesn't follow. Each row carries
   * who among the people the caller follows already follows that user
   * (`followedBy`, at most two, and `followedByCount`, the total).
   * @throws 'unauthorized'.
   */
  suggested(): Promise<SuggestedProfile[]>;
}

export interface CategoriesApi {
  /**
   * The 15 top-level categories with their Bev counts, already age-filtered for
   * the caller. Never returns a leaf of the finer taxonomy — use `tree()` for
   * that. @throws 'unauthorized'.
   */
  list(): Promise<Category[]>;

  /**
   * The whole two-level taxonomy (A-13/D-04): the 15 roots and the 60 leaves,
   * age-filtered by the root's `isAlcoholic`, ordered root-then-leaf in sibling
   * order so one pass builds the tree. No Bev counts — `list()` has those.
   *
   * The result is catalog structure: it changes only when a migration changes
   * it, so cache it for the session rather than per screen.
   * @throws 'unauthorized'.
   */
  tree(): Promise<CategoryNode[]>;
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

  /**
   * A Bev that was merged into another (a duplicate, resolved by hand) resolves to
   * the surviving Bev: the returned `id` is then the survivor's, not `id`, which is
   * how a caller can tell it followed a merge (an old link or a cached id).
   * @throws 'unauthorized', 'not_found', 'age_restricted' (judged on the Bev returned).
   */
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

  /**
   * Reports a Bev for moderation. `opts.duplicateOfId` names the Bev this one
   * duplicates: meant for `reason = 'duplicate'`, accepted with any reason, and
   * optional even then (an operator reads the reports and merges by hand; a
   * duplicate report without it is still a valid report).
   * @throws 'unauthorized'; 'not_found' (no Bev `id`); 'validation' — an unknown
   *   reason, or `detail.field = 'duplicateOfId'` when it equals `id` or names a Bev
   *   the caller cannot see (unknown, not active, or alcoholic for a caller under
   *   21 — one error for all three, so it reveals nothing); 'rate_limited'.
   */
  report(id: string, reason: string, opts?: { duplicateOfId?: string }): Promise<void>;

  /**
   * Age-filtered `isStarter` Bevs, at least 30, each with `ratingCount`. The app
   * picks 10 with `selectStarterSet(candidates, { seed: userId })`.
   * @throws 'unauthorized'.
   */
  getStarterCandidates(): Promise<BevSummary[]>;

  /**
   * Bev-graph edge weights between `bevId` and each of `otherIds` — for
   * anchored placement (compare a new mocha with mochas first) and for the
   * content term of a recommendation.
   *
   * Reads the **`bev_edges` mirror** in Postgres, which the nightly graph sync
   * writes (A-16); Neo4j is never on a request path. **The mirror is empty
   * until that sync job lands, so this returns `[]` today** — and it stays
   * sparse afterwards, because only pairs above `EDGE_MIN_WEIGHT` that made one
   * of the two Bevs' top-`EDGE_TOP_K` cut are stored. Callers MUST handle a
   * result shorter than `otherIds`, including empty, and fall back to
   * `treeSimilarity` / `contentSimilarity` from `@bevi/ranking` for the pairs
   * that are missing.
   *
   * Order is unspecified; match on `bevId`. Ids the caller may not see (an
   * alcoholic Bev while under 21, or a Bev that is not active) are simply
   * absent rather than an error.
   * @throws 'unauthorized'; 'validation' (`detail.field = 'otherIds'`) — more
   *   than 500 ids in one call.
   */
  similarities(bevId: string, otherIds: readonly string[]): Promise<BevSimilarity[]>;

  /**
   * "Bevs like this": the heaviest `bev_edges` neighbours of `bevId`, most
   * similar first, age-filtered and active only. `n` defaults to 10 and is
   * clamped server-side to 50.
   *
   * Same mirror as `similarities`, so the same caveat: **empty until the graph
   * sync job lands**, and a Bev with no edges returns `[]`. Render the row only
   * when it is non-empty; there is no error for "no neighbours".
   * @throws 'unauthorized'.
   */
  similar(bevId: string, n?: number): Promise<BevSummary[]>;

  /**
   * Each Bev's leaf in the finer taxonomy (A-13/D-04), for M-21's two-phase
   * placement: phase 1 narrows to the Bevs sharing a leaf, phase 2 searches
   * within.
   *
   * Same bulk shape and the same caveats as `similarities`, deliberately — call
   * it once per bucket, not once per Bev. `leafCategoryId` is **null** when a
   * Bev sits directly on its category, which is correct for the two unsplit
   * roots (`water`, `sports`) and for every user-created Bev until something
   * relabels it; fall back to `BevSummary.categoryId`, still one of the 15.
   *
   * Ids the caller may not see (age-gated, or not `active`) are **omitted**, so
   * a short result is normal. A visible Bev with no leaf is present with
   * `leafCategoryId: null`, which is how "no finer placement" differs from "not
   * visible". Order is by `bevId`; at most 500 ids.
   * @throws 'unauthorized', 'validation' (`detail.field = 'bevIds'`, over 500).
   */
  leaves(bevIds: readonly string[]): Promise<BevLeaf[]>;
}

export interface UploadMediaInput {
  /** 'avatar' is the caller's profile photo, applied with `profile.updateMe({ avatarAssetId })`. */
  kind: 'bev-photo' | 'label' | 'avatar';
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
   * The same bucket as `listBucket`, same order, but each id carried with the
   * `categoryId` and `brandKey` the similarity formulas need — so anchored
   * placement can rank the bucket against a new Bev without a `bevs.get` per
   * row.
   *
   * It pairs with `bevs.similarities`: ask for the weights over these ids, and
   * use `treeSimilarity(categoryId, …)` / `contentSimilarity` from
   * `@bevi/ranking` for the pairs `bev_edges` has no row for — which, until the
   * graph sync job lands, is all of them.
   * @throws 'unauthorized'.
   */
  listBucketBevs(bucket: Bucket): Promise<BucketBev[]>;

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
   * Idempotent: saving an already-saved Bev resolves without error. A save is
   * never a feed post; the only public signal is the filled bookmark on a Bev
   * the caller has saved.
   * @throws 'unauthorized', 'not_found', 'age_restricted'.
   */
  add(bevId: string, viaUserId?: string): Promise<void>;

  /** Idempotent. @throws 'unauthorized'. */
  remove(bevId: string): Promise<void>;
}

export interface FeedApi {
  /** The caller's and followed users' RANKING posts, newest first. @throws 'unauthorized'. */
  getFeed(page?: PageParams): Promise<Page<FeedItem>>;

  /**
   * One user's RANKING posts, newest first, in the same shape as `getFeed`
   * (likes, the first seven comments inline, and `alsoBevdBy`, which is
   * always relative to the caller, not to `userId`). Only posts the caller may
   * see: their own and followed users'; empty for anyone else, whose Activity
   * uses `rankings.listUser`.
   * @throws 'unauthorized'; 'not_found' — no such user.
   */
  listUser(userId: string, page?: PageParams): Promise<Page<FeedItem>>;

  /**
   * Explore: RANKING posts by users up to two follows away whom the caller
   * does NOT follow (never their own, never someone they already follow, so
   * no post is ever in both the feed and Explore). Age-filtered.
   *
   * **Ordered by popularity, not by time** — a time-decayed like count,
   * `(likes + 1) / (ageHours + 2)^1.5` (docs/bevi-ranking-math.tex §10.4) —
   * so `items` is NOT newest-first and a post can move up as it is liked.
   *
   * **Read-only (D-15):** an `ExplorePost` is a `FeedItem` without
   * `likeCount`, `likedByMe`, `commentCount` and `comments`. The server does
   * not return them, and `feed.like` / `comments.add` on an Explore post
   * throw 'not_found' — likes and comments stay follower-only. Render it as a
   * plain post with no heart, no counts and no comments.
   *
   * While Bevi has fewer than 20 users the two-hop scope widens to everyone
   * (minus the caller and the people they follow), so the tab is never empty
   * (D-01).
   *
   * Paging is by `nextCursor` as everywhere else; the cursor freezes the
   * ordering for the rest of the sequence, so pages do not reshuffle as
   * scores decay. Start a fresh sequence (no cursor) to pick up new posts.
   * @throws 'unauthorized'.
   */
  getExplore(page?: PageParams): Promise<Page<ExplorePost>>;

  /** Age-filtered. @throws 'unauthorized'. */
  getFeatured(): Promise<FeaturedBev[]>;

  /**
   * Bev of the day and Bev of the week (`PeriodWinner`), age-filtered. A period with no
   * rankings falls back to the latest one that had some, with `isCurrent: false`.
   * @throws 'unauthorized'.
   */
  getBevOfPeriod(): Promise<BevOfPeriod>;

  /**
   * Idempotent: liking an already-liked post resolves without error.
   * @throws 'unauthorized'; 'not_found' — no such post, or one the caller
   *   cannot see (a stranger's, or an alcoholic Bev's while under 21);
   *   'rate_limited'.
   */
  like(id: string): Promise<void>;

  /** Idempotent. @throws 'unauthorized', 'not_found', 'rate_limited'. */
  unlike(id: string): Promise<void>;
}

export interface CommentsApi {
  /** Newest first. @throws 'unauthorized', 'not_found' — post not visible. */
  list(eventId: string, page?: PageParams): Promise<Page<Comment>>;

  /**
   * @throws 'unauthorized'; 'not_found' — post not visible; 'validation' —
   *   empty or over 280 characters; 'rate_limited'.
   */
  add(eventId: string, body: string): Promise<Comment>;

  /** Own comments only. Idempotent. @throws 'unauthorized', 'not_found'. */
  remove(id: string): Promise<void>;
}

export interface LeaderboardApi {
  /** @throws 'unauthorized'. */
  bevs(params?: { categoryId?: CategoryId; page?: PageParams }): Promise<Page<LeaderboardRow>>;

  /** @throws 'unauthorized'. */
  users(page?: PageParams): Promise<Page<UserLeaderboardRow>>;

  /**
   * The same board among friends: the caller plus the people the caller
   * follows, ranked among themselves by exactly the `points` `users()` ranks
   * by. `rank` is the competition rank within that set, from 1, and the rows
   * come in the global board's order (points, then Bevs ranked, then the
   * older account, then id), so a tie is broken the same way on both boards.
   *
   * As on `users()`, someone with no rankings is Unranked and has no row —
   * that includes the caller, so the page is empty until the caller or
   * someone they follow has ranked a Bev. With no follows it is the caller
   * alone, at rank 1.
   *
   * Paged by `nextCursor`; `rank` is the rank in the whole set, not the
   * position on the page.
   * @throws 'unauthorized'.
   */
  friends(page?: PageParams): Promise<Page<UserLeaderboardRow>>;
}

export interface RecsApi {
  /** Empty `items` below 3 rankings. @throws 'unauthorized'. */
  getRecommendations(params?: { limit?: number }): Promise<RecommendationsResult>;

  /** @throws 'unauthorized', 'rate_limited'. */
  refresh(): Promise<void>;
}

export interface VenuesApi {
  /**
   * The pins inside a viewport (S-10, trimmed). Venues with no assortment are
   * never returned (D-13), so every pin has at least one Bev behind it.
   *
   * `zoom` caps how many come back -- about 60 at zoom 11 up to 300 at zoom 15
   * -- because a city-wide view would otherwise return everything. The cap is
   * applied after the filters and keeps the highest-scoring venues, so zooming
   * out thins the map rather than changing which end of it you see. A
   * fractional zoom (Google's vector maps report e.g. 12.5) is floored.
   *
   * Every filter is optional, and an EMPTY array is the same as leaving it
   * out (no filter), not "match nothing": a multi-select with nothing ticked
   * means "any".
   *
   * `bounds` is clamped to `NYC_BOUNDS` server-side, so a viewport that spills
   * past the city returns only what is inside it. @throws 'unauthorized'.
   */
  inView(params: { bounds: LatLngBounds; zoom: number; filters?: VenueFilters }): Promise<VenuePin[]>;

  /**
   * One venue and its assortment. A hidden venue, an unknown id, an id that is
   * not a venue id at all, and a venue whose whole assortment the caller may
   * not see are all the same 'not_found'. @throws 'unauthorized', 'not_found'.
   */
  get(venueId: string): Promise<VenueDetail>;

  /**
   * The distinct neighbourhoods that have at least one pinned venue, for the
   * "Neighborhood" filter (decision 36 turns the city filter into it).
   *
   * EXPECT THIS TO BE EMPTY for now. OSM has no neighbourhood for any venue in
   * the starting area -- `addr:suburb` is unused in New York -- so the column
   * is ours to fill and nothing has filled it yet. An empty list means "no
   * vocabulary yet", so hide the filter rather than showing it with no
   * options. @throws 'unauthorized'.
   */
  neighborhoods(): Promise<string[]>;
}

export interface MetaApi {
  /** Callable signed out. */
  getAppConfig(): Promise<AppConfig>;
}

// ---------------------------------------------------------------------------
// Bugs: the internal bug reporter (docs/bug-workflow.md). Internal-only —
// every method is refused for an ordinary account, server-side, whatever the
// client chooses to show. Linear owns the issue: nothing here writes its
// priority, labels or comments after create, and the app never holds a
// tracker credential. The one write after create is `markVerified`, which
// moves a ticket the reporter has checked on the device to Done.
// ---------------------------------------------------------------------------

/** What the reporter says it is. The server files each kind under a Linear label of the same name. */
export type BugReportKind = 'bug' | 'fix' | 'idea' | 'design';

/**
 * How bad the reporter says it is: blocker = cannot use the app or data is
 * wrong; bad = a core flow is broken; annoying = works with a workaround;
 * polish = cosmetic. The server maps it to Linear priority 1–4 at create time.
 */
export type BugReportSeverity = 'blocker' | 'bad' | 'annoying' | 'polish';

/** Safe, allow-listed context the reporter sees before sending. No user content, ever. */
export interface BugReportEnvironment {
  /** The route the reporter was on, e.g. '/bev/[id]'. Never a URL with a query string. */
  route?: string;
  /** The feature area, for the tracker's component label. */
  component?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  /** The deploy's git SHA (short), as the build inlined it. */
  build?: string;
  /** 'production' | 'preview' | 'development', as the build knows itself. */
  stage?: string;
  /** The colour scheme the app rendered in. */
  theme?: 'light' | 'dark';
  /** `navigator.onLine` when the form opened. */
  online?: boolean;
  /** e.g. '390x844'. */
  viewport?: string;
  /** ISO-8601. */
  occurredAt?: string;
  reproducibility?: 'always' | 'intermittent' | 'unknown';
}

/**
 * One entry of the trail the app keeps in memory: a navigation (the route
 * pattern, never ids or a query string) or a failed API call (the method
 * name, the error code, the status, the duration). Never arguments, never
 * responses, never anything a user typed. The server keeps at most 20 and
 * redacts every string.
 */
export interface BugBreadcrumb {
  /** ISO-8601. */
  at: string;
  kind: 'nav' | 'api';
  /** `nav`: the route pattern, e.g. '/bev/[id]'. */
  route?: string;
  /** `api`: the BeviApi method, e.g. 'rankings.submit'. */
  method?: string;
  /** `api`: the ApiError code. */
  code?: string;
  /** `api`: the HTTP status when known. */
  status?: number;
  /** `api`: how long the call took. */
  ms?: number;
}

export interface BugReportInput {
  kind: BugReportKind;
  severity: BugReportSeverity;
  /** The observable symptom; becomes the ticket title. Required. */
  title: string;
  /** What happened. */
  description?: string;
  reproductionSteps?: string[];
  expected?: string;
  actual?: string;
  environment?: BugReportEnvironment;
  breadcrumbs?: BugBreadcrumb[];
  /**
   * The screenshots, at most 3, uploaded to private storage as part of this
   * call and never before it — nothing leaves the device until the reporter
   * submits.
   */
  evidence?: { file: Blob; mimeType: string }[];
  /**
   * A UUID the client generates once per draft and reuses on every retry of
   * that draft. The same key never creates a second ticket.
   */
  idempotencyKey: string;
}

export interface BugReportResult {
  /** The tracker's own identifier, e.g. 'BEV-104'. Never invented client-side. */
  ticketId: string;
  ticketUrl: string;
  /** 'duplicate' = this idempotency key had already produced that ticket. */
  status: 'created' | 'duplicate';
}

/**
 * Where a ticket is in the workflow (docs/bug-workflow.md), derived from
 * Linear's state type; 'unknown' when the tracker could not be asked.
 */
export type BugTicketState = 'triage' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled' | 'unknown';

/** One of the caller's own tickets, as My reports lists it. */
export interface BugReportSummary {
  ticketId: string;
  ticketUrl: string;
  /** The title as filed. */
  title: string;
  kind: BugReportKind;
  severity: BugReportSeverity;
  /** ISO-8601, when it was filed. */
  createdAt: string;
  state: BugTicketState;
  /** Linear's own state name, e.g. 'In Review'; null when `state` is 'unknown'. */
  stateLabel: string | null;
  /** Linear's priority 0–4; null when unknown. */
  priority: number | null;
  /** ISO-8601, Linear's last change; null when unknown. */
  updatedAt: string | null;
}

export interface BugsApi {
  /**
   * Whether this account may file internal bug reports. Drives whether the
   * Report a bug entry point is shown; it is not the access check, which runs
   * server-side on every call. Never throws 'unauthorized' for a signed-in
   * ordinary user — it answers false.
   */
  canReport(): Promise<boolean>;

  /**
   * Files one report: uploads the evidence (if any), then creates the tracker
   * issue server-side and returns the identifier the tracker assigned.
   *
   * @throws 'unauthorized' — signed out, or not an internal reporter;
   *   'validation' — missing title (`detail.field = 'title'`), unknown kind or
   *   severity (`'kind'`, `'severity'`), unsupported, oversized or too many
   *   attachments (`'evidence'`), malformed key (`'idempotencyKey'`);
   *   'conflict' — a submission for this key is already in flight;
   *   'rate_limited'; 'unknown' — the tracker is unreachable or unconfigured
   *   (the draft is still intact and the same key may be retried).
   */
  report(input: BugReportInput): Promise<BugReportResult>;

  /**
   * The caller's own filed tickets, newest first, with their live tracker
   * state. When the tracker cannot be asked the rows still come back with
   * `state: 'unknown'`, so the list never disappears with the tracker.
   *
   * @throws 'unauthorized' — signed out, or not an internal reporter;
   *   'unknown' — the ledger could not be read.
   */
  listMine(): Promise<BugReportSummary[]>;

  /**
   * Moves one of the caller's own tickets to Done, once they have checked the
   * fix on the device where they saw the bug (the one state change the
   * workflow reserves for a human). Returns the ticket as the tracker now
   * reports it.
   *
   * @throws 'unauthorized' — signed out, or not an internal reporter;
   *   'not_found' — not one of the caller's tickets; 'validation' — not a
   *   ticket identifier; 'unknown' — the tracker refused or is unconfigured.
   */
  markVerified(ticketId: string): Promise<BugReportSummary>;
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
  comments: CommentsApi;
  leaderboard: LeaderboardApi;
  recs: RecsApi;
  venues: VenuesApi;
  meta: MetaApi;
  bugs: BugsApi;
}
