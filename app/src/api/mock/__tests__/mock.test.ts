import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUCKET_ORDER, CONFIDENCE_LOCK, MIN_N_USER, RANKING_VERSION, rankUsers, storedScore } from '@bevi/ranking';
import { isApiError, type Session } from '@bevi/shared';

import { STORAGE_KEY, type StorageLike } from '../db';
import { buildFixtures } from '../fixtures';
import { MOCK_INVITE_CODE, MockApi } from '../MockApi';
import catalog from '../seed/catalog.json';
import { DEMO_HANDLE, DEMO_PASSWORD, EXTRA_BEVS, MOCK_ALCOHOLIC_BEV_ID } from '../seed/extra';

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const make = (storage: StorageLike | null = null) => new MockApi({ storage, latency: 0 });

async function signInDemo(api: MockApi) {
  return api.signIn({ username: DEMO_HANDLE, password: DEMO_PASSWORD });
}

describe('seed', () => {
  it('catalog.json matches data/catalog/bevs.csv (re-run app/scripts/build-mock-seed.mjs)', () => {
    const csv = readFileSync(resolve(__dirname, '../../../../../data/catalog/bevs.csv'), 'utf8');
    const slugs = csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]);
    expect(catalog.bevs.map((b) => b.id)).toEqual(slugs);
  });

  it('mock-only Bevs are marked with a mock- id prefix and don\'t collide with the catalog', () => {
    const ids = new Set(catalog.bevs.map((b) => b.id));
    for (const b of EXTRA_BEVS) {
      expect(b.id.startsWith('mock-')).toBe(true);
      expect(ids.has(b.id)).toBe(false);
    }
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
  it('the demo account has rankings, a feed, featured Bevs, a leaderboard and recommendations', async () => {
    const api = make();
    await signInDemo(api);
    const me = await api.profile.getMe();
    expect(me).toMatchObject({ handle: 'demo', onboarded: true, canSeeAlcohol: true });
    expect((await api.rankings.listMine()).items).toHaveLength(12);
    expect((await api.feed.getFeed()).items.length).toBeGreaterThan(10);
    expect((await api.feed.getFeatured()).length).toBeGreaterThanOrEqual(3);
    expect((await api.leaderboard.bevs()).items.length).toBeGreaterThan(0);
    expect((await api.leaderboard.users()).items.length).toBeGreaterThan(3);
    const stats = await api.stats.getMine();
    expect(stats.following).toBe(4);
    const recs = await api.recs.getRecommendations();
    expect(recs.items.length).toBeGreaterThan(5);
    expect(recs.rankingVersion).toBe(RANKING_VERSION);
    expect((await api.bevs.get(recs.items[0]!.bev.id)).prediction).not.toBeNull();
  });

  it('category leaderboard rows carry the board\'s Bayesian score on the Bev too', async () => {
    const api = make();
    await signInDemo(api);
    const rows = (await api.leaderboard.bevs({ categoryId: 'soda' })).items;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.bev.bayesScore).toBe(row.bayesScore);
  });

  it('theo (under 21) never sees alcoholic categories, Bevs or featured items', async () => {
    const api = make();
    api.signInAs('theo');
    expect((await api.profile.getMe()).canSeeAlcohol).toBe(false);
    expect((await api.categories.list()).some((c) => c.isAlcoholic)).toBe(false);
    expect((await api.feed.getFeatured()).map((f) => f.bev.id)).not.toContain(MOCK_ALCOHOLIC_BEV_ID);
    expect((await api.bevs.search({ q: '', limit: 100 })).items.map((b) => b.id)).not.toContain(MOCK_ALCOHOLIC_BEV_ID);
    expect((await api.bevs.getStarterCandidates()).length).toBeGreaterThanOrEqual(30);
    await expect(api.bevs.get(MOCK_ALCOHOLIC_BEV_ID)).rejects.toMatchObject({ code: 'age_restricted' });
  });

  it('bevs.create rejects a photo that is still processing (validation), then accepts it once ready', async () => {
    let now = new Date('2026-10-11T12:00:00Z');
    const api = new MockApi({ storage: null, latency: 0, now: () => now });
    await signInDemo(api);
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
});

describe('persistence', () => {
  it('persists to storage and restores, including the session', async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await a.signUp({ username: 'persisted', password: 'password1', inviteCode: MOCK_INVITE_CODE });
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const b = make(storage);
    expect(await b.getSession()).toMatchObject({ handle: 'persisted' });
  });

  it('falls back to fixtures when the stored db is corrupt', async () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const api = make(storage);
    await expect(signInDemo(api)).resolves.toMatchObject({ handle: 'demo' });
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
    await signInDemo(api);
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
    await signInDemo(api);
    api.failNext('conflict', 'rankings.submitRanking');
    await expect(api.profile.getMe()).resolves.toBeDefined();
    const err = await api.rankings
      .submitRanking({ bevId: 'pepsi', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] })
      .catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('conflict');
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
    await api.signUp({ username: 'temp_user', password: 'password1', inviteCode: MOCK_INVITE_CODE });
    const events: (Session | null)[] = [];
    api.onAuthChange((s) => events.push(s));
    api.resetToFixtures();
    expect(events).toEqual([null]);
    expect(await api.getSession()).toBeNull();
    expect(await api.profile.checkHandle('temp_user')).toEqual({ available: true });
  });

  it('emptyUser gives the signed-in user a first-run state', async () => {
    const api = make();
    await signInDemo(api);
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
    const api = new MockApi({ storage: null, latency: 0, now: () => clock.now });
    return { api, clock };
  };
  /** Ranks each Bev into its own (empty) bucket: no comparisons needed. Up to three. */
  const rankInto = async (api: MockApi, bevId: string, i: number) =>
    api.rankings.submitRanking({ bevId, bucket: BUCKET_ORDER[i]!, insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('demo gets a prediction on an unranked Bev (above MIN_N_USER) and none on a ranked one', async () => {
    const { api } = clocked(NOW);
    await signInDemo(api);
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
    await api.signUp({ username: 'predictor', password: 'password1', inviteCode: MOCK_INVITE_CODE });
    const ids = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    const target = ids[MIN_N_USER]!;
    for (let i = 0; i < MIN_N_USER; i++) {
      expect((await api.bevs.get(target)).prediction).toBeNull();
      await rankInto(api, ids[i]!, i);
    }
    expect((await api.bevs.get(target)).prediction).not.toBeNull();
  });

  it('demo\'s Recommended list has unlocked bubbles and is stable within a local day', async () => {
    const { api, clock } = clocked('2026-10-11T12:00:00Z');
    await signInDemo(api);
    const morning = await api.recs.getRecommendations();
    expect(morning.basedOnCount).toBe(12);
    expect(morning.items.filter((r) => r.confidence >= CONFIDENCE_LOCK).length).toBeGreaterThan(3);
    expect(morning.items.some((r) => r.isExploration)).toBe(true);
    // 20:00Z is still 2026-10-11 in demo's America/New_York: same seed, same list.
    clock.now = new Date('2026-10-11T20:00:00Z');
    const evening = await api.recs.getRecommendations();
    const strip = (items: typeof morning.items) => items.map(({ generatedAt: _g, ...rest }) => rest);
    expect(strip(evening.items)).toEqual(strip(morning.items));
    expect(evening.generatedAt).toBe('2026-10-11T20:00:00.000Z');
  });

  it('streaks count local days in the profile timezone and break after a missed day', async () => {
    const { api, clock } = clocked('2026-10-12T03:00:00Z'); // 2026-10-11 23:00 in New York
    await api.signUp({ username: 'streaker', password: 'password1', inviteCode: MOCK_INVITE_CODE });
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
    await api.signUp({ username: 'remover', password: 'password1', inviteCode: MOCK_INVITE_CODE });
    const [id] = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    await rankInto(api, id!, 0);
    await api.rankings.removeRanking(id!);
    expect(await api.stats.getMine()).toMatchObject({ bevdCount: 0, currentStreak: 1, streakAliveToday: true });
  });

  it('the user leaderboard\'s order, ranks and points are rankUsers over the mock\'s data', async () => {
    const now = new Date(NOW);
    const { api } = clocked(NOW);
    await signInDemo(api);
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
    // The seed plants streaks (demo ranked today and yesterday).
    expect((await api.stats.getMine()).currentStreak).toBeGreaterThanOrEqual(2);
  });
});
