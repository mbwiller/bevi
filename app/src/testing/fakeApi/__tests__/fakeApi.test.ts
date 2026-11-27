import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BUCKET_ORDER,
  CONFIDENCE_LOCK,
  MIN_N_USER,
  RANKING_VERSION,
  categoryAffinity,
  effectiveUserStats,
  populationStats,
  rankUsers,
  storedScore,
  zScore,
} from '@bevi/ranking';
import { isApiError, type Bucket, type Session } from '@bevi/shared';

import { CATALOG_BEVS } from '../catalog';
import { controls } from '../controls';
import { STORAGE_KEY, type FakeDb, type StorageLike } from '../db';
import { buildFixtures, userIdFor } from '../fixtures';
import { FakeApi } from '../FakeApi';
import { getFakeApi } from '../instance';
import { ALCOHOLIC_BEV_ID, FAKE_INVITE_CODE, FRIEND, ME, MINOR } from '../people';

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

/** Every test runs on a pinned clock, so streaks and "today" never depend on the real date. */
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
const make = (storage: StorageLike | null = null, now: Date = FIXED_NOW) => new FakeApi({ storage, latency: 0, now: () => now });

async function signInMe(api: FakeApi) {
  return api.signIn({ username: ME.handle, password: ME.password });
}

describe('seed', () => {
  it('uses exactly the catalog in data/catalog/bevs.csv, nothing invented', () => {
    const csv = readFileSync(resolve(__dirname, '../../../../../data/catalog/bevs.csv'), 'utf8');
    const slugs = csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]);
    expect(CATALOG_BEVS.map((b) => b.id)).toEqual(slugs);
    expect(buildFixtures(FIXED_NOW).bevs.map((b) => b.id)).toEqual(slugs);
  });

  it('fixture scores are exactly @bevi/ranking storedScore for every bucket position', () => {
    const db = buildFixtures(new Date('2026-10-11T12:00:00Z'));
    for (const user of db.users) {
      for (const bucket of BUCKET_ORDER) {
        const rows = db.rankings.filter((r) => r.userId === user.id && r.bucket === bucket).sort((a, z) => a.position - z.position);
        rows.forEach((r, i) => {
          expect(r.position).toBe(i);
          expect(r.score).toBe(storedScore(i, rows.length, bucket));
        });
      }
    }
  });
});

describe('fixtures through the API', () => {
  it('the test account has rankings, a feed, featured Bevs, a leaderboard and recommendations', async () => {
    const api = make();
    await signInMe(api);
    const me = await api.profile.getMe();
    expect(me).toMatchObject({ handle: 'tester', onboarded: true, canSeeAlcohol: true });
    expect((await api.rankings.listMine()).items).toHaveLength(12);
    expect((await api.feed.getFeed()).items.length).toBeGreaterThan(10);
    expect((await api.feed.getFeatured()).length).toBeGreaterThanOrEqual(3);
    expect((await api.leaderboard.bevs()).items.length).toBeGreaterThan(0);
    expect((await api.leaderboard.users()).items.length).toBeGreaterThan(3);
    const stats = await api.stats.getMine();
    expect(stats.following).toBe(4);
    expect(stats).toMatchObject({ currentStreak: 2, longestStreak: 2, streakAliveToday: true });
    const recs = await api.recs.getRecommendations();
    expect(recs.items.length).toBeGreaterThan(5);
    expect(recs.rankingVersion).toBe(RANKING_VERSION);
    expect((await api.bevs.get(recs.items[0]!.bev.id)).prediction).not.toBeNull();
  });

  it('category leaderboard rows carry the board\'s Bayesian score on the Bev too', async () => {
    const api = make();
    await signInMe(api);
    const rows = (await api.leaderboard.bevs({ categoryId: 'soda' })).items;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.bev.bayesScore).toBe(row.bayesScore);
  });

  it('theo (under 21) never sees alcoholic categories, Bevs or featured items', async () => {
    const api = make();
    api.signInAs('minor_user');
    expect((await api.profile.getMe()).canSeeAlcohol).toBe(false);
    expect((await api.categories.list()).some((c) => c.isAlcoholic)).toBe(false);
    expect((await api.feed.getFeatured()).map((f) => f.bev.id)).not.toContain(ALCOHOLIC_BEV_ID);
    expect((await api.bevs.search({ q: '', limit: 100 })).items.map((b) => b.id)).not.toContain(ALCOHOLIC_BEV_ID);
    const minorStarters = await api.bevs.getStarterCandidates();
    expect(minorStarters.length).toBeGreaterThanOrEqual(30);
    expect(minorStarters.filter((b) => ['beer', 'wine', 'spirits_cocktails', 'hard_seltzer', 'cider'].includes(b.categoryId))).toEqual([]);
    await expect(api.bevs.get(ALCOHOLIC_BEV_ID)).rejects.toMatchObject({ code: 'age_restricted' });
  });

  it('an adult is offered at least four starters in each category onboarding draws from, alcoholic ones included', async () => {
    const api = make();
    await signInMe(api);
    expect((await api.profile.getMe()).canSeeAlcohol).toBe(true);
    const perCategory = new Map<string, number>();
    for (const b of await api.bevs.getStarterCandidates()) perCategory.set(b.categoryId, (perCategory.get(b.categoryId) ?? 0) + 1);
    for (const id of ['beer', 'wine', 'spirits_cocktails', 'coffee', 'tea', 'juice', 'sports', 'water', 'boba', 'smoothie']) {
      expect(perCategory.get(id) ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it('bevs.create rejects a photo that is still processing (validation), then accepts it once ready', async () => {
    let now = new Date('2026-10-11T12:00:00Z');
    const api = new FakeApi({ storage: null, latency: 0, now: () => now });
    await signInMe(api);
    const up = await api.media.upload({ kind: 'bev-photo', file: new Blob(['x']), mimeType: 'image/jpeg' });
    expect(up.status).toBe('processing');
    const input = { name: 'Garage Cola', categoryId: 'soda' as const, priceTier: 1 as const, priceEstimated: false, photoAssetId: up.assetId };
    await expect(api.bevs.create(input)).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'photoAssetId', reason: 'asset_not_ready' },
    });
    now = new Date(now.getTime() + 5000);
    const bev = await api.bevs.create(input);
    expect(bev).toMatchObject({ photoStatus: 'ready', photoUrl: up.url });
  });

  it('findLikelyDuplicates ranks the chosen category first and never filters by it (20261112000100)', async () => {
    // The 2026-11-09 incident: a Red Bull flavour created under Sports Drinks by mistake. The
    // catalog's Red Bulls are all `energy`; the duplicate check must still offer them.
    let now = new Date('2026-10-11T12:00:00Z');
    const api = new FakeApi({ storage: null, latency: 0, now: () => now });
    await signInMe(api);
    const up = await api.media.upload({ kind: 'bev-photo', file: new Blob(['x']), mimeType: 'image/jpeg' });
    now = new Date(now.getTime() + 5000);
    const sports = await api.bevs.create({
      name: 'Red Bull',
      brand: 'Red Bull',
      flavor: 'Fiji Apple & Ginger',
      categoryId: 'sports',
      priceTier: 1,
      priceEstimated: false,
      photoAssetId: up.assetId,
    });

    const inSports = await api.bevs.findLikelyDuplicates({ name: 'Red Bull', categoryId: 'sports' });
    expect(inSports[0]?.id).toBe(sports.id);
    expect(inSports.map((b) => b.id)).toContain('red-bull-original');
    expect(inSports.slice(1).every((b) => b.categoryId === 'energy')).toBe(true);

    const inEnergy = await api.bevs.findLikelyDuplicates({ name: 'Red Bull', categoryId: 'energy' });
    expect(inEnergy.map((b) => b.categoryId)).toEqual(['energy', 'energy', 'energy', 'energy', 'sports']);

    const asTyped = await api.bevs.findLikelyDuplicates({
      name: 'Red Bull',
      brand: 'Red Bull',
      flavor: 'Fiji Apple & Ginger',
      categoryId: 'sports',
    });
    expect(asTyped[0]?.id).toBe(sports.id);
    expect(asTyped.map((b) => b.id)).toContain('red-bull-original');
  });
});

