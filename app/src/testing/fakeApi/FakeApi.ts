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
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  type ApiErrorCode,
  type AuthApi,
  type Bev,
  type BeviApi,
  type BevOfPeriod,
  type BevPrediction,
  type BevsApi,
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
  type LeaderboardApi,
  type MediaApi,
  type MetaApi,
  type Page,
  type PageParams,
  type PeriodWinner,
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
  type Session,
  type SignInInput,
  type SignUpInput,
  type StatsApi,
  type TasteProfileRow,
  type SubmitRankingInput,
  type SubmitRankingResult,
  type UpdateMeInput,
  type WantToTryApi,
} from '@bevi/shared';

import {
  clearDb,
  clone,
  loadDb,
  saveDb,
  type FakeBev,
  type FakeComment,
  type FakeDb,
  type FakeFeedEvent,
  type FakeRanking,
  type FakeUser,
  type StorageLike,
} from './db';
import { ALCOHOLIC, CATEGORIES, buildFixtures, isAdult } from './fixtures';
import { buildEdgeMirror, type EdgeMirror } from './graph';
import { FAKE_INVITE_CODE } from './people';

/** Password rule: at least this many characters (`validation`, field 'password'). */
export const FAKE_MIN_PASSWORD_LENGTH = 8;
export const NOTE_MAX = 140;
const NAME_MAX = 80;
const DISPLAY_NAME_MAX = 50;
const REPORT_REASON_MAX = 500;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Default time the fake's "background removal" takes before a bev photo is 'ready'. */
const PHOTO_PROCESSING_MS = 3000;

/** Writes that only change the session; they leave seeded fixtures "clean" (see FakeDb.dirty). */
const SESSION_ONLY_METHODS = new Set(['signIn', 'signOut']);

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
}

function fail(code: ApiErrorCode, message: string, detail?: unknown): never {
  throw new ApiError(code, message, detail);
}

