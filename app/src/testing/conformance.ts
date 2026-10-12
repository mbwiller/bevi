// A conformance suite for any `BeviApi` implementation: every method's happy path and the error
// codes its contract doc comment documents (shared/src/api.ts). The mock runs it in
// mock/__tests__/conformance.test.ts; packages/api can run the same suite against a real backend:
//
//   runConformance(() => createBeviApi({ ... }), { inviteCode: process.env.INVITE_CODE!, alcoholicBevId: '...' });
//
// It only relies on what the contract promises, never on mock fixtures: it creates its own users
// (unique usernames) and finds Bevs through `getStarterCandidates` (≥ 30 promised). Uses Jest globals.

import { BANDS, MIN_N_USER, MIN_RATERS } from '@bevi/ranking';
import {
  ApiError,
  BUCKET_ORDER,
  isApiError,
  type ApiErrorCode,
  type BeviApi,
  type Bucket,
  type Session,
} from '@bevi/shared';

export interface ConformanceOptions {
  /** The shared invite code the implementation accepts. */
  inviteCode: string;
  /** Id of a Bev in an alcoholic category (for `age_restricted`). */
  alcoholicBevId: string;
  /** Unique usernames matching HANDLE_PATTERN. Default: 'c' + timestamp/counter. */
  makeUsername?: () => string;
  /** A password the implementation accepts. Default 'conformance-pass-1'. */
  password?: string;
  /**
   * Resolves once an uploaded bev photo is ready (`bevs.create` rejects a processing one with
   * 'validation'). Default: no wait (the implementation under test finishes processing instantly).
   */
  waitForAsset?: (assetId: string) => Promise<void>;
  /**
   * Check streaks (a ranking today → currentStreak 1). Default true (the mock runs with it on).
   */
  checkStreaks?: boolean;
}

const MINOR_BIRTHDATE = (now: Date) => `${now.getUTCFullYear() - 15}-01-01`;
const ADULT_BIRTHDATE = '1990-05-05';

async function expectCode(p: Promise<unknown>, code: ApiErrorCode): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(isApiError(e)).toBe(true);
    expect((e as ApiError).code).toBe(code);
    return e as ApiError;
  }
  throw new Error(`expected ApiError '${code}', but the call resolved`);
}

