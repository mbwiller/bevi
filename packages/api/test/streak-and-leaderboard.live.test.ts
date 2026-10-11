// Exercises touch_streak and get_user_leaderboard's points formula against
// a real local stack (see auth.live.test.ts for why this is skipped
// without SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).
import { describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';

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

describe.skipIf(!url || !publishableKey)('streak + rank points, against a live local stack', () => {
  it('a first-ever ranking gives a 1-day streak and the matching leaderboard points', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const username = `vitest_${Date.now().toString(36)}_streak`;

    await api.signUp({ username, password: 'correct-horse-battery-staple', inviteCode: 'local-test-invite-code' });
    await api.profile.setBirthDate('1990-01-01');

    const bev = await api.bevs.create({
      name: `Vitest Soda ${Date.now()}`,
      categoryId: 'soda',
      priceTier: null,
      priceEstimated: true,
      photoAssetId: 'vitest-asset',
    });

    await api.rankings.submitRanking({
      bevId: bev.id,
      bucket: 'LOVED',
      insertIndex: 0,
      expectedBucketSize: 0,
      comparisons: [],
    });

    const stats = await api.stats.getMine();
    expect(stats.currentStreak).toBe(1);
    expect(stats.bevdCount).toBe(1);

    const board = await api.leaderboard.users();
    const session = await api.getSession();
    const mine = board.items.find((row) => row.profile.id === session!.userId);
    expect(mine).toBeDefined();
    // bevsRanked(1)*1 + currentStreak(1)*3 + bevsCreated(0, nobody else
    // ranked this Bev)*2 = 4.
    expect(mine!.points).toBe(4);
    expect(mine!.rank).toBeGreaterThanOrEqual(1);

    await api.deleteAccount();
  });
});
