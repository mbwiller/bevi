// MockApi: an in-memory `BeviApi` that behaves like the real server, for building screens before
// packages/api exists. MOCK ONLY: nothing outside app/src/api/mock/ imports this except
// app/src/api/client.ts. It runs @bevi/ranking for real (placement validity, respacing, stats,
// the Bayesian leaderboard, MIN_N_USER gating), so the UI sees the same scores and errors
// (`conflict`, `validation`, `age_restricted`…) it will see in production. It does no ranking
// maths of its own: predictions are null, streaks 0, and recommendations / the user board are
// plain orderings until @bevi/ranking exports them (TODO(rank/predict-streaks)).
//
// Mock invite code: `bevi-dev`. Demo account: `demo` / `demo1234` (friends: `jules`, `priya_k`,
// `sam`, `maya`, `theo` (under 21), `nina`, all with password `password123`).

import {
  BAYES_C,
  BUCKET_ORDER,
  MIN_N_USER,
  RANKING_VERSION,
  bayesianAverage,
  categoryPrior,
  globalPrior,
  insertIntoBucket,
  isLeaderboardEligible,
  leaderboardOrder,
  populationStats,
  respaceBucket,
  type Stats,
} from '@bevi/ranking';
import {
  ApiError,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  type ApiErrorCode,
  type AuthApi,
  type Bev,
  type BeviApi,
  type BevsApi,
  type BevSummary,
  type Bucket,
  type CategoriesApi,
  type CategoryId,
  type CheckHandleResult,
  type Comparison,
  type FeedApi,
  type FeedItem,
  type FollowsApi,
  type LeaderboardApi,
  type MediaApi,
  type MetaApi,
  type Page,
  type PageParams,
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
  webStorage,
  type MockBev,
  type MockDb,
  type MockRanking,
  type MockUser,
  type StorageLike,
} from './db';
import { ALCOHOLIC, CATEGORIES, buildFixtures, isAdult } from './fixtures';

/** The shared invite code the mock accepts on sign-up. */
export const MOCK_INVITE_CODE = 'bevi-dev';
/** Mock password rule: at least this many characters (`validation`, field 'password'). */
export const MOCK_MIN_PASSWORD_LENGTH = 8;
export const NOTE_MAX = 140;
const NAME_MAX = 80;
const DISPLAY_NAME_MAX = 50;
const REPORT_REASON_MAX = 500;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Default time the mock's "background removal" takes before a bev photo is 'ready'. */
const PHOTO_PROCESSING_MS = 3000;

export type Latency = number | readonly [min: number, max: number];

export interface MockApiOptions {
  /** Persistence. Defaults to `localStorage` on web; `null` = memory only. */
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
}

export class MockApi implements BeviApi {
  private db: MockDb;
  private readonly storage: StorageLike | null;
  private readonly clock: () => Date;
  private readonly photoProcessingMs: number;
  private latency: readonly [number, number];
  private readonly listeners = new Set<(session: Session | null) => void>();
  private failures: { code: ApiErrorCode; method?: string }[] = [];
  private agg: Aggregates | null = null;

  constructor(options: MockApiOptions = {}) {
    this.storage = options.storage === undefined ? webStorage() : options.storage;
    this.clock = options.now ?? (() => new Date());
    this.photoProcessingMs = options.photoProcessingMs ?? PHOTO_PROCESSING_MS;
    this.latency = MockApi.toRange(options.latency ?? [200, 600]);
    this.db = loadDb(this.storage) ?? buildFixtures(this.clock());
    saveDb(this.storage, this.db);
  }

  // -------------------------------------------------------------------------
  // Dev controls (not part of BeviApi; exposed through mock/controls.ts)
  // -------------------------------------------------------------------------

  /** The next call (to `method`, e.g. 'rankings.submitRanking', or to any method) rejects with `code`. */
  failNext(code: ApiErrorCode, method?: string): void {
    this.failures.push({ code, method });
  }

  setLatency(latency: Latency): void {
    this.latency = MockApi.toRange(latency);
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
    this.commit();
  }

  /** Sign in as any mock user without a password (dev convenience). */
  signInAs(handle: string): void {
    const user = this.db.users.find((u) => u.handle === handle);
    if (!user) throw new Error(`signInAs: no mock user @${handle}`);
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
      fail(f!.code, `Mock failure on ${method} (failNext)`);
    }
    const result = fn();
    if (write) this.commit();
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

  private sessionUser(): MockUser | null {
    const id = this.db.sessionUserId;
    return id ? (this.db.users.find((u) => u.id === id) ?? null) : null;
  }

  private currentSession(): Session | null {
    const u = this.sessionUser();
    return u ? { userId: u.id, handle: u.handle } : null;
  }

  private requireUser(): MockUser {
    return this.sessionUser() ?? fail('unauthorized', 'Not signed in');
  }

  private user(id: string): MockUser {
    return this.db.users.find((u) => u.id === id) ?? fail('not_found', 'No such user');
  }