export function runConformance(makeApi: () => BeviApi | Promise<BeviApi>, options: ConformanceOptions): void {
  let counter = 0;
  const makeUsername =
    options.makeUsername ?? (() => `c${Date.now().toString(36).slice(-8)}${(counter++).toString(36)}`.slice(0, 20));
  const password = options.password ?? 'conformance-pass-1';
  const waitForAsset = options.waitForAsset ?? (async () => undefined);
  const checkStreaks = options.checkStreaks ?? true;

  let api: BeviApi;
  beforeEach(async () => {
    api = await makeApi();
  });

  /** Signs up a fresh user (and signs in as them). */
  async function newUser(opts: { birthdate?: string | null } = {}): Promise<Session & { password: string }> {
    const username = makeUsername();
    const session = await api.signUp({ username, password, inviteCode: options.inviteCode });
    const birthdate = opts.birthdate === undefined ? ADULT_BIRTHDATE : opts.birthdate;
    if (birthdate) await api.profile.setBirthDate(birthdate);
    return { ...session, password };
  }

  async function signInAs(user: Session & { password: string }) {
    await api.signOut();
    await api.signIn({ username: user.handle, password: user.password });
  }

  async function starterIds(n: number): Promise<string[]> {
    const candidates = await api.bevs.getStarterCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(n);
    return candidates.slice(0, n).map((b) => b.id);
  }

  /** Ranks `bevId` at the bottom of `bucket`. */
  async function rankAtBottom(bevId: string, bucket: Bucket = 'LOVED', note?: string) {
    const ids = await api.rankings.listBucket(bucket);
    return api.rankings.submitRanking({
      bevId,
      bucket,
      insertIndex: ids.length,
      expectedBucketSize: ids.length,
      comparisons: ids.length ? [{ winnerBevId: ids[ids.length - 1]!, loserBevId: bevId, tie: false }] : [],
      note,
    });
  }

  describe('meta and signed-out access', () => {
    it('getAppConfig works signed out', async () => {
      const config = await api.meta.getAppConfig();
      expect(typeof config.minAppVersion).toBe('string');
      expect(typeof config.maintenance).toBe('boolean');
    });

    it('getSession is null signed out, and other reads throw unauthorized', async () => {
      await api.signOut();
      expect(await api.getSession()).toBeNull();
      await expectCode(api.profile.getMe(), 'unauthorized');
      await expectCode(api.feed.getFeed(), 'unauthorized');
      await expectCode(api.rankings.listMine(), 'unauthorized');
      await expectCode(api.categories.list(), 'unauthorized');
      await expectCode(api.deleteAccount(), 'unauthorized');
    });

    it('checkHandle works signed out: invalid, reserved, taken, available', async () => {
      const user = await newUser();
      await api.signOut();
      expect(await api.profile.checkHandle('No Caps!')).toEqual({ available: false, reason: 'invalid' });
      expect(await api.profile.checkHandle('ab')).toMatchObject({ available: false, reason: 'invalid' });
      expect(await api.profile.checkHandle('admin')).toEqual({ available: false, reason: 'reserved' });
      expect(await api.profile.checkHandle(user.handle)).toEqual({ available: false, reason: 'taken' });
      expect(await api.profile.checkHandle(makeUsername())).toEqual({ available: true });
    });
  });

  describe('auth', () => {
    it('signUp creates the profile (handle = username) and signs in', async () => {
      const username = makeUsername();
      const session = await api.signUp({ username, password, inviteCode: options.inviteCode });
      expect(session.handle).toBe(username);
      expect(await api.getSession()).toEqual(session);
      const me = await api.profile.getMe();
      expect(me).toMatchObject({ id: session.userId, handle: username, birthdate: null, canSeeAlcohol: false, onboarded: false });
    });

    it('signUp rejects a wrong invite code with validation (field inviteCode)', async () => {
      const e = await expectCode(api.signUp({ username: makeUsername(), password, inviteCode: 'nope' }), 'validation');
      expect(e.detail).toMatchObject({ field: 'inviteCode' });
    });

    it('signUp rejects malformed and reserved usernames and weak passwords with validation', async () => {
      const bad = await expectCode(api.signUp({ username: 'Bad Name', password, inviteCode: options.inviteCode }), 'validation');
      expect(bad.detail).toMatchObject({ field: 'username' });
      const reserved = await expectCode(api.signUp({ username: 'admin', password, inviteCode: options.inviteCode }), 'validation');
      expect(reserved.detail).toMatchObject({ field: 'username' });
      const weak = await expectCode(api.signUp({ username: makeUsername(), password: '1', inviteCode: options.inviteCode }), 'validation');
      expect(weak.detail).toMatchObject({ field: 'password' });
    });

    it('signUp with a taken username is a conflict', async () => {
      const user = await newUser();
      await api.signOut();
      await expectCode(api.signUp({ username: user.handle, password, inviteCode: options.inviteCode }), 'conflict');
    });

    it('signIn: wrong password or unknown user is unauthorized; right credentials sign in', async () => {
      const user = await newUser();
      await api.signOut();
      await expectCode(api.signIn({ username: user.handle, password: 'wrong-password' }), 'unauthorized');
      await expectCode(api.signIn({ username: makeUsername(), password }), 'unauthorized');
      const session = await api.signIn({ username: user.handle, password });
      expect(session).toEqual({ userId: user.userId, handle: user.handle });
    });

    it('onAuthChange fires on sign-in and sign-out, and unsubscribes', async () => {
      const user = await newUser();
      await api.signOut();
      const events: (Session | null)[] = [];
      const unsubscribe = api.onAuthChange((s) => events.push(s));
      await api.signIn({ username: user.handle, password });
      await api.signOut();
      unsubscribe();
      await api.signIn({ username: user.handle, password });
      expect(events).toEqual([{ userId: user.userId, handle: user.handle }, null]);
    });

    it('deleteAccount removes the user, signs out and fires onAuthChange(null)', async () => {
      const user = await newUser();
      const events: (Session | null)[] = [];
      const unsubscribe = api.onAuthChange((s) => events.push(s));
      await api.deleteAccount();
      unsubscribe();
      expect(events).toEqual([null]);
      expect(await api.getSession()).toBeNull();
      await expectCode(api.signIn({ username: user.handle, password }), 'unauthorized');
      const other = await newUser();
      await expectCode(api.profile.getUser(user.userId), 'not_found');
      expect(other.userId).not.toBe(user.userId);
    });
  });

  describe('profile', () => {
    it('updateMe patches display name, timezone, onboarded and handle', async () => {
      await newUser();
      const handle = makeUsername();
      const me = await api.profile.updateMe({ displayName: '  Pat Doe ', timezone: 'America/Chicago', onboarded: true, handle });
      expect(me).toMatchObject({ displayName: 'Pat Doe', timezone: 'America/Chicago', onboarded: true, handle });
      expect((await api.getSession())?.handle).toBe(handle);
    });

    it('updateMe: validation for empty name, unknown timezone, malformed handle; conflict for a taken handle', async () => {
      const first = await newUser();
      await newUser();
      expect((await expectCode(api.profile.updateMe({ displayName: '  ' }), 'validation')).detail).toMatchObject({ field: 'displayName' });
      expect((await expectCode(api.profile.updateMe({ timezone: 'Mars/Olympus' }), 'validation')).detail).toMatchObject({ field: 'timezone' });
      expect((await expectCode(api.profile.updateMe({ handle: 'Nope!' }), 'validation')).detail).toMatchObject({ field: 'handle' });
      await expectCode(api.profile.updateMe({ handle: first.handle }), 'conflict');
    });

    it('setBirthDate sets canSeeAlcohol once; a second call is validation', async () => {
      await newUser({ birthdate: null });
      const me = await api.profile.setBirthDate(ADULT_BIRTHDATE);
      expect(me).toMatchObject({ birthdate: ADULT_BIRTHDATE, canSeeAlcohol: true });
      await expectCode(api.profile.setBirthDate('1991-01-01'), 'validation');
    });

    it('setBirthDate: under 21 is allowed; malformed and future dates are validation', async () => {
      await newUser({ birthdate: null });
      await expectCode(api.profile.setBirthDate('1990-13-45'), 'validation');
      await expectCode(api.profile.setBirthDate('05/05/1990'), 'validation');
      await expectCode(api.profile.setBirthDate(`${new Date().getUTCFullYear() + 1}-01-01`), 'validation');
      const me = await api.profile.setBirthDate(MINOR_BIRTHDATE(new Date()));
      expect(me.canSeeAlcohol).toBe(false);
    });

    it('getUser returns a row (other users hide birthdate); unknown id is not_found', async () => {
      const a = await newUser();
      await newUser();
      const row = await api.profile.getUser(a.userId);
      expect(row).toMatchObject({ id: a.userId, handle: a.handle, isFollowing: false, birthdate: null });
      await expectCode(api.profile.getUser('no-such-user'), 'not_found');
    });

    it('searchUsers matches by handle (with or without @)', async () => {
      const a = await newUser();
      await newUser();
      const page = await api.profile.searchUsers({ q: `@${a.handle}` });
      expect(page.items.map((u) => u.id)).toContain(a.userId);
      expect(page).toHaveProperty('nextCursor');
    });
  });

  describe('follows and stats', () => {
    it('follow is idempotent; unfollow is idempotent; lists and isFollowing agree', async () => {
      const a = await newUser();
      const b = await newUser();
      await api.follows.follow(a.userId);
      await api.follows.follow(a.userId);
      expect((await api.profile.getUser(a.userId)).isFollowing).toBe(true);
      const following = await api.follows.listFollowing(b.userId);
      expect(following.items.filter((u) => u.id === a.userId)).toHaveLength(1);
      const followers = await api.follows.listFollowers(a.userId);
      expect(followers.items.map((u) => u.id)).toEqual([b.userId]);
      expect((await api.stats.getUser(a.userId)).followers).toBe(1);
      expect((await api.stats.getMine()).following).toBe(1);
      await api.follows.unfollow(a.userId);
      await api.follows.unfollow(a.userId);
      expect((await api.profile.getUser(a.userId)).isFollowing).toBe(false);
      expect((await api.follows.listFollowers(a.userId)).items).toEqual([]);
    });

    it('follow: yourself is validation, unknown user is not_found', async () => {
      const me = await newUser();
      await expectCode(api.follows.follow(me.userId), 'validation');
      await expectCode(api.follows.follow('no-such-user'), 'not_found');
      await expectCode(api.follows.unfollow('no-such-user'), 'not_found');
      await expectCode(api.follows.listFollowers('no-such-user'), 'not_found');
      await expectCode(api.follows.listFollowing('no-such-user'), 'not_found');
    });

    it('suggested excludes yourself and people you follow', async () => {
      const a = await newUser();
      const me = await newUser();
      await api.follows.follow(a.userId);
      const ids = (await api.follows.suggested()).map((u) => u.id);
      expect(ids).not.toContain(me.userId);
      expect(ids).not.toContain(a.userId);
    });

    it('stats for a new user are zero; getUser of an unknown id is not_found', async () => {
      await newUser();
      expect(await api.stats.getMine()).toMatchObject({
        followers: 0, following: 0, bevdCount: 0, wantToTryCount: 0, rankOnBevi: null, currentStreak: 0,
      });
      await expectCode(api.stats.getUser('no-such-user'), 'not_found');
    });

    it('ranking today counts as Bev\'d, puts you on the board and starts a streak', async () => {
      await newUser();
      const [id] = await starterIds(1);
      await rankAtBottom(id!);
      const stats = await api.stats.getMine();
      expect(stats.bevdCount).toBe(1);
      if (checkStreaks) expect(stats).toMatchObject({ currentStreak: 1, streakAliveToday: true });
      expect(stats.rankOnBevi).not.toBeNull();
      expect(stats.rankPoints).toBeGreaterThan(0);
    });
  });

  describe('categories and age gating', () => {
    it('categories hide alcoholic ones until 21+', async () => {
      await newUser({ birthdate: MINOR_BIRTHDATE(new Date()) });
      const minor = await api.categories.list();
      expect(minor.length).toBeGreaterThan(0);
      expect(minor.some((c) => c.isAlcoholic)).toBe(false);
      await newUser({ birthdate: ADULT_BIRTHDATE });
      expect((await api.categories.list()).some((c) => c.isAlcoholic)).toBe(true);
    });

    it('an alcoholic Bev is age_restricted for minors (get, rank, save) and visible to adults', async () => {
      await newUser({ birthdate: MINOR_BIRTHDATE(new Date()) });
      await expectCode(api.bevs.get(options.alcoholicBevId), 'age_restricted');
      await expectCode(api.wantToTry.add(options.alcoholicBevId), 'age_restricted');
      await expectCode(
        api.rankings.submitRanking({ bevId: options.alcoholicBevId, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [] }),
        'age_restricted',
      );
      const starters = await api.bevs.getStarterCandidates();
      expect(starters.map((b) => b.id)).not.toContain(options.alcoholicBevId);
      const minorCats = new Set((await api.categories.list()).map((c) => c.id));
      for (const f of await api.feed.getFeatured()) expect(minorCats.has(f.bev.categoryId)).toBe(true);

      await newUser({ birthdate: ADULT_BIRTHDATE });
      expect((await api.bevs.get(options.alcoholicBevId)).id).toBe(options.alcoholicBevId);
    });

    it('a user without a birthdate cannot see alcohol', async () => {
      await newUser({ birthdate: null });
      await expectCode(api.bevs.get(options.alcoholicBevId), 'age_restricted');
    });
  });

  describe('bevs', () => {
    it('getStarterCandidates returns ≥ 30 Bevs with ratingCount', async () => {
      await newUser({ birthdate: MINOR_BIRTHDATE(new Date()) });
      const candidates = await api.bevs.getStarterCandidates();
      expect(candidates.length).toBeGreaterThanOrEqual(30);
      for (const b of candidates) expect(typeof b.ratingCount).toBe('number');
    });

    it('search finds a Bev by name and filters by category', async () => {
      await newUser();
      const [bev] = await api.bevs.getStarterCandidates();
      const page = await api.bevs.search({ q: bev!.name, limit: 10 });
      expect(page.items.map((b) => b.id)).toContain(bev!.id);
      const filtered = await api.bevs.search({ q: bev!.name, categoryId: bev!.categoryId });
      for (const b of filtered.items) expect(b.categoryId).toBe(bev!.categoryId);
    });

    it('get returns detail; unknown id is not_found', async () => {
      await newUser();
      const [id] = await starterIds(1);
      const bev = await api.bevs.get(id!);
      expect(bev).toMatchObject({ id, myRanking: null, inWantToTry: false, prediction: null });
      expect(Array.isArray(bev.friends)).toBe(true);
      await expectCode(api.bevs.get('no-such-bev'), 'not_found');
    });

    it('findLikelyDuplicates returns at most 5 likely matches', async () => {
      await newUser();
      const [bev] = await api.bevs.getStarterCandidates();
      const dups = await api.bevs.findLikelyDuplicates({ name: bev!.name, brand: bev!.brand ?? undefined });
      expect(dups.length).toBeLessThanOrEqual(5);
      expect(dups.map((b) => b.id)).toContain(bev!.id);
    });

    it('media.upload accepts images and rejects other types with validation', async () => {
      await newUser();
      const file = new Blob(['img'], { type: 'image/jpeg' });
      const up = await api.media.upload({ kind: 'bev-photo', file, mimeType: 'image/jpeg' });
      expect(typeof up.assetId).toBe('string');
      expect(typeof up.url).toBe('string');
      expect(['processing', 'ready']).toContain(up.status);
      await expectCode(api.media.upload({ kind: 'label', file, mimeType: 'application/pdf' }), 'validation');
    });

    it('create makes a Bev (estimating "not sure" prices); an exact duplicate is a conflict with existingBevId', async () => {
      const me = await newUser();
      const file = new Blob(['img'], { type: 'image/png' });
      const photo = await api.media.upload({ kind: 'bev-photo', file, mimeType: 'image/png' });
      await waitForAsset(photo.assetId);
      const name = `Conformance Fizz ${makeUsername()}`;
      const input = { name, brand: 'Test Co', flavor: 'Yuzu', categoryId: 'soda' as const, priceTier: null, priceEstimated: true, photoAssetId: photo.assetId };
      const bev = await api.bevs.create(input);
      expect(bev).toMatchObject({ name, brand: 'Test Co', flavor: 'Yuzu', categoryId: 'soda', priceEstimated: true, createdBy: { id: me.userId } });
      expect([1, 2, 3, 4]).toContain(bev.priceTier);
      const e = await expectCode(api.bevs.create({ ...input, name: name.toUpperCase(), brand: 'test co' }), 'conflict');
      expect(e.detail).toMatchObject({ existingBevId: bev.id });
    });

    it('create: unknown asset is validation; alcoholic category for a minor is age_restricted', async () => {
      await newUser({ birthdate: MINOR_BIRTHDATE(new Date()) });
      const base = { name: `Thing ${makeUsername()}`, categoryId: 'soda' as const, priceTier: 2 as const, priceEstimated: false };
      const e = await expectCode(api.bevs.create({ ...base, photoAssetId: 'no-such-asset' }), 'validation');
      expect(e.detail).toMatchObject({ field: 'photoAssetId' });
      const photo = await api.media.upload({ kind: 'bev-photo', file: new Blob(['x']), mimeType: 'image/jpeg' });
      await waitForAsset(photo.assetId);
      await expectCode(api.bevs.create({ ...base, categoryId: 'beer', photoAssetId: photo.assetId }), 'age_restricted');
    });

    it('report: works for a real Bev, not_found for an unknown one, validation for an empty reason', async () => {
      await newUser();
      const [id] = await starterIds(1);
      await expect(api.bevs.report(id!, 'wrong_info')).resolves.toBeUndefined();
      await expectCode(api.bevs.report('no-such-bev', 'wrong_info'), 'not_found');
      await expectCode(api.bevs.report(id!, ''), 'validation');
    });
  });

  describe('rankings', () => {
    it('submitRanking into an empty bucket, then above it: positions and re-spaced scores', async () => {
      const me = await newUser();
      const [a, b] = await starterIds(2);
      const first = await api.rankings.submitRanking({ bevId: a!, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
      expect(first.bucketSize).toBe(1);
      expect(first.ranking).toMatchObject({ userId: me.userId, bevId: a, bucket: 'LOVED', position: 0, note: null });
      expect(first.ranking.score).toBeGreaterThanOrEqual(BANDS.LOVED[0]);
      const second = await api.rankings.submitRanking({
        bevId: b!, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 1,
        comparisons: [{ winnerBevId: b!, loserBevId: a!, tie: false }], note: 'Better ice cold',
      });
      expect(second.bucketSize).toBe(2);
      expect(second.ranking).toMatchObject({ position: 0, note: 'Better ice cold' });
      expect(await api.rankings.listBucket('LOVED')).toEqual([b, a]);
      const list = await api.rankings.listMine();
      expect(list.items.map((r) => r.bevId)).toEqual([b, a]);
      expect(list.items[0]!.score).toBeGreaterThan(list.items[1]!.score);
      expect(list.items[0]!.bev.id).toBe(b);
      const detail = await api.bevs.get(a!);
      expect(detail.myRanking).toMatchObject({ bucket: 'LOVED', position: 1, bucketSize: 2 });
      expect(detail.prediction).toBeNull();
    });

    it('submitRanking: wrong expectedBucketSize or an already-ranked Bev is a conflict', async () => {
      await newUser();
      const [a, b] = await starterIds(2);
      await rankAtBottom(a!, 'FINE');
      await expectCode(api.rankings.submitRanking({ bevId: b!, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [] }), 'conflict');
      await expectCode(api.rankings.submitRanking({ bevId: a!, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [] }), 'conflict');
    });

    it('submitRanking: insertIndex out of range or a note over 140 chars is validation; unknown Bev is not_found', async () => {
      await newUser();
      const [a] = await starterIds(1);
      await expectCode(api.rankings.submitRanking({ bevId: a!, bucket: 'LOVED', insertIndex: 1, expectedBucketSize: 0, comparisons: [] }), 'validation');
      await expectCode(api.rankings.submitRanking({ bevId: a!, bucket: 'LOVED', insertIndex: -1, expectedBucketSize: 0, comparisons: [] }), 'validation');
      await expectCode(
        api.rankings.submitRanking({ bevId: a!, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [], note: 'x'.repeat(141) }),
        'validation',
      );
      await expectCode(api.rankings.submitRanking({ bevId: 'no-such-bev', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] }), 'not_found');
      expect(await api.rankings.listBucket('LOVED')).toEqual([]);
    });

    it('submitRanking removes the Bev from Want to Try and posts a feed item', async () => {
      const me = await newUser();
      const [a] = await starterIds(1);
      await api.wantToTry.add(a!);
      await rankAtBottom(a!, 'DISLIKED', 'Way too sweet');
      expect((await api.wantToTry.list()).items).toEqual([]);
      const feed = await api.feed.getFeed();
      const post = feed.items.find((i) => i.type === 'RANKING' && i.bev.id === a);
      expect(post).toMatchObject({ actor: { id: me.userId }, bucket: 'DISLIKED', note: 'Way too sweet' });
      expect(post!.score).toBeLessThan(BANDS.DISLIKED[1]);
    });

    it('listMine filters by bucket and category and sorts', async () => {
      await newUser();
      const ids = await starterIds(3);
      await rankAtBottom(ids[0]!, 'LOVED');
      await rankAtBottom(ids[1]!, 'DISLIKED');
      await rankAtBottom(ids[2]!, 'FINE');
      const all = await api.rankings.listMine();
      expect(all.items.map((r) => r.bucket)).toEqual(BUCKET_ORDER);
      expect((await api.rankings.listMine({ bucket: 'FINE' })).items.map((r) => r.bevId)).toEqual([ids[2]]);
      const cat = all.items[0]!.bev.categoryId;
      for (const r of (await api.rankings.listMine({ categoryId: cat })).items) expect(r.bev.categoryId).toBe(cat);
      const recent = await api.rankings.listMine({ sort: 'recent' });
      expect(recent.items).toHaveLength(3);
      const byName = (await api.rankings.listMine({ sort: 'name' })).items.map((r) => r.bev.name);
      expect(byName).toEqual([...byName].sort((x, y) => x.localeCompare(y)));
      const paged = await api.rankings.listMine({ page: { limit: 2 } });
      expect(paged.items).toHaveLength(2);
      expect(paged.nextCursor).not.toBeNull();
      const rest = await api.rankings.listMine({ page: { limit: 2, cursor: paged.nextCursor! } });
      expect(rest.items.map((r) => r.bevId)).toEqual([all.items[2]!.bevId]);
      expect(rest.nextCursor).toBeNull();
    });

    it('listUser shows another user\'s rankings; unknown user is not_found', async () => {
      const a = await newUser();
      const [x] = await starterIds(1);
      await rankAtBottom(x!);
      await newUser();
      const page = await api.rankings.listUser(a.userId);
      expect(page.items.map((r) => r.bevId)).toEqual([x]);
      await expectCode(api.rankings.listUser('no-such-user'), 'not_found');
    });

    it('rerankBev moves a ranking across buckets and keeps the note; errors per contract', async () => {
      await newUser();
      const [a, b] = await starterIds(2);
      await rankAtBottom(a!, 'LOVED', 'keep me');
      await rankAtBottom(b!, 'FINE');
      const moved = await api.rankings.rerankBev({ bevId: a!, bucket: 'FINE', insertIndex: 1, expectedBucketSize: 1, comparisons: [{ winnerBevId: b!, loserBevId: a!, tie: true }] });
      expect(moved.ranking).toMatchObject({ bucket: 'FINE', position: 1, note: 'keep me' });
      expect(moved.bucketSize).toBe(2);
      expect(await api.rankings.listBucket('LOVED')).toEqual([]);
      expect(await api.rankings.listBucket('FINE')).toEqual([b, a]);
      // Within the same bucket, expectedBucketSize excludes the Bev itself.
      const top = await api.rankings.rerankBev({ bevId: a!, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 1, comparisons: [], note: 'new note' });
      expect(top.ranking).toMatchObject({ position: 0, note: 'new note' });
      await expectCode(api.rankings.rerankBev({ bevId: a!, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 2, comparisons: [] }), 'conflict');
      await expectCode(api.rankings.rerankBev({ bevId: a!, bucket: 'FINE', insertIndex: 3, expectedBucketSize: 1, comparisons: [] }), 'validation');
      const [c] = (await starterIds(3)).slice(2);
      await expectCode(api.rankings.rerankBev({ bevId: c!, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 2, comparisons: [] }), 'not_found');
    });

    it('updateNote sets and clears a note; not_found when unranked; validation when too long', async () => {
      await newUser();
      const [a, b] = await starterIds(2);
      await rankAtBottom(a!);
      await api.rankings.updateNote(a!, 'Tastes like flat Sprite');
      expect((await api.bevs.get(a!)).myRanking?.note).toBe('Tastes like flat Sprite');
      await api.rankings.updateNote(a!, '');
      expect((await api.bevs.get(a!)).myRanking?.note).toBeNull();
      await expectCode(api.rankings.updateNote(b!, 'hi'), 'not_found');
      await expectCode(api.rankings.updateNote(a!, 'x'.repeat(141)), 'validation');
    });

    it('removeRanking re-spaces the bucket; not_found when unranked', async () => {
      await newUser();
      const [a, b, c] = await starterIds(3);
      await rankAtBottom(a!);
      await rankAtBottom(b!);
      await rankAtBottom(c!);
      const before = (await api.rankings.listMine()).items;
      await api.rankings.removeRanking(a!);
      const after = (await api.rankings.listMine()).items;
      expect(after.map((r) => [r.bevId, r.position])).toEqual([[b, 0], [c, 1]]);
      expect(after[0]!.score).not.toBe(before[1]!.score);
      await expectCode(api.rankings.removeRanking(a!), 'not_found');
    });
  });

  describe('want to try', () => {
    it('add is idempotent and posts one SAVED item; remove is idempotent', async () => {
      const a = await newUser();
      const viewer = await newUser();
      const [x] = await starterIds(1);
      await api.wantToTry.add(x!, a.userId);
      await api.wantToTry.add(x!, a.userId);
      const list = await api.wantToTry.list();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ bev: { id: x }, via: { id: a.userId } });
      expect((await api.bevs.get(x!)).inWantToTry).toBe(true);
      const saved = (await api.feed.getFeed()).items.filter((i) => i.type === 'SAVED' && i.bev.id === x && i.actor.id === viewer.userId);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ score: null, bucket: null, inMyWantToTry: true });
      expect((await api.stats.getMine()).wantToTryCount).toBe(1);
      await api.wantToTry.remove(x!);
      await api.wantToTry.remove(x!);
      expect((await api.wantToTry.list()).items).toEqual([]);
    });

    it('add: unknown Bev is not_found', async () => {
      await newUser();
      await expectCode(api.wantToTry.add('no-such-bev'), 'not_found');
    });
  });

  describe('feed, leaderboard, recommendations', () => {
    it('the feed shows followed users\' rankings, newest first', async () => {
      const a = await newUser();
      const [x, y] = await starterIds(2);
      await rankAtBottom(x!);
      await rankAtBottom(y!);
      await newUser();
      expect((await api.feed.getFeed()).items.some((i) => i.actor.id === a.userId)).toBe(false);
      await api.follows.follow(a.userId);
      const items = (await api.feed.getFeed()).items.filter((i) => i.actor.id === a.userId);
      expect(items.map((i) => i.bev.id)).toEqual([y, x]);
      expect(items[0]).toMatchObject({ type: 'RANKING', bucket: 'LOVED', inMyWantToTry: false });
    });

    it('getFeatured returns well-formed items', async () => {
      await newUser();
      for (const f of await api.feed.getFeatured()) {
        expect(typeof f.bev.id).toBe('string');
        expect(typeof f.heroImageUrl).toBe('string');
        expect(typeof f.startsAt).toBe('string');
      }
    });

    it('leaderboard.bevs: Bayesian order, ≥ MIN_RATERS ratings, myScore when ranked', async () => {
      await newUser();
      const [x] = await starterIds(1);
      for (let i = 0; i < MIN_RATERS; i++) {
        if (i > 0) await newUser();
        await rankAtBottom(x!);
      }
      const page = await api.leaderboard.bevs({ page: { limit: 100 } });
      page.items.forEach((row, i) => {
        expect(row.ratingCount).toBeGreaterThanOrEqual(MIN_RATERS);
        if (i > 0) expect(row.rank).toBeGreaterThan(page.items[i - 1]!.rank);
        if (i > 0) expect(row.bayesScore).toBeLessThanOrEqual(page.items[i - 1]!.bayesScore);
      });
      const cat = (await api.bevs.get(x!)).categoryId;
      const byCat = await api.leaderboard.bevs({ categoryId: cat, page: { limit: 100 } });
      for (const row of byCat.items) expect(row.bev.categoryId).toBe(cat);
      const mine = byCat.items.find((r) => r.bev.id === x);
      if (mine) expect(mine.myScore).not.toBeNull();
    });

    it('leaderboard.users: ranked users with points, in rank order', async () => {
      const me = await newUser();
      const [x] = await starterIds(1);
      await rankAtBottom(x!);
      const rows: { rank: number; profile: { id: string } }[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.leaderboard.users({ cursor, limit: 100 });
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      rows.forEach((r, i) => i > 0 && expect(r.rank).toBeGreaterThanOrEqual(rows[i - 1]!.rank));
      expect(rows.some((r) => r.profile.id === me.userId)).toBe(true);
    });

    it('recommendations are empty below MIN_N_USER rankings, then exclude ranked Bevs', async () => {
      await newUser();
      const ids = await starterIds(MIN_N_USER + 1);
      const rankedIds = ids.slice(0, MIN_N_USER);
      for (const [i, id] of rankedIds.entries()) {
        if (i === MIN_N_USER - 1) {
          const empty = await api.recs.getRecommendations();
          expect(empty.items).toEqual([]);
          expect(empty.basedOnCount).toBe(MIN_N_USER - 1);
        }
        await rankAtBottom(id, BUCKET_ORDER[i % BUCKET_ORDER.length]);
      }
      await api.recs.refresh();
      const recs = await api.recs.getRecommendations({ limit: 10 });
      expect(recs.basedOnCount).toBe(MIN_N_USER);
      expect(typeof recs.rankingVersion).toBe('string');
      expect(recs.items.length).toBeLessThanOrEqual(10);
      for (const r of recs.items) {
        expect(rankedIds).not.toContain(r.bev.id);
        expect(r.predictedScore).toBeGreaterThanOrEqual(0);
        expect(r.predictedScore).toBeLessThanOrEqual(10);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
      const p = (await api.bevs.get(ids[MIN_N_USER]!)).prediction;
      if (p) expect(typeof p.rankingVersion).toBe('string');
    });
  });
}
