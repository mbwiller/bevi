import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@bevi/shared';
import { createNotificationsApi } from '../src/notifications.ts';
import { decodeCursor, encodeCursor } from '../src/paging.ts';
import type { NotificationActorRpcItem, NotificationRpcRow } from '../src/mappers.ts';

// T-31: the notifications inbox over the RPCs in 20261126000100_notifications.sql.
// A stand-in SupabaseClient records every RPC and answers from a script, so
// these pin the RPC names, the argument shapes, the mapping and the error
// handling without a live stack.

interface RpcCall {
  fn: string;
  args: Record<string, unknown> | undefined;
}

type Answer = { data: unknown; error: unknown };

function fakeClient(log: RpcCall[], answer: (call: RpcCall) => Answer = () => ({ data: null, error: null }), signedIn = true) {
  return {
    auth: {
      getUser: async () =>
        signedIn ? { data: { user: { id: 'me-0000' } }, error: null } : { data: { user: null }, error: null },
    },
    rpc: (fn: string, args?: Record<string, unknown>) => {
      const call = { fn, args };
      log.push(call);
      return Promise.resolve(answer(call));
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
}

/** A PostgrestError as PostgREST or a security-definer RPC raises it. */
const pgError = (message: string, code: string) => ({ message, code, details: null, hint: null });
const NO_SUCH_FUNCTION = pgError('Could not find the function public.get_notifications in the schema cache', 'PGRST202');

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected a rejection');
}

function actor(i: number, isFollowing = false): NotificationActorRpcItem {
  return {
    user_id: `user-${i}`,
    handle: `person${i}`,
    display_name: `Person ${i}`,
    avatar_path: i === 1 ? 'user-1/a.jpg' : null,
    timezone: 'America/New_York',
    onboarded: true,
    created_at: '2026-01-01T00:00:00.000Z',
    is_following: isFollowing,
  };
}

const NO_BEV = {
  bev_id: null,
  bev_name: null,
  bev_brand: null,
  bev_flavor: null,
  bev_category_id: null,
  bev_thumb_path: null,
  bev_price_tier: null,
  bev_price_estimated: null,
  bev_status: null,
  bev_rating_count: null,
  bev_bayes_score: null,
  bev_icon_path: null,
} as const;

const A_BEV = {
  bev_id: 'coke-classic',
  bev_name: 'Coke',
  bev_brand: 'Coca-Cola',
  bev_flavor: null,
  bev_category_id: 'soda',
  bev_thumb_path: null,
  bev_price_tier: 1,
  bev_price_estimated: false,
  bev_status: 'active',
  bev_rating_count: 12,
  bev_bayes_score: 7.25,
  bev_icon_path: 'coke-classic.svg',
} as const;

const followRow: NotificationRpcRow = {
  id: 41,
  kind: 'follow',
  created_at: '2026-11-26T10:00:00.000Z',
  unread: true,
  actor_count: 1,
  actors: [actor(1)],
  feed_event_id: null,
  ...NO_BEV,
  comment_id: null,
  comment_body: null,
};

const likeRow: NotificationRpcRow = {
  id: 57,
  kind: 'like',
  created_at: '2026-11-26T11:00:00.000Z',
  unread: false,
  actor_count: 3,
  actors: [actor(2, true), actor(3)],
  feed_event_id: 900,
  ...A_BEV,
  comment_id: null,
  comment_body: null,
};

const commentRow: NotificationRpcRow = {
  id: 50,
  kind: 'comment',
  created_at: '2026-11-26T10:30:00.000Z',
  unread: true,
  actor_count: 1,
  actors: [actor(2, true)],
  feed_event_id: 900,
  ...A_BEV,
  comment_id: 77,
  comment_body: 'nice one',
};

describe('notifications.list', () => {
  it('calls get_notifications with the limit and no cursor on page 1', async () => {
    const log: RpcCall[] = [];
    await createNotificationsApi(fakeClient(log, () => ({ data: [], error: null }))).list({ limit: 5 });
    expect(log).toEqual([{ fn: 'get_notifications', args: { p_limit: 5, p_before_id: null } }]);
  });

  it('maps a follow row: one actor with isFollowing, no post, no Bev, no comment', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: [followRow], error: null })));
    const { items } = await api.list();
    expect(items).toEqual([
      {
        id: '41',
        kind: 'follow',
        createdAt: '2026-11-26T10:00:00.000Z',
        unread: true,
        actors: [
          {
            id: 'user-1',
            handle: 'person1',
            displayName: 'Person 1',
            avatarUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/user-1/a.jpg',
            timezone: 'America/New_York',
            createdAt: '2026-01-01T00:00:00.000Z',
            birthdate: null,
            canSeeAlcohol: false,
            onboarded: true,
            isFollowing: false,
          },
        ],
        actorCount: 1,
        postId: null,
        bev: null,
        comment: null,
      },
    ]);
  });

  it('maps a like group: two actors newest first, the total, the post and its Bev', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: [likeRow], error: null })));
    const [item] = (await api.list()).items;
    expect(item).toMatchObject({ id: '57', kind: 'like', unread: false, actorCount: 3, postId: '900', comment: null });
    expect(item!.actors.map((a) => [a.id, a.isFollowing])).toEqual([
      ['user-2', true],
      ['user-3', false],
    ]);
    expect(item!.bev).toMatchObject({
      id: 'coke-classic',
      name: 'Coke',
      brand: 'Coca-Cola',
      categoryId: 'soda',
      iconUrl: 'https://example.supabase.co/storage/v1/object/public/bev-icons/coke-classic.svg',
      photoUrl: null,
      priceTier: 1,
      priceEstimated: false,
      ratingCount: 12,
      bayesScore: 7.25,
    });
  });

  it('maps a comment row with its comment, and reads a numeric sent as a string', async () => {
    const api = createNotificationsApi(
      fakeClient([], () => ({ data: [{ ...commentRow, bev_bayes_score: '6.40' }], error: null })),
    );
    const [item] = (await api.list()).items;
    expect(item).toMatchObject({ id: '50', kind: 'comment', postId: '900', comment: { id: '77', body: 'nice one' } });
    expect(item!.bev?.bayesScore).toBe(6.4);
  });

  it('a full page carries a cursor on its last row, and the next call sends it as p_before_id', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [likeRow, commentRow], error: null })));
    const page = await api.list({ limit: 2 });
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor)).toEqual({ beforeId: 50 });
    await api.list({ limit: 2, cursor: page.nextCursor! });
    expect(log[1]).toEqual({ fn: 'get_notifications', args: { p_limit: 2, p_before_id: 50 } });
  });

  it('a short page ends the list', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: [followRow], error: null })));
    expect((await api.list({ limit: 2 })).nextCursor).toBeNull();
  });

  it('a malformed or forged cursor starts over rather than failing', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [], error: null })));
    await api.list({ cursor: 'not-a-cursor' });
    await api.list({ cursor: encodeCursor({ beforeId: 'drop table' }) });
    expect(log.map((c) => c.args?.p_before_id)).toEqual([null, null]);
  });

  it('a backend without the inbox answers an empty page', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    await expect(api.list()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('any other error is mapped, and a signed-out caller is unauthorized before any RPC', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: pgError('BEVI_UNAUTHORIZED', '42501') })));
    expect((await rejection(api.list())).code).toBe('unauthorized');

    const log: RpcCall[] = [];
    const signedOut = createNotificationsApi(fakeClient(log, undefined, false));
    expect((await rejection(signedOut.list())).code).toBe('unauthorized');
    expect(log).toEqual([]);
  });

  it('an unexpected kind is an error, not a silently wrong row', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: [{ ...followRow, kind: 'mention' }], error: null })));
    expect((await rejection(api.list())).code).toBe('unknown');
  });
});

