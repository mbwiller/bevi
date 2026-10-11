import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUCKET_ORDER, RANKING_VERSION, storedScore } from '@bevi/ranking';
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
  it('the demo account has rankings, a feed, featured Bevs, a leaderboard and predictions', async () => {
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
    expect(stats.currentStreak).toBeGreaterThanOrEqual(1);
    const recs = await api.recs.getRecommendations();
    expect(recs.items.length).toBeGreaterThan(5);
    expect(recs.rankingVersion).toBe(RANKING_VERSION);
    expect(recs.items.some((r) => r.isExploration)).toBe(true);
    const unranked = recs.items[0]!.bev.id;
    const bev = await api.bevs.get(unranked);
    expect(bev.prediction).toMatchObject({ rankingVersion: RANKING_VERSION });
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

  it('a Bev created with a processing photo becomes ready', async () => {
    let now = new Date('2026-10-11T12:00:00Z');
    const api = new MockApi({ storage: null, latency: 0, now: () => now });
    await signInDemo(api);
    const up = await api.media.upload({ kind: 'bev-photo', file: new Blob(['x']), mimeType: 'image/jpeg' });
    expect(up.status).toBe('processing');
    const bev = await api.bevs.create({ name: 'Garage Cola', categoryId: 'soda', priceTier: 1, priceEstimated: false, photoAssetId: up.assetId });
    expect(bev.photoStatus).toBe('processing');
    expect(bev.photoUrl).toBe(up.url);
    now = new Date(now.getTime() + 5000);
    expect((await api.bevs.get(bev.id)).photoStatus).toBe('ready');
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
