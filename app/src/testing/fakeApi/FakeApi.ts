// FakeApi: an in-memory `BeviApi` that behaves like the real server, for the app's jest suites.
// TEST-ONLY: jest.setup.js swaps `@/api/client` for it; no production file imports src/testing/**.
// It runs @bevi/ranking for real (placement validity, respacing, stats,
// the Bayesian leaderboard, MIN_N_USER gating), so the UI sees the same scores and errors
// (`conflict`, `validation`, `age_restricted`…) it will see in production. It does no ranking
// maths of its own: predictions (`predictScore`), recommendations (`recommend`), streaks
// (`computeStreak` over `localDayKey`) and the user board (`rankPoints`, `rankUsers`) are all calls
// into @bevi/ranking over a `PredictionSnapshot` built from the fake's tables; this file only maps
// data. Starter selection is the app's job (`selectStarterSet`, per the contract), so
// `getStarterCandidates` only returns the candidates.
//
// Fixture people, passwords and the invite code are in ./people.ts.

import {
  BAYES_C,
  BUCKET_ORDER,
  MIN_N_USER,
  RANKING_VERSION,
  RECOMMEND_N,
  bayesianAverage,
  categoryAffinity,
  categoryPrior,
  computeStreak,
  effectiveUserStats,
  flavorTokens,
  globalPrior,
  insertIntoBucket,
  isLeaderboardEligible,
  leaderboardOrder,
  localDayKey,
  normaliseBrand,
  populationStats,
  compareCodePoints,
  predictScore,
  rankPoints,
  rankUsers,
  recommend,
  respaceBucket,
  userStats,
  zScore,
  type BevFeatures,
  type PredictionSnapshot,
  type Stats,
  type StreakResult,
  type UserSnapshot,
} from '@bevi/ranking';
import {
  ApiError,
  NYC_BOUNDS,
  hoursKnown,
  openAt,
  HANDLE_PATTERN,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  RESERVED_HANDLES,
  type ApiErrorCode,
  type AppConfig,
  type AuthApi,
  type Bev,
  type BeviApi,
  type BevdAtVenue,
  type BevdHere,
  type BevdPin,
  type BevdScope,
  type BevLocationSummary,
  type BlockedUser,
  type BlocksApi,
  type BevOfPeriod,
  type BevPrediction,
  type BevsApi,
  type BevIcon,
  type BevLeaf,
  type BugReportResult,
  type BugReportSummary,
  type BugsApi,
  type BevSimilarity,
  type BevSummary,
  type Bucket,
  type BucketBev,
  type CategoriesApi,
  type CategoryId,
  type CategoryProgress,
  type CheckHandleResult,
  type Comment,
  type CommentsApi,
  type Comparison,
  type ExplorePost,
  type FeedApi,
  type FeedItem,
  type FollowsApi,
  type FriendScore,
  type IconStatus,
  type LeaderboardApi,
  type MediaApi,
  type MetaApi,
  type Notification,
  type NotificationKind,
  type NotificationSettings,
  type NotificationsApi,
  type Page,
  type PageParams,
  type PeriodWinner,
  type PostNotificationPerson,
  type PriceTier,
  type Profile,
  type ProfileApi,
  type ProfileRow,
  type ProfileStats,
  type RankedBev,
  type Ranking,
  type RankingsApi,
  type Recommendation,
  type RecsApi,
  type ReportContentInput,
  type ReportContentKind,
  type ReportContentResult,
  type ReportReason,
  type ReportsApi,
  type Session,
  type SignInInput,
  type SignUpInput,
  type StatsApi,
  type SuggestedProfile,
  type TasteProfileRow,
  type SubmitRankingInput,
  type SubmitRankingResult,
  type UpdateMeInput,
  type ExternalPlace,
  type LatLng,
  type Venue,
  type VenueMatch,
  type VenuePin,
  type VenuesApi,
  type WantToTryApi,
} from '@bevi/shared';

import {
  clearDb,
  clone,
  loadDb,
  saveDb,
  type FakeAsset,
  type FakeBev,
  type FakeComment,
  type FakeDb,
  type FakeFeedEvent,
  type FakeRanking,
  type FakeUser,
  type FakeBevLocation,
  type FakeVenue,
  type StorageLike,
} from './db';
import { CATALOG_CATEGORY_NODES, type CatalogCategoryNode } from './catalog';
import { ALCOHOLIC, CATEGORIES, buildFixtures, isAdult } from './fixtures';
import { buildEdgeMirror, type EdgeMirror } from './graph';
import { FAKE_INVITE_CODE, FRIEND, ME } from './people';

/**
 * Code-point string order, the tie-break every id order in the SQL uses
 * (`collate "C"`; M-22, `compareCodePoints` in @bevi/ranking). Every id these
 * comparisons see is a uuid or a snake_case slug, so plain `<` on ASCII agrees
 * with it -- this exists so the fake's ordering reads as the same rule rather
 * than as an accident of the data.
 */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Password rule: at least this many characters (`validation`, field 'password'). */
