// Recommendations, predicted scores, "rank on Bevi" and card fields against a
// real local stack (skipped without SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).
import { MIN_N_USER, RANKING_VERSION } from '@bevi/ranking';
import type { Bucket } from '@bevi/shared';
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';
import { randomTestUsername } from './testUsername.ts';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

function memoryStorage(): AuthStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

async function newUser() {
  const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
  const session = await api.signUp({ username: randomTestUsername(), password: 'correct-horse-battery-staple', inviteCode: 'local-test-invite-code' });
  await api.profile.setBirthDate('1990-01-01');
  return { api, session };
}

/** Ranks `bevIds` into `bucket`, best first (each lands at the bottom of the bucket). */
async function rankAll(api: ReturnType<typeof createBeviApi>, bevIds: string[], bucket: Bucket) {
  for (const bevId of bevIds) {
    const { size } = await api.rankings.listBucket(bucket).then((ids) => ({ size: ids.length }));
    await api.rankings.submitRanking({ bevId, bucket, insertIndex: size, expectedBucketSize: size, comparisons: [] });
  }
}

describe.skipIf(!url || !publishableKey)('recommendations, predictions and stats, against a live local stack', () => {
  it('locks recommendations below MIN_N_USER rankings, then recommends and predicts', async () => {
    const { api } = await newUser();
    try {
      const starters = await api.bevs.getStarterCandidates();
      const empty = await api.recs.getRecommendations();
      expect(empty).toMatchObject({ items: [], basedOnCount: 0, rankingVersion: RANKING_VERSION });

      const ranked = starters.slice(0, MIN_N_USER + 1).map((b) => b.id);
      await rankAll(api, ranked.slice(0, 2), 'LOVED');
      await rankAll(api, ranked.slice(2), 'DISLIKED');

      const recs = await api.recs.getRecommendations({ limit: 10 });
      expect(recs.basedOnCount).toBe(ranked.length);
      expect(recs.items.length).toBeGreaterThan(0);
      expect(recs.items.length).toBeLessThanOrEqual(10);
      for (const item of recs.items) {
        expect(ranked).not.toContain(item.bev.id); // never something you've ranked
        expect(item.bev.name).toBeTruthy();
        expect(item.predictedScore).toBeGreaterThanOrEqual(0);
        expect(item.predictedScore).toBeLessThanOrEqual(10);
      }

      // A prediction on an unranked Bev, none on a ranked one.
      const unranked = await api.bevs.get(recs.items[0]!.bev.id);
      expect(unranked.prediction).toMatchObject({ rankingVersion: RANKING_VERSION });
      expect((await api.bevs.get(ranked[0]!)).prediction).toBeNull();
    } finally {
      await api.deleteAccount();
    }
  });

  it('profile stats and the People leaderboard agree on rank and points', async () => {
    const { api, session } = await newUser();
    try {
      const before = await api.stats.getMine();
      expect(before).toMatchObject({ bevdCount: 0, rankOnBevi: null, rankPoints: 0, currentStreak: 0, streakAliveToday: false });

      const [first, second] = await api.bevs.getStarterCandidates();
      await rankAll(api, [first!.id, second!.id], 'FINE');

      const after = await api.stats.getMine();
      // bevsRanked(2)*1 + currentStreak(1)*3 = 5.
      expect(after).toMatchObject({ bevdCount: 2, rankPoints: 5, currentStreak: 1, longestStreak: 1, streakAliveToday: true });
      expect(after.rankOnBevi).toBeGreaterThanOrEqual(1);

      const row = (await api.leaderboard.users()).items.find((r) => r.profile.id === session.userId);
      expect(row).toMatchObject({ points: after.rankPoints, rank: after.rankOnBevi });
      expect(await api.stats.getUser(session.userId)).toEqual(after);
    } finally {
      await api.deleteAccount();
    }
  });

  it('search and duplicate cards carry the real category and price', async () => {
    const { api } = await newUser();
    try {
      const [hit] = (await api.bevs.search({ q: 'diet coke' })).items;
      expect(hit).toBeDefined();
      const full = await api.bevs.get(hit!.id);
      expect(hit).toMatchObject({ categoryId: full.categoryId, priceTier: full.priceTier, priceEstimated: full.priceEstimated });

      const dups = await api.bevs.findLikelyDuplicates({ name: full.name, brand: full.brand ?? undefined, flavor: full.flavor ?? undefined });
      const same = dups.find((d) => d.id === full.id);
      expect(same).toMatchObject({ categoryId: full.categoryId, priceTier: full.priceTier });
    } finally {
      await api.deleteAccount();
    }
  });
});
