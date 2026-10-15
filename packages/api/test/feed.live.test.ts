// A-01 DoD: the feed carries rankings only -- a save and a follow add nothing
// (20261014000100). Skipped without SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY,
// like the other live suites.
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

describe.skipIf(!url || !publishableKey)('feed, against a live local stack', () => {
  it('getFeed has only RANKING items: saving and following post nothing', async () => {
    const other = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const password = 'correct-horse-battery-staple';
    const { userId: otherId } = await other.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });
    await api.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });

    try {
      // Seeded catalog Bevs (20261012000300), so the test leaves nothing behind.
      const [ranked, saved] = await api.bevs.getStarterCandidates();
      expect(ranked).toBeDefined();
      expect(saved).toBeDefined();

      await api.rankings.submitRanking({ bevId: ranked!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
      await api.wantToTry.add(saved!.id);
      await api.follows.follow(otherId);

      const feed = await api.feed.getFeed();
      expect(feed.items).toHaveLength(1);
      expect(feed.items.every((item) => item.type === 'RANKING')).toBe(true);
      expect(feed.items[0]).toMatchObject({ bev: { id: ranked!.id }, bucket: 'LOVED' });
      expect(typeof feed.items[0]!.score).toBe('number');
    } finally {
      await api.deleteAccount();
      await other.deleteAccount();
    }
  });
});