export const FAKE_MIN_PASSWORD_LENGTH = 8;
export const NOTE_MAX = 140;
const NAME_MAX = 80;
const DISPLAY_NAME_MAX = 50;
const REPORT_REASON_MAX = 500;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Narrower than UPLOAD_MIME_TYPES, matching the `bug-evidence` bucket (packages/api/src/bugs.ts). */
const BUG_EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BUG_KINDS: readonly string[] = ['bug', 'fix', 'idea', 'design'];
const BUG_SEVERITIES: readonly string[] = ['blocker', 'bad', 'annoying', 'polish'];
/** The priority a new fake ticket starts with, from the severity: the fake's own choice, so suites can tell severities apart. */
const BUG_PRIORITY: Record<BugReportSummary['severity'], number> = { blocker: 1, bad: 2, annoying: 3, polish: 4 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUG_TICKET_RE = /^[A-Z][A-Z0-9]*-\d{1,9}$/;
/** The states a ticket is ranked in (supabase/functions/bug-report/rank.ts `OPEN_STATES`). */
const BUG_OPEN_STATES: readonly BugReportSummary['state'][] = ['triage', 'todo', 'in_progress'];
const BUG_STATE_LABELS: Record<BugReportSummary['state'], string | null> = {
  triage: 'New',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  canceled: 'Canceled',
  unknown: null,
};

/**
 * The priority a rank implies, as the function computes it (rank.ts `priorityForRank`): the top
 * quarter High (2), the middle half Medium (3), the rest Low (4), measured at the middle of the
 * slot; an Urgent (1) ticket stays Urgent.
 */
function bugPriorityForRank(index: number, count: number, current: number | null): number {
  if (current === 1) return 1;
  const f = (index + 0.5) / Math.max(count, 1);
  if (f <= 0.25) return 2;
  if (f <= 0.75) return 3;
  return 4;
}

/** Default time the fake's "background removal" takes before a bev photo is 'ready'. */
const PHOTO_PROCESSING_MS = 3000;
/** How long the fake icon pipeline "takes" once an eligible Bev is created. */
const ICON_GENERATION_MS = 4000;

/** Writes that only change the session; they leave seeded fixtures "clean" (see FakeDb.dirty). */
const SESSION_ONLY_METHODS = new Set(['signIn', 'signOut']);
/**
 * The fake's `app_config` row until `controls.setAppConfig` edits it: no maintenance, and floors
 * the app is not below. `minAppVersion` is what the fake has always answered (the app's own
 * version); `minContractVersion` and the message are the server's seed (IA-2: '0.0.0', none).
 */
const DEFAULT_APP_CONFIG: AppConfig = {
  minAppVersion: '0.1.0',
  minContractVersion: '0.0.0',
  maintenance: false,
  maintenanceMessage: null,
};
/** `app_config`'s CHECKs on the two floors, and on the message's length. */
const APP_CONFIG_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const MAINTENANCE_MESSAGE_MAX = 280;

export type Latency = number | readonly [min: number, max: number];

export interface FakeApiOptions {
  /** Persistence (a Web Storage-like object). Default: none, memory only. */
  storage?: StorageLike | null;
  /** Per-call latency in ms (uniform in [min, max]). Default [200, 600]. */
  latency?: Latency;
  /** Clock, for tests. */
  now?: () => Date;
  /** How long an uploaded bev photo stays 'processing'. Default 3000 ms. */
  photoProcessingMs?: number;
  /** How long a generated icon takes to appear. Default 4000; 0 makes it immediate. */
  iconGenerationMs?: number;
}

function fail(code: ApiErrorCode, message: string, detail?: unknown): never {
  throw new ApiError(code, message, detail);
}

function invalid(field: string, message: string, reason?: string): never {
  return fail('validation', message, reason ? { field, reason } : { field });
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Mirrors `public.venue_pin_cap`: 60 pins at zoom 11 up to 300 at zoom 15, flat outside. A
 * fractional zoom is floored (packages/api floors it before the integer RPC parameter), and a
 * non-finite one is 11, which is what the RPC makes of the null packages/api sends for it.
 */
const venuePinCap = (zoom: number): number => {
  const z = Number.isFinite(zoom) ? Math.floor(zoom) : 11;
  return 60 + (Math.min(Math.max(z, 11), 15) - 11) * 60;
};

/** Metres between two positions: the haversine formula `private.distance_m` uses (20261119193000). */
const distanceMeters = (a: LatLng, b: LatLng): number => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** `lower(unaccent(...))` with runs of whitespace collapsed, as `venues_search` normalises both sides. */
const foldPlace = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** pg_trgm's `similarity`: shared trigrams over all trigrams, each word padded with two spaces before and one after. */
const trigramSimilarity = (a: string, b: string): number => {
  const grams = (text: string): Set<string> => {
    const out = new Set<string>();
    for (const word of text.split(/[^a-z0-9]+/).filter(Boolean)) {
      const padded = `  ${word} `;
      for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
    }
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared += 1;
  return shared / (x.size + y.size - shared);
};

/** `venues_search`'s third tier: a name at least this similar to the query (20261119193000). */
const PLACE_SIMILARITY_MIN = 0.35;

const BEVD_SCOPES: readonly BevdScope[] = ['mine', 'friends', 'all'];

/** An empty filter array is no filter (contract 2.10.0), as in `venues_in_view` and packages/api. */
const activeFilter = <T>(values: readonly T[] | undefined): readonly T[] | null =>
  values !== undefined && values.length > 0 ? values : null;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
// Whitespace only, punctuation kept inside a token: "a&w" is one token, "barq's" is one. Splitting on
// [^a-z0-9]+ (as this did until 20261102000200) made "a&w" the tokens "a" and "w", substrings of
// almost every name. search_bevs/find_similar_bevs split the same way (20261102000200); the SQL side
// also unaccents, which `norm` does not.
const tokens = (s: string) => norm(s).split(' ').filter(Boolean);

function paginate<T>(items: readonly T[], page: PageParams | undefined, defaultLimit: number): Page<T> {
  const limit = clamp(Math.floor(page?.limit ?? defaultLimit), 1, 100);
  let start = 0;
  if (page?.cursor) {
    const m = /^o:(\d+)$/.exec(page.cursor);
    if (!m) invalid('cursor', 'Malformed cursor');
    start = Number(m[1]);
  }
  const end = start + limit;
  return { items: items.slice(start, end), nextCursor: end < items.length ? `o:${end}` : null };
}

/** `comments.add` refuses longer bodies (contract); `get_feed` carries this many comments per post. */
const COMMENT_MAX = 280;
const FEED_INLINE_COMMENTS = 7;
/** Contract 2.12.0: how many people `FeedItem.alsoBevdBy` and `SuggestedProfile.followedBy` list (20261111000100). */
const ALSO_BEVD_MAX = 3;
const FOLLOWED_BY_MAX = 2;
/** T-31: how many actors a notification row lists (get_notifications), and its page cap. */
const NOTIFICATION_ACTORS_MAX = 2;
const NOTIFICATIONS_PAGE_MAX = 50;
/** `get_notifications` / `mark_notifications_read` take a bigint id; packages/api refuses anything else. */
const NOTIFICATION_ID_RE = /^\d{1,15}$/;

/**
 * T-31: one row of the fake's `notifications` ledger, as the triggers write it (20261126000100).
 * Ids are the ledger's own sequence, so they order rows the way the identity column does.
 */
interface FakeNotification {
  id: number;
  recipientId: string;
  actorId: string;
  kind: NotificationKind;
  feedEventId: string | null;
  commentId: string | null;
  createdAt: string;
  readAt: string | null;
  /**
   * Set on the rows `seedNotifications` deals ME, which record things that happened before the
   * fixtures begin: the follow, like or comment behind them is not in the fixture data (seeding
   * those would move follower, like and comment counts other suites assert), so the "is it still
   * there" rule is skipped for them. Blocks, the age gate and the post's own existence still apply.
   */
  fixture?: { commentBody?: string };
}

/** One displayed row: a follow or a comment alone, or every like on one post. Newest member first. */
interface FakeNotificationGroup {
  head: FakeNotification;
  members: FakeNotification[];
}

/** T-31 Release 2: `notification_settings`' defaults, what someone who never saved any gets. */
const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { paused: false, follows: true, likes: true, comments: true, posts: false };
const NOTIFICATION_SETTING_FIELDS = ['paused', 'follows', 'likes', 'comments', 'posts'] as const;
/** `push_tokens`' check, and its per-user cap (register_push_token keeps the 10 most recently seen). */
const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[!-~]{1,180}\]$/;
const PUSH_TOKEN_MAX = 200;
const PUSH_TOKENS_PER_USER = 10;
/** get_post_notification_people refuses a longer `q`. */
const POST_PEOPLE_QUERY_MAX = 80;

/** T-31 Release 2: one `push_outbox` row, as the two queue triggers write it (20261127000100). */
interface FakePush {
  kind: NotificationKind | 'post';
  recipientId: string;
  actorId: string;
  feedEventId: string | null;
  commentId: string | null;
}

/** What `controls.pendingPushes` answers: one push claim_push_batch would send now. */
export interface FakePendingPush {
  kind: NotificationKind | 'post';
  actorHandle: string;
  /** The post it is about; null for a follow. */
  postId: string | null;
}
/** Bev of the day / week is "strictly New York City" (get_bev_of_period, 20261018000100). */
const BEV_OF_PERIOD_ZONE = 'America/New_York';
/** D-01: below this many users Explore widens from two hops to everyone (get_explore, 20261019000300). */
const EXPLORE_GLOBAL_FALLBACK_USERS = 20;
/**
 * Explore's order: hot = (likes + 1) / (ageHours + 2)^1.5, docs/bevi-ranking-math.tex §10.4.
 * The server's one copy of the two constants is `explore_hotness()` in 20261019000300; this is the
 * fake's, kept here next to it rather than spread through the method. @bevi/ranking has no hotness
 * helper to import (nothing in the app computes it: the ordering is the server's).
 */
const exploreHotness = (likes: number, ageHours: number) => (likes + 1) / Math.pow(Math.max(ageHours, 0) + 2, 1.5);
/** get_bev_similarities' guard on how many ids one call may ask about (20261019000500). */
const SIMILARITIES_MAX_IDS = 500;
/** get_similar_bevs' default and its server-side clamp. */
const SIMILAR_DEFAULT_N = 10;
const SIMILAR_MAX_N = 50;
/** The ISO week's Monday for a `YYYY-MM-DD` day key. */
function isoWeekStart(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const codePointOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const commentSeq = (c: FakeComment) => Number(c.id.split('-')[1]);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Aggregates {
  global: Stats;
  byBev: Map<string, number[]>;
  byCategory: Map<CategoryId, number[]>;
  /** Built lazily by `snapshot()`; dropped with the aggregates on every write. */
  snapshot?: PredictionSnapshot;
}

/** One user's streak, as @bevi/ranking's computeStreak sees it, plus whether today counts. */
interface UserStreak extends StreakResult {
  aliveToday: boolean;
}

export class FakeApi implements BeviApi {
  nutrition: NonNullable<BeviApi['nutrition']> = { lookupBarcode: async () => null, lookupProduct: async () => null };
  private db: FakeDb;
  private readonly storage: StorageLike | null;
  private readonly clock: () => Date;
  private readonly photoProcessingMs: number;
  private readonly iconGenerationMs: number;
  private latency: readonly [number, number];
  private readonly listeners = new Set<(session: Session | null) => void>();
  private failures: { code: ApiErrorCode; method?: string }[] = [];
  private agg: Aggregates | null = null;
  /** ./graph.ts's mirror, keyed on the Bev table it was built from (see `edges()`). */
  private edgeCache: { source: FakeBev[]; size: number; mirror: EdgeMirror } | null = null;
  /**
   * Whether the signed-in user is an internal reporter (`profiles.role` in ('admin','tester')).
   * Off by default, so a suite that doesn't opt in sees what an ordinary account sees. Not
   * persisted: it is a property of the account on the server, not of the fake's data.
   */
  private internalReporter = false;
  /**
   * Whether that reporter may also rank their tickets (`can_rank_bugs()`: an admin, a founder).
   * `setInternalReporter(true)` makes a founder (both true); `setTesterReporter()` a tester, who
   * reports but does not rank. Never true without `internalReporter`.
   */
  private bugRanker = false;
  /** The fake's `bug_reports` ledger, keyed by idempotency key per user, with the summary My reports shows. */
  private bugLedger = new Map<string, { userId: string; result: BugReportResult; summary: BugReportSummary }>();
  /**
   * Each user's manual order of their tickets, top first: the fake's stand-in for the board's
   * shared order. A new ticket goes to the top. Ranks count only the open ones (BUG_OPEN_STATES).
   */
  private bugOrder = new Map<string, string[]>();
  private nextTicket = 100;
  /**
   * IS-7: `user_blocks` and `content_reports`. Kept beside the bug ledger rather than in FakeDb,
   * so they are in memory only (a reload of a persisted dev db starts with none) and FakeDb's
   * schema does not move. `resetToFixtures` and account deletion clear them.
   */
  private blockRows: { blockerId: string; blockedId: string; createdAt: string }[] = [];
  private contentReports: {
    id: string;
    reporterId: string;
    kind: ReportContentKind;
    targetId: string;
    reportedUserId: string;
    reason: ReportReason;
    note: string | null;
    createdAt: string;
  }[] = [];
  private nextContentReport = 1;
  /**
   * T-31: the `notifications` ledger. In memory beside the block rows, for the same reason (FakeDb's
   * schema does not move); `resetToFixtures` re-deals ME's fixture rows, account deletion and
   * `emptyUser` drop the rows the user is on either side of, and `clearNotifications` empties it.
   */
  private notificationRows: FakeNotification[] = [];
  private nextNotification = 1;
  /**
   * T-31 Release 2: `notification_settings`, `post_notification_subscriptions`, `push_tokens` and
   * `push_outbox`, in memory beside the inbox for the same reason. Cleared by `resetToFixtures`;
   * account deletion and `emptyUser` drop the user's rows. The fake sends nothing: the queue is
   * judged on demand by `pendingPushes`, with claim_push_batch's rules.
   */
  private notificationSettingsRows = new Map<string, NotificationSettings>();
  private postSubscriptions: { subscriberId: string; targetId: string }[] = [];
  private pushTokenRows: { token: string; userId: string; seen: number }[] = [];
  private pushOutbox: FakePush[] = [];
  private pushSeq = 0;
  /**
   * IA-2: the single `app_config` row `meta.getAppConfig` answers with. Not in FakeDb and not
   * persisted: it is the backend's, written by an operator, not part of anyone's data. Suites set
   * it with `controls.setAppConfig`; `resetToFixtures` puts the default back.
   */
  private appConfig: AppConfig = { ...DEFAULT_APP_CONFIG };

  constructor(options: FakeApiOptions = {}) {
    this.storage = options.storage ?? null;
    this.clock = options.now ?? (() => new Date());
    this.photoProcessingMs = options.photoProcessingMs ?? PHOTO_PROCESSING_MS;
    this.iconGenerationMs = options.iconGenerationMs ?? ICON_GENERATION_MS;
    this.latency = FakeApi.toRange(options.latency ?? [200, 600]);
    const stored = loadDb(this.storage);
    if (stored && stored.dirty !== false) {
      this.db = stored;
    } else {
      // Untouched fixtures are rebuilt for today (timestamps are relative to now), keeping the session.
      this.db = buildFixtures(this.clock());
      const session = stored?.sessionUserId;
      if (session && this.db.users.some((u) => u.id === session)) this.db.sessionUserId = session;
    }
    this.seedNotifications();
    saveDb(this.storage, this.db);
  }

  // -------------------------------------------------------------------------
  // Test controls (not part of BeviApi; exposed through ./controls.ts)
  // -------------------------------------------------------------------------

  /** The next call (to `method`, e.g. 'rankings.submitRanking', or to any method) rejects with `code`. */
  failNext(code: ApiErrorCode, method?: string): void {
    this.failures.push({ code, method });
  }

  setLatency(latency: Latency): void {
    this.latency = FakeApi.toRange(latency);
  }

  /** Back to the seeded fixtures, signed out. */
  resetToFixtures(): void {
    clearDb(this.storage);
    this.db = buildFixtures(this.clock());
    this.failures = [];
    this.internalReporter = false;
    this.bugRanker = false;
    this.bugLedger.clear();
    this.bugOrder.clear();
    this.nextTicket = 100;
    this.blockRows = [];
    this.contentReports = [];
    this.nextContentReport = 1;
    this.seedNotifications();
    this.clearPushState();
    this.appConfig = { ...DEFAULT_APP_CONFIG };
    this.commit();
    this.emit();
  }

  /** T-31: an empty inbox for everyone (the fixture rows included) until `resetToFixtures()`. */
  clearNotifications(): void {
    this.notificationRows = [];
  }

  /** T-31 Release 2: no settings, subscriptions, devices or queued pushes for anyone. */
  private clearPushState(): void {
    this.notificationSettingsRows.clear();
    this.postSubscriptions = [];
    this.pushTokenRows = [];
    this.pushOutbox = [];
    this.pushSeq = 0;
  }

  /**
   * T-31 Release 2, a control: the pushes claim_push_batch would send `userId` now, oldest first.
   * The same rules: nothing while paused, nothing of a kind switched off, nothing across a block
   * either way, nothing about an alcoholic Bev under 21, and nothing that is no longer true (an
   * unliked like, a deleted comment, an unfollowed follow; a post push only while the subscription
   * and the follow stand). A post push is queued for a NEW ranking only, never a re-rank. Unlike
   * the server, a user with no registered device is not skipped, so a suite can assert the
   * settings without registering one (`pushTokens` lists the devices).
   */
  pendingPushes(userId: string): FakePendingPush[] {
    const me = this.db.users.find((u) => u.id === userId);
    if (!me) return [];
    const settings = this.notificationSettingsOf(userId);
    if (settings.paused) return [];
    const on = { follow: settings.follows, like: settings.likes, comment: settings.comments, post: settings.posts };
    const visible = this.visibleNotifications(me);
    return this.pushOutbox
      .filter((p) => p.recipientId === userId && on[p.kind] && !this.blockedBetween(userId, p.actorId))
      .filter((p) => {
        if (p.kind !== 'post') {
          return visible.some(
            (n) => n.kind === p.kind && n.actorId === p.actorId && n.feedEventId === p.feedEventId && n.commentId === p.commentId,
          );
        }
        const e = this.db.feed.find((x) => x.id === p.feedEventId);
        const bev = e && this.db.bevs.find((b) => b.id === e.bevId);
        return (
          !!e &&
          !!bev &&
          !!this.rankingOf(e.actorId, e.bevId) &&
          this.visible(bev, me) &&
          this.isFollowing(userId, p.actorId) &&
          this.postSubscriptions.some((s) => s.subscriberId === userId && s.targetId === p.actorId)
        );
      })
      .flatMap((p) => {
        const actor = this.db.users.find((u) => u.id === p.actorId);
        return actor ? [{ kind: p.kind, actorHandle: actor.handle, postId: p.feedEventId }] : [];
      });
  }

  /** T-31 Release 2, a control: the push tokens registered to `userId`, most recently seen first. */
  pushTokens(userId: string): string[] {
    return this.pushTokenRows
      .filter((t) => t.userId === userId)
      .sort((a, z) => z.seen - a.seen)
      .map((t) => t.token);
  }

  private notificationSettingsOf(userId: string): NotificationSettings {
    return { ...(this.notificationSettingsRows.get(userId) ?? DEFAULT_NOTIFICATION_SETTINGS) };
  }

  /** drop_post_notification_on_unfollow: a follow that goes takes its post subscription with it. */
  private dropPostSubscription(followerId: string, followeeId: string): void {
    this.postSubscriptions = this.postSubscriptions.filter((s) => !(s.subscriberId === followerId && s.targetId === followeeId));
  }

  /**
   * ME's fixture inbox, so a FakeApi-backed build opens on something to show. Dealt from ME's own
   * posts and relative to now, so it is the same rows for the same clock:
   *
   *   1  follow   friend_d                       read, over a week ago (ME follows them back)
   *   2  like     friend_d on an older post      read, over a week ago
   *   3  comment  friend_b on that older post    read, over a week ago
   *   4  follow   friend_e                       unread (ME does NOT follow them back)
   *   5  comment  friend_a on ME's second-newest post   unread
   *   6  like     friend_b on ME's newest post           unread
   *   7  like     friend_a on ME's newest post           unread
   *
   * Listed, 6 and 7 are one row ("friend_a and friend_b"), so ME's badge is 3. Rows 1-3 need a post
   * of ME's over eight days old, and 5-7 two posts; a database without them gets what it can.
   */
  private seedNotifications(): void {
    this.notificationRows = [];
    this.nextNotification = 1;
    const byHandle = (handle: string) => this.db.users.find((u) => u.handle === handle);
    const me = byHandle(ME.handle);
    const [a, b, d, e] = [byHandle(FRIEND.handle), byHandle('friend_b'), byHandle('friend_d'), byHandle('friend_e')];
    if (!me || !a || !b || !d || !e) return;

    const MINUTE = 60_000;
    const DAY = 24 * 60 * MINUTE;
    const now = this.now().getTime();
    const at = (ms: number) => new Date(ms).toISOString();
    const posts = this.db.feed
      .filter((ev) => ev.actorId === me.id && ev.type === 'RANKING' && !!this.rankingOf(me.id, ev.bevId))
      .sort((x, z) => z.createdAt.localeCompare(x.createdAt));
    const add = (row: Omit<FakeNotification, 'id' | 'recipientId'>) =>
      this.notificationRows.push({ id: this.nextNotification++, recipientId: me.id, ...row });

    const older = posts.find((p) => Date.parse(p.createdAt) < now - 8 * DAY);
    if (older) {
      const t0 = Date.parse(older.createdAt);
      const read = (ms: number) => ({ createdAt: at(ms), readAt: at(ms + DAY) });
      add({ actorId: d.id, kind: 'follow', feedEventId: null, commentId: null, ...read(t0 + 30 * MINUTE), fixture: {} });
      add({ actorId: d.id, kind: 'like', feedEventId: older.id, commentId: null, ...read(t0 + 60 * MINUTE), fixture: {} });
      add({
        actorId: b.id,
        kind: 'comment',
        feedEventId: older.id,
        commentId: 'fixture-comment-1',
        ...read(t0 + 120 * MINUTE),
        fixture: { commentBody: 'Still thinking about this one' },
      });
    }
    add({ actorId: e.id, kind: 'follow', feedEventId: null, commentId: null, createdAt: at(now - 10 * MINUTE), readAt: null, fixture: {} });
    const [newest, second] = posts;
    if (newest && second) {
      add({
        actorId: a.id,
        kind: 'comment',
        feedEventId: second.id,
        commentId: 'fixture-comment-2',
        createdAt: at(now - 6 * MINUTE),
        readAt: null,
        fixture: { commentBody: 'Need to try this' },
      });
      add({ actorId: b.id, kind: 'like', feedEventId: newest.id, commentId: null, createdAt: at(now - 4 * MINUTE), readAt: null, fixture: {} });
      add({ actorId: a.id, kind: 'like', feedEventId: newest.id, commentId: null, createdAt: at(now - 2 * MINUTE), readAt: null, fixture: {} });
    }
  }

  /**
   * First-run state for the signed-in user: no rankings, follows, Want to Try or activity, and back
   * to onboarding (no birthdate, `onboarded: false`).
   */
  emptyUser(): void {
    const me = this.sessionUser();
    if (!me) throw new Error('emptyUser: sign in first');
    this.wipeUserData(me.id);
    me.onboarded = false;
    me.birthdate = null;
    this.db.dirty = true;
    this.commit();
  }

  /**
   * Edit the fake's `app_config` row, as an operator would the real one: the fields given replace
   * the current ones, the rest stay. Refuses what the table's CHECKs refuse, so a suite cannot
   * render a config the server could never send.
   */
  setAppConfig(config: Partial<AppConfig>): void {
    const next = { ...this.appConfig, ...config };
    for (const key of ['minAppVersion', 'minContractVersion'] as const) {
      if (!APP_CONFIG_VERSION_RE.test(next[key])) throw new Error(`setAppConfig: ${key} must be x.y.z, got '${next[key]}'`);
    }
    const message = next.maintenanceMessage;
    if (message !== null && (message.length < 1 || message.length > MAINTENANCE_MESSAGE_MAX)) {
      throw new Error(`setAppConfig: maintenanceMessage must be null or 1 to ${MAINTENANCE_MESSAGE_MAX} characters`);
    }
    this.appConfig = next;
  }

  /** Make (or stop making) the signed-in user an internal bug reporter who is a founder: they report and rank. */
  setInternalReporter(internal: boolean): void {
    this.internalReporter = internal;
    this.bugRanker = internal;
  }

  /** Make the signed-in user a tester: an internal reporter who may not rank (`profiles.role` 'tester'). */
  setTesterReporter(): void {
    this.internalReporter = true;
    this.bugRanker = false;
  }

  /**
   * Move one of the fake's tickets to a workflow state, as a founder or an agent would on the board
   * (e.g. 'in_review', so My reports offers Verified on device; or 'done', so it leaves the ranks).
   */
  setBugTicketState(ticketId: string, state: BugReportSummary['state']): void {
    const entry = [...this.bugLedger.values()].find((e) => e.summary.ticketId === ticketId);
    if (!entry) throw new Error(`setBugTicketState: no ticket ${ticketId}`);
    entry.summary = { ...entry.summary, state, stateLabel: BUG_STATE_LABELS[state], updatedAt: this.now().toISOString() };
  }

  /**
   * The user's tickets with their ranks, newest first (what `bugs.listMine` answers). For a
   * reporter who may not rank (a tester) every rank is null, as the status route answers.
   */
  private bugSummaries(userId: string): BugReportSummary[] {
    const ranks = new Map(this.bugRanker ? this.openBugOrder(userId).map((id, i) => [id, i + 1]) : []);
    return [...this.bugLedger.values()]
      .filter((entry) => entry.userId === userId)
      .map((entry) => ({ ...entry.summary, rank: ranks.get(entry.summary.ticketId) ?? null }))
      .reverse();
  }

  /** The user's open tickets in their manual order, top first. */
  private openBugOrder(userId: string): string[] {
    const open = new Set(
      [...this.bugLedger.values()]
        .filter((e) => e.userId === userId && BUG_OPEN_STATES.includes(e.summary.state))
        .map((e) => e.summary.ticketId),
    );
    return (this.bugOrder.get(userId) ?? []).filter((id) => open.has(id));
  }

  /** Sign in as any fixture user without a password. */
  signInAs(handle: string): void {
    const user = this.db.users.find((u) => u.handle === handle);
    if (!user) throw new Error(`signInAs: no fixture user @${handle}`);
    this.db.sessionUserId = user.id;
    this.commit();
    this.emit();
  }

  private static toRange(l: Latency): readonly [number, number] {
    const [min, max] = typeof l === 'number' ? [l, l] : l;
    return [Math.max(0, min), Math.max(0, min, max)];
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private async call<T>(method: string, fn: () => T, write = false): Promise<T> {
    const [min, max] = this.latency;
    const ms = min + Math.random() * (max - min);
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    const i = this.failures.findIndex((f) => !f.method || f.method === method);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      fail(f!.code, `Fake failure on ${method} (failNext)`);
    }
    const result = fn();
    if (write) {
      if (!SESSION_ONLY_METHODS.has(method)) this.db.dirty = true;
      this.commit();
    }
    return clone(result);
  }

  private commit(): void {
    this.agg = null;
    saveDb(this.storage, this.db);
  }

  private emit(): void {
    const session = this.currentSession();
    for (const cb of [...this.listeners]) {
      try {
        cb(clone(session));
      } catch {
        // A listener's error must not break the mutation that triggered it.
      }
    }
  }

  private now(): Date {
    return this.clock();
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private nextId(prefix: string): string {
    this.db.seq += 1;
    return `${prefix}-${this.db.seq}`;
  }

  private sessionUser(): FakeUser | null {
    const id = this.db.sessionUserId;
    return id ? (this.db.users.find((u) => u.id === id) ?? null) : null;
  }

  private currentSession(): Session | null {
    const u = this.sessionUser();
    return u ? { userId: u.id, handle: u.handle } : null;
  }

  private requireUser(): FakeUser {
    return this.sessionUser() ?? fail('unauthorized', 'Not signed in');
  }

  private user(id: string): FakeUser {
    return this.db.users.find((u) => u.id === id) ?? fail('not_found', 'No such user');
  }

  /**
   * private.is_blocked: a block between these two people in EITHER direction. The one rule for
   * "hidden by a block"; never exposed, since it would tell a blocked person who blocked them.
   */
  private blockedBetween(a: string, b: string): boolean {
    return this.blockRows.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
  }

  /** `user(id)`, but 'not_found' across a block too, as every read of a named person now says. */
  private visibleUser(id: string, viewer: FakeUser): FakeUser {
    const u = this.user(id);
    return this.blockedBetween(viewer.id, u.id) ? fail('not_found', 'No such user') : u;
  }

  private venueRows(): FakeVenue[] {
    return this.db.venues ?? [];
  }

  /** The Bevs a venue carries that this viewer may see (the age gate). */
  private venueAssortment(venueId: string, viewer: FakeUser): FakeBev[] {
    return (this.db.venueBevs ?? [])
      .filter((vb) => vb.venueId === venueId)
      .flatMap((vb) => {
        const b = this.db.bevs.find((x) => x.id === vb.bevId);
        return b && this.visible(b, viewer) ? [b] : [];
      });
  }

  private toVenue(v: FakeVenue): Venue {
    return {
      id: v.id,
      name: v.name,
      kind: v.kind,
      placeType: v.placeType ?? 'other',
      lat: v.lat,
      lng: v.lng,
      address: v.address,
      neighborhood: v.neighborhood,
      borough: v.borough,
      hoursOsm: v.hoursOsm,
      // What the evaluator understood, not just the column, as the RPCs report
      // it: so `hoursKnown` is true exactly when `openNow` is not null.
      hoursKnown: v.hoursKnown && hoursKnown(v.hoursOsm),
      website: v.website,
    };
  }

  private locationRows(): FakeBevLocation[] {
    return (this.db.bevLocations ??= []);
  }

  /** An active venue by id, or not_found: a hidden venue and an unknown one are the same answer. */
  private activeVenue(venueId: string): FakeVenue {
    return this.venueRows().find((v) => v.id === venueId && !v.hidden) ?? fail('not_found', 'No such venue');
  }

  /** Where `userId` had `bevId`, or null: nobody said, or the venue has since been hidden. */
  private venueOf(userId: string, bevId: string): Venue | null {
    const row = this.locationRows().find((l) => l.userId === userId && l.bevId === bevId);
    const venue = row ? this.venueRows().find((v) => v.id === row.venueId && !v.hidden) : undefined;
    return venue ? this.toVenue(venue) : null;
  }

  /** `private.put_bev_location`: set, replace or (null) clear. The caller has checked the ranking exists. */
  private putLocation(userId: string, bevId: string, venueId: string | null): Venue | null {
    const venue = venueId === null ? null : this.activeVenue(venueId);
    this.db.bevLocations = this.locationRows().filter((l) => !(l.userId === userId && l.bevId === bevId));
    if (!venue) return null;
    this.db.bevLocations.push({ userId, bevId, venueId: venue.id });
    return this.toVenue(venue);
  }

  /**
   * `private.visible_bev_locations`, narrowed to a scope: the rankings with a place that `me` may
   * see, by `me` ('mine'), by the people `me` follows ('friends'), or both.
   */
  private scopedLocations(me: FakeUser, scope: BevdScope): { ranking: FakeRanking; venue: FakeVenue }[] {
    return this.locationRows().flatMap((l) => {
      const mine = l.userId === me.id;
      const inScope = mine ? scope !== 'friends' : scope !== 'mine' && this.isFollowing(me.id, l.userId);
      if (!inScope) return [];
      const ranking = this.rankingOf(l.userId, l.bevId);
      const venue = this.venueRows().find((v) => v.id === l.venueId && !v.hidden);
      const bev = this.db.bevs.find((b) => b.id === l.bevId);
      return ranking && venue && bev && this.visible(bev, me) ? [{ ranking, venue }] : [];
    });
  }

  private bev(id: string): FakeBev {
    return this.db.bevs.find((b) => b.id === id) ?? fail('not_found', 'No such Bev');
  }

  private canSeeAlcohol(u: FakeUser): boolean {
    return isAdult(u.birthdate, this.now());
  }

  private visible(b: FakeBev, viewer: FakeUser): boolean {
    return !ALCOHOLIC.has(b.categoryId) || this.canSeeAlcohol(viewer);
  }

  private requireVisible(b: FakeBev, viewer: FakeUser): void {
    if (!this.visible(b, viewer)) fail('age_restricted', 'Not available');
  }

  private aggregates(): Aggregates {
    if (this.agg) return this.agg;
    const byBev = new Map<string, number[]>();
    const byCategory = new Map<CategoryId, number[]>();
    const byUser = new Map<string, number[]>();
    const catOf = new Map(this.db.bevs.map((b) => [b.id, b.categoryId]));
    const push = <K>(m: Map<K, number[]>, k: K, v: number) => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const r of this.db.rankings) {
      push(byBev, r.bevId, r.score);
      push(byUser, r.userId, r.score);
      const cat = catOf.get(r.bevId);
      if (cat) push(byCategory, cat, r.score);
    }
    const global = populationStats(this.db.rankings.map((r) => r.score));
    this.agg = { global, byBev, byCategory };
    return this.agg;
  }

  /**
   * The fake's tables as a @bevi/ranking `PredictionSnapshot` (§9): every Bev's features, every
   * user's stats (via `userStats`), the global stats and the whole rankings table. Pure data
   * mapping; z-scores and everything else are computed inside @bevi/ranking.
   */
  private snapshot(): PredictionSnapshot {
    const agg = this.aggregates();
    if (agg.snapshot) return agg.snapshot;
    const catOf = new Map(this.db.bevs.map((b) => [b.id, b.categoryId]));
    const bevs: Record<string, BevFeatures> = {};
    for (const b of this.db.bevs) {
      const s = populationStats(agg.byBev.get(b.id) ?? []);
      bevs[b.id] = {
        id: b.id,
        categoryId: b.categoryId,
        brandKey: normaliseBrand(b.brand),
        flavorTokens: flavorTokens(b.name, b.flavor),
        priceTier: b.priceTier,
        ratingCount: s.n,
        mean: s.mean,
        stddev: s.stddev,
        isAlcoholic: ALCOHOLIC.has(b.categoryId),
      };
    }
    const users: Record<string, UserSnapshot> = {};
    for (const u of this.db.users) {
      const stats = userStats(
        this.db.rankings
          .filter((r) => r.userId === u.id && catOf.has(r.bevId))
          .map((r) => ({ bevId: r.bevId, categoryId: catOf.get(r.bevId)!, score: r.score })),
      );
      users[u.id] = { id: u.id, stats: stats.overall, categoryStats: stats.byCategory, canSeeAlcohol: this.canSeeAlcohol(u) };
    }
    const byCategoryMean: Record<string, number> = {};
    for (const [c, scores] of agg.byCategory) byCategoryMean[c] = populationStats(scores).mean;
    agg.snapshot = {
      version: RANKING_VERSION,
      generatedAt: this.nowIso(),
      global: { mean: agg.global.mean, stddev: agg.global.stddev, byCategoryMean },
      bevs,
      users,
      rankings: this.db.rankings.filter((r) => catOf.has(r.bevId)).map((r) => ({ userId: r.userId, bevId: r.bevId, score: r.score })),
    };
    return agg.snapshot;
  }

  /**
   * The fake's `bev_edges` mirror (./graph.ts), built with `edgeWeight`/`topEdges` from
   * @bevi/ranking over the catalog.
   *
   * Cached outside `this.agg`, which every write drops: the mirror depends only on the Bev rows
   * (category, brand, flavour tokens, price tier, flavour profile) and not on the rankings table,
   * exactly as the real `bev_edges` only changes when a Bev or a flavour profile does. So it is
   * rebuilt when a Bev is added or the fixtures are reset, and not when someone ranks something.
   */
  private edges(): EdgeMirror {
    if (this.edgeCache && this.edgeCache.source === this.db.bevs && this.edgeCache.size === this.db.bevs.length) {
      return this.edgeCache.mirror;
    }
    const mirror = buildEdgeMirror(this.db.bevs, ALCOHOLIC);
    this.edgeCache = { source: this.db.bevs, size: this.db.bevs.length, mirror };
    return mirror;
  }

  /**
   * @bevi/ranking's computeStreak over the local days (profile timezone, `localDayKey`) on which
   * the user ranked: each ranking's createdAt plus every RANKING feed event (written on submit and
   * re-rank, kept on removal) and every submission made before onboarding (which posts no feed
   * event), so re-ranks count and removals don't break a streak (§8.14).
   */
  private streakOf(u: FakeUser): UserStreak {
    const stamps = [
      ...this.db.rankings.filter((r) => r.userId === u.id).map((r) => r.createdAt),
      ...this.db.feed.filter((e) => e.actorId === u.id && e.type === 'RANKING').map((e) => e.createdAt),
      ...(this.db.unpostedRankings ?? []).filter((e) => e.userId === u.id).map((e) => e.createdAt),
    ];
    const keys = [...new Set(stamps.map((at) => localDayKey(at, u.timezone)))];
    const todayKey = localDayKey(this.nowIso(), u.timezone);
    const streak = computeStreak(keys, todayKey);
    return { ...streak, aliveToday: streak.lastKey === todayKey };
  }

  /** Bevs `u` added that at least one other user has ranked (§8.13 `bevsCreated`). */
  private bevsCreatedBy(u: FakeUser): number {
    const mine = new Set(this.db.bevs.filter((b) => b.createdById === u.id).map((b) => b.id));
    return new Set(this.db.rankings.filter((r) => r.userId !== u.id && mine.has(r.bevId)).map((r) => r.bevId)).size;
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toProfile(u: FakeUser, viewer: FakeUser | null): Profile {
    const self = viewer?.id === u.id;
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      timezone: u.timezone,
      createdAt: u.createdAt,
      birthdate: self ? u.birthdate : null,
      canSeeAlcohol: this.canSeeAlcohol(u),
      onboarded: u.onboarded,
    };
  }

  private isFollowing(followerId: string, followeeId: string): boolean {
    return this.db.follows.some((f) => f.followerId === followerId && f.followeeId === followeeId);
  }

  private toRow(u: FakeUser, viewer: FakeUser): ProfileRow {
    return { ...this.toProfile(u, viewer), isFollowing: u.id !== viewer.id && this.isFollowing(viewer.id, u.id) };
  }

  private assetUrlAndStatus(assetId: string | null): { url: string | null; status: 'processing' | 'ready' } {
    const a = assetId ? this.db.assets.find((x) => x.id === assetId) : undefined;
    if (!a) return { url: null, status: 'ready' };
    return { url: a.url, status: this.now().getTime() >= Date.parse(a.readyAt) ? 'ready' : 'processing' };
  }

  /**
   * A Bev's generated-icon state, derived the way `assetUrlAndStatus` derives a
   * photo's: from the clock, so no timer has to run.
   *
   * `iconReadyAt === null` is the load-bearing case -- the Bev was never
   * eligible, so the answer is 'none' and the caller stops polling. An
   * override set by `controls.setIconStatus` wins, which is how a suite renders
   * 'processing' or 'failed'.
   */
  private iconFor(b: FakeBev): { url: string | null; status: IconStatus } {
    const status: IconStatus =
      b.iconStatusOverride ??
      (b.iconReadyAt === null ? 'none' : this.now().getTime() >= Date.parse(b.iconReadyAt) ? 'completed' : 'pending');
    return { url: status === 'completed' ? `https://fake.bevi.test/bev-icons/${b.id}/icon-1024.png` : null, status };
  }

  /**
   * The authored catalogue icon `bev` may borrow, as `get_bev_icons` picks it:
   * the best match in its own category that is ACTUALLY PUBLISHED.
   *
   * Always null here, and that is the honest answer rather than a gap. The
   * real one joins `public.bev_icons`, which holds the published catalogue
   * art; this fake has no published icons at all -- `iconUrl` is null for
   * every Bev it serves, for the same reason. So there is nothing to borrow
   * and screens fall through to the category art, which is exactly what they
   * do against a database whose catalogue has not been published yet.
   *
   * To exercise the borrow path in a screen test, give the fake a few pretend
   * published icons and return one here; the ranking to copy is in the
   * migration's lateral join.
   */
  private fallbackIconUrlFor(_bev: FakeBev, _viewer: FakeUser): string | null {
    return null;
  }

  private bayes(bevId: string): number | null {
    const { global, byBev } = this.aggregates();
    const scores = byBev.get(bevId) ?? [];
    if (!isLeaderboardEligible(scores.length)) return null;
    const s = populationStats(scores);
    return round2(bayesianAverage(s.mean, s.n, { m: globalPrior(global), C: BAYES_C }));
  }

  private toSummary(b: FakeBev): BevSummary {
    const photo = this.assetUrlAndStatus(b.photoAssetId);
    // What `generatedIcons.ts` does to every summary the real API returns: a
    // COMPLETED generated icon takes the icon slot, and carries the band the
    // caller letters across it. Pending, failed and 'none' leave it empty, so
    // the Bev goes on showing its creator's photograph until the icon exists.
    const icon = this.iconFor(b);
    return {
      id: b.id,
      name: b.name,
      brand: b.brand,
      flavor: b.flavor,
      categoryId: b.categoryId,
      photoUrl: photo.url,
      // The fake catalog has no AUTHORED icon rows (see `fallbackIconUrlFor`),
      // so this is the generated icon or nothing, and bevImageProps falls back
      // to the photograph and then the category art.
      iconUrl: icon.url,
      iconLabelBand: icon.url ? { x: 0.33, y: 0.29, width: 0.34, height: 0.25, dark: true } : null,
      photoStatus: photo.status,
      priceTier: b.priceTier,
      priceEstimated: b.priceEstimated,
      ratingCount: this.aggregates().byBev.get(b.id)?.length ?? 0,
      bayesScore: this.bayes(b.id),
    };
  }

  private bucketIds(userId: string, bucket: Bucket): string[] {
    return this.db.rankings
      .filter((r) => r.userId === userId && r.bucket === bucket)
      .sort((a, z) => a.position - z.position)
      .map((r) => r.bevId);
  }

  private rankingOf(userId: string, bevId: string): FakeRanking | undefined {
    return this.db.rankings.find((r) => r.userId === userId && r.bevId === bevId);
  }

  private toRanking(r: FakeRanking): Ranking {
    const { id, userId, bevId, bucket, position, score, note, createdAt, updatedAt } = r;
    return { id, userId, bevId, bucket, position, score, note, createdAt, updatedAt };
  }

  private toRanked(r: FakeRanking): RankedBev {
    return { ...this.toRanking(r), bev: this.toSummary(this.bev(r.bevId)), venue: this.venueOf(r.userId, r.bevId) };
  }

  /** Positions and scores for a whole bucket via @bevi/ranking's respaceBucket. */
  private writeBucket(userId: string, bucket: Bucket, orderedBevIds: readonly string[]): void {
    for (const r of respaceBucket(orderedBevIds, bucket)) {
      const row = this.rankingOf(userId, r.bevId)!;
      row.bucket = bucket;
      row.position = r.position;
      row.score = r.score;
    }
  }

  private toBev(b: FakeBev, viewer: FakeUser): Bev {
    const scores = this.aggregates().byBev.get(b.id) ?? [];
    const s = scores.length ? populationStats(scores) : null;
    const mine = this.rankingOf(viewer.id, b.id);
    const label = this.assetUrlAndStatus(b.labelAssetId);
    const creator = b.createdById ? this.db.users.find((u) => u.id === b.createdById) : undefined;
    const followed = new Set(this.db.follows.filter((f) => f.followerId === viewer.id).map((f) => f.followeeId));
    return {
      ...this.toSummary(b),
      status: 'active',
      nutritionLabelUrl: label.url,
      nutrition: b.nutrition ? { ...b.nutrition } : null,
      avgScore: s ? round2(s.mean) : null,
      scoreStddev: s ? round2(s.stddev) : null,
      createdBy: creator ? { id: creator.id, handle: creator.handle } : null,
      createdAt: b.createdAt,
      myRanking: mine
        ? {
            bucket: mine.bucket,
            position: mine.position,
            bucketSize: this.bucketIds(viewer.id, mine.bucket).length,
            score: mine.score,
            note: mine.note,
          }
        : null,
      prediction: this.predictionFor(b, viewer, !!mine),
      inWantToTry: this.db.wantToTry.some((w) => w.userId === viewer.id && w.bevId === b.id),
      friends: this.db.rankings
        .filter((r) => r.bevId === b.id && followed.has(r.userId))
        .map((r) => ({ profile: this.toProfile(this.user(r.userId), viewer), score: r.score, bucket: r.bucket })),
      isStarter: b.isStarter,
      // The fake catalog carries no flavour profiles; null is the contract's "not labelled yet".
      flavorProfile: null,
    };
  }

  /**
   * `Bev.prediction`: null when the viewer has ranked the Bev or has fewer than MIN_N_USER
   * rankings (contract), else @bevi/ranking's predictScore over the snapshot.
   */
  private predictionFor(b: FakeBev, viewer: FakeUser, rankedByViewer: boolean): BevPrediction | null {
    if (rankedByViewer) return null;
    if (this.db.rankings.filter((r) => r.userId === viewer.id).length < MIN_N_USER) return null;
    const p = predictScore(this.snapshot(), viewer.id, b.id);
    return { score: round2(p.score), confidence: p.confidence, generatedAt: this.nowIso(), rankingVersion: RANKING_VERSION };
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * "Rank on Bevi": @bevi/ranking's rankUsers (which drops Unranked users) in display order.
   * Given a subset of the users, the same board among just them: the same points and the same
   * order, with the ranks counted within the subset (`leaderboard.friends`).
   */
  private userBoard(users: readonly FakeUser[] = this.db.users) {
    const inputs = users.map((u) => ({
      u,
      streak: this.streakOf(u),
      bevsRanked: this.db.rankings.filter((r) => r.userId === u.id).length,
      bevsCreated: this.bevsCreatedBy(u),
    }));
    const byId = new Map(inputs.map((x) => [x.u.id, x]));
    return rankUsers(
      inputs.map((x) => ({
        userId: x.u.id,
        bevsRanked: x.bevsRanked,
        currentStreak: x.streak.current,
        bevsCreated: x.bevsCreated,
        createdAt: x.u.createdAt,
      })),
    ).map((r) => ({ ...byId.get(r.userId)!, points: r.points, rank: r.rank }));
  }

  private statsFor(u: FakeUser): ProfileStats {
    const bevsRanked = this.db.rankings.filter((r) => r.userId === u.id).length;
    const streak = this.streakOf(u);
    const board = this.userBoard().find((r) => r.u.id === u.id);
    return {
      followers: this.db.follows.filter((f) => f.followeeId === u.id).length,
      following: this.db.follows.filter((f) => f.followerId === u.id).length,
      bevdCount: bevsRanked,
      wantToTryCount: this.db.wantToTry.filter((w) => w.userId === u.id).length,
      rankOnBevi: board ? board.rank : null,
      rankPoints: rankPoints({ bevsRanked, currentStreak: streak.current, bevsCreated: this.bevsCreatedBy(u) }),
      currentStreak: streak.current,
      longestStreak: streak.longest,
      streakAliveToday: streak.aliveToday,
    };
  }

  private wipeUserData(userId: string): void {
    const db = this.db;
    db.rankings = db.rankings.filter((r) => r.userId !== userId);
    db.bevLocations = (db.bevLocations ?? []).filter((l) => l.userId !== userId);
    db.comparisons = db.comparisons.filter((c) => c.userId !== userId);
    db.follows = db.follows.filter((f) => f.followerId !== userId && f.followeeId !== userId);
    this.blockRows = this.blockRows.filter((b) => b.blockerId !== userId && b.blockedId !== userId);
    // notifications: both people cascade from profiles.
    this.notificationRows = this.notificationRows.filter((n) => n.recipientId !== userId && n.actorId !== userId);
    // T-31 Release 2: settings, subscriptions either way, devices and queued pushes cascade too.
    this.notificationSettingsRows.delete(userId);
    this.postSubscriptions = this.postSubscriptions.filter((s) => s.subscriberId !== userId && s.targetId !== userId);
    this.pushTokenRows = this.pushTokenRows.filter((t) => t.userId !== userId);
    this.pushOutbox = this.pushOutbox.filter((p) => p.recipientId !== userId && p.actorId !== userId);
    db.wantToTry = db.wantToTry
      .filter((w) => w.userId !== userId)
      .map((w) => (w.viaUserId === userId ? { ...w, viaUserId: null } : w));
    db.feed = db.feed.filter((e) => e.actorId !== userId);
    db.unpostedRankings = (db.unpostedRankings ?? []).filter((e) => e.userId !== userId);
    const events = new Set(db.feed.map((e) => e.id));
    db.likes = (db.likes ?? []).filter((l) => l.userId !== userId && events.has(l.feedEventId));
    db.comments = (db.comments ?? []).filter((c) => c.userId !== userId && events.has(c.feedEventId));
  }

  /** The feed event `id` if `viewer` can see it (own or a followee's post, Bev age-visible), else not_found. */
  private visibleFeedEvent(id: string, viewer: FakeUser): FakeFeedEvent {
    const e = this.db.feed.find((x) => x.id === id);
    const bev = e && this.db.bevs.find((b) => b.id === e.bevId);
    const sees =
      !!e &&
      !!bev &&
      (e.actorId === viewer.id || this.db.follows.some((f) => f.followerId === viewer.id && f.followeeId === e.actorId)) &&
      !this.blockedBetween(viewer.id, e.actorId) &&
      this.visible(bev, viewer);
    return sees ? e! : fail('not_found', 'No such post');
  }

  /**
   * A post's comments that aren't deleted, oldest first. With a viewer, also without the
   * comments of anyone on the other side of a block from them (post_comments_select, IS-7).
   */
  private liveComments(eventId: string, viewer?: FakeUser): FakeComment[] {
    return (this.db.comments ?? [])
      .filter((c) => c.feedEventId === eventId && !c.deleted && !(viewer && this.blockedBetween(viewer.id, c.userId)))
      .sort((a, z) => commentSeq(a) - commentSeq(z));
  }

  private toComment(c: FakeComment, viewer: FakeUser): Comment {
    return { id: c.id, author: this.toProfile(this.user(c.userId), viewer), body: c.body, createdAt: c.createdAt };
  }

  /**
   * The notify_on_* triggers (T-31): one row per thing that happened, never about yourself, and
   * never a second one for the same follow (per pair), like (per pair and post) or comment.
   */
  private notify(recipientId: string, actorId: string, kind: NotificationKind, feedEventId: string | null, commentId: string | null): void {
    if (recipientId === actorId) return;
    const exists = this.notificationRows.some(
      (n) =>
        n.kind === kind &&
        (kind === 'comment'
          ? n.commentId === commentId
          : n.recipientId === recipientId && n.actorId === actorId && (kind === 'follow' || n.feedEventId === feedEventId)),
    );
    if (exists) return;
    this.notificationRows.push({
      id: this.nextNotification++,
      recipientId,
      actorId,
      kind,
      feedEventId,
      commentId,
      createdAt: this.nowIso(),
      readAt: null,
    });
    // enqueue_push_on_notification (T-31 Release 2): a NEW inbox row is a push to queue.
    this.pushOutbox.push({ kind, recipientId, actorId, feedEventId, commentId });
  }

  /**
   * visible_notifications: `me`'s rows that are still true. No block either way; the follow, the
   * like or the (undeleted) comment still there (skipped for fixture rows, see FakeNotification);
   * and for a post, the post still there with its ranking and its Bev within the age gate.
   */
  private visibleNotifications(me: FakeUser): FakeNotification[] {
    return this.notificationRows.filter((n) => {
      if (n.recipientId !== me.id || this.blockedBetween(me.id, n.actorId)) return false;
      if (!this.db.users.some((u) => u.id === n.actorId)) return false;
      if (n.kind === 'follow') return !!n.fixture || this.isFollowing(n.actorId, me.id);
      const e = this.db.feed.find((x) => x.id === n.feedEventId);
      // A removed ranking's post is gone (on the server its feed event, and these with it, cascade).
      if (!e || !this.rankingOf(e.actorId, e.bevId)) return false;
      const bev = this.db.bevs.find((x) => x.id === e.bevId);
      if (!bev || !this.visible(bev, me)) return false;
      if (n.fixture) return true;
      if (n.kind === 'like') return (this.db.likes ?? []).some((l) => l.userId === n.actorId && l.feedEventId === n.feedEventId);
      return (this.db.comments ?? []).some((c) => c.id === n.commentId && !c.deleted);
    });
  }

  /** get_notifications' rows before paging: likes on one post grouped, newest row first. */
  private notificationGroups(me: FakeUser): FakeNotificationGroup[] {
    const groups = new Map<string, FakeNotification[]>();
    // Newest first, so each group's first member is its head and the map's order is the rows'.
    for (const n of this.visibleNotifications(me).sort((x, z) => z.id - x.id)) {
      const key = n.kind === 'like' ? `like:${n.feedEventId}` : `${n.kind}:${n.id}`;
      const members = groups.get(key);
      if (members) members.push(n);
      else groups.set(key, [n]);
    }
    return [...groups.values()].map((members) => ({ head: members[0]!, members }));
  }

  private toNotification({ head, members }: FakeNotificationGroup, me: FakeUser): Notification {
    const event = head.feedEventId ? this.db.feed.find((x) => x.id === head.feedEventId) : undefined;
    const bev = event ? this.db.bevs.find((x) => x.id === event.bevId) : undefined;
    const body =
      head.kind === 'comment'
        ? (head.fixture?.commentBody ?? (this.db.comments ?? []).find((c) => c.id === head.commentId)?.body ?? '')
        : null;
    return {
      id: String(head.id),
      kind: head.kind,
      createdAt: head.createdAt,
      unread: members.some((m) => m.readAt === null),
      actors: members.slice(0, NOTIFICATION_ACTORS_MAX).map((m) => this.toRow(this.user(m.actorId), me)),
      actorCount: new Set(members.map((m) => m.actorId)).size,
      postId: head.feedEventId,
      bev: bev ? this.toSummary(bev) : null,
      comment: body !== null && head.commentId ? { id: head.commentId, body } : null,
    };
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  signUp: AuthApi['signUp'] = (input: SignUpInput) =>
    this.call(
      'signUp',
      () => {
        if ((input.inviteCode ?? '').trim() !== FAKE_INVITE_CODE) invalid('inviteCode', 'That invite code is not valid');
        const username = input.username ?? '';
        if (!HANDLE_PATTERN.test(username)) {
          invalid('username', 'Use 3–20 lowercase letters, numbers or _', 'invalid');
        }
        if (RESERVED_HANDLES.includes(username)) invalid('username', 'That username is reserved', 'reserved');
        if ((input.password ?? '').length < FAKE_MIN_PASSWORD_LENGTH) {
          invalid('password', `Use at least ${FAKE_MIN_PASSWORD_LENGTH} characters`, 'weak');
        }
        if (this.db.users.some((u) => u.handle === username)) fail('conflict', 'That username is taken');
        const user: FakeUser = {
          id: this.nextId('user'),
          handle: username,
          password: input.password,
          displayName: username,
          avatarUrl: null,
          timezone: 'UTC',
          createdAt: this.nowIso(),
          birthdate: null,
          onboarded: false,
        };
        this.db.users.push(user);
        this.db.sessionUserId = user.id;
        this.commit();
        this.emit();
        return { userId: user.id, handle: user.handle };
      },
      true,
    );

  signIn: AuthApi['signIn'] = (input: SignInInput) =>
    this.call(
      'signIn',
      () => {
        const username = norm(input.username);
        const user = this.db.users.find((u) => u.handle === username);
        if (!user || user.password !== input.password) fail('unauthorized', 'Wrong username or password');
        this.db.sessionUserId = user.id;
        this.commit();
        this.emit();
        return { userId: user.id, handle: user.handle };
      },
      true,
    );

  getSession: AuthApi['getSession'] = () => this.call('getSession', () => this.currentSession());

  onAuthChange: AuthApi['onAuthChange'] = (cb) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** Idempotent: signing out while signed out resolves. */
  signOut: AuthApi['signOut'] = () =>
    this.call(
      'signOut',
      () => {
        const was = this.db.sessionUserId;
        this.db.sessionUserId = null;
        this.commit();
        if (was) this.emit();
      },
      true,
    );

  deleteAccount: AuthApi['deleteAccount'] = () =>
    this.call(
      'deleteAccount',
      () => {
        const me = this.requireUser();
        this.wipeUserData(me.id);
        // content_reports: a report about the account goes with it; one the account filed stays,
        // reporterless (reporter_id `on delete set null`), so the person it named is still reviewed.
        this.contentReports = this.contentReports
          .filter((r) => r.reportedUserId !== me.id)
          .map((r) => (r.reporterId === me.id ? { ...r, reporterId: '' } : r));
        this.db.assets = this.db.assets.filter((a) => a.userId !== me.id);
        for (const b of this.db.bevs) if (b.createdById === me.id) b.createdById = null;
        this.db.users = this.db.users.filter((u) => u.id !== me.id);
        this.db.sessionUserId = null;
        this.commit();
        this.emit();
      },
      true,
    );

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  private handleProblem(handle: string, selfId?: string): CheckHandleResult['reason'] | null {
    if (!HANDLE_PATTERN.test(handle)) return 'invalid';
    if (RESERVED_HANDLES.includes(handle)) return 'reserved';
    if (this.db.users.some((u) => u.handle === handle && u.id !== selfId)) return 'taken';
    return null;
  }

  profile: ProfileApi = {
    getMe: () => this.call('profile.getMe', () => this.toProfile(this.requireUser(), this.sessionUser())),

    updateMe: (patch: UpdateMeInput) =>
      this.call(
        'profile.updateMe',
        () => {
          const me = this.requireUser();
          let displayName = me.displayName;
          if (patch.displayName !== undefined) {
            displayName = patch.displayName.trim();
            if (!displayName) invalid('displayName', 'Enter a name');
            if (displayName.length > DISPLAY_NAME_MAX) invalid('displayName', 'That name is too long');
          }
          if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) invalid('timezone', 'Unknown timezone');
          let avatarUrl = me.avatarUrl;
          if (patch.avatarAssetId !== undefined) {
            if (patch.avatarAssetId === null) {
              avatarUrl = null;
            } else {
              // set_avatar's rule: the caller's own upload, to the avatars bucket.
              const asset = this.db.assets.find((a) => a.id === patch.avatarAssetId && a.userId === me.id && a.kind === 'avatar');
              if (!asset) invalid('avatarAssetId', "That photo isn't one of your uploads", 'unknown_asset');
              avatarUrl = asset.url;
            }
          }
          const handleChanged = patch.handle !== undefined && patch.handle !== me.handle;
          if (handleChanged) {
            const problem = this.handleProblem(patch.handle!, me.id);
            if (problem === 'taken') fail('conflict', 'That username is taken');
            if (problem) invalid('handle', problem === 'reserved' ? 'That username is reserved' : 'Use 3–20 lowercase letters, numbers or _', problem);
            me.handle = patch.handle!;
          }
          me.displayName = displayName;
          me.avatarUrl = avatarUrl;
          if (patch.timezone !== undefined) me.timezone = patch.timezone;
          if (patch.onboarded !== undefined) me.onboarded = patch.onboarded;
          this.commit();
          if (handleChanged) this.emit();
          return this.toProfile(me, me);
        },
        true,
      ),

    setBirthDate: (date: string) =>
      this.call(
        'profile.setBirthDate',
        () => {
          const me = this.requireUser();
          if (me.birthdate) invalid('birthdate', 'Your birthdate is already set', 'already_set');
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
          const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
          if (!m || !d || d.toISOString().slice(0, 10) !== date || Number(m[1]) < 1900) {
            invalid('birthdate', 'Use a real date (YYYY-MM-DD)', 'malformed');
          }
          if (date > this.nowIso().slice(0, 10)) invalid('birthdate', 'That date is in the future', 'future');
          me.birthdate = date;
          return this.toProfile(me, me);
        },
        true,
      ),

    checkHandle: (handle: string) =>
      this.call('profile.checkHandle', (): CheckHandleResult => {
        const reason = this.handleProblem(handle, this.sessionUser()?.id);
        return reason ? { available: false, reason } : { available: true };
      }),

    getUser: (id: string) =>
      this.call('profile.getUser', () => {
        const me = this.requireUser();
        return this.toRow(this.visibleUser(id, me), me);
      }),

    searchUsers: (params) =>
      this.call('profile.searchUsers', () => {
        const me = this.requireUser();
        const q = norm(params.q).replace(/^@/, '');
        const rows = this.db.users
          .filter(
            (u) =>
              u.id !== me.id &&
              !this.blockedBetween(me.id, u.id) &&
              (!q || u.handle.includes(q) || norm(u.displayName).includes(q)),
          )
          .sort((a, z) => Number(z.handle.startsWith(q)) - Number(a.handle.startsWith(q)) || a.handle.localeCompare(z.handle))
          .map((u) => this.toRow(u, me));
        return paginate(rows, params, 25);
      }),
  };

  stats: StatsApi = {
    getMine: () => this.call('stats.getMine', () => this.statsFor(this.requireUser())),
    getUser: (id: string) =>
      this.call('stats.getUser', () => {
        const me = this.requireUser();
        return this.statsFor(this.visibleUser(id, me));
      }),
    getCategoryProgress: () => this.call('stats.getCategoryProgress', () => this.categoryProgress(this.requireUser())),
    getTasteProfile: (userId: string) =>
      this.call('stats.getTasteProfile', () => {
        const me = this.requireUser();
        return this.tasteProfile(me, this.visibleUser(userId, me));
      }),
  };

  /**
   * As `get_taste_profile()` over `refresh_user_category_stats()` (20261019000100),
   * computed with @bevi/ranking's own functions: per category the user's mean and
   * Σz / (n + K_AFF), z against their effective overall stats (their own from
   * MIN_N_USER rankings, else every stored score's). Rounded to 3 places as the
   * numeric(5,3) / numeric(6,3) columns store them. Alcoholic categories only
   * when the viewer and the owner are both 21+. Highest mean first.
   */
  private tasteProfile(viewer: FakeUser, owner: FakeUser): TasteProfileRow[] {
    const showAlcohol = this.canSeeAlcohol(viewer) && this.canSeeAlcohol(owner);
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const all = this.db.rankings;
    const own = all.filter((r) => r.userId === owner.id);
    const effective = effectiveUserStats(populationStats(own.map((r) => r.score)), populationStats(all.map((r) => r.score)));
    const byCategory = new Map<CategoryId, number[]>();
    for (const r of own) {
      const c = this.bev(r.bevId).categoryId;
      byCategory.set(c, [...(byCategory.get(c) ?? []), r.score]);
    }
    const order = new Map(CATEGORIES.map((c) => [c.id, c.sortOrder]));
    return [...byCategory]
      .filter(([c]) => showAlcohol || !ALCOHOLIC.has(c))
      .map(([categoryId, scores]) => ({
        categoryId,
        rankingCount: scores.length,
        mean: round3(populationStats(scores).mean),
        affinity: round3(categoryAffinity(scores.map((sc) => zScore(sc, effective)))),
      }))
      .sort((a, z) => z.mean - a.mean || (order.get(a.categoryId) ?? 0) - (order.get(z.categoryId) ?? 0) || (a.categoryId < z.categoryId ? -1 : 1));
  }

  /**
   * As `get_category_progress()` (20261018000200): one row per category the
   * viewer can see, in sort order. Every FakeBev counts as active (the fake has
   * no pending_photo / hidden / merged states).
   */
  private categoryProgress(me: FakeUser): CategoryProgress[] {
    const adult = this.canSeeAlcohol(me);
    const mine = new Set(this.db.rankings.filter((r) => r.userId === me.id).map((r) => r.bevId));
    return CATEGORIES.filter((c) => adult || !c.isAlcoholic)
      .sort((a, z) => a.sortOrder - z.sortOrder)
      .map((c) => {
        const inCategory = this.db.bevs.filter((b) => b.categoryId === c.id);
        return { categoryId: c.id, ranked: inCategory.filter((b) => mine.has(b.id)).length, total: inCategory.length };
      });
  }

  // -------------------------------------------------------------------------
  // Follows
  // -------------------------------------------------------------------------

  follows: FollowsApi = {
    follow: (id: string) =>
      this.call(
        'follows.follow',
        () => {
          const me = this.requireUser();
          this.user(id);
          if (id === me.id) invalid('id', "You can't follow yourself");
          // follow_user (IS-7): refused across a block either way, as "no such user".
          this.visibleUser(id, me);
          if (!this.isFollowing(me.id, id)) {
            this.db.follows.push({ followerId: me.id, followeeId: id, createdAt: this.nowIso() });
            this.notify(id, me.id, 'follow', null, null);
          }
        },
        true,
      ),

    unfollow: (id: string) =>
      this.call(
        'follows.unfollow',
        () => {
          const me = this.requireUser();
          this.user(id);
          this.db.follows = this.db.follows.filter((f) => !(f.followerId === me.id && f.followeeId === id));
          this.dropPostSubscription(me.id, id);
        },
        true,
      ),

    listFollowers: (id: string, page?: PageParams) =>
      this.call('follows.listFollowers', () => {
        const me = this.requireUser();
        this.user(id);
        // follows_select (IS-7): no edge with someone across a block from the caller at either end.
        const rows = this.db.follows
          .filter((f) => f.followeeId === id && !this.blockedBetween(me.id, f.followerId) && !this.blockedBetween(me.id, f.followeeId))
          .sort((a, z) => z.createdAt.localeCompare(a.createdAt))
          .map((f) => this.toRow(this.user(f.followerId), me));
        return paginate(rows, page, 50);
      }),

    listFollowing: (id: string, page?: PageParams) =>
      this.call('follows.listFollowing', () => {
        const me = this.requireUser();
        this.user(id);
        const rows = this.db.follows
          .filter((f) => f.followerId === id && !this.blockedBetween(me.id, f.followerId) && !this.blockedBetween(me.id, f.followeeId))
          .sort((a, z) => z.createdAt.localeCompare(a.createdAt))
          .map((f) => this.toRow(this.user(f.followeeId), me));
        return paginate(rows, page, 50);
      }),

    suggested: () =>
      this.call('follows.suggested', () => {
        const me = this.requireUser();
        const count = (id: string) => this.db.rankings.filter((r) => r.userId === id).length;
        return this.db.users
          .filter((u) => u.id !== me.id && !this.isFollowing(me.id, u.id) && !this.blockedBetween(me.id, u.id))
          .sort((a, z) => count(z.id) - count(a.id) || a.handle.localeCompare(z.handle))
          .slice(0, 10)
          .map((u): SuggestedProfile => ({ ...this.toRow(u, me), ...this.followedBy(u, me) }));
      }),
  };

  /**
   * get_followed_by: the people `me` follows who follow `u`. All of them are counted; the first
   * FOLLOWED_BY_MAX are listed, the one who followed `u` most recently first.
   *
   * Two follows written in the same millisecond tie on `createdAt`, which happens here (two
   * calls of one test easily land in one millisecond) and in practice never in Postgres. The
   * fake breaks that tie by which was written later, the nearer reading of "most recently"; the
   * SQL breaks it by id, only to keep its order total.
   */
  private followedBy(u: FakeUser, me: FakeUser): Pick<SuggestedProfile, 'followedBy' | 'followedByCount'> {
    const mutual = this.db.follows
      .map((f, written) => ({ f, written }))
      .filter(({ f }) => f.followeeId === u.id && this.isFollowing(me.id, f.followerId))
      .sort((a, z) => z.f.createdAt.localeCompare(a.f.createdAt) || z.written - a.written);
    return {
      followedBy: mutual.slice(0, FOLLOWED_BY_MAX).map(({ f }) => this.toProfile(this.user(f.followerId), me)),
      followedByCount: mutual.length,
    };
  }

  categories: CategoriesApi = {
    list: () =>
      this.call('categories.list', () => {
        const me = this.requireUser();
        const adult = this.canSeeAlcohol(me);
        const totals = new Map(this.categoryProgress(me).map((p) => [p.categoryId, p.total]));
        return CATEGORIES.filter((c) => adult || !c.isAlcoholic)
          .map(({ id, name, sortOrder, isAlcoholic }) => ({ id, name, sortOrder, isAlcoholic, bevCount: totals.get(id) ?? 0 }))
          .sort((a, z) => a.sortOrder - z.sortOrder);
      }),

    // get_category_tree (20261026000100): the 75 nodes, age-gated by the ROOT's
    // flag so a leaf of `beer` is hidden with `beer` itself, ordered
    // root-then-leaf in sibling order.
    tree: () =>
      this.call('categories.tree', () => {
        const me = this.requireUser();
        const adult = this.canSeeAlcohol(me);
        const rootOf = (c: CatalogCategoryNode) => c.parentId ?? c.id;
        const byId = new Map(CATALOG_CATEGORY_NODES.map((c) => [c.id, c]));
        const sortOrderOf = (id: string) => byId.get(id)?.sortOrder ?? 0;
        return CATALOG_CATEGORY_NODES.filter((c) => adult || !c.isAlcoholic)
          .map(({ id, name, parentId, sortOrder, isAlcoholic, emoji }) => ({ id, name, parentId, sortOrder, isAlcoholic, emoji }))
          .sort(
            (a, z) =>
              sortOrderOf(rootOf(a)) - sortOrderOf(rootOf(z)) ||
              cmp(rootOf(a), rootOf(z)) ||
              Number(a.parentId !== null) - Number(z.parentId !== null) ||
              a.sortOrder - z.sortOrder ||
              cmp(a.id, z.id),
          );
      }),
  };

  // -------------------------------------------------------------------------
  // Bevs and media
  // -------------------------------------------------------------------------

  private estimateTier(categoryId: CategoryId): PriceTier {
    const tiers = this.db.bevs.filter((b) => b.categoryId === categoryId).map((b) => b.priceTier).sort();
    return (tiers.length ? tiers[Math.floor((tiers.length - 1) / 2)] : 2) as PriceTier;
  }

  bevs: BevsApi = {
    search: (params) =>
      this.call('bevs.search', () => {
        const me = this.requireUser();
        const q = norm(params.q);
        const qTokens = tokens(q);
        const catName = new Map(CATEGORIES.map((c) => [c.id, c.name]));
        const counts = this.aggregates().byBev;
        const hits = this.db.bevs
          .filter((b) => this.visible(b, me) && (!params.categoryId || b.categoryId === params.categoryId))
          .filter((b) => {
            const hay = norm([b.name, b.brand, b.flavor, catName.get(b.categoryId), ...b.aliases].join(' '));
            return qTokens.every((t) => hay.includes(t));
          })
          .sort(
            (a, z) =>
              Number(!!q && norm(z.name).startsWith(q)) - Number(!!q && norm(a.name).startsWith(q)) ||
              (counts.get(z.id)?.length ?? 0) - (counts.get(a.id)?.length ?? 0) ||
              a.name.localeCompare(z.name),
          )
          .map((b) => this.toSummary(b));
        return paginate(hits, params, 25);
      }),

    get: (id: string) =>
      this.call('bevs.get', () => {
        const me = this.requireUser();
        const b = this.bev(id);
        this.requireVisible(b, me);
        return this.toBev(b, me);
      }),

    findLikelyDuplicates: (input) =>
      this.call('bevs.findLikelyDuplicates', () => {
        const me = this.requireUser();
        const want = new Set(tokens([input.name, input.brand, input.flavor].join(' ')));
        if (!want.size) return [];
        return this.db.bevs
          .filter((b) => this.visible(b, me))
          .map((b) => {
            const have = new Set(tokens([b.name, b.brand, b.flavor, ...b.aliases].join(' ')));
            const inter = [...want].filter((t) => have.has(t)).length;
            const jaccard = inter / (want.size + have.size - inter);
            const nameHit = norm(b.name).includes(norm(input.name)) ? 0.3 : 0;
            const sameCat = input.categoryId !== undefined && input.categoryId === b.categoryId;
            const catHit = sameCat ? 0.1 : 0;
            // As find_similar_bevs orders (20261112000100): every token present first, then the
            // chosen category, then the score. The category reorders; it never excludes a Bev.
            return { b, s: jaccard + nameHit + catHit, tokHit: inter === want.size, sameCat };
          })
          .filter((x) => x.s >= 0.3)
          .sort(
            (a, z) =>
              Number(z.tokHit) - Number(a.tokHit) ||
              Number(z.sameCat) - Number(a.sameCat) ||
              z.s - a.s ||
              a.b.name.localeCompare(z.b.name),
          )
          .slice(0, 5)
          .map((x) => this.toSummary(x.b));
      }),

    create: (input) =>
      this.call(
        'bevs.create',
        () => {
          const me = this.requireUser();
          const name = (input.name ?? '').trim();
          if (!name) invalid('name', 'Enter a name');
          if (name.length > NAME_MAX) invalid('name', 'That name is too long');
          const brand = input.brand?.trim() || null;
          const flavor = input.flavor?.trim() || null;
          if (!CATEGORIES.some((c) => c.id === input.categoryId)) invalid('categoryId', 'Choose a category');
          if (input.priceTier === null && !input.priceEstimated) invalid('priceTier', 'Choose a price or "Not sure"');
          if (input.priceTier !== null && ![1, 2, 3, 4].includes(input.priceTier)) invalid('priceTier', 'Choose a price');
          if (input.nutrition) {
            const n = input.nutrition;
            const fields = ['barcode', 'productName', 'basis', 'sourceUrl', 'calories', 'fatGrams', 'carbohydrateGrams', 'sugarGrams', 'proteinGrams', 'sodiumMg'];
            const values = [n.calories, n.fatGrams, n.carbohydrateGrams, n.sugarGrams, n.proteinGrams, n.sodiumMg];
            const strings = [n.barcode, n.productName, n.basis, n.sourceUrl];
            if (Object.keys(n).some((k) => !fields.includes(k)) ||
                strings.some((v) => typeof v !== 'string' || !v.trim() || v.length > 256) ||
                !/^(?:\d{8}|\d{12}|\d{13})$/.test(n.barcode) ||
                n.sourceUrl !== `https://world.openfoodfacts.org/product/${n.barcode}` ||
                !values.some((v) => v !== null) ||
                values.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1_000_000))) {
              invalid('nutrition', 'Scan the nutrition label again');
            }
          }
          // The photo is optional (contract 3.0.0). When it is absent the Bev is
          // still created and is INELIGIBLE for icon generation; when it is
          // present it must be a real, finished upload of the caller's, exactly
          // as `create_bev` checks the storage object's bucket, folder and owner.
          let photo: FakeAsset | undefined;
          if (input.photoAssetId !== undefined) {
            photo = this.db.assets.find((a) => a.id === input.photoAssetId && a.userId === me.id && a.kind === 'bev-photo');
            if (!photo) invalid('photoAssetId', 'Upload a photo first', 'unknown_asset');
            if (this.assetUrlAndStatus(photo.id).status !== 'ready') {
              invalid('photoAssetId', 'The photo is still processing', 'asset_not_ready');
            }
          }
          if (input.labelAssetId !== undefined) {
            const label = this.db.assets.find((a) => a.id === input.labelAssetId && a.userId === me.id && a.kind === 'label');
            if (!label) invalid('labelAssetId', 'Upload the label again', 'unknown_asset');
          }
          if (ALCOHOLIC.has(input.categoryId) && !this.canSeeAlcohol(me)) fail('age_restricted', 'Not available');
          const existing = this.db.bevs.find(
            (b) =>
              norm(b.name) === norm(name) &&
              norm(b.brand) === norm(brand) &&
              norm(b.flavor) === norm(flavor) &&
              b.categoryId === input.categoryId,
          );
          if (existing) fail('conflict', 'That Bev already exists', { existingBevId: existing.id });
          const bev: FakeBev = {
            id: this.nextId('bev'),
            name,
            brand,
            flavor,
            categoryId: input.categoryId,
            // The wizard offers only the 15 roots, so a user-created Bev has no
            // leaf until something relabels it -- exactly what `create_bev`
            // leaves `leaf_category_id` as.
            leafCategoryId: null,
            priceTier: input.priceTier ?? this.estimateTier(input.categoryId),
            priceEstimated: input.priceTier === null ? true : input.priceEstimated,
            isStarter: false,
            aliases: [],
            photoAssetId: photo?.id ?? null,
            labelAssetId: input.labelAssetId ?? null,
            // A new Bev with a verified photo automatically enters generation.
            iconReadyAt: photo ? new Date(this.now().getTime() + this.iconGenerationMs).toISOString() : null,
            iconStatusOverride: null,
            ...(input.nutrition ? { nutrition: { ...input.nutrition } } : {}),
            createdById: me.id,
            createdAt: this.nowIso(),
          };
          this.db.bevs.push(bev);
          this.agg = null;
          return this.toBev(bev, me);
        },
        true,
      ),

    // report_bev (20261101000500): `duplicateOfId` must name another Bev the caller can see. The
    // fake has no hidden or merged Bevs, so "can see" is "exists, and not alcoholic for a minor";
    // unknown, self and age-gated are one error, as on the server.
    report: (id: string, reason: string, opts?: { duplicateOfId?: string }) =>
      this.call(
        'bevs.report',
        () => {
          const me = this.requireUser();
          this.bev(id);
          const r = (reason ?? '').trim();
          if (!r || r.length > REPORT_REASON_MAX) invalid('reason', 'Choose a reason', 'unknown_reason');
          const duplicateOfId = opts?.duplicateOfId ?? null;
          if (duplicateOfId !== null) {
            const original = this.db.bevs.find((b) => b.id === duplicateOfId);
            if (duplicateOfId === id || !original || !this.visible(original, me)) {
              invalid('duplicateOfId', 'Choose the Bev this one duplicates');
            }
          }
          this.db.reports.push({ bevId: id, userId: me.id, reason: r, duplicateOfId, createdAt: this.nowIso() });
        },
        true,
      ),

    // The contract has the app pick the 10 with selectStarterSet(candidates, { seed: userId }), so the
    // fake only returns the age-filtered starter candidates and never selects.
    getStarterCandidates: () =>
      this.call('bevs.getStarterCandidates', () => {
        const me = this.requireUser();
        return this.db.bevs.filter((b) => b.isStarter && this.visible(b, me)).map((b) => this.toSummary(b));
      }),

    // get_bev_similarities (20261019000500): the weights for the pairs the mirror has a row for.
    // A pair with no edge is absent, so the result is usually shorter than `otherIds` -- the
    // contract's "callers must handle empty" is the ordinary case, not a failure mode.
    similarities: (bevId: string, otherIds: readonly string[]) =>
      this.call('bevs.similarities', () => {
        const me = this.requireUser();
        if (otherIds.length > SIMILARITIES_MAX_IDS) invalid('otherIds', 'Too many Bevs to compare at once');
        const anchor = this.db.bevs.find((b) => b.id === bevId);
        // An anchor the caller cannot see contributes nothing, and is not an error: the SQL drops
        // the row rather than raising, because this feeds a placement heuristic.
        if (!anchor || !this.visible(anchor, me)) return [];
        const mirror = this.edges();
        const out: BevSimilarity[] = [];
        for (const id of new Set(otherIds)) {
          if (id === bevId) continue;
          const other = this.db.bevs.find((b) => b.id === id);
          if (!other || !this.visible(other, me)) continue;
          // Unrounded, as the server's numeric column is: the value is exactly what
          // `edgeWeight()` produced, which is what the sync job will store.
          const weight = mirror.weightOf(bevId, id);
          if (weight !== null) out.push({ bevId: id, weight });
        }
        return out;
      }),

    // get_bev_leaves (20261026000100): each visible Bev's leaf. Unlike
    // `similarities`, a visible Bev with NO leaf is still returned, with null --
    // "no finer placement" has to be distinguishable from "you may not see it".
    leaves: (bevIds: readonly string[]) =>
      this.call('bevs.leaves', () => {
        const me = this.requireUser();
        if (bevIds.length > SIMILARITIES_MAX_IDS) invalid('bevIds', 'Too many Bevs to look up at once');
        const out: BevLeaf[] = [];
        for (const id of new Set(bevIds)) {
          const bev = this.db.bevs.find((b) => b.id === id);
          if (!bev || !this.visible(bev, me)) continue;
          out.push({ bevId: bev.id, leafCategoryId: bev.leafCategoryId });
        }
        return out.sort((a, z) => cmp(a.bevId, z.bevId));
      }),

    // Copied from `leaves` on purpose, down to the cap and the omit-what-you-
    // cannot-see rule -- `get_bev_icons` (20261119185801) is copied from
    // `get_bev_leaves` for the same reason. READ-ONLY: drawing a screen must
    // never schedule generation, so nothing here touches `iconReadyAt`.
    icons: (bevIds: readonly string[]) =>
      this.call('bevs.icons', () => {
        const me = this.requireUser();
        if (bevIds.length > SIMILARITIES_MAX_IDS) invalid('bevIds', 'Too many Bevs to look up at once');
        const out: BevIcon[] = [];
        for (const id of new Set(bevIds)) {
          const bev = this.db.bevs.find((b) => b.id === id);
          if (!bev || !this.visible(bev, me)) continue;
          const icon = this.iconFor(bev);
          out.push({
            bevId: bev.id,
            generatedIconUrl: icon.url,
            iconStatus: icon.status,
            fallbackIconUrl: icon.url ? null : this.fallbackIconUrlFor(bev, me),
            // The real worker detects this from the render; the fake just has
            // to give the app something plausible to letter.
            labelBand: icon.url ? { x: 0.33, y: 0.29, width: 0.34, height: 0.25, dark: true } : null,
          });
        }
        return out.sort((a, z) => cmp(a.bevId, z.bevId));
      }),

    // get_similar_bevs: the heaviest neighbours, both stored orientations merged, age-filtered.
    similar: (bevId: string, n?: number) =>
      this.call('bevs.similar', () => {
        const me = this.requireUser();
        const anchor = this.db.bevs.find((b) => b.id === bevId);
        if (!anchor || !this.visible(anchor, me)) return [];
        const limit = clamp(Math.floor(n ?? SIMILAR_DEFAULT_N), 1, SIMILAR_MAX_N);
        return this.edges()
          .neighboursOf(bevId)
          .map((e) => this.db.bevs.find((b) => b.id === e.bevId))
          .filter((b): b is FakeBev => !!b && this.visible(b, me))
          .slice(0, limit)
          .map((b) => this.toSummary(b));
      }),
  };

  // -------------------------------------------------------------------------
  // controls.setIconStatus
  // -------------------------------------------------------------------------

  /**
   * Force a Bev's generated-icon state, so a suite can render 'processing' or
   * 'failed' without waiting on a clock. Passing 'none' also clears
   * `iconReadyAt`, so the Bev reads as never eligible.
   */
  setIconStatus(bevId: string, status: IconStatus | null): void {
    const bev = this.db.bevs.find((b) => b.id === bevId);
    if (!bev) return;
    bev.iconStatusOverride = status;
    if (status === 'none') bev.iconReadyAt = null;
    this.db.dirty = true;
  }

  media: MediaApi = {
    upload: (input) =>
      this.call(
        'media.upload',
        () => {
          const me = this.requireUser();
          if (!UPLOAD_MIME_TYPES.includes(input.mimeType)) invalid('mimeType', 'Use a JPEG, PNG, WebP or HEIC image');
          // Contract 2.15.0 widened `file` to Blob | ArrayBuffer | Uint8Array (a React Native Blob
          // uploads 0 bytes), so the size guard reads whichever measure the payload carries.
          const fileBytes = input.file instanceof ArrayBuffer || ArrayBuffer.isView(input.file) ? input.file.byteLength : input.file?.size;
          if (typeof fileBytes === 'number' && fileBytes > UPLOAD_MAX_BYTES) invalid('file', 'That image is too large');
          const id = this.nextId('asset');
          let url = `fake-asset://${id}`;
          try {
            // Only a real Blob has an object URL; bytes keep the placeholder.
            if (typeof Blob !== 'undefined' && input.file instanceof Blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function')
              url = URL.createObjectURL(input.file);
          } catch {
            // Not a real Blob (tests) or no object URLs: keep the placeholder.
          }
          const processing = input.kind === 'bev-photo' ? this.photoProcessingMs : 0;
          const readyAt = new Date(this.now().getTime() + processing).toISOString();
          this.db.assets.push({ id, userId: me.id, kind: input.kind, url, mimeType: input.mimeType, readyAt });
          return { assetId: id, url, status: processing > 0 ? ('processing' as const) : ('ready' as const) };
        },
        true,
      ),
  };

  // -------------------------------------------------------------------------
  // Rankings
  // -------------------------------------------------------------------------

  private checkPlacement(input: SubmitRankingInput): string | null | undefined {
    if (!BUCKET_ORDER.includes(input.bucket)) invalid('bucket', 'Unknown bucket');
    const { insertIndex, expectedBucketSize } = input;
    if (!Number.isInteger(expectedBucketSize) || expectedBucketSize < 0) invalid('expectedBucketSize', 'Bad bucket size');
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > expectedBucketSize) {
      invalid('insertIndex', `insertIndex must be in [0, ${expectedBucketSize}]`);
    }
    if (!Array.isArray(input.comparisons)) invalid('comparisons', 'comparisons must be a list');
    if (input.note === undefined) return undefined;
    const note = (input.note ?? '').trim();
    if (note.length > NOTE_MAX) invalid('note', `Notes are up to ${NOTE_MAX} characters`);
    return note || null;
  }

  /**
   * `post` false is a submission made before onboarding ended: `submit_ranking` writes no feed
   * event for it (DELIVERABLE-44), so it is kept in `unpostedRankings` for the streak instead and
   * there is no event id to return. A re-rank always posts, as `rerank_bev` does.
   */
  private logPlacement(me: FakeUser, rankingId: string, bevId: string, comparisons: readonly Comparison[], at: string, post = true): string | null {
    for (const c of comparisons) {
      this.db.comparisons.push({ rankingId, userId: me.id, winnerBevId: c.winnerBevId, loserBevId: c.loserBevId, tie: !!c.tie, createdAt: at });
    }
    if (!post) {
      (this.db.unpostedRankings ??= []).push({ userId: me.id, bevId, createdAt: at });
      return null;
    }
    const id = this.nextId('feed');
    this.db.feed.push({ id, type: 'RANKING', actorId: me.id, bevId, createdAt: at });
    return id;
  }

  rankings: RankingsApi = {
    listMine: (params = {}) =>
      this.call('rankings.listMine', () => {
        const me = this.requireUser();
        const catOf = new Map(this.db.bevs.map((b) => [b.id, b]));
        const sort = params.sort ?? 'score';
        const rows = this.db.rankings
          .filter((r) => r.userId === me.id)
          .filter((r) => !params.bucket || r.bucket === params.bucket)
          .filter((r) => !params.categoryId || catOf.get(r.bevId)?.categoryId === params.categoryId)
          .sort((a, z) => {
            if (sort === 'recent') return z.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(z.id);
            if (sort === 'name') return (catOf.get(a.bevId)?.name ?? '').localeCompare(catOf.get(z.bevId)?.name ?? '');
            return BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(z.bucket) || a.position - z.position;
          })
          .map((r) => this.toRanked(r));
        return paginate(rows, params.page, 50);
      }),

    listUser: (id: string, page?: PageParams) =>
      this.call('rankings.listUser', () => {
        const me = this.requireUser();
        this.user(id);
        // rankings_select (IS-7): someone across a block has no visible rankings, so an empty list.
        const rows = this.db.rankings
          .filter((r) => r.userId === id && !this.blockedBetween(me.id, id) && this.visible(this.bev(r.bevId), me))
          .sort((a, z) => z.updatedAt.localeCompare(a.updatedAt) || z.id.localeCompare(a.id))
          .map((r) => this.toRanked(r));
        return paginate(rows, page, 20);
      }),

    listBucket: (bucket: Bucket) =>
      this.call('rankings.listBucket', () => {
        const me = this.requireUser();
        if (!BUCKET_ORDER.includes(bucket)) invalid('bucket', 'Unknown bucket');
        return this.bucketIds(me.id, bucket);
      }),

    // list_bucket_bevs (20261019000500): listBucket's ids, same order, each with the two catalog
    // fields the similarity formulas need. brandKey is normaliseBrand's, from @bevi/ranking, which
    // is also what the SQL's lower/trim/collapse reproduces.
    //
    // Built on `bucketIds`, so it is the same row set as `listBucket` above -- which is the
    // invariant the SQL version is written to hold too (rankings_select age-gates both or neither).
    // Neither applies a visibility filter here because the fake cannot produce a ranking of a Bev
    // its ranker could not see: `submitRanking` calls `requireVisible` first.
    listBucketBevs: (bucket: Bucket) =>
      this.call('rankings.listBucketBevs', (): BucketBev[] => {
        const me = this.requireUser();
        if (!BUCKET_ORDER.includes(bucket)) invalid('bucket', 'Unknown bucket');
        return this.bucketIds(me.id, bucket).map((id) => {
          const b = this.bev(id);
          return { id: b.id, categoryId: b.categoryId, brandKey: normaliseBrand(b.brand) };
        });
      }),

    submitRanking: (input: SubmitRankingInput) =>
      this.call(
        'rankings.submitRanking',
        (): SubmitRankingResult => {
          const me = this.requireUser();
          const bev = this.bev(input.bevId);
          this.requireVisible(bev, me);
          if (this.rankingOf(me.id, bev.id)) fail('conflict', 'Already ranked; use rerankBev', { reason: 'already_ranked' });
          const note = this.checkPlacement(input) ?? null;
          const ids = this.bucketIds(me.id, input.bucket);
          if (ids.length !== input.expectedBucketSize) {
            fail('conflict', 'Your list changed', { reason: 'bucket_changed', bucketSize: ids.length });
          }
          // submit_ranking_with_location saves both or neither, so the venue is checked before
          // anything is written.
          if (input.venueId) this.activeVenue(input.venueId);
          const next = insertIntoBucket(ids, bev.id, input.insertIndex);
          const at = this.nowIso();
          const row: FakeRanking = {
            id: this.nextId('rank'),
            userId: me.id,
            bevId: bev.id,
            bucket: input.bucket,
            position: 0,
            score: 0,
            note,
            createdAt: at,
            updatedAt: at,
          };
          this.db.rankings.push(row);
          this.writeBucket(me.id, input.bucket, next);
          this.db.wantToTry = this.db.wantToTry.filter((w) => !(w.userId === me.id && w.bevId === bev.id));
          if (input.venueId) this.putLocation(me.id, bev.id, input.venueId);
          const eventId = this.logPlacement(me, row.id, bev.id, input.comparisons, at, me.onboarded);
          // enqueue_push_on_post (T-31 Release 2): a NEW ranking ('ranked', never a re-rank) queues
          // a post push for everyone who asked for this person's posts. The trigger is on the feed
          // event, so a starter ranking, which has none, pushes nothing.
          if (eventId !== null) {
            for (const s of this.postSubscriptions) {
              if (s.targetId === me.id && s.subscriberId !== me.id) {
                this.pushOutbox.push({ kind: 'post', recipientId: s.subscriberId, actorId: me.id, feedEventId: eventId, commentId: null });
              }
            }
          }
          return { ranking: this.toRanking(row), bucketSize: next.length };
        },
        true,
      ),

    rerankBev: (input: SubmitRankingInput) =>
      this.call(
        'rankings.rerankBev',
        (): SubmitRankingResult => {
          const me = this.requireUser();
          const row = this.rankingOf(me.id, input.bevId) ?? fail('not_found', "You haven't ranked this Bev");
          const note = this.checkPlacement(input);
          const target = this.bucketIds(me.id, input.bucket).filter((id) => id !== row.bevId);
          if (target.length !== input.expectedBucketSize) {
            fail('conflict', 'Your list changed', { reason: 'bucket_changed', bucketSize: target.length });
          }
          if (input.venueId) this.activeVenue(input.venueId);
          const from = row.bucket;
          if (from !== input.bucket) this.writeBucket(me.id, from, this.bucketIds(me.id, from).filter((id) => id !== row.bevId));
          const next = insertIntoBucket(target, row.bevId, input.insertIndex);
          this.writeBucket(me.id, input.bucket, next);
          const at = this.nowIso();
          // `rerank_bev` deletes the row and re-inserts it, so the server's `ranked_at` -- the contract's
          // `createdAt` -- becomes the re-rank's time. Mutating in place here is fine, but the date has to
          // move with it, or the Recent sort and "Ranked Oct 3" behave one way in tests and another on prod.
          row.createdAt = at;
          row.updatedAt = at;
          if (note !== undefined) row.note = note;
          // Left out, the place is kept (it is keyed by user and Bev, not by this row); a venue
          // replaces it and null removes it.
          if (input.venueId !== undefined) this.putLocation(me.id, row.bevId, input.venueId);
          // On the server the re-rank deletes the ranking row, its old post cascades away, and the
          // notifications and queued pushes about that post go with it (T-31). The fake keeps the
          // old feed event, so it drops those two here.
          const oldPosts = new Set(this.db.feed.filter((e) => e.actorId === me.id && e.bevId === row.bevId).map((e) => e.id));
          this.notificationRows = this.notificationRows.filter((n) => !n.feedEventId || !oldPosts.has(n.feedEventId));
          this.pushOutbox = this.pushOutbox.filter((p) => !p.feedEventId || !oldPosts.has(p.feedEventId));
          this.logPlacement(me, row.id, row.bevId, input.comparisons, at);
          return { ranking: this.toRanking(row), bucketSize: next.length };
        },
        true,
      ),

    updateNote: (bevId: string, note: string) =>
      this.call(
        'rankings.updateNote',
        () => {
          const me = this.requireUser();
          const row = this.rankingOf(me.id, bevId) ?? fail('not_found', "You haven't ranked this Bev");
          const n = (note ?? '').trim();
          if (n.length > NOTE_MAX) invalid('note', `Notes are up to ${NOTE_MAX} characters`);
          row.note = n || null;
          row.updatedAt = this.nowIso();
        },
        true,
      ),

    removeRanking: (bevId: string) =>
      this.call(
        'rankings.removeRanking',
        () => {
          const me = this.requireUser();
          const row = this.rankingOf(me.id, bevId) ?? fail('not_found', "You haven't ranked this Bev");
          this.db.rankings = this.db.rankings.filter((r) => r !== row);
          this.writeBucket(me.id, row.bucket, this.bucketIds(me.id, row.bucket));
          // The place goes with the ranking (bev_locations_follow_ranking_delete).
          this.putLocation(me.id, row.bevId, null);
        },
        true,
      ),

    setVenue: (bevId: string, venueId: string | null) =>
      this.call(
        'rankings.setVenue',
        (): Venue | null => {
          const me = this.requireUser();
          const row = this.rankingOf(me.id, bevId) ?? fail('not_found', "You haven't ranked this Bev");
          return this.putLocation(me.id, row.bevId, venueId);
        },
        true,
      ),

    getVenue: (bevId: string) =>
      this.call('rankings.getVenue', (): Venue | null => {
        const me = this.requireUser();
        return this.rankingOf(me.id, bevId) ? this.venueOf(me.id, bevId) : null;
      }),

    locationSummary: () =>
      this.call('rankings.locationSummary', (): BevLocationSummary => {
        const me = this.requireUser();
        const mine = this.db.rankings.filter((r) => r.userId === me.id);
        const located = new Set(this.locationRows().filter((l) => l.userId === me.id).map((l) => l.bevId));
        return { rankedCount: mine.length, locatedCount: mine.filter((r) => located.has(r.bevId)).length };
      }),
  };

  // -------------------------------------------------------------------------
  // Want to Try, feed, leaderboard, recommendations, meta
  // -------------------------------------------------------------------------

  wantToTry: WantToTryApi = {
    list: (page?: PageParams) =>
      this.call('wantToTry.list', () => {
        const me = this.requireUser();
        const rows = this.db.wantToTry
          .filter((w) => w.userId === me.id)
          .sort((a, z) => z.savedAt.localeCompare(a.savedAt))
          .map((w) => {
            const via = w.viaUserId ? this.db.users.find((u) => u.id === w.viaUserId) : undefined;
            return { bev: this.toSummary(this.bev(w.bevId)), savedAt: w.savedAt, via: via ? this.toProfile(via, me) : null };
          });
        return paginate(rows, page, 50);
      }),

    add: (bevId: string, viaUserId?: string) =>
      this.call(
        'wantToTry.add',
        () => {
          const me = this.requireUser();
          const bev = this.bev(bevId);
          this.requireVisible(bev, me);
          if (this.db.wantToTry.some((w) => w.userId === me.id && w.bevId === bevId)) return;
          const via = viaUserId && viaUserId !== me.id && this.db.users.some((u) => u.id === viaUserId) ? viaUserId : null;
          const at = this.nowIso();
          this.db.wantToTry.push({ userId: me.id, bevId, savedAt: at, viaUserId: via });
        },
        true,
      ),

    remove: (bevId: string) =>
      this.call(
        'wantToTry.remove',
        () => {
          const me = this.requireUser();
          this.db.wantToTry = this.db.wantToTry.filter((w) => !(w.userId === me.id && w.bevId === bevId));
        },
        true,
      ),
  };

  /** Whose posts the caller may see (feed_event_visible): themselves and the users they follow. */
  private feedActors(me: FakeUser): Set<string> {
    return new Set([me.id, ...this.db.follows.filter((f) => f.followerId === me.id).map((f) => f.followeeId)]);
  }

  /**
   * feed_also_bevd: the people `me` follows, other than the post's actor (and never `me`), who
   * have ranked the Bev. All of them are counted; the first ALSO_BEVD_MAX are listed with their
   * own score and bucket, the most recently ranked first. A tie on the timestamp goes to the
   * ranking written later (its id's sequence number), for the reason `followedBy` gives.
   */
  private alsoBevd(me: FakeUser, actorId: string, bevId: string): Pick<FeedItem, 'alsoBevdBy' | 'alsoBevdCount'> {
    const written = (r: FakeRanking) => Number(r.id.split('-')[1]);
    const friends = this.db.rankings
      .filter(
        (r) => r.bevId === bevId && r.userId !== actorId && r.userId !== me.id && this.isFollowing(me.id, r.userId),
      )
      .sort((a, z) => z.createdAt.localeCompare(a.createdAt) || written(z) - written(a));
    return {
      alsoBevdBy: friends.slice(0, ALSO_BEVD_MAX).map(
        (r): FriendScore => ({ profile: this.toProfile(this.user(r.userId), me), score: r.score, bucket: r.bucket }),
      ),
      alsoBevdCount: friends.length,
    };
  }

  /** get_feed's rows for these actors, newest first, age-gated like the SQL. */
  private feedItems(me: FakeUser, actors: Set<string>): FeedItem[] {
    const saved = new Set(this.db.wantToTry.filter((w) => w.userId === me.id).map((w) => w.bevId));
    const likes = this.db.likes ?? [];
    const items: FeedItem[] = [];
    const events = this.db.feed
      .filter((e) => actors.has(e.actorId))
      .sort((a, z) => z.createdAt.localeCompare(a.createdAt) || Number(z.id.split('-')[1]) - Number(a.id.split('-')[1]));
    for (const e of events) {
      const actor = this.db.users.find((u) => u.id === e.actorId);
      const bev = this.db.bevs.find((b) => b.id === e.bevId);
      if (!actor || !bev || !this.visible(bev, me) || this.blockedBetween(me.id, actor.id)) continue;
      // The feed carries rankings only (contract 2.0.0): a save is never a post.
      const r = e.type === 'RANKING' ? this.rankingOf(e.actorId, e.bevId) : undefined;
      if (!r) continue; // ranking since removed
      items.push({
        id: e.id,
        type: e.type,
        actor: this.toProfile(actor, me),
        bev: this.toSummary(bev),
        score: r.score,
        bucket: r.bucket,
        note: r.note,
        createdAt: e.createdAt,
        inMyWantToTry: saved.has(bev.id),
        likeCount: likes.filter((l) => l.feedEventId === e.id).length,
        likedByMe: likes.some((l) => l.feedEventId === e.id && l.userId === me.id),
        commentCount: this.liveComments(e.id, me).length,
        // The first seven, oldest first, as get_feed returns them.
        comments: this.liveComments(e.id, me).slice(0, FEED_INLINE_COMMENTS).map((c) => this.toComment(c, me)),
        // Relative to the caller, whoever's page this is. The Bev is visible to `me` (checked
        // above), which is the only age gate the SQL applies to it too.
        ...this.alsoBevd(me, e.actorId, bev.id),
        venue: this.venueOf(e.actorId, bev.id),
      });
    }
    return items;
  }

  /**
   * get_explore's scope: the users up to two follows away, minus the caller and everyone the
   * caller already follows -- so an Explore post is always a stranger's, and never one the feed
   * has already shown. Below EXPLORE_GLOBAL_FALLBACK_USERS users the two-hop set would be empty
   * for almost everyone, so it widens to all users, with the same two exclusions (D-01).
   */
  private exploreAuthors(me: FakeUser): Set<string> {
    const following = (id: string) => this.db.follows.filter((f) => f.followerId === id).map((f) => f.followeeId);
    const direct = new Set(following(me.id));
    const twoHops = new Set(direct);
    for (const id of direct) for (const id2 of following(id)) twoHops.add(id2);
    const candidates =
      this.db.users.length < EXPLORE_GLOBAL_FALLBACK_USERS ? this.db.users.map((u) => u.id) : [...twoHops];
    return new Set(candidates.filter((id) => id !== me.id && !direct.has(id) && !this.blockedBetween(me.id, id)));
  }

  /**
   * get_explore's rows: hottest first (§10.4), age-gated like the feed, and with no like or
   * comment data at all -- an Explore post is read-only (D-15).
   */
  private explorePosts(me: FakeUser): ExplorePost[] {
    const authors = this.exploreAuthors(me);
    const saved = new Set(this.db.wantToTry.filter((w) => w.userId === me.id).map((w) => w.bevId));
    const likes = this.db.likes ?? [];
    const now = Date.parse(this.nowIso());
    const rows: { post: ExplorePost; hot: number; seq: number }[] = [];
    for (const e of this.db.feed) {
      if (!authors.has(e.actorId)) continue;
      const actor = this.db.users.find((u) => u.id === e.actorId);
      const bev = this.db.bevs.find((b) => b.id === e.bevId);
      if (!actor || !bev || !this.visible(bev, me)) continue;
      // Rankings only, as in the feed.
      const r = e.type === 'RANKING' ? this.rankingOf(e.actorId, e.bevId) : undefined;
      if (!r) continue;
      rows.push({
        // Like counts order the rows and never leave the server (D-15).
        hot: exploreHotness(
          likes.filter((l) => l.feedEventId === e.id).length,
          (now - Date.parse(e.createdAt)) / 3_600_000,
        ),
        seq: Number(e.id.split('-')[1]),
        post: {
          id: e.id,
          type: e.type,
          actor: this.toProfile(actor, me),
          bev: this.toSummary(bev),
          score: r.score,
          bucket: r.bucket,
          note: r.note,
          createdAt: e.createdAt,
          inMyWantToTry: saved.has(bev.id),
          venue: this.venueOf(e.actorId, bev.id),
        },
      });
    }
    // `hot desc, id desc`: the id keeps the order total, so paging cannot repeat a row.
    rows.sort((a, z) => z.hot - a.hot || z.seq - a.seq);
    return rows.map((x) => x.post);
  }

  feed: FeedApi = {
    getFeed: (page?: PageParams) =>
      this.call('feed.getFeed', () => {
        const me = this.requireUser();
        return paginate(this.feedItems(me, this.feedActors(me)), page, 20);
      }),

    listUser: (userId: string, page?: PageParams) =>
      this.call('feed.listUser', () => {
        const me = this.requireUser();
        this.visibleUser(userId, me);
        // feed_event_visible: only the caller's own and followed users' posts; anyone else's page is empty.
        const actors = this.feedActors(me).has(userId) ? new Set([userId]) : new Set<string>();
        return paginate(this.feedItems(me, actors), page, 20);
      }),

    // Popularity order, not time order, and read-only rows (D-15). Paging is by offset over that
    // order, as get_explore pages: the real one also freezes the clock in its cursor, which the
    // fake has no need of (its ordering only moves when a test moves it).
    getExplore: (page?: PageParams) =>
      this.call('feed.getExplore', () => {
        const me = this.requireUser();
        return paginate(this.explorePosts(me), page, 20);
      }),

    getFeatured: () =>
      this.call('feed.getFeatured', () => {
        const me = this.requireUser();
        const now = this.nowIso();
        return this.db.featured
          .filter((f) => f.startsAt <= now && (f.endsAt === null || f.endsAt > now))
          .map((f) => ({ f, b: this.db.bevs.find((b) => b.id === f.bevId) }))
          .filter((x): x is { f: (typeof x)['f']; b: FakeBev } => !!x.b && this.visible(x.b, me))
          .map(({ f, b }) => ({ bev: this.toSummary(b), heroImageUrl: f.heroImageUrl, tagline: f.tagline, startsAt: f.startsAt, endsAt: f.endsAt }));
      }),

    // As get_bev_of_period: among Bevs ranked in the period (New York day / ISO week), the best
    // current Bayesian score, then more rankings in the period, more raters, name, id. An empty
    // current period falls back to the latest one with a ranking.
    getBevOfPeriod: () =>
      this.call('feed.getBevOfPeriod', (): BevOfPeriod => {
        const me = this.requireUser();
        const now = this.nowIso();
        const { global, byBev } = this.aggregates();
        const m = globalPrior(global);
        const bevs = new Map(this.db.bevs.filter((b) => this.visible(b, me)).map((b) => [b.id, b]));
        const days = this.db.rankings
          .filter((r) => r.createdAt <= now && bevs.has(r.bevId))
          .map((r) => ({ bevId: r.bevId, day: localDayKey(r.createdAt, BEV_OF_PERIOD_ZONE) }));
        const today = localDayKey(now, BEV_OF_PERIOD_ZONE);

        const winner = (periodOf: (day: string) => string): PeriodWinner | null => {
          if (days.length === 0) return null;
          const start = days.map((r) => periodOf(r.day)).reduce((a, k) => (k > a ? k : a));
          const inPeriod = new Map<string, number>();
          for (const r of days) if (periodOf(r.day) === start) inPeriod.set(r.bevId, (inPeriod.get(r.bevId) ?? 0) + 1);
          const rows = [...inPeriod].map(([bevId, k]) => {
            const s = populationStats(byBev.get(bevId) ?? []);
            return { bevId, k, n: s.n, name: bevs.get(bevId)!.name, bayes: bayesianAverage(s.mean, s.n, { m, C: BAYES_C }) };
          });
          rows.sort(
            (a, z) => z.bayes - a.bayes || z.k - a.k || z.n - a.n || codePointOrder(a.name, z.name) || codePointOrder(a.bevId, z.bevId),
          );
          const w = rows[0]!;
          return {
            // The score it won with, set even below MIN_RATERS (toSummary would give null).
            bev: { ...this.toSummary(bevs.get(w.bevId)!), bayesScore: round2(w.bayes) },
            periodStart: start,
            rankingsInPeriod: w.k,
            isCurrent: start === periodOf(today),
          };
        };
        return { day: winner((d) => d), week: winner(isoWeekStart) };
      }),

    // get_post (T-31): the one post, exactly as this caller's feed would show it, or not_found when
    // it is gone or not theirs to see (feed_event_visible: own or followed, no block, the age gate).
    getPost: (id: string) =>
      this.call('feed.getPost', (): FeedItem => {
        const me = this.requireUser();
        const e = this.visibleFeedEvent(id, me);
        return this.feedItems(me, new Set([e.actorId])).find((item) => item.id === e.id) ?? fail('not_found', 'No such post');
      }),

    like: (id: string) =>
      this.call(
        'feed.like',
        () => {
          const me = this.requireUser();
          const e = this.visibleFeedEvent(id, me);
          const likes = (this.db.likes ??= []);
          if (!likes.some((l) => l.userId === me.id && l.feedEventId === id)) {
            likes.push({ userId: me.id, feedEventId: id });
            this.notify(e.actorId, me.id, 'like', id, null);
          }
        },
        true,
      ),

    unlike: (id: string) =>
      this.call(
        'feed.unlike',
        () => {
          const me = this.requireUser();
          const likes = this.db.likes ?? [];
          // Your own like can always be taken back, as in unlike_post (A-02).
          if (!likes.some((l) => l.userId === me.id && l.feedEventId === id)) {
            this.visibleFeedEvent(id, me);
            return;
          }
          this.db.likes = likes.filter((l) => !(l.userId === me.id && l.feedEventId === id));
        },
        true,
      ),
  };

  // Comments (S-03), as add_comment / delete_comment / get_comments do them (20261014000300).
  comments: CommentsApi = {
    list: (eventId: string, page?: PageParams) =>
      this.call('comments.list', () => {
        const me = this.requireUser();
        this.visibleFeedEvent(eventId, me);
        // Newest first, keyset-paged like get_comments (`p_before_id`): a comment added meanwhile
        // never shifts a later page.
        // get_comments and packages/api's MAX_LIMIT cap a page at 50.
        const limit = clamp(Math.floor(page?.limit ?? 20), 1, 50);
        let before = Infinity;
        if (page?.cursor) {
          const m = /^c:(\d+)$/.exec(page.cursor);
          if (!m) invalid('cursor', 'Malformed cursor');
          before = Number(m[1]);
        }
        const rows = this.liveComments(eventId, me)
          .reverse()
          .filter((c) => commentSeq(c) < before)
          .slice(0, limit);
        const last = rows[rows.length - 1];
        return {
          items: rows.map((c) => this.toComment(c, me)),
          nextCursor: rows.length === limit && last ? `c:${commentSeq(last)}` : null,
        };
      }),

    add: (eventId: string, body: string) =>
      this.call(
        'comments.add',
        () => {
          const me = this.requireUser();
          const e = this.visibleFeedEvent(eventId, me);
          // btrim(body, E' \t\n\r'), then 1–280 characters (code points, like char_length).
          const text = (body ?? '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
          const length = Array.from(text).length;
          if (length < 1 || length > COMMENT_MAX) invalid('body', `A comment is 1 to ${COMMENT_MAX} characters`);
          const row: FakeComment = { id: this.nextId('comment'), feedEventId: eventId, userId: me.id, body: text, createdAt: this.nowIso() };
          (this.db.comments ??= []).push(row);
          this.notify(e.actorId, me.id, 'comment', eventId, row.id);
          return this.toComment(row, me);
        },
        true,
      ),

    remove: (id: string) =>
      this.call(
        'comments.remove',
        () => {
          const me = this.requireUser();
          // Own comments only; removing one already removed is a no-op.
          const row = (this.db.comments ?? []).find((c) => c.id === id && c.userId === me.id);
          if (!row) fail('not_found', 'No such comment');
          row.deleted = true;
        },
        true,
      ),
  };

  leaderboard: LeaderboardApi = {
    bevs: (params = {}) =>
      this.call('leaderboard.bevs', () => {
        const me = this.requireUser();
        const { global, byBev, byCategory } = this.aggregates();
        const m = params.categoryId
          ? categoryPrior(populationStats(byCategory.get(params.categoryId) ?? []), global)
          : globalPrior(global);
        const bevs = this.db.bevs.filter((b) => this.visible(b, me) && (!params.categoryId || b.categoryId === params.categoryId));
        const input = bevs.map((b) => {
          const s = populationStats(byBev.get(b.id) ?? []);
          return { bevId: b.id, n: s.n, name: b.name, bayes: bayesianAverage(s.mean, s.n, { m, C: BAYES_C }) };
        });
        const byId = new Map(input.map((r) => [r.bevId, r]));
        const bevById = new Map(bevs.map((b) => [b.id, b]));
        const rows = leaderboardOrder(input).map((bevId, i) => {
          const r = byId.get(bevId)!;
          const bayesScore = round2(r.bayes);
          return {
            rank: i + 1,
            // On a category board the prior is the category's, so the row's score can differ from
            // the Bev's global score; the summary carries the board's score so the two agree.
            bev: { ...this.toSummary(bevById.get(bevId)!), bayesScore },
            bayesScore,
            ratingCount: r.n,
            myScore: this.rankingOf(me.id, bevId)?.score ?? null,
          };
        });
        return paginate(rows, params.page, 50);
      }),

    users: (page?: PageParams) =>
      this.call('leaderboard.users', () => {
        const me = this.requireUser();
        // get_user_leaderboard (IS-7): rows across a block drop out, and the others keep their global
        // rank rather than being renumbered.
        const rows = this.userBoard()
          .filter((r) => !this.blockedBetween(me.id, r.u.id))
          .map((r) => ({
          rank: r.rank,
          profile: this.toProfile(r.u, me),
          points: r.points,
          bevsRanked: r.bevsRanked,
          currentStreak: r.streak.current,
        }));
        return paginate(rows, page, 50);
      }),

    // get_friends_leaderboard: the caller and the people they follow, on the same board. Someone
    // with no rankings is Unranked there too, the caller included.
    friends: (page?: PageParams) =>
      this.call('leaderboard.friends', () => {
        const me = this.requireUser();
        const members = this.db.users.filter((u) => u.id === me.id || this.isFollowing(me.id, u.id));
        const rows = this.userBoard(members).map((r) => ({
          rank: r.rank,
          profile: this.toProfile(r.u, me),
          points: r.points,
          bevsRanked: r.bevsRanked,
          currentStreak: r.streak.current,
        }));
        return paginate(rows, page, 50);
      }),
  };

  recs: RecsApi = {
    // @bevi/ranking's recommend() over the snapshot, seeded with userId + ':' + the local day
    // (profile timezone) so the list is stable within a day (§8.11). The contract's reasons are
    // @bevi/ranking's RecommendationReason values, so they map one to one; the app owns the copy.
    getRecommendations: (params = {}) =>
      this.call('recs.getRecommendations', () => {
        const me = this.requireUser();
        const generatedAt = this.nowIso();
        const basedOnCount = this.db.rankings.filter((r) => r.userId === me.id).length;
        const base = { generatedAt, basedOnCount, rankingVersion: RANKING_VERSION };
        if (basedOnCount < MIN_N_USER) return { ...base, items: [] };
        const limit = clamp(Math.floor(params.limit ?? RECOMMEND_N), 1, 50);
        const seed = `${me.id}:${localDayKey(generatedAt, me.timezone)}`;
        const items: Recommendation[] = recommend(this.snapshot(), me.id, { n: limit, seed }).map((r) => ({
          bev: this.toSummary(this.bev(r.bevId)),
          predictedScore: round2(r.score),
          confidence: r.confidence,
          reason: r.reason,
          isExploration: r.isExploration,
          generatedAt,
        }));
        return { ...base, items };
      }),

    refresh: () =>
      this.call('recs.refresh', () => {
        this.requireUser();
      }),
  };

  /**
   * A-08 half 2. The three venue tables have RLS on with no policy in the real
   * backend, so `venues_in_view` / `venue_detail` / `venue_neighborhoods` are
   * the whole surface there -- and the age gate lives in them. These mirror
   * that: the gate is on the ASSORTMENT, so a venue whose every Bev is
   * alcoholic has nothing to show a minor and therefore no pin.
   */
  venues: VenuesApi = {
    inView: ({ bounds, zoom, filters }) =>
      this.call('venues.inView', () => {
        const me = this.requireUser();
        // Clamped to the city, not rejected: a map gesture routinely drags the
        // viewport past the coast, and the answer there is "what is inside".
        const south = Math.max(bounds.south, NYC_BOUNDS.south);
        const north = Math.min(bounds.north, NYC_BOUNDS.north);
        const west = Math.max(bounds.west, NYC_BOUNDS.west);
        const east = Math.min(bounds.east, NYC_BOUNDS.east);
        if (south >= north || west >= east) return [];

        const kinds = activeFilter(filters?.kinds);
        const neighborhoods = activeFilter(filters?.neighborhoods);
        const categoryIds = activeFilter(filters?.categoryIds);
        const priceTiers = activeFilter(filters?.priceTiers);

        const pins = this.venueRows()
          .filter((v) => !v.hidden)
          .filter((v) => v.lat >= south && v.lat <= north && v.lng >= west && v.lng <= east)
          .filter((v) => !kinds || kinds.includes(v.kind))
          .filter((v) => !neighborhoods || (v.neighborhood !== null && neighborhoods.includes(v.neighborhood)))
          .flatMap((v) => {
            const assortment = this.venueAssortment(v.id, me).filter(
              (b) =>
                (!categoryIds || categoryIds.includes(b.categoryId)) &&
                (!priceTiers || priceTiers.includes(b.priceTier)),
            );
            // D-13: no assortment, no pin.
            if (assortment.length === 0) return [];

            const scores = assortment.map((b) => this.bayes(b.id));
            const best = scores.filter((x): x is number => x !== null);
            // A prediction only fills the gap for a Bev with no Bayesian score
            // yet; it is not a second opinion on one that has it.
            const predictions = assortment
              .filter((b) => this.bayes(b.id) === null)
              .map((b) => this.predictionFor(b, me, false)?.score ?? null)
              .filter((x): x is number => x !== null);

            const pin: VenuePin = {
              venue: this.toVenue(v),
              bestScore: best.length > 0 ? Math.max(...best) : null,
              predictedScore: predictions.length > 0 ? round2(Math.max(...predictions)) : null,
              openNow: v.hoursKnown ? openAt(v.hoursOsm, this.now()) : null,
              bevCount: assortment.length,
            };
            return [pin];
          })
          .filter((pin) => !filters?.openNow || pin.openNow === true)
          // The cap keeps the best venues, with a deterministic tail.
          .sort(
            (a, b) =>
              (b.bestScore ?? -1) - (a.bestScore ?? -1) ||
              (b.predictedScore ?? -1) - (a.predictedScore ?? -1) ||
              b.bevCount - a.bevCount ||
              compareCodePoints(a.venue.name, b.venue.name) ||
              compareCodePoints(a.venue.id, b.venue.id),
          );

        return pins.slice(0, venuePinCap(zoom));
      }),

    get: (venueId) =>
      this.call('venues.get', () => {
        const me = this.requireUser();
        const v = this.venueRows().find((x) => x.id === venueId && !x.hidden);
        if (!v) fail('not_found', 'No such venue');
        const assortment = this.venueAssortment(v.id, me);
        // A venue whose whole assortment this caller may not see is not_found,
        // not an empty sheet: there was no pin to have tapped.
        if (assortment.length === 0) fail('not_found', 'No such venue');

        return {
          venue: this.toVenue(v),
          openNow: v.hoursKnown ? openAt(v.hoursOsm, this.now()) : null,
          bevs: assortment
            .slice()
            .sort(
              (a, b) =>
                (this.bayes(b.id) ?? -1) - (this.bayes(a.id) ?? -1) ||
                compareCodePoints(a.name, b.name) ||
                compareCodePoints(a.id, b.id),
            )
            .map((b) => this.toSummary(b)),
        };
      }),

    neighborhoods: () =>
      this.call('venues.neighborhoods', () => {
        const me = this.requireUser();
        // Only neighbourhoods with a PINNED venue, so the filter can never
        // offer an option that returns nothing.
        const names = new Set<string>();
        for (const v of this.venueRows()) {
          if (v.hidden || v.neighborhood === null) continue;
          if (this.venueAssortment(v.id, me).length > 0) names.add(v.neighborhood);
        }
        return [...names].sort(compareCodePoints);
      }),

    // BEV-22. As `venues_search`: no query answers "what is near", a query matches names in three
    // tiers (it starts a word of the name; every word is in the name, address or neighbourhood;
    // the name is merely similar), the nearest first within the first two.
    search: ({ query, near, limit }) =>
      this.call('venues.search', (): VenueMatch[] => {
        this.requireUser();
        if ((query ?? '').length > 80) invalid('query', 'Search for something shorter');
        const pos = near && Number.isFinite(near.lat) && Number.isFinite(near.lng) ? near : null;
        if (pos && (Math.abs(pos.lat) > 90 || Math.abs(pos.lng) > 180)) invalid('position', 'Not a position');
        const cap = Math.min(Math.max(limit ?? 20, 1), 50);
        const q = foldPlace(query ?? '');
        const tokens = q.split(' ');

        const rows = this.venueRows()
          .filter((v) => !v.hidden)
          .flatMap((v) => {
            const d = pos ? distanceMeters(pos, v) : null;
            if (!q) return pos ? [{ v, d, tier: 0, sim: 0 }] : [];
            const name = foldPlace(v.name);
            const hay = foldPlace(`${v.name} ${v.address ?? ''} ${v.neighborhood ?? ''}`);
            const sim = trigramSimilarity(name, q);
            const tier = ` ${name}`.includes(` ${q}`) ? 0 : tokens.every((t) => hay.includes(t)) ? 1 : 2;
            return tier < 2 || sim >= PLACE_SIMILARITY_MIN ? [{ v, d, tier, sim }] : [];
          })
          .sort(
            (a, z) =>
              a.tier - z.tier ||
              (a.tier === 2 ? z.sim - a.sim : 0) ||
              (a.d ?? Infinity) - (z.d ?? Infinity) ||
              z.sim - a.sim ||
              compareCodePoints(a.v.name, z.v.name) ||
              compareCodePoints(a.v.id, z.v.id),
          );
        return rows.slice(0, cap).map(({ v, d }) => ({ venue: this.toVenue(v), distanceMeters: d === null ? null : Math.round(d) }));
      }),

    // The outside directory is `db.externalPlaces`: a name match, the nearest first.
    searchMore: ({ query, near }) =>
      this.call('venues.searchMore', (): ExternalPlace[] => {
        this.requireUser();
        const q = foldPlace(query ?? '');
        if (!q) invalid('query', 'Type a place to search for');
        if (q.length > 80) invalid('query', 'Search for something shorter');
        const pos = near && Number.isFinite(near.lat) && Number.isFinite(near.lng) ? near : null;
        return (this.db.externalPlaces ?? [])
          .filter((p) => foldPlace(`${p.name} ${p.address ?? ''}`).includes(q))
          .map((p) => ({ ...p, distanceMeters: pos ? Math.round(distanceMeters(pos, p)) : null }))
          .sort((a, z) => (a.distanceMeters ?? Infinity) - (z.distanceMeters ?? Infinity) || compareCodePoints(a.name, z.name));
      }),

    // As `upsert_google_venue`: the venue already made from this place, else one of the same name
    // within 75 m, else a new one.
    addPlace: (placeId: string) =>
      this.call(
        'venues.addPlace',
        (): Venue => {
          this.requireUser();
          const place = (this.db.externalPlaces ?? []).find((p) => p.placeId === placeId) ?? fail('not_found', 'No such place');
          const venues = (this.db.venues ??= []);
          const id = `venue-ext-${place.placeId}`;
          const existing =
            venues.find((v) => v.id === id) ??
            venues.find((v) => foldPlace(v.name) === foldPlace(place.name) && distanceMeters(v, place) <= 75);
          if (existing) return existing.hidden ? fail('not_found', 'No such place') : this.toVenue(existing);
          const made: FakeVenue = {
            id,
            name: place.name,
            kind: 'craft',
            placeType: place.placeType,
            lat: place.lat,
            lng: place.lng,
            address: place.address,
            neighborhood: null,
            borough: null,
            hoursOsm: null,
            hoursKnown: false,
            website: null,
          };
          venues.push(made);
          return this.toVenue(made);
        },
        true,
      ),

    // As `recent_bev_venues`: the caller's own places by when each was set, newest first, each once.
    // `putLocation` appends, so the rows are already in the order they were set.
    recent: (params) =>
      this.call('venues.recent', (): Venue[] => {
        const me = this.requireUser();
        const limit = Math.min(Math.max(Math.trunc(params?.limit ?? 5), 1), 20);
        const seen = new Set<string>();
        const out: Venue[] = [];
        for (const row of [...this.locationRows()].reverse()) {
          if (row.userId !== me.id || seen.has(row.venueId)) continue;
          seen.add(row.venueId);
          const venue = this.venueRows().find((v) => v.id === row.venueId && !v.hidden);
          if (venue) out.push(this.toVenue(venue));
        }
        return out.slice(0, limit);
      }),

    // As `bevd_map`: one pin per venue, the most recent first.
    bevdMap: (params) =>
      this.call('venues.bevdMap', (): BevdPin[] => {
        const me = this.requireUser();
        const scope = params?.scope ?? 'all';
        if (!BEVD_SCOPES.includes(scope)) invalid('scope', 'Unknown scope');
        const pins = new Map<string, BevdPin>();
        for (const { ranking, venue } of this.scopedLocations(me, scope)) {
          const pin = pins.get(venue.id) ?? { venue: this.toVenue(venue), bevCount: 0, mineCount: 0, latestAt: ranking.createdAt };
          pin.bevCount += 1;
          if (ranking.userId === me.id) pin.mineCount += 1;
          if (ranking.createdAt > pin.latestAt) pin.latestAt = ranking.createdAt;
          pins.set(venue.id, pin);
        }
        return [...pins.values()].sort((a, z) => z.latestAt.localeCompare(a.latestAt) || compareCodePoints(a.venue.id, z.venue.id));
      }),

    // As `bevd_at_venue` plus packages/api's join: who had what there, the most recent first.
    bevdAt: (venueId, params) =>
      this.call('venues.bevdAt', (): BevdAtVenue => {
        const me = this.requireUser();
        const scope = params?.scope ?? 'all';
        if (!BEVD_SCOPES.includes(scope)) invalid('scope', 'Unknown scope');
        const venue = this.activeVenue(venueId);
        const items = this.scopedLocations(me, scope)
          .filter((x) => x.venue.id === venue.id)
          .sort((a, z) => z.ranking.createdAt.localeCompare(a.ranking.createdAt) || compareCodePoints(a.ranking.id, z.ranking.id))
          .map(({ ranking }): BevdHere => ({ user: this.toProfile(this.user(ranking.userId), me), ranking: this.toRanked(ranking) }));
        // Nothing in scope: there was no pin to have tapped.
        if (items.length === 0) fail('not_found', 'Nothing was had at this venue');
        return { venue: this.toVenue(venue), items };
      }),
  };

  // -------------------------------------------------------------------------
  // Bugs (the internal reporter). The board is mocked out entirely: the fake
  // mints `T-<n>` the way the board names a ticket, keeps the same
  // idempotency promise, and holds each ticket's state so the UI's success,
  // duplicate, validation, failure and My reports states are all reachable
  // without a tracker.
  // -------------------------------------------------------------------------

  bugs: BugsApi = {
    canReport: () =>
      this.call('bugs.canReport', () => (this.sessionUser() ? this.internalReporter : false)),

    canRank: () =>
      this.call('bugs.canRank', () => (this.sessionUser() ? this.internalReporter && this.bugRanker : false)),

    report: (input) =>
      this.call(
        'bugs.report',
        () => {
          const me = this.requireUser();
          if (!this.internalReporter) fail('unauthorized', 'This account cannot file internal bug reports');
          if (!input.title?.trim()) invalid('title', 'Say what went wrong');
          if (!BUG_KINDS.includes(input.kind)) invalid('kind', 'Say what kind of report this is');
          if (!BUG_SEVERITIES.includes(input.severity)) invalid('severity', 'Say how bad it is');
          if (!UUID_RE.test(input.idempotencyKey ?? '')) invalid('idempotencyKey', 'Missing submission key');
          const evidence = input.evidence ?? [];
          if (evidence.length > 3) invalid('evidence', 'Attach at most 3 screenshots');
          // More than six pointed-at components is not an error: packages/api sends the first six
          // and the function keeps the first six, so the fake (which stores none) has nothing to do.
          for (const item of evidence) {
            if (!BUG_EVIDENCE_MIME_TYPES.includes(item.mimeType)) invalid('evidence', 'Attach a JPEG, PNG or WebP image');
            // Contract 3.3.0: evidence is an UploadPayload, measured like media.upload's file.
            const fileBytes = item.file instanceof ArrayBuffer || ArrayBuffer.isView(item.file) ? item.file.byteLength : item.file?.size;
            if (typeof fileBytes === 'number' && fileBytes > UPLOAD_MAX_BYTES) {
              invalid('evidence', 'That screenshot is too large');
            }
          }

          const key = `${me.id}:${input.idempotencyKey}`;
          const seen = this.bugLedger.get(key);
          if (seen) return { ...seen.result, status: 'duplicate' as const };

          const ticketId = `T-${this.nextTicket++}`;
          const result: BugReportResult = {
            ticketId,
            ticketUrl: `https://board.example/?open=${ticketId}`,
            status: 'created',
          };
          const at = this.now().toISOString();
          const summary: BugReportSummary = {
            ticketId,
            ticketUrl: result.ticketUrl,
            title: input.title.trim(),
            kind: input.kind,
            severity: input.severity,
            createdAt: at,
            state: 'triage',
            stateLabel: 'New',
            priority: BUG_PRIORITY[input.severity],
            updatedAt: at,
            rank: null,
          };
          this.bugLedger.set(key, { userId: me.id, result, summary });
          this.bugOrder.set(me.id, [ticketId, ...(this.bugOrder.get(me.id) ?? [])]);
          return result;
        },
        // Not a `db` write: the ledger is the fake's own, and a bug report
        // changes nothing a screen reads.
        false,
      ),

    listMine: () =>
      this.call('bugs.listMine', () => {
        const me = this.requireUser();
        if (!this.internalReporter) fail('unauthorized', 'This account cannot file internal bug reports');
        return this.bugSummaries(me.id);
      }),

    markVerified: (ticketId) =>
      this.call(
        'bugs.markVerified',
        () => {
          const me = this.requireUser();
          if (!this.internalReporter) fail('unauthorized', 'This account cannot file internal bug reports');
          if (!BUG_TICKET_RE.test(ticketId?.trim() ?? '')) invalid('ticketId', 'That is not a ticket identifier');
          const entry = [...this.bugLedger.values()].find((e) => e.userId === me.id && e.summary.ticketId === ticketId.trim());
          if (!entry) fail('not_found', "That ticket isn't one of yours");
          // Only a ticket in review can be verified, for every caller, as the verify route checks.
          if (entry.summary.state !== 'in_review') {
            fail('conflict', "That report isn't waiting for your check", { reason: 'not_in_review' });
          }
          entry.summary = { ...entry.summary, state: 'done', stateLabel: 'Done', updatedAt: this.now().toISOString(), rank: null };
          return { ...entry.summary };
        },
        false,
      ),

    place: (ticketId, afterTicketId) =>
      this.call(
        'bugs.place',
        () => {
          const me = this.requireUser();
          // Validation before the role check, as packages/api/src/bugs.ts and the function order them.
          const id = ticketId?.trim() ?? '';
          if (!BUG_TICKET_RE.test(id)) invalid('ticketId', 'That is not a ticket identifier');
          const after = afterTicketId === null || afterTicketId === undefined ? null : afterTicketId.trim();
          if (after !== null && !BUG_TICKET_RE.test(after)) invalid('afterTicketId', 'That is not a ticket identifier');
          if (after === id) invalid('afterTicketId', 'A ticket cannot be placed after itself');
          if (!this.internalReporter) fail('unauthorized', 'This account cannot file internal bug reports');
          // Ranking is a founder's act: a tester is refused, as the place route's not_allowed is.
          if (!this.bugRanker) fail('unauthorized', 'This account cannot rank reports', { reason: 'not_allowed' });

          // Both must be the caller's own tickets (else not_found, which says nothing about anyone
          // else's), and both open (else conflict with reason 'not_open'), as the function checks.
          const mine = new Set(
            [...this.bugLedger.values()].filter((e) => e.userId === me.id).map((e) => e.summary.ticketId),
          );
          if (!mine.has(id) || (after !== null && !mine.has(after))) {
            fail('not_found', "That report isn't one of yours", { reason: 'not_found' });
          }
          const open = this.openBugOrder(me.id);
          if (!open.includes(id) || (after !== null && !open.includes(after))) {
            fail('conflict', "That report isn't open any more", { reason: 'not_open' });
          }

          const others = open.filter((t) => t !== id);
          const index = after === null ? 0 : others.indexOf(after) + 1;
          const entry = [...this.bugLedger.values()].find((e) => e.userId === me.id && e.summary.ticketId === id)!;
          entry.summary = {
            ...entry.summary,
            priority: bugPriorityForRank(index, open.length, entry.summary.priority),
            updatedAt: this.now().toISOString(),
          };

          // Rewrite the full order: the moving ticket goes directly below `after` (or above every
          // open ticket); closed ones keep their slots, since they carry no rank.
          const full = (this.bugOrder.get(me.id) ?? []).filter((t) => t !== id);
          const anchor = after === null ? (others[0] ?? null) : after;
          const at = anchor === null ? 0 : full.indexOf(anchor) + (after === null ? 0 : 1);
          full.splice(at, 0, id);
          this.bugOrder.set(me.id, full);
          return this.bugSummaries(me.id);
        },
        false,
      ),
  };

  // -------------------------------------------------------------------------
  // Blocks and content reports (IS-7), as block_user / unblock_user / list_blocked_users /
  // report_content do them (20261118220000). No rate limits, as elsewhere in the fake.
  // -------------------------------------------------------------------------

  blocks: BlocksApi = {
    block: (userId: string) =>
      this.call(
        'blocks.block',
        () => {
          const me = this.requireUser();
          if (userId === me.id) invalid('cannot block self', "You can't block yourself");
          this.user(userId);
          if (!this.blockRows.some((b) => b.blockerId === me.id && b.blockedId === userId)) {
            this.blockRows.push({ blockerId: me.id, blockedId: userId, createdAt: this.nowIso() });
          }
          // Both follow edges go, and unblocking never brings them back.
          this.db.follows = this.db.follows.filter(
            (f) => !(f.followerId === me.id && f.followeeId === userId) && !(f.followerId === userId && f.followeeId === me.id),
          );
          this.dropPostSubscription(me.id, userId);
          this.dropPostSubscription(userId, me.id);
        },
        true,
      ),

    unblock: (userId: string) =>
      this.call(
        'blocks.unblock',
        () => {
          const me = this.requireUser();
          // Only the caller's own block; a block made against them is untouched (and unseen).
          this.blockRows = this.blockRows.filter((b) => !(b.blockerId === me.id && b.blockedId === userId));
        },
        true,
      ),

    list: (page?: PageParams) =>
      this.call('blocks.list', () => {
        const me = this.requireUser();
        // One direction only: the people the caller blocked, newest first, then by id.
        const rows = this.blockRows
          .map((b, written) => ({ b, written }))
          .filter(({ b }) => b.blockerId === me.id)
          .sort((a, z) => z.b.createdAt.localeCompare(a.b.createdAt) || z.written - a.written)
          .flatMap(({ b }): BlockedUser[] => {
            const u = this.db.users.find((x) => x.id === b.blockedId);
            return u ? [{ ...this.toProfile(u, me), birthdate: null, canSeeAlcohol: false, blockedAt: b.createdAt }] : [];
          });
        return paginate(rows, page, 50);
      }),
  };

  reports: ReportsApi = {
    report: (input: ReportContentInput) =>
      this.call(
        'reports.report',
        (): ReportContentResult => {
          const me = this.requireUser();
          if (!REPORT_REASONS.includes(input.reason)) invalid('reason', 'Unknown reason');
          // btrim(note, E' \t\n\r'); blank is no note; at most REPORT_NOTE_MAX code points.
          const note = (input.note ?? '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '') || null;
          if (note && Array.from(note).length > REPORT_NOTE_MAX) invalid('note', `A note is at most ${REPORT_NOTE_MAX} characters`);

          // Anything the caller can be shown (20261119100000), or by someone the caller blocked (one
          // direction: so Block then Report works, and a blocked person cannot probe the blocker's
          // content -- every "shown" rule below is false across a block either way).
          const iBlocked = (userId: string) => this.blockRows.some((b) => b.blockerId === me.id && b.blockedId === userId);
          const feedShows = (eventId: string) => {
            try {
              this.visibleFeedEvent(eventId, me);
              return true;
            } catch (e) {
              if (e instanceof ApiError && e.code === 'not_found') return false;
              throw e;
            }
          };
          let subject: string;
          if (input.kind === 'post') {
            const e = this.db.feed.find((x) => x.id === input.id) ?? fail('not_found', 'No such post');
            // The feed's rule (feed, a profile's posts), or Explore's: the same rows getExplore
            // returns. Neither has a recency bound in the fake, matching the SQL's choice.
            const shown = feedShows(e.id) || this.explorePosts(me).some((p) => p.id === e.id);
            if (!iBlocked(e.actorId) && !shown) fail('not_found', 'No such post');
            subject = e.actorId;
          } else if (input.kind === 'comment') {
            const c = (this.db.comments ?? []).find((x) => x.id === input.id && !x.deleted) ?? fail('not_found', 'No such comment');
            // Comments are never in Explore (D-15): a visible post, and an author not across a block.
            const shown = feedShows(c.feedEventId) && !this.blockedBetween(me.id, c.userId);
            if (!iBlocked(c.userId) && !shown) fail('not_found', 'No such comment');
            subject = c.userId;
          } else if (input.kind === 'profile') {
            subject = this.user(input.id).id;
          } else {
            invalid('target', 'Unknown report kind');
          }
          if (subject === me.id) invalid('cannot report own content', "You can't report yourself");

          // One report per (reporter, content): a repeat answers with the first one's id.
          const existing = this.contentReports.find((r) => r.reporterId === me.id && r.kind === input.kind && r.targetId === input.id);
          if (existing) return { reportId: existing.id };
          const id = String(this.nextContentReport++);
          this.contentReports.push({
            id,
            reporterId: me.id,
            kind: input.kind,
            targetId: input.id,
            reportedUserId: subject,
            reason: input.reason,
            note,
            createdAt: this.nowIso(),
          });
          return { reportId: id };
        },
        true,
      ),
  };

  // The notifications inbox (T-31), as get_notifications / get_unread_notification_count /
  // mark_notifications_read answer it (20261126000100). One set of rules (visibleNotifications)
  // behind all three, so the list, the badge and mark-read never disagree.
  notifications: NotificationsApi = {
    list: (page?: PageParams) =>
      this.call('notifications.list', (): Page<Notification> => {
        const me = this.requireUser();
        // Keyset on the row's id (its newest notification), like get_notifications' p_before_id.
        const limit = clamp(Math.floor(page?.limit ?? 20), 1, NOTIFICATIONS_PAGE_MAX);
        let before = Infinity;
        if (page?.cursor) {
          const m = /^n:(\d+)$/.exec(page.cursor);
          if (!m) invalid('cursor', 'Malformed cursor');
          before = Number(m[1]);
        }
        const rows = this.notificationGroups(me)
          .filter((g) => g.head.id < before)
          .slice(0, limit);
        const last = rows[rows.length - 1];
        return {
          items: rows.map((g) => this.toNotification(g, me)),
          nextCursor: rows.length === limit && last ? `n:${last.head.id}` : null,
        };
      }),

    unreadCount: () =>
      this.call('notifications.unreadCount', () => {
        const me = this.requireUser();
        // A row of likes counts once, as it is one row on the screen.
        return this.notificationGroups(me).filter((g) => g.members.some((m) => m.readAt === null)).length;
      }),

    markRead: (upToId?: string) =>
      this.call(
        'notifications.markRead',
        () => {
          const me = this.requireUser();
          if (upToId !== undefined && !NOTIFICATION_ID_RE.test(upToId)) invalid('upToId', 'That is not a notification id');
          const upTo = upToId === undefined ? Infinity : Number(upToId);
          const at = this.nowIso();
          // Only what the caller could have been shown: a hidden row comes back unread.
          for (const n of this.visibleNotifications(me)) if (n.readAt === null && n.id <= upTo) n.readAt = at;
        },
        true,
      ),

    // T-31 Release 2 (20261127000100): push settings, post subscriptions, device tokens.
    getSettings: () =>
      this.call('notifications.getSettings', () => this.notificationSettingsOf(this.requireUser().id)),

    updateSettings: (settings: NotificationSettings) =>
      this.call(
        'notifications.updateSettings',
        (): NotificationSettings => {
          const me = this.requireUser();
          for (const field of NOTIFICATION_SETTING_FIELDS) {
            if (typeof settings?.[field] !== 'boolean') invalid(field, `${field} must be true or false`);
          }
          const stored: NotificationSettings = {
            paused: settings.paused,
            follows: settings.follows,
            likes: settings.likes,
            comments: settings.comments,
            posts: settings.posts,
          };
          this.notificationSettingsRows.set(me.id, stored);
          return { ...stored };
        },
        true,
      ),

    // get_post_notification_people: the people the caller follows, none across a block, chosen
    // first, then by handle in code-point order; `q` a case-insensitive substring of the handle or
    // the display name, a leading '@' ignored.
    listPostNotificationPeople: (params?: PageParams & { q?: string }) =>
      this.call('notifications.listPostNotificationPeople', (): Page<PostNotificationPerson> => {
        const me = this.requireUser();
        const raw = (params?.q ?? '').trim();
        if (raw.length > POST_PEOPLE_QUERY_MAX) invalid('q', `Search is up to ${POST_PEOPLE_QUERY_MAX} characters`);
        const q = raw.replace(/^@+/, '').toLowerCase();
        const subscribed = (id: string) => this.postSubscriptions.some((s) => s.subscriberId === me.id && s.targetId === id);
        const rows = this.db.follows
          .filter((f) => f.followerId === me.id && !this.blockedBetween(me.id, f.followeeId))
          .flatMap((f) => {
            const u = this.db.users.find((x) => x.id === f.followeeId);
            return u ? [u] : [];
          })
          .filter((u) => !q || u.handle.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))
          .map((u): PostNotificationPerson => ({ ...this.toRow(u, me), subscribed: subscribed(u.id) }))
          .sort(
            (a, z) => Number(z.subscribed) - Number(a.subscribed) || compareCodePoints(a.handle, z.handle) || compareCodePoints(a.id, z.id),
          );
        // packages/api asks for clampLimit's default, 20.
        return paginate(rows, params, 20);
      }),

    setPostNotification: (userId: string, on: boolean) =>
      this.call(
        'notifications.setPostNotification',
        () => {
          const me = this.requireUser();
          if (!on) {
            this.dropPostSubscription(me.id, userId);
            return;
          }
          // No follow edge is always "not following": someone missing, yourself, and someone across
          // a block (a block removes the follow) read the same, so the answer reveals no block.
          if (!this.isFollowing(me.id, userId)) invalid('not following', 'You can only choose people you follow');
          // Only a follow standing beside a block is left, which no API path creates.
          this.visibleUser(userId, me);
          if (!this.postSubscriptions.some((s) => s.subscriberId === me.id && s.targetId === userId)) {
            this.postSubscriptions.push({ subscriberId: me.id, targetId: userId });
          }
        },
        true,
      ),

    registerPushToken: (token: string) =>
      this.call(
        'notifications.registerPushToken',
        () => {
          const me = this.requireUser();
          if (typeof token !== 'string' || token.length > PUSH_TOKEN_MAX || !PUSH_TOKEN_RE.test(token)) {
            invalid('token', 'That is not an Expo push token');
          }
          // One device, one account: a token someone else registered moves to the caller.
          this.pushTokenRows = this.pushTokenRows.filter((t) => t.token !== token);
          this.pushTokenRows.push({ token, userId: me.id, seen: ++this.pushSeq });
          // This one and the nine others seen most recently.
          const keep = new Set(this.pushTokens(me.id).slice(0, PUSH_TOKENS_PER_USER));
          this.pushTokenRows = this.pushTokenRows.filter((t) => t.userId !== me.id || keep.has(t.token));
        },
        true,
      ),

    unregisterPushToken: (token: string) =>
      this.call(
        'notifications.unregisterPushToken',
        () => {
          const me = this.requireUser();
          // Only the caller's own; anything else is a no-op.
          this.pushTokenRows = this.pushTokenRows.filter((t) => !(t.token === token && t.userId === me.id));
        },
        true,
      ),
  };

  meta: MetaApi = {
    // Signed out too, like the server's: no session check.
    getAppConfig: () => this.call('meta.getAppConfig', () => this.appConfig),
  };
}
