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

  // A-05 (20261018000100). Other suites rank too, so this checks the shape and
  // the current periods, not which Bev wins.
  it('getBevOfPeriod: ranking a Bev now makes both periods current', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    await api.signUp({ username: randomTestUsername(), password: 'correct-horse-battery-staple', inviteCode: TEST_INVITE_CODE });

    try {
      const [bev] = await api.bevs.getStarterCandidates();
      expect(bev).toBeDefined();
      await api.rankings.submitRanking({ bevId: bev!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      const { day, week } = await api.feed.getBevOfPeriod();
      expect(day).toMatchObject({ periodStart: today, isCurrent: true });
      expect(day!.rankingsInPeriod).toBeGreaterThanOrEqual(1);
      expect(typeof day!.bev.bayesScore).toBe('number');
      expect(week).toMatchObject({ isCurrent: true });
      // The ISO week's Monday, on or before today.
      expect(new Date(`${week!.periodStart}T12:00:00Z`).getUTCDay()).toBe(1);
      expect(week!.periodStart <= today).toBe(true);
    } finally {
      await api.deleteAccount();
    }
  });
});
