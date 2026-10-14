// A-02: feed.like / feed.unlike round-trip against a real local stack (see
// auth.live.test.ts for why this is skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).
import { describe, expect, it } from 'vitest';
import { isApiError } from '@bevi/shared';
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

describe.skipIf(!url || !publishableKey)('post likes, against a live local stack', () => {
  it('like and unlike are idempotent and show up on the feed item', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });

    await api.signUp({
      username: randomTestUsername(),
      password: 'correct-horse-battery-staple',
      inviteCode: TEST_INVITE_CODE,
    });
    await api.profile.setBirthDate('1990-01-01');

    try {
      // A seeded catalog Bev (20261012000300), so the test leaves nothing behind.
      const [bev] = await api.bevs.getStarterCandidates();
      expect(bev).toBeDefined();
      await api.rankings.submitRanking({
        bevId: bev!.id,
        bucket: 'LOVED',
        insertIndex: 0,
        expectedBucketSize: 0,
        comparisons: [],
      });

      const postOf = async () => {
        const { items } = await api.feed.getFeed();
        const post = items.find((item) => item.bev.id === bev!.id);
        expect(post).toBeDefined();
        return post!;
      };

      const before = await postOf();
      expect(before.likeCount).toBe(0);
      expect(before.likedByMe).toBe(false);

      await api.feed.like(before.id);
      await api.feed.like(before.id);
      const liked = await postOf();
      expect(liked.likeCount).toBe(1);
      expect(liked.likedByMe).toBe(true);

      await api.feed.unlike(before.id);
      await api.feed.unlike(before.id);
      const unliked = await postOf();
      expect(unliked.likeCount).toBe(0);
      expect(unliked.likedByMe).toBe(false);

      const missing = await api.feed.like('999999999999').catch((e: unknown) => e);
      expect(isApiError(missing) && missing.code).toBe('not_found');
    } finally {
      await api.deleteAccount();
    }
  });
});