function invalid(field: string, message: string, reason?: string): never {
  return fail('validation', message, reason ? { field, reason } : { field });
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

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
  private db: FakeDb;
  private readonly storage: StorageLike | null;
  private readonly clock: () => Date;
  private readonly photoProcessingMs: number;
  private latency: readonly [number, number];
  private readonly listeners = new Set<(session: Session | null) => void>();
  private failures: { code: ApiErrorCode; method?: string }[] = [];
  private agg: Aggregates | null = null;
  /** ./graph.ts's mirror, keyed on the Bev table it was built from (see `edges()`). */
  private edgeCache: { source: FakeBev[]; size: number; mirror: EdgeMirror } | null = null;

  constructor(options: FakeApiOptions = {}) {
    this.storage = options.storage ?? null;
    this.clock = options.now ?? (() => new Date());
    this.photoProcessingMs = options.photoProcessingMs ?? PHOTO_PROCESSING_MS;
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
    this.commit();
    this.emit();
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
   * re-rank, kept on removal), so re-ranks count and removals don't break a streak (§8.14).
   */
  private streakOf(u: FakeUser): UserStreak {
    const stamps = [
      ...this.db.rankings.filter((r) => r.userId === u.id).map((r) => r.createdAt),
      ...this.db.feed.filter((e) => e.actorId === u.id && e.type === 'RANKING').map((e) => e.createdAt),
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

  private bayes(bevId: string): number | null {
    const { global, byBev } = this.aggregates();
    const scores = byBev.get(bevId) ?? [];
    if (!isLeaderboardEligible(scores.length)) return null;
    const s = populationStats(scores);
    return round2(bayesianAverage(s.mean, s.n, { m: globalPrior(global), C: BAYES_C }));
  }

  private toSummary(b: FakeBev): BevSummary {
    const photo = this.assetUrlAndStatus(b.photoAssetId);
    return {
      id: b.id,
      name: b.name,
      brand: b.brand,
      flavor: b.flavor,
      categoryId: b.categoryId,
      photoUrl: photo.url,
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
    return { ...this.toRanking(r), bev: this.toSummary(this.bev(r.bevId)) };
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

  /** "Rank on Bevi": @bevi/ranking's rankUsers (which drops Unranked users) in display order. */
  private userBoard() {
    const inputs = this.db.users.map((u) => ({
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
    db.comparisons = db.comparisons.filter((c) => c.userId !== userId);
    db.follows = db.follows.filter((f) => f.followerId !== userId && f.followeeId !== userId);
    db.wantToTry = db.wantToTry
      .filter((w) => w.userId !== userId)
      .map((w) => (w.viaUserId === userId ? { ...w, viaUserId: null } : w));
    db.feed = db.feed.filter((e) => e.actorId !== userId);
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
      this.visible(bev, viewer);
    return sees ? e! : fail('not_found', 'No such post');
  }

  /** A post's comments that aren't deleted, oldest first. */
  private liveComments(eventId: string): FakeComment[] {
    return (this.db.comments ?? []).filter((c) => c.feedEventId === eventId && !c.deleted).sort((a, z) => commentSeq(a) - commentSeq(z));
  }

  private toComment(c: FakeComment, viewer: FakeUser): Comment {
    return { id: c.id, author: this.toProfile(this.user(c.userId), viewer), body: c.body, createdAt: c.createdAt };
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
        return this.toRow(this.user(id), me);
      }),

    searchUsers: (params) =>
      this.call('profile.searchUsers', () => {
        const me = this.requireUser();
        const q = norm(params.q).replace(/^@/, '');
        const rows = this.db.users
          .filter((u) => u.id !== me.id && (!q || u.handle.includes(q) || norm(u.displayName).includes(q)))
          .sort((a, z) => Number(z.handle.startsWith(q)) - Number(a.handle.startsWith(q)) || a.handle.localeCompare(z.handle))
          .map((u) => this.toRow(u, me));
        return paginate(rows, params, 25);
      }),
  };

  stats: StatsApi = {
    getMine: () => this.call('stats.getMine', () => this.statsFor(this.requireUser())),
    getUser: (id: string) =>
      this.call('stats.getUser', () => {
        this.requireUser();
        return this.statsFor(this.user(id));
      }),
    getCategoryProgress: () => this.call('stats.getCategoryProgress', () => this.categoryProgress(this.requireUser())),
    getTasteProfile: (userId: string) =>
      this.call('stats.getTasteProfile', () => this.tasteProfile(this.requireUser(), this.user(userId))),
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
          if (!this.isFollowing(me.id, id)) this.db.follows.push({ followerId: me.id, followeeId: id, createdAt: this.nowIso() });
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
        },
        true,
      ),

    listFollowers: (id: string, page?: PageParams) =>
      this.call('follows.listFollowers', () => {
        const me = this.requireUser();
        this.user(id);
        const rows = this.db.follows
          .filter((f) => f.followeeId === id)
          .sort((a, z) => z.createdAt.localeCompare(a.createdAt))
          .map((f) => this.toRow(this.user(f.followerId), me));
        return paginate(rows, page, 50);
      }),

    listFollowing: (id: string, page?: PageParams) =>
      this.call('follows.listFollowing', () => {
        const me = this.requireUser();
        this.user(id);
        const rows = this.db.follows
          .filter((f) => f.followerId === id)
          .sort((a, z) => z.createdAt.localeCompare(a.createdAt))
          .map((f) => this.toRow(this.user(f.followeeId), me));
        return paginate(rows, page, 50);
      }),

    suggested: () =>
      this.call('follows.suggested', () => {
        const me = this.requireUser();
        const count = (id: string) => this.db.rankings.filter((r) => r.userId === id).length;
        return this.db.users
          .filter((u) => u.id !== me.id && !this.isFollowing(me.id, u.id))
          .sort((a, z) => count(z.id) - count(a.id) || a.handle.localeCompare(z.handle))
          .slice(0, 10)
          .map((u) => this.toRow(u, me));
      }),
  };

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
            const catHit = input.categoryId && input.categoryId === b.categoryId ? 0.1 : 0;
            return { b, s: jaccard + nameHit + catHit };
          })
          .filter((x) => x.s >= 0.3)
          .sort((a, z) => z.s - a.s || a.b.name.localeCompare(z.b.name))
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
          const photo = this.db.assets.find((a) => a.id === input.photoAssetId && a.userId === me.id && a.kind === 'bev-photo');
          if (!photo) invalid('photoAssetId', 'Upload a photo first', 'unknown_asset');
          if (this.assetUrlAndStatus(photo.id).status !== 'ready') {
            invalid('photoAssetId', 'The photo is still processing', 'asset_not_ready');
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
            priceTier: input.priceTier ?? this.estimateTier(input.categoryId),
            priceEstimated: input.priceTier === null ? true : input.priceEstimated,
            isStarter: false,
            aliases: [],
            photoAssetId: photo.id,
            labelAssetId: input.labelAssetId ?? null,
            createdById: me.id,
            createdAt: this.nowIso(),
          };
          this.db.bevs.push(bev);
          this.agg = null;
          return this.toBev(bev, me);
        },
        true,
      ),

    report: (id: string, reason: string) =>
      this.call(
        'bevs.report',
        () => {
          const me = this.requireUser();
          this.bev(id);
          const r = (reason ?? '').trim();
          if (!r || r.length > REPORT_REASON_MAX) invalid('reason', 'Choose a reason', 'unknown_reason');
          this.db.reports.push({ bevId: id, userId: me.id, reason: r, createdAt: this.nowIso() });
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

  media: MediaApi = {
    upload: (input) =>
      this.call(
        'media.upload',
        () => {
          const me = this.requireUser();
          if (!UPLOAD_MIME_TYPES.includes(input.mimeType)) invalid('mimeType', 'Use a JPEG, PNG, WebP or HEIC image');
          if (typeof input.file?.size === 'number' && input.file.size > UPLOAD_MAX_BYTES) invalid('file', 'That image is too large');
          const id = this.nextId('asset');
          let url = `fake-asset://${id}`;
          try {
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') url = URL.createObjectURL(input.file);
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

  private logPlacement(me: FakeUser, rankingId: string, bevId: string, comparisons: readonly Comparison[], at: string) {
    for (const c of comparisons) {
      this.db.comparisons.push({ rankingId, userId: me.id, winnerBevId: c.winnerBevId, loserBevId: c.loserBevId, tie: !!c.tie, createdAt: at });
    }
    this.db.feed.push({ id: this.nextId('feed'), type: 'RANKING', actorId: me.id, bevId, createdAt: at });
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
        const rows = this.db.rankings
          .filter((r) => r.userId === id && this.visible(this.bev(r.bevId), me))
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
          this.logPlacement(me, row.id, bev.id, input.comparisons, at);
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
          const from = row.bucket;
          if (from !== input.bucket) this.writeBucket(me.id, from, this.bucketIds(me.id, from).filter((id) => id !== row.bevId));
          const next = insertIntoBucket(target, row.bevId, input.insertIndex);
          this.writeBucket(me.id, input.bucket, next);
          const at = this.nowIso();
          row.updatedAt = at;
          if (note !== undefined) row.note = note;
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
        },
        true,
      ),
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
      if (!actor || !bev || !this.visible(bev, me)) continue;
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
        commentCount: this.liveComments(e.id).length,
        // The first seven, oldest first, as get_feed returns them.
        comments: this.liveComments(e.id).slice(0, FEED_INLINE_COMMENTS).map((c) => this.toComment(c, me)),
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
    return new Set(candidates.filter((id) => id !== me.id && !direct.has(id)));
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
        this.user(userId);
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

    like: (id: string) =>
      this.call(
        'feed.like',
        () => {
          const me = this.requireUser();
          this.visibleFeedEvent(id, me);
          const likes = (this.db.likes ??= []);
          if (!likes.some((l) => l.userId === me.id && l.feedEventId === id)) likes.push({ userId: me.id, feedEventId: id });
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
        const rows = this.liveComments(eventId)
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
          this.visibleFeedEvent(eventId, me);
          // btrim(body, E' \t\n\r'), then 1–280 characters (code points, like char_length).
          const text = (body ?? '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
          const length = Array.from(text).length;
          if (length < 1 || length > COMMENT_MAX) invalid('body', `A comment is 1 to ${COMMENT_MAX} characters`);
          const row: FakeComment = { id: this.nextId('comment'), feedEventId: eventId, userId: me.id, body: text, createdAt: this.nowIso() };
          (this.db.comments ??= []).push(row);
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
        const rows = this.userBoard().map((r) => ({
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

  meta: MetaApi = {
    getAppConfig: () => this.call('meta.getAppConfig', () => ({ minAppVersion: '0.1.0', maintenance: false })),
  };
}
