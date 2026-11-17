// Contract 2.12.0 (20261111000100), without a live stack: leaderboard.friends
// over get_friends_leaderboard, follows.suggested's followedBy over
// get_followed_by, and the feed's alsoBevdBy over the `also_bevd` column. The
// SQL itself is pinned by supabase/tests/31_social_context.test.sql.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFeedApi } from '../src/feed.ts';
import { createFollowsApi } from '../src/follows.ts';
import { createLeaderboardApi } from '../src/leaderboard.ts';
import { decodeCursor, encodeCursor } from '../src/paging.ts';
import {
  mapFeedItem,
  mapSuggestedProfile,
  type AlsoBevdRpcItem,
  type EmbeddedProfileRow,
  type FeedRpcRow,
  type FollowedByRpcRow,
  type FriendsLeaderboardRpcRow,
  type ProfileViewRow,
} from '../src/mappers.ts';

const ME = '00000000-0000-4000-8000-0000000000a1';
const ANA = '00000000-0000-4000-8000-0000000000a2';
const BEN = '00000000-0000-4000-8000-0000000000a3';
const CAT = '00000000-0000-4000-8000-0000000000a4';
const DAN = '00000000-0000-4000-8000-0000000000a5';

const storage = { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) };
const auth = { getUser: async () => ({ data: { user: { id: ME } }, error: null }) };

function embedded(id: string, handle: string, avatar: string | null = null): EmbeddedProfileRow {
  return {
    user_id: id,
    handle,
    display_name: handle.toUpperCase(),
    avatar_path: avatar,
    timezone: 'America/New_York',
    onboarded: true,
    created_at: '2026-10-01T00:00:00+00:00',
  };
}

function profileView(id: string, handle: string): ProfileViewRow {
  return {
    id,
    handle,
    display_name: handle.toUpperCase(),
    avatar_path: null,
    birth_date: null,
    can_see_alcohol: false,
    timezone: 'America/New_York',
    onboarded: true,
    created_at: '2026-10-01T00:00:00+00:00',
  };
}

// ---------------------------------------------------------------------------
// leaderboard.friends
// ---------------------------------------------------------------------------

function boardRow(id: string, handle: string, points: number, rank: number): FriendsLeaderboardRpcRow {
  return {
    user_id: id,
    handle,
    display_name: handle.toUpperCase(),
    avatar_path: null,
    timezone: 'UTC',
    created_at: '2026-10-01T00:00:00+00:00',
    onboarded: true,
    can_see_alcohol: id === ME,
    points,
    friend_rank: rank,
    rating_count: points,
    current_streak_days: 0,
  };
}

function boardClient(
  result: { data?: FriendsLeaderboardRpcRow[] | null; error?: unknown },
  calls: Array<[string, unknown]> = [],
): SupabaseClient {
  return {
    auth,
    storage,
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  } as unknown as SupabaseClient;
}

