import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SuggestedProfile } from '@bevi/shared';
import type { ReactNode } from 'react';

import {
  flattenPages,
  useBlock,
  useBlockedUsers,
  useFeed,
  useFollowing,
  useLeaderboardFriends,
  useLeaderboardUsers,
  useUnblock,
  useUser,
  useUserSearch,
  useSuggested,
} from '@/api/hooks';
import { api } from '@/api/client';
import { keys } from '@/api/keys';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';

// What a block does to every list that can show the person, through the app's own hooks and the
// FakeApi's filtering (each hook is mounted, so what is checked is what a screen would read).

jest.setTimeout(30_000);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
});

afterEach(() => client.clear());

const friend = () => userIdFor(FRIEND.handle);
const stranger = () => userIdFor('friend_e');

describe('blocking a person you follow', () => {
  it('drops them from the feed, following, search, the leaderboard and their own profile', async () => {
    const me = await api.profile.getMe();
    const feed = await renderHook(() => useFeed(), { wrapper });
    const following = await renderHook(() => useFollowing(me.id), { wrapper });
    const search = await renderHook(() => useUserSearch('friend_a'), { wrapper });
    const board = await renderHook(() => useLeaderboardUsers(), { wrapper });
    const friends = await renderHook(() => useLeaderboardFriends(), { wrapper });
    // Reading `error` in the callback subscribes the hook to it (TanStack re-renders only for what was read).
    const profile = await renderHook(() => { const { data, error } = useUser(friend()); return { data, error }; }, { wrapper });
    const block = await renderHook(() => useBlock(), { wrapper });
    await waitFor(() => expect(flattenPages(feed.result.current.data).some((p) => p.actor.id === friend())).toBe(true));
    await waitFor(() => expect(flattenPages(following.result.current.data).some((u) => u.id === friend())).toBe(true));
    await waitFor(() => expect(flattenPages(search.result.current.data).some((u) => u.id === friend())).toBe(true));
    await waitFor(() => expect(flattenPages(board.result.current.data).some((r) => r.profile.id === friend())).toBe(true));
    await waitFor(() => expect(flattenPages(friends.result.current.data).some((r) => r.profile.id === friend())).toBe(true));
    await waitFor(() => expect(profile.result.current.data?.id).toBe(friend()));

    block.result.current.mutate(friend());

    await waitFor(() => expect(flattenPages(feed.result.current.data).some((p) => p.actor.id === friend())).toBe(false));
    await waitFor(() => expect(flattenPages(following.result.current.data).some((u) => u.id === friend())).toBe(false));
    await waitFor(() => expect(flattenPages(search.result.current.data).some((u) => u.id === friend())).toBe(false));
    await waitFor(() => expect(flattenPages(board.result.current.data).some((r) => r.profile.id === friend())).toBe(false));
    await waitFor(() => expect(flattenPages(friends.result.current.data).some((r) => r.profile.id === friend())).toBe(false));
    await waitFor(() => expect(profile.result.current.error).toMatchObject({ code: 'not_found' }));
  });

  it('drops them from suggestions when they are someone you do not follow, without waiting for a refetch', async () => {
    const suggested = await renderHook(() => useSuggested(), { wrapper });
    const block = await renderHook(() => useBlock(), { wrapper });
    await waitFor(() => expect(suggested.result.current.data?.some((u) => u.id === stranger())).toBe(true));
    // Hold the refetch the block triggers: what is checked is the cache edit itself, not the refill.
    jest.spyOn(api.follows, 'suggested').mockImplementation(() => new Promise(() => undefined));
    await act(() => block.result.current.mutateAsync(stranger()));
    const cached = client.getQueryData<SuggestedProfile[]>(keys.follows.suggested());
    expect(cached).toBeDefined();
    expect(cached!.some((u) => u.id === stranger())).toBe(false);
    // The held refetch never lands, so the mounted hook can only be showing the cache edit.
    await waitFor(() => expect(suggested.result.current.data?.some((u) => u.id === stranger())).toBe(false));
  });
});

describe('blocked accounts', () => {
  it('lists who you blocked, and Unblock takes the row away and brings them back everywhere', async () => {
    const list = await renderHook(() => useBlockedUsers(), { wrapper });
    const search = await renderHook(() => useUserSearch('friend_a'), { wrapper });
    const block = await renderHook(() => useBlock(), { wrapper });
    const unblock = await renderHook(() => useUnblock(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(flattenPages(list.result.current.data)).toHaveLength(0);

    block.result.current.mutate(friend());
    await waitFor(() => expect(flattenPages(list.result.current.data).map((b) => b.id)).toEqual([friend()]));
    await waitFor(() => expect(flattenPages(search.result.current.data).some((u) => u.id === friend())).toBe(false));

    unblock.result.current.mutate(friend());
    await waitFor(() => expect(flattenPages(list.result.current.data)).toHaveLength(0));
    await waitFor(() => expect(flattenPages(search.result.current.data).some((u) => u.id === friend())).toBe(true));
  });

  it('a failed Unblock puts the row back', async () => {
    await api.blocks.block(friend());
    const list = await renderHook(() => useBlockedUsers(), { wrapper });
    const unblock = await renderHook(() => useUnblock(), { wrapper });
    await waitFor(() => expect(flattenPages(list.result.current.data)).toHaveLength(1));
    controls.failNext('network', 'blocks.unblock');
    unblock.result.current.mutate(friend());
    await waitFor(() => expect(unblock.result.current.isError).toBe(true));
    await waitFor(() => expect(flattenPages(list.result.current.data).map((b) => b.id)).toEqual([friend()]));
  });
});