  private bev(id: string): MockBev {
    return this.db.bevs.find((b) => b.id === id) ?? fail('not_found', 'No such Bev');
  }

  private canSeeAlcohol(u: MockUser): boolean {
    return isAdult(u.birthdate, this.now());
  }

  private visible(b: MockBev, viewer: MockUser): boolean {
    return !ALCOHOLIC.has(b.categoryId) || this.canSeeAlcohol(viewer);
  }

  private requireVisible(b: MockBev, viewer: MockUser): void {
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

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toProfile(u: MockUser, viewer: MockUser | null): Profile {
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

  private toRow(u: MockUser, viewer: MockUser): ProfileRow {
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

  private toSummary(b: MockBev): BevSummary {
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

  private rankingOf(userId: string, bevId: string): MockRanking | undefined {
    return this.db.rankings.find((r) => r.userId === userId && r.bevId === bevId);
  }

  private toRanking(r: MockRanking): Ranking {
    const { id, userId, bevId, bucket, position, score, note, createdAt, updatedAt } = r;
    return { id, userId, bevId, bucket, position, score, note, createdAt, updatedAt };
  }

  private toRanked(r: MockRanking): RankedBev {
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

  private toBev(b: MockBev, viewer: MockUser): Bev {
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
      // TODO(rank/predict-streaks): call @bevi/ranking's predictScore once it lands; no maths here.
      prediction: null,
      inWantToTry: this.db.wantToTry.some((w) => w.userId === viewer.id && w.bevId === b.id),
      friends: this.db.rankings
        .filter((r) => r.bevId === b.id && followed.has(r.userId))
        .map((r) => ({ profile: this.toProfile(this.user(r.userId), viewer), score: r.score, bucket: r.bucket })),
      isStarter: b.isStarter,
    };
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  // TODO(rank/predict-streaks): call @bevi/ranking's computeStreak / rankPoints / rankUsers once they
  // land. Until then the mock does no maths: streaks are 0, points are the ranking count, and the
  // user board is simply ordered by ranking count (then handle).
  private userBoard() {
    const count = (id: string) => this.db.rankings.filter((r) => r.userId === id).length;
    return this.db.users
      .map((u) => ({ u, bevsRanked: count(u.id) }))
      .filter((r) => r.bevsRanked > 0)
      .sort((a, z) => z.bevsRanked - a.bevsRanked || a.u.handle.localeCompare(z.u.handle))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  private statsFor(u: MockUser): ProfileStats {
    const bevsRanked = this.db.rankings.filter((r) => r.userId === u.id).length;
    const board = this.userBoard().find((r) => r.u.id === u.id);
    return {
      followers: this.db.follows.filter((f) => f.followeeId === u.id).length,
      following: this.db.follows.filter((f) => f.followerId === u.id).length,
      bevdCount: bevsRanked,
      wantToTryCount: this.db.wantToTry.filter((w) => w.userId === u.id).length,
      rankOnBevi: board ? board.rank : null,
      rankPoints: bevsRanked, // TODO(rank/predict-streaks): rankPoints from @bevi/ranking
      currentStreak: 0, // TODO(rank/predict-streaks): computeStreak from @bevi/ranking
      longestStreak: 0,
      streakAliveToday: false,
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
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  signUp: AuthApi['signUp'] = (input: SignUpInput) =>
    this.call(
      'signUp',
      () => {
        if ((input.inviteCode ?? '').trim() !== MOCK_INVITE_CODE) invalid('inviteCode', 'That invite code is not valid');
        const username = input.username ?? '';
        if (!HANDLE_PATTERN.test(username)) {
          invalid('username', 'Use 3–20 lowercase letters, numbers or _', 'invalid');
        }
        if (RESERVED_HANDLES.includes(username)) invalid('username', 'That username is reserved', 'reserved');
        if ((input.password ?? '').length < MOCK_MIN_PASSWORD_LENGTH) {
          invalid('password', `Use at least ${MOCK_MIN_PASSWORD_LENGTH} characters`, 'weak');
        }
        if (this.db.users.some((u) => u.handle === username)) fail('conflict', 'That username is taken');
        const user: MockUser = {
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
          const handleChanged = patch.handle !== undefined && patch.handle !== me.handle;
          if (handleChanged) {
            const problem = this.handleProblem(patch.handle!, me.id);
            if (problem === 'taken') fail('conflict', 'That username is taken');
            if (problem) invalid('handle', problem === 'reserved' ? 'That username is reserved' : 'Use 3–20 lowercase letters, numbers or _', problem);
            me.handle = patch.handle!;
          }
          me.displayName = displayName;
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
  };

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
        return CATEGORIES.filter((c) => adult || !c.isAlcoholic)
          .map(({ id, name, sortOrder, isAlcoholic }) => ({ id, name, sortOrder, isAlcoholic }))
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
          const bev: MockBev = {
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
            mockOnly: true,
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

    getStarterCandidates: () =>
      this.call('bevs.getStarterCandidates', () => {
        const me = this.requireUser();
        return this.db.bevs.filter((b) => b.isStarter && this.visible(b, me)).map((b) => this.toSummary(b));
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
          let url = `mock-asset://${id}`;
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

  private logPlacement(me: MockUser, rankingId: string, bevId: string, comparisons: readonly Comparison[], at: string) {
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
          const row: MockRanking = {
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
          this.db.feed.push({ id: this.nextId('feed'), type: 'SAVED', actorId: me.id, bevId, createdAt: at });
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

  feed: FeedApi = {
    getFeed: (page?: PageParams) =>
      this.call('feed.getFeed', () => {
        const me = this.requireUser();
        const actors = new Set([me.id, ...this.db.follows.filter((f) => f.followerId === me.id).map((f) => f.followeeId)]);
        const saved = new Set(this.db.wantToTry.filter((w) => w.userId === me.id).map((w) => w.bevId));
        const items: FeedItem[] = [];
        const events = this.db.feed
          .filter((e) => actors.has(e.actorId))
          .sort((a, z) => z.createdAt.localeCompare(a.createdAt) || Number(z.id.split('-')[1]) - Number(a.id.split('-')[1]));
        for (const e of events) {
          const actor = this.db.users.find((u) => u.id === e.actorId);
          const bev = this.db.bevs.find((b) => b.id === e.bevId);
          if (!actor || !bev) continue;
          const r = e.type === 'RANKING' ? this.rankingOf(e.actorId, e.bevId) : undefined;
          if (e.type === 'RANKING' && !r) continue; // ranking since removed
          items.push({
            id: e.id,
            type: e.type,
            actor: this.toProfile(actor, me),
            bev: this.toSummary(bev),
            score: r?.score ?? null,
            bucket: r?.bucket ?? null,
            note: r?.note ?? null,
            createdAt: e.createdAt,
            inMyWantToTry: saved.has(bev.id),
          });
        }
        return paginate(items, page, 20);
      }),

    getFeatured: () =>
      this.call('feed.getFeatured', () => {
        const me = this.requireUser();
        const now = this.nowIso();
        return this.db.featured
          .filter((f) => f.startsAt <= now && (f.endsAt === null || f.endsAt > now))
          .map((f) => ({ f, b: this.db.bevs.find((b) => b.id === f.bevId) }))
          .filter((x): x is { f: (typeof x)['f']; b: MockBev } => !!x.b && this.visible(x.b, me))
          .map(({ f, b }) => ({ bev: this.toSummary(b), heroImageUrl: f.heroImageUrl, tagline: f.tagline, startsAt: f.startsAt, endsAt: f.endsAt }));
      }),
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
          points: r.bevsRanked, // TODO(rank/predict-streaks): rankPoints
          bevsRanked: r.bevsRanked,
          currentStreak: 0, // TODO(rank/predict-streaks): computeStreak
        }));
        return paginate(rows, page, 50);
      }),
  };

  recs: RecsApi = {
    // TODO(rank/predict-streaks): call @bevi/ranking's recommend() once it lands. Until then a plain,
    // formula-free list: unranked Bevs in categories the user has ranked, then other unranked Bevs,
    // each ordered by their existing Bayesian score; predictedScore = that score, confidence 0
    // (the UI shows a locked bubble), no exploration slots.
    getRecommendations: (params = {}) =>
      this.call('recs.getRecommendations', () => {
        const me = this.requireUser();
        const generatedAt = this.nowIso();
        const mine = this.db.rankings.filter((r) => r.userId === me.id);
        const base = { generatedAt, basedOnCount: mine.length, rankingVersion: RANKING_VERSION };
        if (mine.length < MIN_N_USER) return { ...base, items: [] };
        const limit = clamp(Math.floor(params.limit ?? 20), 1, 50);
        const ranked = new Set(mine.map((r) => r.bevId));
        const catOf = new Map(this.db.bevs.map((b) => [b.id, b.categoryId]));
        const triedCats = new Set(mine.map((r) => catOf.get(r.bevId)));
        const candidates = this.db.bevs
          .filter((b) => !ranked.has(b.id) && this.visible(b, me))
          .map((b) => ({ b, summary: this.toSummary(b) }))
          .filter((x): x is { b: MockBev; summary: BevSummary & { bayesScore: number } } => x.summary.bayesScore !== null)
          .sort(
            (a, z) =>
              Number(triedCats.has(z.b.categoryId)) - Number(triedCats.has(a.b.categoryId)) ||
              z.summary.bayesScore - a.summary.bayesScore ||
              a.b.name.localeCompare(z.b.name),
          );
        const items: Recommendation[] = candidates.slice(0, limit).map(({ b, summary }) => ({
          bev: summary,
          predictedScore: summary.bayesScore,
          confidence: 0,
          reason: triedCats.has(b.categoryId) ? 'CATEGORY' : 'POPULAR',
          isExploration: false,
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
