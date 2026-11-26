import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/api/client';
import { flattenPages, useFollow, useMarkNotificationsRead, useNotifications, usePost, useToggleLike, useUnreadNotificationCount } from '@/api/hooks';
import { keys } from '@/api/keys';
import { controls } from '@/testing/fakeApi';

const clients: QueryClient[] = [];

// gcTime: Infinity schedules no garbage-collection timers, so Jest can exit.
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

beforeEach(async () => {
  controls.setLatency(0);
  controls.resetToFixtures();
  await api.signIn({ username: 'tester', password: 'tester-pass-1' });
});

afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

describe('useMarkNotificationsRead', () => {
  it('clears the bell at once and leaves the list as it was', async () => {
    const { client, wrapper } = setup();
    const count = await renderHook(() => useUnreadNotificationCount(), { wrapper });
    const list = await renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(count.result.current.data).toBe(3));
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const before = list.result.current.data;
    const newest = flattenPages(before)[0]!;
    const listFn = jest.spyOn(api.notifications, 'list');

    const mark = await renderHook(() => useMarkNotificationsRead(), { wrapper });
    controls.setLatency(50);
    await act(async () => {
      mark.result.current.mutate(newest.id);
    });
    // Optimistic: 0 before the server answers.
    expect(client.getQueryData(keys.notifications.unreadCount())).toBe(0);
    await waitFor(() => expect(mark.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(count.result.current.data).toBe(0));
    expect(await api.notifications.unreadCount()).toBe(0);
    // The rows keep their unread state: the list was neither refetched nor marked stale.
    expect(list.result.current.data).toBe(before);
    expect(flattenPages(list.result.current.data).filter((n) => n.unread)).toHaveLength(3);
    expect(client.getQueryState(keys.notifications.list())?.isInvalidated).toBe(false);
    expect(listFn).not.toHaveBeenCalled();
    listFn.mockRestore();
  });

  it('puts the count back when marking fails', async () => {
    const { client, wrapper } = setup();
    const count = await renderHook(() => useUnreadNotificationCount(), { wrapper });
    await waitFor(() => expect(count.result.current.data).toBe(3));
    const newest = (await api.notifications.list()).items[0]!;
    const mark = await renderHook(() => useMarkNotificationsRead(), { wrapper });
    controls.failNext('network', 'notifications.markRead');
    await act(async () => {
      await mark.result.current.mutateAsync(newest.id).catch(() => undefined);
    });
    await waitFor(() => expect(mark.result.current.isError).toBe(true));
    await waitFor(() => expect(client.getQueryData(keys.notifications.unreadCount())).toBe(3));
    expect(await api.notifications.unreadCount()).toBe(3);
  });
});

describe('a follow and the inbox', () => {
  it('flips "Follow back" in the cached notification at once, and only marks the list stale', async () => {
    const { client, wrapper } = setup();
    const list = await renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const followRow = () => flattenPages(list.result.current.data).find((n) => n.kind === 'follow' && n.unread)!;
    const person = followRow().actors[0]!;
    expect(person.isFollowing).toBe(false);
    const listFn = jest.spyOn(api.notifications, 'list');

    const follow = await renderHook(() => useFollow(), { wrapper });
    controls.setLatency(50);
    await act(async () => {
      follow.result.current.mutate(person.id);
    });
    await waitFor(() => expect(followRow().actors[0]!.isFollowing).toBe(true));
    await waitFor(() => expect(follow.result.current.isSuccess).toBe(true));
    // Still unread on screen: stale, not refetched under the reader.
    expect(followRow().unread).toBe(true);
    expect(client.getQueryState(keys.notifications.list())?.isInvalidated).toBe(true);
    expect(listFn).not.toHaveBeenCalled();
    listFn.mockRestore();
  });

  it('puts the pill back when the follow fails', async () => {
    const { wrapper } = setup();
    const list = await renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const followRow = () => flattenPages(list.result.current.data).find((n) => n.kind === 'follow' && n.unread)!;
    const person = followRow().actors[0]!;
    const follow = await renderHook(() => useFollow(), { wrapper });
    controls.failNext('network', 'follows.follow');
    await act(async () => {
      await follow.result.current.mutateAsync(person.id).catch(() => undefined);
    });
    expect(followRow().actors[0]!.isFollowing).toBe(false);
  });
});

describe('usePost', () => {
  it('is reached by the like that patches every cached FeedItem', async () => {
    const { wrapper } = setup();
    const id = (await api.feed.getFeed({ limit: 20 })).items.find((p) => !p.likedByMe && p.actor.handle !== 'tester')!.id;
    const post = await renderHook(() => usePost(id), { wrapper });
    await waitFor(() => expect(post.result.current.data?.id).toBe(id));
    const likes = post.result.current.data!.likeCount;
    const like = await renderHook(() => useToggleLike(), { wrapper });
    controls.setLatency(50);
    await act(async () => {
      like.result.current.mutate({ id, like: true });
    });
    await waitFor(() => expect(post.result.current.data?.likedByMe).toBe(true));
    expect(post.result.current.data?.likeCount).toBe(likes + 1);
  });

  it('fails with not_found for a post the caller cannot see', async () => {
    const { wrapper } = setup();
    const post = await renderHook(() => usePost('no-such-post'), { wrapper });
    await waitFor(() => expect(post.result.current.isError).toBe(true));
    expect(post.result.current.error).toMatchObject({ code: 'not_found' });
  });
});