describe('persistence', () => {
  it('persists to storage and restores, including the session', async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await a.signUp({ username: 'persisted', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const b = make(storage);
    expect(await b.getSession()).toMatchObject({ handle: 'persisted' });
  });

  it('re-seeds untouched fixtures for today, so the test user keeps its streak on later days', async () => {
    const storage = memoryStorage();
    await signInMe(make(storage));
    const later = make(storage, new Date(FIXED_NOW.getTime() + 9 * 24 * 60 * 60 * 1000));
    expect(await later.getSession()).toMatchObject({ handle: 'tester' });
    expect(await later.stats.getMine()).toMatchObject({ currentStreak: 2, streakAliveToday: true });
  });

  it('keeps a db with real changes as it is, so it ages like real data', async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await signInMe(a);
    await a.wantToTry.add('pepsi');
    const later = make(storage, new Date(FIXED_NOW.getTime() + 9 * 24 * 60 * 60 * 1000));
    expect((await later.wantToTry.list()).items.map((w) => w.bev.id)).toContain('pepsi');
    expect(await later.stats.getMine()).toMatchObject({ currentStreak: 0, longestStreak: 2, streakAliveToday: false });
  });

  it('falls back to fixtures when the stored db is corrupt', async () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const api = make(storage);
    await expect(signInMe(api)).resolves.toMatchObject({ handle: 'tester' });
  });

  it('keeps working in memory when storage throws', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const api = make(throwing);
    await signInMe(api);
    await api.wantToTry.add('pepsi');
    expect((await api.wantToTry.list()).items.map((w) => w.bev.id)).toContain('pepsi');
    api.resetToFixtures();
  });
});

describe('dev controls', () => {
  it('failNext rejects only the next call, optionally for one method', async () => {
    const api = make();
    api.failNext('network');
    await expect(api.meta.getAppConfig()).rejects.toMatchObject({ code: 'network' });
    await expect(api.meta.getAppConfig()).resolves.toBeDefined();
    await signInMe(api);
    api.failNext('conflict', 'rankings.submitRanking');
    await expect(api.profile.getMe()).resolves.toBeDefined();
    const err = await api.rankings
      .submitRanking({ bevId: 'pepsi', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] })
      .catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('conflict');
  });

  it('getAppConfig answers the default config signed out, with both IA-2 fields', async () => {
    const api = make();
    expect(await api.getSession()).toBeNull();
    expect(await api.meta.getAppConfig()).toEqual({
      minAppVersion: '0.1.0',
      minContractVersion: '0.0.0',
      maintenance: false,
      maintenanceMessage: null,
    });
  });

  it('setAppConfig replaces only the fields given, and resetToFixtures puts the default back', async () => {
    const api = make();
    const initial = await api.meta.getAppConfig();

    api.setAppConfig({ maintenance: true, maintenanceMessage: 'Back by 9pm ET.' });
    expect(await api.meta.getAppConfig()).toEqual({ ...initial, maintenance: true, maintenanceMessage: 'Back by 9pm ET.' });

    api.setAppConfig({ minAppVersion: '9.0.0', minContractVersion: '3.2.0' });
    expect(await api.meta.getAppConfig()).toEqual({
      minAppVersion: '9.0.0',
      minContractVersion: '3.2.0',
      maintenance: true,
      maintenanceMessage: 'Back by 9pm ET.',
    });

    api.resetToFixtures();
    expect(await api.meta.getAppConfig()).toEqual(initial);
  });

  it('setAppConfig refuses what the app_config table refuses, and leaves the config as it was', async () => {
    const api = make();
    const initial = await api.meta.getAppConfig();
    expect(() => api.setAppConfig({ minAppVersion: '1.2' })).toThrow('minAppVersion must be x.y.z');
    expect(() => api.setAppConfig({ minContractVersion: 'v3.2.0' })).toThrow('minContractVersion must be x.y.z');
    expect(() => api.setAppConfig({ maintenanceMessage: '' })).toThrow('maintenanceMessage');
    expect(() => api.setAppConfig({ maintenanceMessage: 'x'.repeat(281) })).toThrow('maintenanceMessage');
    expect(await api.meta.getAppConfig()).toEqual(initial);
  });

  it("failNext accepts 'meta.getAppConfig', failing that read once and nothing else", async () => {
    const api = make();
    api.failNext('network', 'meta.getAppConfig');
    await expect(api.profile.checkHandle('someone_new')).resolves.toEqual({ available: true });
    await expect(api.meta.getAppConfig()).rejects.toMatchObject({ code: 'network' });
    await expect(api.meta.getAppConfig()).resolves.toMatchObject({ maintenance: false });
  });

  it("controls.setAppConfig drives the suites' shared FakeApi", async () => {
    controls.setLatency(0);
    controls.resetToFixtures();
    controls.setAppConfig({ maintenance: true });
    expect((await getFakeApi().meta.getAppConfig()).maintenance).toBe(true);
    controls.failNext('unknown', 'meta.getAppConfig');
    await expect(getFakeApi().meta.getAppConfig()).rejects.toMatchObject({ code: 'unknown' });
    controls.resetToFixtures();
    expect((await getFakeApi().meta.getAppConfig()).maintenance).toBe(false);
  });

  it('setLatency delays calls', async () => {
    const api = make();
    api.setLatency(40);
    const t = Date.now();
    await api.meta.getAppConfig();
    expect(Date.now() - t).toBeGreaterThanOrEqual(35);
  });

  it('resetToFixtures signs out (firing onAuthChange) and restores data', async () => {
    const api = make();
    await api.signUp({ username: 'temp_user', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const events: (Session | null)[] = [];
    api.onAuthChange((s) => events.push(s));
    api.resetToFixtures();
    expect(events).toEqual([null]);
    expect(await api.getSession()).toBeNull();
    expect(await api.profile.checkHandle('temp_user')).toEqual({ available: true });
  });

  it('emptyUser gives the signed-in user a first-run state', async () => {
    const api = make();
    await signInMe(api);
    api.emptyUser();
    expect((await api.rankings.listMine()).items).toEqual([]);
    expect((await api.wantToTry.list()).items).toEqual([]);
    expect(await api.stats.getMine()).toMatchObject({ following: 0, followers: 0, bevdCount: 0 });
    expect(await api.profile.getMe()).toMatchObject({ onboarded: false, birthdate: null, canSeeAlcohol: false });
    expect((await api.recs.getRecommendations()).items).toEqual([]);
  });
});

describe('@bevi/ranking-backed predictions, recommendations, streaks and points', () => {
  const NOW = '2026-10-11T16:00:00Z';
  const clocked = (iso: string) => {
    const clock = { now: new Date(iso) };
    const api = new FakeApi({ storage: null, latency: 0, now: () => clock.now });
    return { api, clock };
  };
  /** Ranks each Bev into its own (empty) bucket: no comparisons needed. Up to three. */
  const rankInto = async (api: FakeApi, bevId: string, i: number) =>
    api.rankings.submitRanking({ bevId, bucket: BUCKET_ORDER[i]!, insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('the test user gets a prediction on an unranked Bev (above MIN_N_USER) and none on a ranked one', async () => {
    const { api } = clocked(NOW);
    await signInMe(api);
    const mine = (await api.rankings.listMine()).items;
    expect(mine.length).toBeGreaterThanOrEqual(MIN_N_USER);
    const ranked = new Set(mine.map((r) => r.bevId));
    const unranked = (await api.bevs.search({ q: '', limit: 100 })).items.find((b) => !ranked.has(b.id))!;
    const bev = await api.bevs.get(unranked.id);
    expect(bev.prediction).toMatchObject({ rankingVersion: RANKING_VERSION, generatedAt: new Date(NOW).toISOString() });
    expect(bev.prediction!.score).toBeGreaterThanOrEqual(0);
    expect(bev.prediction!.score).toBeLessThanOrEqual(10);
    expect(bev.prediction!.confidence).toBeGreaterThanOrEqual(0);
    expect(bev.prediction!.confidence).toBeLessThanOrEqual(1);
    expect((await api.bevs.get(mine[0]!.bevId)).prediction).toBeNull();
  });

  it('prediction is null below MIN_N_USER rankings and appears once the user reaches it', async () => {
    const { api } = clocked(NOW);
    await api.signUp({ username: 'predictor', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const ids = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    const target = ids[MIN_N_USER]!;
    for (let i = 0; i < MIN_N_USER; i++) {
      expect((await api.bevs.get(target)).prediction).toBeNull();
      await rankInto(api, ids[i]!, i);
    }
    expect((await api.bevs.get(target)).prediction).not.toBeNull();
  });

  it('the test user\'s Recommended list has unlocked bubbles and is stable within a local day', async () => {
    const { api, clock } = clocked('2026-10-11T12:00:00Z');
    await signInMe(api);
    const morning = await api.recs.getRecommendations();
    expect(morning.basedOnCount).toBe(12);
    expect(morning.items.filter((r) => r.confidence >= CONFIDENCE_LOCK).length).toBeGreaterThan(3);
    expect(morning.items.some((r) => r.isExploration)).toBe(true);
    // 20:00Z is still 2026-10-11 in the test user's America/New_York: same seed, same list.
    clock.now = new Date('2026-10-11T20:00:00Z');
    const evening = await api.recs.getRecommendations();
    const strip = (items: typeof morning.items) => items.map(({ generatedAt: _g, ...rest }) => rest);
    expect(strip(evening.items)).toEqual(strip(morning.items));
    expect(evening.generatedAt).toBe('2026-10-11T20:00:00.000Z');
  });

  it('streaks count local days in the profile timezone and break after a missed day', async () => {
    const { api, clock } = clocked('2026-10-12T03:00:00Z'); // 2026-10-11 23:00 in New York
    await api.signUp({ username: 'streaker', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    await api.profile.updateMe({ timezone: 'America/New_York' });
    const ids = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    await rankInto(api, ids[0]!, 0);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, longestStreak: 1, streakAliveToday: true });

    clock.now = new Date('2026-10-12T14:00:00Z'); // same UTC day, but the next local day
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, streakAliveToday: false });
    await rankInto(api, ids[1]!, 1);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 2, longestStreak: 2, streakAliveToday: true });

    clock.now = new Date('2026-10-14T14:00:00Z'); // 2026-10-13 missed
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 0, longestStreak: 2, streakAliveToday: false });
    await rankInto(api, ids[2]!, 2);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, longestStreak: 2, streakAliveToday: true });
  });

  it('removing today\'s ranking does not break the streak', async () => {
    const { api } = clocked(NOW);
    await api.signUp({ username: 'remover', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const [id] = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    await rankInto(api, id!, 0);
    await api.rankings.removeRanking(id!);
    expect(await api.stats.getMine()).toMatchObject({ bevdCount: 0, currentStreak: 1, streakAliveToday: true });
  });

  it('the user leaderboard\'s order, ranks and points are rankUsers over the fake\'s data', async () => {
    const now = new Date(NOW);
    const { api } = clocked(NOW);
    await signInMe(api);
    const db = buildFixtures(now);
    const rows = [];
    for (const u of db.users) {
      const stats = await api.stats.getUser(u.id);
      const created = new Set(db.bevs.filter((b) => b.createdById === u.id).map((b) => b.id));
      const bevsCreated = new Set(db.rankings.filter((r) => r.userId !== u.id && created.has(r.bevId)).map((r) => r.bevId)).size;
      rows.push({ userId: u.id, bevsRanked: stats.bevdCount, currentStreak: stats.currentStreak, bevsCreated, createdAt: u.createdAt });
      if (stats.rankOnBevi !== null) expect(stats.rankPoints).toBeGreaterThan(0);
    }
    const expected = rankUsers(rows);
    const board = (await api.leaderboard.users()).items;
    expect(board.map((r) => ({ userId: r.profile.id, points: r.points, rank: r.rank }))).toEqual(expected);
    for (const r of board) {
      const stats = await api.stats.getUser(r.profile.id);
      expect(stats).toMatchObject({ rankOnBevi: r.rank, rankPoints: r.points, currentStreak: r.currentStreak });
    }
    // The seed plants streaks (the test user ranked today and yesterday).
    expect((await api.stats.getMine()).currentStreak).toBeGreaterThanOrEqual(2);
  });
});