describe('leaderboard.friends', () => {
  it('calls get_friends_leaderboard and maps friend_rank to rank, ties included', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createLeaderboardApi(
      boardClient({ data: [boardRow(ANA, 'ana', 20, 1), boardRow(ME, 'me', 12, 2), boardRow(BEN, 'ben', 12, 2)] }, calls),
    );

    const page = await api.friends();

    expect(calls).toEqual([['get_friends_leaderboard', { p_limit: 50, p_offset: 0 }]]);
    expect(page.items.map((r) => [r.profile.handle, r.rank, r.points, r.bevsRanked])).toEqual([
      ['ana', 1, 20, 20],
      ['me', 2, 12, 12],
      ['ben', 2, 12, 12],
    ]);
    // The caller's own flag only, and never a birthdate.
    expect(page.items.map((r) => r.profile.canSeeAlcohol)).toEqual([false, true, false]);
    expect(page.items.every((r) => r.profile.birthdate === null)).toBe(true);
    // A short page ends the board.
    expect(page.nextCursor).toBeNull();
  });

  it('pages by offset: a full page hands back a cursor, and the next call sends it', async () => {
    const first: Array<[string, unknown]> = [];
    const page1 = await createLeaderboardApi(
      boardClient({ data: [boardRow(ANA, 'ana', 20, 1), boardRow(ME, 'me', 12, 2)] }, first),
    ).friends({ limit: 2 });
    expect(first).toEqual([['get_friends_leaderboard', { p_limit: 2, p_offset: 0 }]]);
    expect(decodeCursor(page1.nextCursor)).toEqual({ offset: 2 });

    const second: Array<[string, unknown]> = [];
    const page2 = await createLeaderboardApi(boardClient({ data: [boardRow(BEN, 'ben', 12, 2)] }, second)).friends({
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(second).toEqual([['get_friends_leaderboard', { p_limit: 2, p_offset: 2 }]]);
    // The rank is the set's (2, tied with the previous page's last row), not the page's.
    expect(page2.items.map((r) => r.rank)).toEqual([2]);
    expect(page2.nextCursor).toBeNull();
  });

  it('clamps the limit to 1..100 and starts over on a cursor that holds no offset', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createLeaderboardApi(boardClient({ data: [] }, calls));

    await api.friends({ limit: 500 });
    await api.friends({ limit: 0 });
    await api.friends({ limit: 7.9, cursor: 'not-a-cursor' });
    await api.friends({ cursor: encodeCursor({ offset: -3 }) });
    await api.friends({ cursor: encodeCursor({ beforeId: 9 }) });

    expect(calls.map(([, args]) => args)).toEqual([
      { p_limit: 100, p_offset: 0 },
      { p_limit: 50, p_offset: 0 },
      { p_limit: 7, p_offset: 0 },
      { p_limit: 50, p_offset: 0 },
      { p_limit: 50, p_offset: 0 },
    ]);
  });

  it('an empty board (nobody ranked yet) is an empty page, and errors are mapped', async () => {
    await expect(createLeaderboardApi(boardClient({ data: [] })).friends()).resolves.toEqual({ items: [], nextCursor: null });
    await expect(createLeaderboardApi(boardClient({ data: null })).friends()).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      createLeaderboardApi(boardClient({ error: { code: '42501', message: 'BEVI_UNAUTHORIZED' } })).friends(),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('is unauthorized signed out, without calling the RPC', async () => {
    const calls: Array<[string, unknown]> = [];
    const client = {
      ...boardClient({ data: [] }, calls),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as unknown as SupabaseClient;
    await expect(createLeaderboardApi(client).friends()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// follows.suggested
// ---------------------------------------------------------------------------

interface SuggestedFixture {
  /** user_stats rows, already in `rating_count desc` order, as the query returns them. */
  stats: string[];
  /** Who the caller follows. */
  following: string[];
  followedBy?: FollowedByRpcRow[];
  followedByError?: unknown;
}

/**
 * Answers the four reads `suggested()` makes -- the caller's follows, the top
 * of user_stats, profiles_view for the candidates, and which candidates the
 * caller follows -- plus get_followed_by. The query builder is chainable and
 * awaitable, like PostgREST's, and remembers the filters it was given.
 */
function suggestedClient(fixture: SuggestedFixture, calls: Array<[string, unknown]> = []): SupabaseClient {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const resolve = (): { data: unknown; error: null } => {
      if (table === 'user_stats') return { data: fixture.stats.map((user_id) => ({ user_id, rating_count: 1 })), error: null };
      if (table === 'profiles_view') {
        // Reversed on purpose: `.in()` promises no order, and the candidates' order must survive that.
        const ids = [...(filters['in:id'] as string[])].reverse();
        return { data: ids.map((id) => profileView(id, `u${id.slice(-2)}`)), error: null };
      }
      if (table === 'follows') {
        const wanted = filters['in:followee_id'] as string[] | undefined;
        const rows = fixture.following
          .filter((id) => wanted === undefined || wanted.includes(id))
          .map((followee_id) => ({ followee_id }));
        return { data: rows, error: null };
      }
      throw new Error(`unexpected table ${table}`);
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[`eq:${column}`] = value;
        return builder;
      },
      in: (column: string, values: unknown) => {
        filters[`in:${column}`] = values;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      then: (onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve().then(resolve).then(onFulfilled, onRejected),
    };
    return builder;
  };
  return {
    auth,
    storage,
    from,
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      if (fixture.followedByError) return Promise.resolve({ data: null, error: fixture.followedByError });
      return Promise.resolve({ data: fixture.followedBy ?? [], error: null });
    },
  } as unknown as SupabaseClient;
}

describe('follows.suggested', () => {
  const S1 = '00000000-0000-4000-8000-0000000000b1';
  const S2 = '00000000-0000-4000-8000-0000000000b2';
  const S3 = '00000000-0000-4000-8000-0000000000b3';

  it('keeps who is suggested and their order, and adds followedBy from get_followed_by', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createFollowsApi(
      suggestedClient(
        {
          // ANA is followed and ME is the caller: neither is suggested. The rest keep this order.
          stats: [S2, ANA, S1, ME, S3],
          following: [ANA],
          // Returned in id order, as the function does -- not the suggestions' order.
          followedBy: [
            { user_id: S1, followed_by_count: 0, followed_by: [] },
            { user_id: S2, followed_by_count: 3, followed_by: [embedded(BEN, 'ben', 'ben/a.jpg'), embedded(CAT, 'cat')] },
            { user_id: S3, followed_by_count: 1, followed_by: [embedded(ANA, 'ana')] },
          ],
        },
        calls,
      ),
    );

    const rows = await api.suggested();

    expect(calls).toEqual([['get_followed_by', { p_user_ids: [S2, S1, S3] }]]);
    expect(rows.map((r) => r.id)).toEqual([S2, S1, S3]);
    expect(rows.every((r) => r.isFollowing === false)).toBe(true);
    expect(rows.map((r) => [r.followedByCount, r.followedBy.map((p) => p.handle)])).toEqual([
      [3, ['ben', 'cat']],
      [0, []],
      [1, ['ana']],
    ]);
    expect(rows[0]!.followedBy[0]).toEqual({
      id: BEN,
      handle: 'ben',
      displayName: 'BEN',
      avatarUrl: 'https://x/ben/a.jpg',
      timezone: 'America/New_York',
      createdAt: '2026-10-01T00:00:00+00:00',
      birthdate: null,
      canSeeAlcohol: false,
      onboarded: true,
    });
  });

  it('someone get_followed_by returned no row for has nobody', async () => {
    const api = createFollowsApi(suggestedClient({ stats: [S1], following: [], followedBy: [] }));
    expect(await api.suggested()).toMatchObject([{ id: S1, followedBy: [], followedByCount: 0 }]);
  });

  it('with nobody to suggest it does not call get_followed_by', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createFollowsApi(suggestedClient({ stats: [ME, ANA], following: [ANA] }, calls));
    expect(await api.suggested()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a database without get_followed_by yet (PGRST202) still returns the suggestions, with no context', async () => {
    const api = createFollowsApi(
      suggestedClient({
        stats: [S1, S2],
        following: [],
        followedByError: {
          code: 'PGRST202',
          message: 'Could not find the function public.get_followed_by(p_user_ids) in the schema cache',
          details: null,
          hint: null,
        },
      }),
    );
    expect((await api.suggested()).map((r) => [r.id, r.followedByCount, r.followedBy])).toEqual([
      [S1, 0, []],
      [S2, 0, []],
    ]);
  });

  it('any other get_followed_by error fails the call instead of being hidden', async () => {
    const api = createFollowsApi(
      suggestedClient({
        stats: [S1],
        following: [],
        followedByError: { code: '22023', message: 'BEVI_VALIDATION', details: 'userIds', hint: null },
      }),
    );
    await expect(api.suggested()).rejects.toMatchObject({ code: 'validation', detail: { field: 'userIds' } });
  });

  it('mapSuggestedProfile keeps the ProfileRow as it is', () => {
    const client = { storage } as unknown as SupabaseClient;
    const row = { ...profileRow(S1), isFollowing: false };
    expect(mapSuggestedProfile(client, row, undefined)).toEqual({ ...row, followedBy: [], followedByCount: 0 });
  });
});

function profileRow(id: string) {
  return {
    id,
    handle: 'sam',
    displayName: 'Sam',
    avatarUrl: null,
    timezone: 'UTC',
    createdAt: '2026-10-01T00:00:00+00:00',
    birthdate: null,
    canSeeAlcohol: false,
    onboarded: true,
  };
}

// ---------------------------------------------------------------------------
// FeedItem.alsoBevdBy / alsoBevdCount
// ---------------------------------------------------------------------------

function feedRow(id: number, alsoBevd?: FeedRpcRow['also_bevd']): FeedRpcRow {
  const row: FeedRpcRow = {
    id,
    kind: 'ranked',
    created_at: '2026-11-11T12:00:00Z',
    actor_id: ANA,
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
    bev_rating_count: 4,
    bev_bayes_score: 6.5,
    score: 9.1,
    bucket: 3,
    note: null,
    in_my_want_to_try: false,
    like_count: 0,
    liked_by_me: false,
    comment_count: 0,
    comments: [],
  };
  if (alsoBevd !== undefined) row.also_bevd = alsoBevd;
  return row;
}

function friend(id: string, handle: string, score: number | string, bucket: number): AlsoBevdRpcItem {
  return { ...embedded(id, handle), score, bucket };
}

function feedClient(rows: FeedRpcRow[], calls: Array<[string, unknown]> = []): SupabaseClient {
  return {
    auth,
    storage,
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      return Promise.resolve({ data: rows, error: null });
    },
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [profileView(ANA, 'ana')], error: null }) }) }),
  } as unknown as SupabaseClient;
}

