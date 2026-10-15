// A-03: comments on posts, round-tripped through createBeviApi against a live
// local stack (see auth.live.test.ts for why this is skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).
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

describe.skipIf(!url || !publishableKey)('comments, against a live local stack', () => {
  it('add, list (paged), inline on the feed, remove own', async () => {
    const api = createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
    await api.signUp({ username: randomTestUsername(), password: 'correct-horse-battery-staple', inviteCode: TEST_INVITE_CODE });
    await api.profile.setBirthDate('1990-01-01');

    // A seeded catalog Bev (20261012000300), so the test leaves nothing behind.
    const [bev] = await api.bevs.getStarterCandidates();
    expect(bev).toBeDefined();
    await api.rankings.submitRanking({ bevId: bev!.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

    const post = (await api.feed.getFeed()).items.find((i) => i.bev.id === bev!.id);
    expect(post).toBeDefined();
    expect(post!.commentCount).toBe(0);
    expect(post!.comments).toEqual([]);

    await expect(api.comments.add(post!.id, ' \n ')).rejects.toMatchObject({ code: 'validation' });
    await expect(api.comments.add(post!.id, 'x'.repeat(281))).rejects.toMatchObject({ code: 'validation' });

    const first = await api.comments.add(post!.id, '  first  ');
    expect(first.body).toBe('first');
    const session = await api.getSession();
    expect(first.author.id).toBe(session!.userId);
    await api.comments.add(post!.id, 'second');
    const third = await api.comments.add(post!.id, 'third');

    // Newest first, two per page, each comment exactly once.
    const page1 = await api.comments.list(post!.id, { limit: 2 });
    expect(page1.items.map((c) => c.body)).toEqual(['third', 'second']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await api.comments.list(post!.id, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((c) => c.body)).toEqual(['first']);
    expect(page2.nextCursor).toBeNull();

    // Inline on the feed: oldest first, with the total.
    const withComments = (await api.feed.getFeed()).items.find((i) => i.id === post!.id)!;
    expect(withComments.commentCount).toBe(3);
    expect(withComments.comments.map((c) => c.body)).toEqual(['first', 'second', 'third']);
    expect(withComments.comments[0]!.author.handle).toBe(first.author.handle);

    await api.comments.remove(third.id);
    await api.comments.remove(third.id); // idempotent
    const after = (await api.feed.getFeed()).items.find((i) => i.id === post!.id)!;
    expect(after.commentCount).toBe(2);
    expect((await api.comments.list(post!.id)).items.map((c) => c.id)).not.toContain(third.id);

    await api.deleteAccount();
  });
});