describe('notifications.unreadCount', () => {
  it('calls get_unread_notification_count and returns the number', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: 3, error: null })));
    expect(await api.unreadCount()).toBe(3);
    expect(log.map((c) => c.fn)).toEqual(['get_unread_notification_count']);
  });

  it('is 0 from a backend without the inbox', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    expect(await api.unreadCount()).toBe(0);
  });

  it('maps any other error', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: pgError('BEVI_UNAUTHORIZED', '42501') })));
    expect((await rejection(api.unreadCount())).code).toBe('unauthorized');
  });
});

describe('notifications.markRead', () => {
  it('sends the id as a number, or null for everything', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    await api.markRead('57');
    await api.markRead();
    expect(log).toEqual([
      { fn: 'mark_notifications_read', args: { p_up_to_id: 57 } },
      { fn: 'mark_notifications_read', args: { p_up_to_id: null } },
    ]);
  });

  it('refuses an id that is not a notification id, without a round trip', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    for (const bad of ['', 'abc', '-1', '1.5', 'feed-12']) {
      const e = await rejection(api.markRead(bad));
      expect(e).toMatchObject({ code: 'validation', detail: { field: 'upToId' } });
    }
    expect(log).toEqual([]);
  });

  it('resolves on a backend without the inbox, and maps any other error', async () => {
    await expect(
      createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION }))).markRead('1'),
    ).resolves.toBeUndefined();
    const e = await rejection(
      createNotificationsApi(fakeClient([], () => ({ data: null, error: pgError('BEVI_UNAUTHORIZED', '42501') }))).markRead(),
    );
    expect(e.code).toBe('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// Release 2 (contract 3.8.0, 20261127000100): settings, post subscriptions, device tokens
// ---------------------------------------------------------------------------

const PERSON_ID = '00000000-0000-4000-8000-000000000a01';
const settingsRow = { paused: true, follows: false, likes: true, comments: true, posts: true };

describe('notifications.getSettings', () => {
  it('calls get_notification_settings and maps its one row', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [settingsRow], error: null })));
    expect(await api.getSettings()).toEqual({ paused: true, follows: false, likes: true, comments: true, posts: true });
    expect(log).toEqual([{ fn: 'get_notification_settings', args: undefined }]);
  });

  it('a backend without settings answers the defaults', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    expect(await api.getSettings()).toEqual({ paused: false, follows: true, likes: true, comments: true, posts: false });
  });

  it('no row is an error, and so is a signed-out caller, before any RPC', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: [], error: null })));
    expect((await rejection(api.getSettings())).code).toBe('unknown');
    const log: RpcCall[] = [];
    expect((await rejection(createNotificationsApi(fakeClient(log, undefined, false)).getSettings())).code).toBe('unauthorized');
    expect(log).toEqual([]);
  });
});