describe('rankings made before onboarding ends (DELIVERABLE-44)', () => {
  const rankFirst = (api: FakeApi, bevId: string, bucket: Bucket) =>
    api.rankings.submitRanking({ bevId, bucket, insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('are saved, counted and kept in the streak, but post nothing, even to a follower', async () => {
    const api = make();
    const fan = await api.signUp({ username: 'starterfan', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const me = await api.signUp({ username: 'starter', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    expect((await api.profile.getMe()).onboarded).toBe(false);
    const [a, b] = (await api.bevs.getStarterCandidates()).map((x) => x.id);
    await rankFirst(api, a!, 'LOVED');
    await rankFirst(api, b!, 'FINE');

    expect((await api.rankings.listMine()).items.map((r) => r.bevId).sort()).toEqual([a, b].sort());
    expect(await api.stats.getMine()).toMatchObject({ bevdCount: 2, currentStreak: 1, streakAliveToday: true });
    expect((await api.feed.getFeed()).items.filter((i) => i.actor.id === me.userId)).toEqual([]);
    expect((await api.feed.listUser(me.userId)).items).toEqual([]);

    // Removed again, the day still counts, as the server's ranking_events keep it.
    await api.rankings.removeRanking(b!);
    expect(await api.stats.getMine()).toMatchObject({ bevdCount: 1, currentStreak: 1, streakAliveToday: true });

    await api.signOut();
    await api.signIn({ username: 'starterfan', password: 'password1' });
    expect(fan.userId).not.toBe(me.userId);
    await api.follows.follow(me.userId);
    expect((await api.feed.getFeed()).items.filter((i) => i.actor.id === me.userId)).toEqual([]);
    expect((await api.feed.listUser(me.userId)).items).toEqual([]);
    expect((await api.rankings.listUser(me.userId)).items.map((r) => r.bevId)).toEqual([a]);
  });

  it('queue no post push for a subscriber until the profile is onboarded', async () => {
    const api = make();
    const fan = await api.signUp({ username: 'pushfan', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const me = await api.signUp({ username: 'pushstarter', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    await api.signOut();
    await api.signIn({ username: 'pushfan', password: 'password1' });
    await api.follows.follow(me.userId);
    await api.notifications.updateSettings({ paused: false, follows: true, likes: true, comments: true, posts: true });
    await api.notifications.setPostNotification(me.userId, true);
    await api.signOut();

    await api.signIn({ username: 'pushstarter', password: 'password1' });
    const [a, b] = (await api.bevs.getStarterCandidates()).map((x) => x.id);
    await rankFirst(api, a!, 'LOVED');
    expect(api.pendingPushes(fan.userId)).toEqual([]);

    await api.profile.updateMe({ onboarded: true });
    await rankFirst(api, b!, 'FINE');
    const post = (await api.feed.listUser(me.userId)).items[0]!;
    expect(api.pendingPushes(fan.userId)).toEqual([{ kind: 'post', actorHandle: 'pushstarter', postId: post.id }]);
  });

  it('once the profile is onboarded, the next ranking posts; an onboarded fixture user posts as before', async () => {
    const api = make();
    const me = await api.signUp({ username: 'graduate', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const [a, b] = (await api.bevs.getStarterCandidates()).map((x) => x.id);
    await rankFirst(api, a!, 'LOVED');
    await api.profile.updateMe({ onboarded: true });
    await rankFirst(api, b!, 'FINE');
    expect((await api.feed.listUser(me.userId)).items.map((i) => i.bev.id)).toEqual([b]);

    await api.signOut();
    await signInMe(api);
    expect((await api.profile.getMe()).onboarded).toBe(true);
    const mine = new Set((await Promise.all(BUCKET_ORDER.map((bucket) => api.rankings.listBucket(bucket)))).flat());
    const fresh = (await api.bevs.getStarterCandidates()).map((x) => x.id).find((id) => !mine.has(id))!;
    const fine = await api.rankings.listBucket('FINE');
    const comparisons = fine.length ? [{ winnerBevId: fine[fine.length - 1]!, loserBevId: fresh, tie: false }] : [];
    await api.rankings.submitRanking({ bevId: fresh, bucket: 'FINE', insertIndex: fine.length, expectedBucketSize: fine.length, comparisons });
    const post = (await api.feed.getFeed()).items.find((i) => i.bev.id === fresh && i.actor.handle === ME.handle);
    expect(post).toMatchObject({ type: 'RANKING', bucket: 'FINE' });
  });
});

describe('likes (S-02)', () => {
  it('like and unlike are idempotent and show on the feed item; an unknown post is not_found', async () => {
    const api = make();
    await signInMe(api);
    const [post] = (await api.feed.getFeed()).items;
    expect(post).toMatchObject({ likeCount: 0, likedByMe: false });

    await api.feed.like(post!.id);
    await api.feed.like(post!.id);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post!.id)).toMatchObject({ likeCount: 1, likedByMe: true });

    await api.feed.unlike(post!.id);
    await api.feed.unlike(post!.id);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post!.id)).toMatchObject({ likeCount: 0, likedByMe: false });

    const missing = await api.feed.like('feed-does-not-exist').catch((e: unknown) => e);
    expect(isApiError(missing) && missing.code).toBe('not_found');
  });
});

// The conformance suite can only check the shape of these (`bev_edges` is empty on a real backend
// until the graph sync job lands), so the plausibility of the fake's own mirror is asserted here.
describe('the Bev graph (A-16 + S-14 part 2)', () => {
  it('derives recognisable edges from the catalog with edgeWeight/topEdges', async () => {
    const api = make();
    await signInMe(api);

    const near = await api.bevs.similar('coca-cola-classic', 10);
    expect(near.length).toBeGreaterThan(0);
    // Every neighbour of Coke is a cola of some kind: the fake is running the real formula over the
    // real catalog, not picking rows at random.
    expect(near.map((b) => b.id)).toContain('pepsi');
    expect(near.map((b) => b.id)).not.toContain('coca-cola-classic');
    for (const b of near) expect(['soda', 'diet_soda', 'energy', 'other']).toContain(b.categoryId);

    const [coke] = await api.bevs.similarities('coca-cola-classic', ['pepsi']);
    expect(coke!.bevId).toBe('pepsi');
    // Not the paper's ≥ 0.8: `emb` is 0 here (the fixtures carry no gte-small vectors), and its
    // weight is 0.30. What has to hold is that Coke-Pepsi clears EDGE_MIN_WEIGHT comfortably and
    // beats an unrelated drink, which has no edge at all.
    expect(coke!.weight).toBeGreaterThan(0.5);
    expect(await api.bevs.similarities('coca-cola-classic', ['red-bull-original'])).toEqual([]);

    // Symmetric: the mirror stores one row per unordered pair and both ends read the same number.
    const [back] = await api.bevs.similarities('pepsi', ['coca-cola-classic']);
    expect(back).toEqual({ bevId: 'coca-cola-classic', weight: coke!.weight });

    // Heaviest first, and n is clamped the way the RPC clamps it.
    const all = await api.bevs.similar('coca-cola-classic', 10_000);
    expect(all.length).toBeLessThanOrEqual(50);
    expect((await api.bevs.similar('coca-cola-classic', 1))[0]!.id).toBe(all[0]!.id);
  });

  it('hides an alcoholic Bev from a minor, as an anchor and as a neighbour', async () => {
    const api = make();
    await signInMe(api);
    const adultNear = await api.bevs.similar(ALCOHOLIC_BEV_ID, 10);
    expect(adultNear.length).toBeGreaterThan(0);

    api.signInAs('minor_user');
    expect(await api.bevs.similar(ALCOHOLIC_BEV_ID)).toEqual([]);
    expect(await api.bevs.similarities(ALCOHOLIC_BEV_ID, [adultNear[0]!.id])).toEqual([]);
    for (const neighbour of adultNear) {
      expect(await api.bevs.similarities(neighbour.id, [ALCOHOLIC_BEV_ID])).toEqual([]);
    }
  });

  it('listBucketBevs is listBucket plus the category and the brand key', async () => {
    const api = make();
    await signInMe(api);
    const ids = await api.rankings.listBucket('LOVED');
    const rows = await api.rankings.listBucketBevs('LOVED');
    expect(rows.map((r) => r.id)).toEqual(ids);
    const brandy = rows.find((r) => r.brandKey !== null);
    expect(brandy).toBeDefined();
    expect(brandy!.brandKey).toBe(brandy!.brandKey!.trim().toLowerCase());
  });
});

describe('taste profile (S-12)', () => {
  it("matches @bevi/ranking's affinity for ME, highest mean first, and hides alcohol from a minor", async () => {
    const api = make();
    await signInMe(api);
    const me = await api.profile.getMe();
    if (!(await api.bevs.get(ALCOHOLIC_BEV_ID)).myRanking) {
      const loved = await api.rankings.listBucket('LOVED');
      await api.rankings.submitRanking({ bevId: ALCOHOLIC_BEV_ID, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });
    }
    const mine = [];
    for (let page = await api.rankings.listMine({ page: { limit: 100 } }); ; ) {
      mine.push(...page.items);
      if (!page.nextCursor) break;
      page = await api.rankings.listMine({ page: { limit: 100, cursor: page.nextCursor } });
    }
    expect(mine.length).toBeGreaterThanOrEqual(MIN_N_USER);
    const effective = effectiveUserStats(populationStats(mine.map((r) => r.score)), { n: 0, mean: 0, stddev: 0 });
    const byCat = new Map<string, number[]>();
    for (const r of mine) byCat.set(r.bev.categoryId, [...(byCat.get(r.bev.categoryId) ?? []), r.score]);

    const profile = await api.stats.getTasteProfile(me.id);
    expect(profile.map((p) => p.categoryId).sort()).toEqual([...byCat.keys()].sort());
    for (const row of profile) {
      const scores = byCat.get(row.categoryId)!;
      expect(row.rankingCount).toBe(scores.length);
      expect(row.mean).toBeCloseTo(populationStats(scores).mean, 3);
      expect(row.affinity).toBeCloseTo(categoryAffinity(scores.map((s) => zScore(s, effective))), 3);
    }
    const means = profile.map((p) => p.mean);
    expect(means).toEqual([...means].sort((a, b) => b - a));
    const alcoholic = (await api.bevs.get(ALCOHOLIC_BEV_ID)).categoryId;
    expect(profile.map((p) => p.categoryId)).toContain(alcoholic);

    api.signInAs('minor_user');
    const seenByMinor = await api.stats.getTasteProfile(me.id);
    expect(seenByMinor.map((p) => p.categoryId)).not.toContain(alcoholic);
    expect(seenByMinor).toEqual(profile.filter((p) => p.categoryId !== alcoholic));
  });
});

describe('category progress (S-07)', () => {
  it('counts the catalog per category and the signed-in user\'s rankings in it', async () => {
    const api = make();
    await signInMe(api);
    const progress = await api.stats.getCategoryProgress();
    const { bevdCount } = await api.stats.getMine();
    for (const p of progress) {
      expect(p.total).toBe(CATALOG_BEVS.filter((b) => b.categoryId === p.categoryId).length);
    }
    const ranked = progress.reduce((sum, p) => sum + p.ranked, 0);
    expect(ranked).toBe(bevdCount);
    expect(ranked).toBeGreaterThan(0);
    const categories = await api.categories.list();
    expect(categories.map((c) => c.bevCount)).toEqual(progress.map((p) => p.total));
  });
});

describe('feed.listUser (S-20)', () => {
  it("is get_feed's rows for one actor: followed users and yourself, never a stranger, age-gated", async () => {
    const api = make();
    await signInMe(api);
    const me = await api.profile.getMe();
    const friendPosts = (await api.feed.getFeed()).items.filter((i) => i.actor.handle === FRIEND.handle);
    expect(friendPosts.length).toBeGreaterThan(0);
    const friendId = friendPosts[0]!.actor.id;
    // The feed's first page holds FRIEND's newest posts, so they open FRIEND's own page.
    expect((await api.feed.listUser(friendId)).items.slice(0, friendPosts.length)).toEqual(friendPosts);

    if (!(await api.bevs.get(ALCOHOLIC_BEV_ID)).myRanking) {
      const loved = await api.rankings.listBucket('LOVED');
      await api.rankings.submitRanking({
        bevId: ALCOHOLIC_BEV_ID,
        bucket: 'LOVED',
        insertIndex: 0,
        expectedBucketSize: loved.length,
        comparisons: [],
      });
    }
    expect((await api.feed.listUser(me.id)).items.map((i) => i.bev.id)).toContain(ALCOHOLIC_BEV_ID);

    api.signInAs('minor_user');
    await api.follows.unfollow(me.id);
    expect((await api.feed.listUser(me.id)).items).toEqual([]);
    await api.follows.follow(me.id);
    const seen = (await api.feed.listUser(me.id)).items;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((i) => i.bev.id)).not.toContain(ALCOHOLIC_BEV_ID);
  });
});

describe('feed.getExplore (S-04 + A-04)', () => {
  const PW = 'explore-pass-1';
  /** Signs up and finishes onboarding: a ranking made before that is not a post (DELIVERABLE-44). */
  const join = async (api: FakeApi, username: string) => {
    const session = await api.signUp({ username, password: PW, inviteCode: FAKE_INVITE_CODE });
    await api.profile.updateMe({ onboarded: true });
    return session;
  };
  /** Two non-alcoholic Bevs: a fresh signup has no birthdate, so search already hides alcohol. */
  const twoBevs = async (api: FakeApi) => (await api.bevs.search({ q: '', limit: 2 })).items.map((b) => b.id);
  const rankFirstIn = (api: FakeApi, bevId: string, bucket: Bucket) =>
    api.rankings.submitRanking({ bevId, bucket, insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('shows strangers exactly two follows away, hottest first, with no like or comment fields', async () => {
    const api = make();
    // The fixtures hold seven users; these fourteen signups clear D-01's 20-user threshold, so
    // what is under test here is the two-hop scope and not the global fallback.
    for (let i = 1; i <= 10; i++) await join(api, `expfill${i}`);

    const hop3 = await join(api, 'exphop3');
    const [h3bev] = await twoBevs(api);
    await rankFirstIn(api, h3bev!, 'LOVED');

    const author = await join(api, 'expauthor');
    const [x, y] = await twoBevs(api);
    await rankFirstIn(api, x!, 'LOVED');
    await rankFirstIn(api, y!, 'FINE');
    await api.follows.follow(hop3.userId); // author -> hop3, so hop3 is three hops from the viewer

    const middle = await join(api, 'expmiddle');
    await api.follows.follow(author.userId);
    const xPost = (await api.feed.listUser(author.userId)).items.find((i) => i.bev.id === x)!;
    await api.feed.like(xPost.id); // one like, and the clock is pinned: x's post is the hotter one

    const viewer = await join(api, 'expviewer');
    const [ownBev] = await twoBevs(api);
    await rankFirstIn(api, ownBev!, 'LOVED');
    await api.follows.follow(middle.userId);

    const explore = await api.feed.getExplore({ limit: 50 });
    expect(explore.items.map((i) => i.actor.id)).toEqual([author.userId, author.userId]);
    // Popularity, not time: both posts were made at the same pinned instant, so newest-first would
    // have put y's post (the later ranking) first. The liked one wins instead.
    expect(explore.items.map((i) => i.bev.id)).toEqual([x, y]);
    expect(explore.items.some((i) => i.actor.id === viewer.userId)).toBe(false); // never your own
    expect(explore.items.some((i) => i.actor.id === middle.userId)).toBe(false); // never a followee
    expect(explore.items.some((i) => i.actor.id === hop3.userId)).toBe(false); // three hops is too far

    // D-15: a read-only post, so no heart, no counts and no comments can be rendered. `venue`
    // (3.5.0) is where the Bev was had: part of the post, not engagement with it.
    expect(Object.keys(explore.items[0]!).sort()).toEqual(
      ['actor', 'bev', 'bucket', 'createdAt', 'id', 'inMyWantToTry', 'note', 'score', 'type', 'venue'].sort(),
    );
  });

  it('falls back to everyone while Bevi has fewer than 20 users, minus whoever you follow (D-01)', async () => {
    const api = make();
    const viewer = await join(api, 'expsmall'); // eight users: under the threshold

    const first = await api.feed.getExplore({ limit: 50 });
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.some((i) => i.actor.id === viewer.userId)).toBe(false);

    const stranger = first.items[0]!.actor.id;
    await api.follows.follow(stranger);
    const after = await api.feed.getExplore({ limit: 50 });
    expect(after.items.some((i) => i.actor.id === stranger)).toBe(false);
    expect((await api.feed.getFeed()).items.some((i) => i.actor.id === stranger)).toBe(true);
  });
});

describe('comments (S-03)', () => {
  /** FRIEND's newest post, which ME (following FRIEND) can see. */
  async function friendsPost(api: FakeApi) {
    const post = (await api.feed.getFeed()).items.find((i) => i.actor.handle === FRIEND.handle);
    expect(post).toBeDefined();
    return post!;
  }

  it('add trims, lists newest first in keyset pages, and the feed carries the count and the first seven', async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    expect(post).toMatchObject({ commentCount: 0, comments: [] });

    const added = await api.comments.add(post.id, '  one  ');
    expect(added).toMatchObject({ body: 'one', author: { handle: ME.handle } });
    for (let i = 2; i <= 9; i++) await api.comments.add(post.id, `c${i}`);

    const first = await api.comments.list(post.id, { limit: 5 });
    expect(first.items.map((c) => c.body)).toEqual(['c9', 'c8', 'c7', 'c6', 'c5']);
    // A comment added between pages doesn't shift the next one.
    await api.comments.add(post.id, 'c10');
    const second = await api.comments.list(post.id, { cursor: first.nextCursor!, limit: 5 });
    expect(second.items.map((c) => c.body)).toEqual(['c4', 'c3', 'c2', 'one']);
    expect(second.nextCursor).toBeNull();

    const item = (await api.feed.getFeed()).items.find((i) => i.id === post.id)!;
    expect(item.commentCount).toBe(10);
    expect(item.comments.map((c) => c.body)).toEqual(['one', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });

  it('add refuses empty and over 280 characters; an unseen post is not_found', async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (isApiError(e) ? e.code : e));
    expect(await code(api.comments.add(post.id, ' \n\t '))).toBe('validation');
    expect(await code(api.comments.add(post.id, 'x'.repeat(281)))).toBe('validation');
    expect(await code(api.comments.add(post.id, 'x'.repeat(280)))).toBe('ok');
    expect(await code(api.comments.add('feed-does-not-exist', 'hi'))).toBe('not_found');
    expect(await code(api.comments.list('feed-does-not-exist'))).toBe('not_found');
  });

  it("remove is own comments only and idempotent; removed comments leave the count", async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    const mine = await api.comments.add(post.id, 'mine');
    api.signInAs(FRIEND.handle);
    const theirs = await api.comments.add(post.id, 'theirs');
    const removeTheirs = await api.comments.remove(mine.id).catch((e: unknown) => e);
    expect(isApiError(removeTheirs) && removeTheirs.code).toBe('not_found');

    api.signInAs(ME.handle);
    await api.comments.remove(mine.id);
    await api.comments.remove(mine.id);
    expect((await api.comments.list(post.id)).items.map((c) => c.id)).toEqual([theirs.id]);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post.id)).toMatchObject({ commentCount: 1 });
  });
});

describe('feed.getBevOfPeriod', () => {
  // Fixtures are built at 2026-10-11; the clock then moves past all of them, so the
  // only rankings in November are this test's.
  const setup = async () => {
    const clock = { now: new Date('2026-10-11T16:00:00Z') };
    const api = new FakeApi({ storage: null, latency: 0, now: () => clock.now });
    await api.signUp({ username: 'periodic', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    await api.profile.setBirthDate('1990-05-05');
    return { api, clock };
  };
  const rankFirst = (api: FakeApi, bevId: string) =>
    api.rankings.submitRanking({ bevId, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('uses the New York day and ISO week, and falls back to the latest non-empty period', async () => {
    const { api, clock } = await setup();
    const [bev] = await api.bevs.getStarterCandidates();
    // Tuesday 2026-11-10, 22:30 in New York (already the 11th in UTC).
    clock.now = new Date('2026-11-11T03:30:00Z');
    await rankFirst(api, bev!.id);

    const now = await api.feed.getBevOfPeriod();
    expect(now.day).toMatchObject({ bev: { id: bev!.id }, periodStart: '2026-11-10', isCurrent: true, rankingsInPeriod: 1 });
    expect(now.week).toMatchObject({ bev: { id: bev!.id }, periodStart: '2026-11-09', isCurrent: true });
    // One rating is enough to win, and the card gets the score it won with.
    expect(typeof now.day!.bev.bayesScore).toBe('number');

    clock.now = new Date('2026-11-13T17:00:00Z'); // Friday: nothing ranked today
    const friday = await api.feed.getBevOfPeriod();
    expect(friday.day).toMatchObject({ periodStart: '2026-11-10', isCurrent: false });
    expect(friday.week).toMatchObject({ periodStart: '2026-11-09', isCurrent: true });

    clock.now = new Date('2026-11-18T17:00:00Z'); // the next week, still empty
    expect((await api.feed.getBevOfPeriod()).week).toMatchObject({ periodStart: '2026-11-09', isCurrent: false });
  });

  it('never gives a minor an alcoholic winner', async () => {
    const { api, clock } = await setup();
    clock.now = new Date('2026-11-11T17:00:00Z');
    await rankFirst(api, ALCOHOLIC_BEV_ID);
    expect((await api.feed.getBevOfPeriod()).day).toMatchObject({ bev: { id: ALCOHOLIC_BEV_ID }, isCurrent: true });

    api.signInAs('minor_user');
    const minor = await api.feed.getBevOfPeriod();
    expect([minor.day?.bev.id, minor.week?.bev.id]).not.toContain(ALCOHOLIC_BEV_ID);
    // Its latest visible period is from the fixtures, not today.
    expect(minor.day?.isCurrent).toBe(false);
  });
});

it('rejects invalid scanned nutrition before creating a Bev, matching the live contract', async () => {
  const api = make();
  await signInMe(api);
  await expect(api.bevs.create({
    name: 'Invalid nutrition snapshot', categoryId: 'water', priceTier: 2, priceEstimated: false,
    photoAssetId: 'unused', nutrition: {
      barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
      calories: -1, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
      sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901',
    },
  })).rejects.toMatchObject({ code: 'validation', detail: { field: 'nutrition' } });
  expect((await api.bevs.search({ q: 'Invalid nutrition snapshot' })).items).toHaveLength(0);
});

// IS-7: block_user / list_blocked_users / report_content, and the filtering a block causes.
describe('blocks and reports', () => {
  const friendId = userIdFor(FRIEND.handle);

  async function setup() {
    const api = make();
    const me = await signInMe(api);
    const feed = (await api.feed.getFeed({ limit: 100 })).items;
    const friendPost = feed.find((i) => i.actor.id === friendId)!;
    const myPost = feed.find((i) => i.actor.id === me.userId)!;
    expect(friendPost).toBeDefined();
    expect(myPost).toBeDefined();
    return { api, me, friendPost, myPost };
  }

  it('a block is mutual in effect: each reads the other as not_found, and the follows go both ways', async () => {
    const { api, me, friendPost } = await setup();
    await api.blocks.block(friendId);
    await api.blocks.block(friendId); // idempotent

    await expect(api.profile.getUser(friendId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.feed.listUser(friendId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.follows.follow(friendId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.comments.list(friendPost.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await api.feed.getFeed({ limit: 100 })).items.some((i) => i.actor.id === friendId)).toBe(false);
    expect((await api.profile.searchUsers({ q: FRIEND.handle })).items).toEqual([]);
    expect((await api.follows.listFollowing(me.userId, { limit: 50 })).items.some((p) => p.id === friendId)).toBe(false);

    // The other side sees the same wall, and nothing tells them they were blocked.
    api.signInAs(FRIEND.handle);
    await expect(api.profile.getUser(me.userId)).rejects.toMatchObject({ code: 'not_found' });
    expect((await api.follows.listFollowing(friendId, { limit: 50 })).items.some((p) => p.id === me.userId)).toBe(false);
    expect((await api.blocks.list()).items).toEqual([]);
  });

  it("list shows only the caller's own blocks; unblock does not restore the follows", async () => {
    const { api, me } = await setup();
    await api.blocks.block(friendId);
    expect((await api.blocks.list()).items).toEqual([
      expect.objectContaining({ id: friendId, handle: FRIEND.handle, birthdate: null, canSeeAlcohol: false, blockedAt: expect.any(String) }),
    ]);

    await api.blocks.unblock(friendId);
    await api.blocks.unblock(friendId); // idempotent
    expect((await api.blocks.list()).items).toEqual([]);
    expect((await api.profile.getUser(friendId)).isFollowing).toBe(false);
    expect((await api.follows.listFollowing(me.userId, { limit: 50 })).items.some((p) => p.id === friendId)).toBe(false);
  });

  it('refuses a self-block as validation and an unknown user as not_found', async () => {
    const { api, me } = await setup();
    await expect(api.blocks.block(me.userId)).rejects.toMatchObject({ code: 'validation' });
    await expect(api.blocks.block('no-such-user')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('report is idempotent per content and validates as report_content does', async () => {
    const { api, me, friendPost } = await setup();
    const first = await api.reports.report({ kind: 'post', id: friendPost.id, reason: 'spam' });
    const again = await api.reports.report({ kind: 'post', id: friendPost.id, reason: 'hate', note: 'different' });
    expect(again).toEqual(first);
    const profile = await api.reports.report({ kind: 'profile', id: friendId, reason: 'harassment' });
    expect(profile.reportId).not.toBe(first.reportId);

    await expect(api.reports.report({ kind: 'profile', id: me.userId, reason: 'spam' })).rejects.toMatchObject({ code: 'validation' });
    await expect(api.reports.report({ kind: 'post', id: friendPost.id, reason: 'nope' as never })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'reason' },
    });
    await expect(
      api.reports.report({ kind: 'profile', id: friendId, reason: 'spam', note: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'note' } });
    await expect(api.reports.report({ kind: 'post', id: 'no-such-post', reason: 'spam' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('Block then Report works for the blocker, and the blocked person cannot report back', async () => {
    const { api, friendPost, myPost } = await setup();
    await api.blocks.block(friendId);
    await expect(api.reports.report({ kind: 'post', id: friendPost.id, reason: 'harassment' })).resolves.toEqual({
      reportId: expect.any(String),
    });

    api.signInAs(FRIEND.handle);
    await expect(api.reports.report({ kind: 'post', id: myPost.id, reason: 'spam' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it("a stranger's Explore post is reportable, until its author blocks the caller", async () => {
    const { api, me } = await setup();
    const explore = (await api.feed.getExplore({ limit: 100 })).items;
    const first = explore[0]!;
    const other = explore.find((p) => p.actor.id !== first.actor.id)!;
    expect(first).toBeDefined();
    expect(other).toBeDefined();
    // A stranger's post: the feed's rule alone would say not_found.
    await expect(api.comments.list(first.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.reports.report({ kind: 'post', id: first.id, reason: 'spam' })).resolves.toEqual({ reportId: expect.any(String) });

    // The author of another Explore post blocks the caller: it reads as missing, Explore or not.
    api.signInAs(other.actor.handle);
    await api.blocks.block(me.userId);
    api.signInAs(ME.handle);
    expect((await api.feed.getExplore({ limit: 100 })).items.some((p) => p.id === other.id)).toBe(false);
    await expect(api.reports.report({ kind: 'post', id: other.id, reason: 'spam' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a comment by someone who blocked the caller is not reportable, though its post is visible', async () => {
    const { api, me, friendPost } = await setup();
    api.signInAs('friend_b');
    const comment = await api.comments.add(friendPost.id, 'friend_b on friend_a');
    await api.blocks.block(me.userId);
    api.signInAs(ME.handle);
    await expect(api.comments.list(friendPost.id)).resolves.toMatchObject({ items: expect.not.arrayContaining([expect.objectContaining({ id: comment.id })]) });
    await expect(api.reports.report({ kind: 'comment', id: comment.id, reason: 'spam' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

// DELIVERABLE-44: go-to categories, with set_category_picks' rules (20261128000200).
describe('category picks', () => {
  it('is [] until set; set returns and reads back favourite first; replace and clear', async () => {
    const api = make();
    await signInMe(api);
    expect(await api.profile.getCategoryPicks()).toEqual([]);

    expect(await api.profile.setCategoryPicks(['coffee', 'soda', 'tea'])).toEqual(['coffee', 'soda', 'tea']);
    expect(await api.profile.getCategoryPicks()).toEqual(['coffee', 'soda', 'tea']);

    expect(await api.profile.setCategoryPicks(['tea', 'coffee'])).toEqual(['tea', 'coffee']);
    expect(await api.profile.getCategoryPicks()).toEqual(['tea', 'coffee']);

    expect(await api.profile.setCategoryPicks([])).toEqual([]);
    expect(await api.profile.getCategoryPicks()).toEqual([]);
  });

  it('refuses too many, a repeat, a leaf and an unknown id on categoryIds, and saves nothing', async () => {
    const api = make();
    await signInMe(api);
    await api.profile.setCategoryPicks(['water']);
    const refused = { code: 'validation', detail: { field: 'categoryIds' } };
    await expect(api.profile.setCategoryPicks(['soda', 'juice', 'tea', 'coffee'])).rejects.toMatchObject(refused);
    await expect(api.profile.setCategoryPicks(['soda', 'soda'])).rejects.toMatchObject(refused);
    await expect(api.profile.setCategoryPicks(['cola' as never])).rejects.toMatchObject(refused);
    await expect(api.profile.setCategoryPicks(['no_such_category' as never])).rejects.toMatchObject(refused);
    expect(await api.profile.getCategoryPicks()).toEqual(['water']);
  });

  it('an alcoholic category is age_restricted when the caller cannot see alcohol, and fine at 21+', async () => {
    const api = make();
    api.signInAs(MINOR.handle);
    await expect(api.profile.setCategoryPicks(['beer'])).rejects.toMatchObject({ code: 'age_restricted' });
    await expect(api.profile.setCategoryPicks(['soda', 'wine'])).rejects.toMatchObject({ code: 'age_restricted' });
    // Validation first, as in the RPC: a leaf under beer is the wrong id, not a restricted one.
    await expect(api.profile.setCategoryPicks(['lager' as never])).rejects.toMatchObject({ code: 'validation' });
    expect(await api.profile.getCategoryPicks()).toEqual([]);
    expect(await api.profile.setCategoryPicks(['boba', 'energy'])).toEqual(['boba', 'energy']);

    api.signInAs(ME.handle);
    expect(await api.profile.setCategoryPicks(['beer', 'wine', 'spirits_cocktails'])).toEqual(['beer', 'wine', 'spirits_cocktails']);
  });

  it("are private: another user reads only their own, and signed out is unauthorized", async () => {
    const api = make();
    await signInMe(api);
    await api.profile.setCategoryPicks(['juice']);
    api.signInAs(FRIEND.handle);
    expect(await api.profile.getCategoryPicks()).toEqual([]);
    await api.signOut();
    await expect(api.profile.getCategoryPicks()).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(api.profile.setCategoryPicks(['soda'])).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('go with the account when it is deleted, and with a first-run reset', async () => {
    const storage = memoryStorage();
    const stored = () => (JSON.parse(storage.data.get(STORAGE_KEY)!) as FakeDb).categoryPicks ?? {};
    const api = make(storage);
    const me = await signInMe(api);
    await api.profile.setCategoryPicks(['juice']);
    api.emptyUser();
    expect(await api.profile.getCategoryPicks()).toEqual([]);

    await api.profile.setCategoryPicks(['tea']);
    api.signInAs(FRIEND.handle);
    await api.profile.setCategoryPicks(['soda']);
    api.signInAs(ME.handle);
    expect(stored()[me.userId]).toEqual(['tea']);
    await api.deleteAccount();
    expect(stored()).toEqual({ [userIdFor(FRIEND.handle)]: ['soda'] });
  });
});

// BEV-22: the two `venues` methods the conformance suite cannot exercise, because what an outside
// directory holds is not something a contract can promise. Here it is the fixtures' two places.
describe('venues.searchMore and addPlace (BEV-22)', () => {
  const NEAR = { lat: 40.7736, lng: -73.9566 };

  it('searchMore finds a place Bevi does not have, with its distance from the caller', async () => {
    const api = make();
    await api.signIn({ username: ME.handle, password: ME.password });

    expect(await api.venues.search({ query: 'bread butter' })).toEqual([]);
    const places = await api.venues.searchMore({ query: 'bread', near: NEAR });
    expect(places).toEqual([expect.objectContaining({ placeId: 'ext-bread-butter', name: 'Bread & Butter Market' })]);
    expect(places[0]!.distanceMeters).toBeGreaterThan(0);
    expect((await api.venues.searchMore({ query: 'long hall' }))[0]).toMatchObject({ placeId: 'ext-long-hall', distanceMeters: null });

    await expect(api.venues.searchMore({ query: '  ' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('addPlace makes a venue of it once, which search then finds and a Bev can be tagged with', async () => {
    const api = make();
    await api.signIn({ username: ME.handle, password: ME.password });

    const venue = await api.venues.addPlace('ext-long-hall');
    expect(venue).toMatchObject({ name: 'The Long Hall', lat: 53.3419, neighborhood: null });
    expect((await api.venues.addPlace('ext-long-hall')).id).toBe(venue.id);
    expect((await api.venues.search({ query: 'long hall' })).map((m) => m.venue.id)).toEqual([venue.id]);

    const mine = (await api.rankings.listMine()).items[0]!;
    await api.rankings.setVenue(mine.bev.id, venue.id);
    expect((await api.venues.bevdMap({ scope: 'mine' })).map((p) => p.venue.name)).toContain('The Long Hall');

    await expect(api.venues.addPlace('ext-nowhere')).rejects.toMatchObject({ code: 'not_found' });
  });
});

// T-31. The conformance suite covers the inbox's behaviour on fresh accounts; these pin the fake's
// own seeded inbox for ME and the parts only the fake has (fixture rows, controls, failNext).
describe('notifications (T-31)', () => {
  const id = (handle: string) => userIdFor(handle);

  async function myPosts(api: FakeApi, meId: string) {
    return (await api.feed.listUser(meId, { limit: 50 })).items;
  }

  it("seeds ME's inbox: two unread likes as one row, an unread comment and follow, three read ones", async () => {
    const api = make();
    const me = await signInMe(api);
    const [newest, second] = await myPosts(api, me.userId);
    const { items, nextCursor } = await api.notifications.list();
    expect(nextCursor).toBeNull();
    expect(items.map((n) => [n.kind, n.unread, n.actors.map((p) => p.handle)])).toEqual([
      ['like', true, [FRIEND.handle, 'friend_b']],
      ['comment', true, [FRIEND.handle]],
      ['follow', true, ['friend_e']],
      ['comment', false, ['friend_b']],
      ['like', false, ['friend_d']],
      ['follow', false, ['friend_d']],
    ]);
    expect(items[0]).toMatchObject({ actorCount: 2, postId: newest!.id, bev: { id: newest!.bev.id }, comment: null });
    expect(items[1]).toMatchObject({ postId: second!.id, comment: { body: expect.any(String) } });
    // friend_e follows ME and ME does not follow back; friend_d is followed both ways.
    expect(items[2]!.actors[0]).toMatchObject({ id: id('friend_e'), isFollowing: false });
    expect(items[5]!.actors[0]).toMatchObject({ id: id('friend_d'), isFollowing: true });
    expect(items.slice(3).every((n) => Date.parse(n.createdAt) < FIXED_NOW.getTime() - 7 * 24 * 3600 * 1000)).toBe(true);
    expect(await api.notifications.unreadCount()).toBe(3);
    // The fixtures add no likes, comments or follows of their own: the post still reads as it did.
    expect((await api.feed.getPost(newest!.id)).likeCount).toBe(0);
  });

  it('pages by keyset, each row once, and markRead stops at the id it is given', async () => {
    const api = make();
    await signInMe(api);
    const all = (await api.notifications.list()).items;
    const page1 = await api.notifications.list({ limit: 4 });
    const page2 = await api.notifications.list({ limit: 4, cursor: page1.nextCursor! });
    expect(page2.nextCursor).toBeNull();
    expect([...page1.items, ...page2.items].map((n) => n.id)).toEqual(all.map((n) => n.id));

    await api.notifications.markRead(all[2]!.id);
    expect(await api.notifications.unreadCount()).toBe(2);
    await api.notifications.markRead();
    expect(await api.notifications.unreadCount()).toBe(0);
    await expect(api.notifications.markRead('feed-1')).rejects.toMatchObject({ code: 'validation', detail: { field: 'upToId' } });
  });

  it("a friend's like and comment arrive, an unlike hides the like, and your own like notifies nobody", async () => {
    const api = make();
    const me = await signInMe(api);
    const third = (await myPosts(api, me.userId))[2]!;
    await api.feed.like(third.id);
    expect(await api.notifications.unreadCount()).toBe(3);

    api.signInAs(FRIEND.handle);
    await api.feed.like(third.id);
    await api.comments.add(third.id, 'from friend a');
    api.signInAs(ME.handle);
    const [comment, like] = (await api.notifications.list()).items;
    expect(comment).toMatchObject({ kind: 'comment', postId: third.id, comment: { body: 'from friend a' }, unread: true });
    expect(like).toMatchObject({ kind: 'like', postId: third.id, actorCount: 1, unread: true });
    expect(await api.notifications.unreadCount()).toBe(5);

    api.signInAs(FRIEND.handle);
    await api.feed.unlike(third.id);
    await api.feed.like(third.id);
    await api.feed.unlike(third.id);
    api.signInAs(ME.handle);
    expect((await api.notifications.list()).items.filter((n) => n.postId === third.id).map((n) => n.kind)).toEqual(['comment']);
    expect(await api.notifications.unreadCount()).toBe(4);
  });

  it('a block hides even a fixture row; deleting an account takes its rows', async () => {
    const api = make();
    await signInMe(api);
    await api.blocks.block(id('friend_e'));
    expect((await api.notifications.list()).items.some((n) => n.actors.some((p) => p.id === id('friend_e')))).toBe(false);
    expect(await api.notifications.unreadCount()).toBe(2);

    api.signInAs(FRIEND.handle);
    await api.deleteAccount();
    await signInMe(api);
    const items = (await api.notifications.list()).items;
    expect(items.some((n) => n.actors.some((p) => p.id === id(FRIEND.handle)))).toBe(false);
    expect(items[0]).toMatchObject({ kind: 'like', actorCount: 1 });
  });

  it('controls: clearNotifications empties the inbox until resetToFixtures; failNext reaches the methods', async () => {
    const api = make();
    await signInMe(api);
    api.clearNotifications();
    expect(await api.notifications.list()).toEqual({ items: [], nextCursor: null });
    expect(await api.notifications.unreadCount()).toBe(0);
    api.resetToFixtures();
    await signInMe(api);
    expect(await api.notifications.unreadCount()).toBe(3);

    api.failNext('network', 'notifications.list');
    await expect(api.notifications.list()).rejects.toMatchObject({ code: 'network' });
    api.failNext('network', 'notifications.unreadCount');
    await expect(api.notifications.unreadCount()).rejects.toMatchObject({ code: 'network' });
    api.failNext('network', 'feed.getPost');
    await expect(api.feed.getPost('feed-1')).rejects.toMatchObject({ code: 'network' });
    await api.signOut();
    await expect(api.notifications.list()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it("feed.getPost: own and followed posts as the feed shows them; a stranger's or a missing one is not_found", async () => {
    const api = make();
    await signInMe(api);
    const feed = (await api.feed.getFeed({ limit: 100 })).items;
    const friendPost = feed.find((i) => i.actor.id === id(FRIEND.handle))!;
    expect(await api.feed.getPost(friendPost.id)).toEqual(friendPost);

    api.signInAs('friend_e');
    const strangerPost = (await api.feed.listUser(id('friend_e'), { limit: 1 })).items[0]!;
    await signInMe(api);
    await expect(api.feed.getPost(strangerPost.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.feed.getPost('feed-does-not-exist')).rejects.toMatchObject({ code: 'not_found' });
  });
});

// T-31 Release 2. The conformance suite covers settings, post subscriptions and tokens on fresh
// accounts; these pin what only the fake has: `pendingPushes` (the server's claim rules, applied to
// what was queued), `pushTokens`, and the re-rank cascade the fake has to do by hand.
describe('push notifications (T-31 Release 2)', () => {
  const id = (handle: string) => userIdFor(handle);

  /** A starter Bev `handle` has not ranked, ranked by them at the bottom of LOVED. */
  async function rankSomethingNew(api: FakeApi) {
    const mine = new Set((await api.rankings.listMine({ page: { limit: 100 } })).items.map((r) => r.bev.id));
    const bev = (await api.bevs.getStarterCandidates()).find((b) => !mine.has(b.id))!;
    const ids = await api.rankings.listBucket('LOVED');
    await api.rankings.submitRanking({ bevId: bev.id, bucket: 'LOVED', insertIndex: ids.length, expectedBucketSize: ids.length, comparisons: [] });
    return bev.id;
  }

  it('pendingPushes: the settings, the subscription and "new rankings only" decide what would be pushed', async () => {
    const api = make();
    const me = await signInMe(api);
    const myPost = (await api.feed.listUser(me.userId, { limit: 3 })).items[2]!;
    await api.notifications.setPostNotification(id(FRIEND.handle), true);

    api.signInAs(FRIEND.handle);
    await api.feed.like(myPost.id);
    const bevId = await rankSomethingNew(api);
    const post = (await api.feed.listUser(id(FRIEND.handle), { limit: 1 })).items[0]!;
    api.signInAs(ME.handle);

    // posts is off by default: the like only.
    expect(api.pendingPushes(me.userId)).toEqual([{ kind: 'like', actorHandle: FRIEND.handle, postId: myPost.id }]);
    const on = { paused: false, follows: true, likes: true, comments: true, posts: true };
    await api.notifications.updateSettings(on);
    expect(api.pendingPushes(me.userId)).toEqual([
      { kind: 'like', actorHandle: FRIEND.handle, postId: myPost.id },
      { kind: 'post', actorHandle: FRIEND.handle, postId: post.id },
    ]);
    // Paused: nothing. Un-paused with likes off: the post only.
    await api.notifications.updateSettings({ ...on, paused: true });
    expect(api.pendingPushes(me.userId)).toEqual([]);
    await api.notifications.updateSettings({ ...on, likes: false });
    expect(api.pendingPushes(me.userId)).toEqual([{ kind: 'post', actorHandle: FRIEND.handle, postId: post.id }]);

    // A re-rank queues nothing, and its old post (gone on the server) takes its push with it.
    api.signInAs(FRIEND.handle);
    const ids = (await api.rankings.listBucket('LOVED')).filter((x) => x !== bevId);
    await api.rankings.rerankBev({ bevId, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: ids.length, comparisons: [] });
    api.signInAs(ME.handle);
    expect(api.pendingPushes(me.userId)).toEqual([]);
  });

  it('pendingPushes: an unlike, an unfollow of the person chosen, and a block each drop a push', async () => {
    const api = make();
    const me = await signInMe(api);
    await api.notifications.updateSettings({ paused: false, follows: true, likes: true, comments: true, posts: true });
    await api.notifications.setPostNotification(id(FRIEND.handle), true);
    const myPost = (await api.feed.listUser(me.userId, { limit: 3 })).items[2]!;

    api.signInAs(FRIEND.handle);
    await api.feed.like(myPost.id);
    await api.feed.unlike(myPost.id);
    await rankSomethingNew(api);
    api.signInAs(ME.handle);
    expect(api.pendingPushes(me.userId).map((p) => p.kind)).toEqual(['post']);

    await api.follows.unfollow(id(FRIEND.handle));
    expect(api.pendingPushes(me.userId)).toEqual([]);
    expect((await api.notifications.listPostNotificationPeople({ q: FRIEND.handle })).items).toEqual([]);
    await api.follows.follow(id(FRIEND.handle));
    expect((await api.notifications.listPostNotificationPeople({ q: FRIEND.handle })).items).toMatchObject([
      { id: id(FRIEND.handle), subscribed: false, isFollowing: true },
    ]);

    // friend_b comments on ME's post; ME blocks friend_b: the push goes, and so does friend_b.
    api.signInAs('friend_b');
    await api.comments.add(myPost.id, 'from friend b');
    api.signInAs(ME.handle);
    expect(api.pendingPushes(me.userId)).toEqual([{ kind: 'comment', actorHandle: 'friend_b', postId: myPost.id }]);
    await api.blocks.block(id('friend_b'));
    expect(api.pendingPushes(me.userId)).toEqual([]);
    expect((await api.notifications.listPostNotificationPeople({ q: 'friend_b' })).items).toEqual([]);
  });

  it("re-ranking a post drops the notifications about it, as the server's cascade does", async () => {
    const api = make();
    const me = await signInMe(api);
    const [newest] = (await api.feed.listUser(me.userId, { limit: 1 })).items;
    expect(await api.notifications.unreadCount()).toBe(3);
    const bucket = newest!.bucket;
    const ids = (await api.rankings.listBucket(bucket)).filter((x) => x !== newest!.bev.id);
    await api.rankings.rerankBev({ bevId: newest!.bev.id, bucket, insertIndex: 0, expectedBucketSize: ids.length, comparisons: [] });
    // The pair of likes on that post is gone; the comment and the follow are not.
    expect((await api.notifications.list()).items.some((n) => n.postId === newest!.id)).toBe(false);
    expect(await api.notifications.unreadCount()).toBe(2);
  });

  it('device tokens: one device, one account; ten per user; only your own can be unregistered', async () => {
    const api = make();
    const me = await signInMe(api);
    const t = (n: number) => `ExponentPushToken[fake-${n}]`;
    await api.notifications.registerPushToken(t(1));
    expect(api.pushTokens(me.userId)).toEqual([t(1)]);
    await expect(api.notifications.registerPushToken('nope')).rejects.toMatchObject({ code: 'validation', detail: { field: 'token' } });

    api.signInAs(FRIEND.handle);
    await api.notifications.registerPushToken(t(1));
    expect(api.pushTokens(me.userId)).toEqual([]);
    expect(api.pushTokens(id(FRIEND.handle))).toEqual([t(1)]);
    for (let n = 2; n <= 11; n++) await api.notifications.registerPushToken(t(n));
    expect(api.pushTokens(id(FRIEND.handle))).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map(t));

    api.signInAs(ME.handle);
    await api.notifications.unregisterPushToken(t(11));
    expect(api.pushTokens(id(FRIEND.handle))).toHaveLength(10);

    api.resetToFixtures();
    expect(api.pushTokens(id(FRIEND.handle))).toEqual([]);
  });

  it('controls reach the same state, and failNext reaches the new methods', async () => {
    const api = make();
    const me = await signInMe(api);
    expect(controls.pendingPushes).toBeDefined();
    expect(controls.pushTokens).toBeDefined();
    api.failNext('network', 'notifications.getSettings');
    await expect(api.notifications.getSettings()).rejects.toMatchObject({ code: 'network' });
    expect(await api.notifications.getSettings()).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: false });
    expect(api.pendingPushes(me.userId)).toEqual([]);
  });
});
