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

  it('listUser: own and followed posts in the feed shape; a stranger gets an empty page', async () => {
    const author = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const follower = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const stranger = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    const password = 'correct-horse-battery-staple';
    const { userId: authorId } = await author.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });
    await follower.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });
    await stranger.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });

    try {
      const [first, second] = await author.bevs.getStarterCandidates();
      await author.rankings.submitRanking({ bevId: first!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
      await author.rankings.submitRanking({ bevId: second!.id, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
      await follower.follows.follow(authorId);

      const own = await author.feed.listUser(authorId);
      expect(own.items.map((i) => i.bev.id)).toEqual([second!.id, first!.id]);

      const followed = await follower.feed.listUser(authorId, { limit: 1 });
      expect(followed.items).toHaveLength(1);
      expect(followed.items[0]).toMatchObject({ type: 'RANKING', actor: { id: authorId }, bev: { id: second!.id } });
      await follower.feed.like(followed.items[0]!.id);
      const next = await follower.feed.listUser(authorId, { limit: 1, cursor: followed.nextCursor! });
      expect(next.items.map((i) => i.bev.id)).toEqual([first!.id]);
      expect((await follower.feed.listUser(authorId)).items[0]).toMatchObject({ likeCount: 1, likedByMe: true });

      expect((await stranger.feed.listUser(authorId)).items).toEqual([]);
      await expect(stranger.feed.listUser('00000000-0000-4000-8000-00000000ffff')).rejects.toMatchObject({ code: 'not_found' });
    } finally {
      await stranger.deleteAccount();
      await follower.deleteAccount();
      await author.deleteAccount();
    }
  });
});