describe('notifications.updateSettings', () => {
  it('sends all five switches and answers them as stored', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [settingsRow], error: null })));
    const stored = await api.updateSettings({ paused: true, follows: false, likes: true, comments: true, posts: true });
    expect(stored).toEqual(settingsRow);
    expect(log).toEqual([
      {
        fn: 'update_notification_settings',
        args: { p_paused: true, p_follows: false, p_likes: true, p_comments: true, p_posts: true },
      },
    ]);
  });

  it('refuses a switch that is not a boolean, naming it, without a round trip', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    const e = await rejection(api.updateSettings({ ...settingsRow, likes: 'yes' as unknown as boolean }));
    expect(e).toMatchObject({ code: 'validation', detail: { field: 'likes' } });
    expect(log).toEqual([]);
  });

  it('THROWS on a backend without settings: a change it cannot keep is not reported as saved', async () => {
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    expect((await rejection(api.updateSettings(settingsRow))).code).toBe('unknown');
  });

  it("maps the RPC's validation, with the field", async () => {
    const api = createNotificationsApi(
      fakeClient([], () => ({ data: null, error: { ...pgError('BEVI_VALIDATION', '22023'), details: 'posts' } })),
    );
    expect(await rejection(api.updateSettings(settingsRow))).toMatchObject({ code: 'validation', detail: { field: 'posts' } });
  });
});

