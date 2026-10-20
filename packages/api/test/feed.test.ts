import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFeedApi } from '../src/feed.ts';
import { encodeCursor } from '../src/paging.ts';
import type { ExploreRpcRow, FeedRpcRow, ProfileViewRow } from '../src/mappers.ts';

const ACTOR = '00000000-0000-4000-8000-0000000000a1';

function row(id: number): FeedRpcRow {
  return {
    id,
    kind: 'ranked',
    created_at: '2026-10-18T12:00:00Z',
    actor_id: ACTOR,
    actor_handle: 'ana',
    actor_display_name: 'Ana',
    actor_avatar_path: null,
    bev_id: `bev-${id}`,
    bev_name: `Bev ${id}`,
    bev_brand: null,
    bev_flavor: null,
    bev_category_id: 'soda',
    bev_thumb_path: null,
    bev_price_tier: 1,
    bev_price_estimated: false,
    bev_status: 'active',
    bev_rating_count: 2,
    bev_bayes_score: 6.5,
    score: 8.2,
    bucket: 3,
    note: null,
    in_my_want_to_try: false,
    like_count: 4,
    liked_by_me: true,
    comment_count: 0,
    comments: [],
  };
}

const actorRow: ProfileViewRow = {
  id: ACTOR,
  handle: 'ana',
  display_name: 'Ana',
  avatar_path: null,
  birth_date: null,
  can_see_alcohol: false,
  timezone: 'America/New_York',
  onboarded: true,
  created_at: '2026-10-01T00:00:00Z',
};

/** `row` without the four fields get_explore does not return (D-15). */
function exploreRow(id: number): ExploreRpcRow {
  const { like_count: _lc, liked_by_me: _lbm, comment_count: _cc, comments: _cs, ...rest } = row(id);
  return rest;
}

// Records the RPC name and arguments; returns the given rows or error.
function fakeClient(
  result: { data?: (FeedRpcRow | ExploreRpcRow)[]; error?: unknown },
  calls: { rpc?: [string, unknown] } = {},
): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    rpc: (name: string, args: unknown) => {
      calls.rpc = [name, args];
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [actorRow], error: null }) }) }),
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
  } as unknown as SupabaseClient;
}

describe('feed.listUser', () => {
  it('calls get_user_feed for the user and maps rows like getFeed', async () => {
    const calls: { rpc?: [string, unknown] } = {};
    const api = createFeedApi(fakeClient({ data: [row(9), row(7)] }, calls));

    const page = await api.listUser(ACTOR, { limit: 2 });

    expect(calls.rpc).toEqual(['get_user_feed', { p_user_id: ACTOR, p_limit: 2, p_before_id: null }]);
    expect(page.items.map((i) => i.id)).toEqual(['9', '7']);
    expect(page.items[0]).toMatchObject({ type: 'RANKING', actor: { id: ACTOR }, likeCount: 4, likedByMe: true });
    expect(page.nextCursor).not.toBeNull();
  });

  it('passes the cursor on as p_before_id, and ends on a short page', async () => {
    const calls: { rpc?: [string, unknown] } = {};
    const api = createFeedApi(fakeClient({ data: [row(3)] }, calls));

    const page = await api.listUser(ACTOR, { limit: 2, cursor: encodeCursor({ beforeId: 7 }) });

    expect(calls.rpc).toEqual(['get_user_feed', { p_user_id: ACTOR, p_limit: 2, p_before_id: 7 }]);
    expect(page.nextCursor).toBeNull();
  });

  it('an empty page (a stranger) is not an error', async () => {
    const api = createFeedApi(fakeClient({ data: [] }));
    await expect(api.listUser(ACTOR)).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('maps BEVI_NOT_FOUND to not_found', async () => {
    const api = createFeedApi(fakeClient({ error: { code: 'P0002', message: 'BEVI_NOT_FOUND' } }));
    await expect(api.listUser('nobody')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('feed.getExplore', () => {
  it('snapshots the clock for page 1 and maps rows with no like or comment fields', async () => {
    const calls: { rpc?: [string, unknown] } = {};
    const api = createFeedApi(fakeClient({ data: [exploreRow(9), exploreRow(7)] }, calls));

    const page = await api.getExplore({ limit: 2 });

    const [name, args] = calls.rpc!;
    expect(name).toBe('get_explore');
    expect(args).toMatchObject({ p_limit: 2, p_offset: 0 });
    const before = (args as { p_before: string }).p_before;
    expect(Number.isNaN(Date.parse(before))).toBe(false);

    expect(page.items.map((i) => i.id)).toEqual(['9', '7']);
    expect(page.items[0]).toMatchObject({ type: 'RANKING', actor: { id: ACTOR }, score: 8.2, bucket: 'LOVED' });
    // D-15: an ExplorePost carries no engagement at all.
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      ['actor', 'bev', 'bucket', 'createdAt', 'id', 'inMyWantToTry', 'note', 'score', 'type'].sort(),
    );
    expect(page.nextCursor).not.toBeNull();
  });

  it('page 2 reuses page 1\'s snapshot and advances the offset', async () => {
    const first: { rpc?: [string, unknown] } = {};
    const page1 = await createFeedApi(fakeClient({ data: [exploreRow(9), exploreRow(7)] }, first)).getExplore({ limit: 2 });
    const before = (first.rpc![1] as { p_before: string }).p_before;

    const second: { rpc?: [string, unknown] } = {};
    const api = createFeedApi(fakeClient({ data: [exploreRow(5)] }, second));
    const page2 = await api.getExplore({ limit: 2, cursor: page1.nextCursor! });

    expect(second.rpc).toEqual(['get_explore', { p_limit: 2, p_before: before, p_offset: 2 }]);
    // A short page ends the sequence.
    expect(page2.nextCursor).toBeNull();
  });

  it('starts over on a malformed cursor instead of failing', async () => {
    const calls: { rpc?: [string, unknown] } = {};
    const api = createFeedApi(fakeClient({ data: [] }, calls));

    await expect(api.getExplore({ limit: 5, cursor: 'not-a-cursor' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(calls.rpc![1]).toMatchObject({ p_limit: 5, p_offset: 0 });

    // A forged cursor that decodes but holds nonsense starts over too.
    await api.getExplore({ limit: 5, cursor: encodeCursor({ before: 'nope', offset: -3 }) });
    expect(calls.rpc![1]).toMatchObject({ p_limit: 5, p_offset: 0 });
  });

  it('never copies like or comment data through, even if a row carries it', async () => {
    // get_explore does not return those columns; this pins the mapper so a
    // future shape change cannot leak them into an ExplorePost (D-15).
    const api = createFeedApi(fakeClient({ data: [row(3)] }));
    const page = await api.getExplore();
    expect(page.items[0]).not.toHaveProperty('likeCount');
    expect(page.items[0]).not.toHaveProperty('likedByMe');
    expect(page.items[0]).not.toHaveProperty('commentCount');
    expect(page.items[0]).not.toHaveProperty('comments');
  });
});