describe('FeedItem.alsoBevdBy and alsoBevdCount', () => {
  const also = {
    count: 4,
    // jsonb numerics arrive as numbers, but a string must map too.
    items: [friend(BEN, 'ben', 8.2, 3), friend(CAT, 'cat', '7.30', 2), friend(DAN, 'dan', 1, 1)],
  };

  it('getFeed maps also_bevd: profiles with each friend\'s own score and bucket, in the order given, and the total', async () => {
    const page = await createFeedApi(feedClient([feedRow(9, also), feedRow(7, { count: 0, items: [] })])).getFeed();

    const [first, second] = page.items;
    expect(first!.alsoBevdCount).toBe(4);
    expect(first!.alsoBevdBy.map((f) => [f.profile.handle, f.score, f.bucket])).toEqual([
      ['ben', 8.2, 'LOVED'],
      ['cat', 7.3, 'FINE'],
      ['dan', 1, 'DISLIKED'],
    ]);
    expect(first!.alsoBevdBy[0]!.profile).toMatchObject({ id: BEN, birthdate: null, canSeeAlcohol: false });
    // The post's own score is still the actor's.
    expect(first).toMatchObject({ score: 9.1, bucket: 'LOVED', actor: { id: ANA } });
    expect(second).toMatchObject({ alsoBevdBy: [], alsoBevdCount: 0 });
  });

  it('listUser maps it the same way', async () => {
    const calls: Array<[string, unknown]> = [];
    const page = await createFeedApi(feedClient([feedRow(9, also)], calls)).listUser(ANA);
    expect(calls[0]![0]).toBe('get_user_feed');
    expect(page.items[0]).toMatchObject({ alsoBevdCount: 4 });
    expect(page.items[0]!.alsoBevdBy.map((f) => f.profile.id)).toEqual([BEN, CAT, DAN]);
  });

  it('a database without the column yet (or a null) reads as nobody, so the feed still loads', () => {
    const client = { storage } as unknown as SupabaseClient;
    const actor = { ...profileRow(ANA) };
    expect(mapFeedItem(client, feedRow(1), actor)).toMatchObject({ alsoBevdBy: [], alsoBevdCount: 0 });
    expect(mapFeedItem(client, feedRow(1, null), actor)).toMatchObject({ alsoBevdBy: [], alsoBevdCount: 0 });
  });

  it('getExplore never carries the fields, even if a row does', async () => {
    const page = await createFeedApi(feedClient([feedRow(3, also)])).getExplore();
    expect(page.items[0]).not.toHaveProperty('alsoBevdBy');
    expect(page.items[0]).not.toHaveProperty('alsoBevdCount');
  });
});