describe('notifications.listPostNotificationPeople', () => {
  const personRow = {
    user_id: PERSON_ID,
    handle: 'ana',
    display_name: 'Ana B',
    avatar_path: null,
    timezone: 'America/New_York',
    onboarded: true,
    created_at: '2026-01-01T00:00:00.000Z',
    subscribed: true,
  };

  it('sends q, the limit and offset 0, and maps each person as followed, with subscribed', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [personRow, { ...personRow, user_id: 'x', subscribed: false }], error: null })));
    const page = await api.listPostNotificationPeople({ q: '  an ', limit: 5 });
    expect(log).toEqual([{ fn: 'get_post_notification_people', args: { p_q: 'an', p_limit: 5, p_offset: 0 } }]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: PERSON_ID,
      handle: 'ana',
      displayName: 'Ana B',
      avatarUrl: null,
      timezone: 'America/New_York',
      createdAt: '2026-01-01T00:00:00.000Z',
      birthdate: null,
      canSeeAlcohol: false,
      onboarded: true,
      isFollowing: true,
      subscribed: true,
    });
    expect(page.items[1]).toMatchObject({ isFollowing: true, subscribed: false });
  });

  it('a blank q is no filter, and a full page pages on by offset', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, () => ({ data: [personRow, personRow], error: null })));
    const page = await api.listPostNotificationPeople({ q: '   ', limit: 2 });
    expect(decodeCursor(page.nextCursor)).toEqual({ offset: 2 });
    await api.listPostNotificationPeople({ limit: 2, cursor: page.nextCursor! });
    expect(log.map((c) => c.args)).toEqual([
      { p_q: null, p_limit: 2, p_offset: 0 },
      { p_q: null, p_limit: 2, p_offset: 2 },
    ]);
  });

  it('a backend without post notifications answers an empty page; other errors are mapped', async () => {
    const old = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    await expect(old.listPostNotificationPeople()).resolves.toEqual({ items: [], nextCursor: null });
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: { ...pgError('BEVI_VALIDATION', '22023'), details: 'q' } })));
    expect(await rejection(api.listPostNotificationPeople({ q: 'x' }))).toMatchObject({ code: 'validation', detail: { field: 'q' } });
  });
});

describe('notifications.setPostNotification', () => {
  it('calls set_post_notification with the id and the switch', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    await api.setPostNotification(PERSON_ID, true);
    await api.setPostNotification(PERSON_ID, false);
    expect(log).toEqual([
      { fn: 'set_post_notification', args: { p_user_id: PERSON_ID, p_on: true } },
      { fn: 'set_post_notification', args: { p_user_id: PERSON_ID, p_on: false } },
    ]);
  });

  it('an id that cannot be anybody is not_found when turning on and a no-op when turning off, without a round trip', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    expect((await rejection(api.setPostNotification('nobody', true))).code).toBe('not_found');
    await expect(api.setPostNotification('nobody', false)).resolves.toBeUndefined();
    expect(log).toEqual([]);
  });

  it("maps 'not following' to validation, and THROWS on a backend without it", async () => {
    const notFollowing = createNotificationsApi(
      fakeClient([], () => ({ data: null, error: { ...pgError('BEVI_VALIDATION', '22023'), details: 'not following' } })),
    );
    expect((await rejection(notFollowing.setPostNotification(PERSON_ID, true))).code).toBe('validation');
    const old = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    expect((await rejection(old.setPostNotification(PERSON_ID, true))).code).toBe('unknown');
  });
});

describe('notifications.registerPushToken / unregisterPushToken', () => {
  const TOKEN = 'ExponentPushToken[abc123]';

  it('call the two RPCs with the token', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log));
    await api.registerPushToken(TOKEN);
    await api.unregisterPushToken(TOKEN);
    expect(log).toEqual([
      { fn: 'register_push_token', args: { p_token: TOKEN } },
      { fn: 'unregister_push_token', args: { p_token: TOKEN } },
    ]);
  });

  it('resolve silently on a backend without push, and map any other error', async () => {
    const old = createNotificationsApi(fakeClient([], () => ({ data: null, error: NO_SUCH_FUNCTION })));
    await expect(old.registerPushToken(TOKEN)).resolves.toBeUndefined();
    await expect(old.unregisterPushToken(TOKEN)).resolves.toBeUndefined();
    const api = createNotificationsApi(fakeClient([], () => ({ data: null, error: { ...pgError('BEVI_VALIDATION', '22023'), details: 'token' } })));
    expect(await rejection(api.registerPushToken('nope'))).toMatchObject({ code: 'validation', detail: { field: 'token' } });
  });

  it('need a session', async () => {
    const log: RpcCall[] = [];
    const api = createNotificationsApi(fakeClient(log, undefined, false));
    expect((await rejection(api.registerPushToken(TOKEN))).code).toBe('unauthorized');
    expect((await rejection(api.unregisterPushToken(TOKEN))).code).toBe('unauthorized');
    expect(log).toEqual([]);
  });
});
