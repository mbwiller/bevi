// Recommendations, predicted scores, "rank on Bevi" and card fields against a
// real local stack (skipped without SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).
import { categoryAffinity, effectiveUserStats, MIN_N_USER, populationStats, RANKING_VERSION, zScore } from '@bevi/ranking';
import type { Bucket } from '@bevi/shared';
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';
import { randomTestUsername, TEST_INVITE_CODE } from './testUsername.ts';

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
  const session = await api.signUp({ username: randomTestUsername(), password: 'correct-horse-battery-staple', inviteCode: TEST_INVITE_CODE });
  try {
    await api.profile.setBirthDate('1990-01-01');
  } catch (e) {
    await api.deleteAccount();
    throw e;
  }
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

  it('category progress counts the caller\'s rankings against the active catalog (S-07)', async () => {
    const { api } = await newUser();
    try {
      const empty = await api.stats.getCategoryProgress();
      const categories = await api.categories.list();
      expect(empty.map((p) => p.categoryId)).toEqual(categories.map((c) => c.id));
      expect(empty.every((p) => p.ranked === 0)).toBe(true);
      // categories.list() and getCategoryProgress() read the same count.
      for (const c of categories) expect(c.bevCount).toBe(empty.find((p) => p.categoryId === c.id)!.total);

      const [first] = await api.bevs.getStarterCandidates();
      await rankAll(api, [first!.id], 'LOVED');
      const after = await api.stats.getCategoryProgress();
      expect(after.find((p) => p.categoryId === first!.categoryId)).toMatchObject({ ranked: 1 });
      expect(after.reduce((sum, p) => sum + p.ranked, 0)).toBe(1);
      expect(after.every((p) => p.ranked <= p.total)).toBe(true);
    } finally {
      await api.deleteAccount();
    }
  });

  it('taste profile: per-category means and affinities as @bevi/ranking computes them (S-12)', async () => {
    const { api } = await newUser();
    const { api: viewer } = await newUser();
    try {
      expect(await api.stats.getTasteProfile((await api.profile.getMe()).id)).toEqual([]);

      // MIN_N_USER rankings over at least two categories, so z uses the user's own stats.
      const starters = await api.bevs.getStarterCandidates();
      const first = starters[0]!;
      const other = starters.find((b) => b.categoryId !== first.categoryId)!;
      const third = starters.find((b) => b.id !== first.id && b.id !== other.id)!;
      const picks = [first, other, third];
      expect(new Set(picks.map((b) => b.id)).size).toBe(MIN_N_USER);
      await rankAll(api, picks.slice(0, 2).map((b) => b.id), 'LOVED');
      await rankAll(api, picks.slice(2).map((b) => b.id), 'FINE');

      const mine = (await api.rankings.listMine()).items;
      const overall = effectiveUserStats(populationStats(mine.map((r) => r.score)), { n: 0, mean: 0, stddev: 0 });
      const byCat = new Map<string, number[]>();
      for (const r of mine) byCat.set(r.bev.categoryId, [...(byCat.get(r.bev.categoryId) ?? []), r.score]);

      const me = (await api.profile.getMe()).id;
      const profile = await viewer.stats.getTasteProfile(me);
      expect(profile.map((p) => p.categoryId).sort()).toEqual([...byCat.keys()].sort());
      for (const row of profile) {
        const scores = byCat.get(row.categoryId)!;
        expect(row.rankingCount).toBe(scores.length);
        expect(row.mean).toBeCloseTo(populationStats(scores).mean, 2);
        expect(row.affinity).toBeCloseTo(categoryAffinity(scores.map((sc) => zScore(sc, overall))), 2);
      }
      expect(profile.map((p) => p.mean)).toEqual([...profile.map((p) => p.mean)].sort((x, y) => y - x));

      await expect(viewer.stats.getTasteProfile('00000000-0000-4000-8000-00000000ffff')).rejects.toMatchObject({ code: 'not_found' });
    } finally {
      await viewer.deleteAccount();
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
