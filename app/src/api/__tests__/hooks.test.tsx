import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { ProfileRow, Session } from '@bevi/shared';

import { api, mockControls } from '../client';
import {
  flattenPages,
  useAuthListener,
  useBucket,
  useFeed,
  useFollow,
  useMe,
  useSignIn,
  useSubmitRanking,
  useUser,
} from '../hooks';
import { keys } from '../keys';

const controls = mockControls!;

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

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
});

afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

it('signs in, then reads the profile and the paginated feed', async () => {
  const { wrapper } = setup();
  const signIn = await renderHook(() => useSignIn(), { wrapper });
  await act(() => signIn.result.current.mutateAsync({ username: 'demo', password: 'demo1234' }));

  const me = await renderHook(() => useMe(), { wrapper });
  await waitFor(() => expect(me.result.current.data?.handle).toBe('demo'));

  const feed = await renderHook(() => useFeed(), { wrapper });
  await waitFor(() => expect(feed.result.current.isSuccess).toBe(true));
  expect(feed.result.current.data!.pages[0]!.items).toHaveLength(20);
  expect(feed.result.current.hasNextPage).toBe(true);
  await act(() => feed.result.current.fetchNextPage());
  await waitFor(() => expect(feed.result.current.data!.pages).toHaveLength(2));
  expect(flattenPages(feed.result.current.data).length).toBeGreaterThan(20);
});

it('useAuthListener reports the persisted session, then changes', async () => {
  const { wrapper } = setup();
  const seen: (Session | null)[] = [];
  await renderHook(() => useAuthListener((s) => seen.push(s)), { wrapper });
  await waitFor(() => expect(seen).toEqual([null]));
  await act(() => api.signIn({ username: 'demo', password: 'demo1234' }).then(() => undefined));
  await act(() => api.signOut());
  expect(seen).toEqual([null, { userId: 'mock-user-demo', handle: 'demo' }, null]);
});

it('useFollow is optimistic and rolls back on error', async () => {
  await api.signIn({ username: 'demo', password: 'demo1234' });
  const { client, wrapper } = setup();
  const nina = 'mock-user-nina';
  const user = await renderHook(() => useUser(nina), { wrapper });
  await waitFor(() => expect(user.result.current.data?.isFollowing).toBe(false));
  const follow = await renderHook(() => useFollow(), { wrapper });

  controls.setLatency(50);
  controls.failNext('network', 'follows.follow');
  await act(async () => {
    follow.result.current.mutate(nina);
  });
  await waitFor(() => expect(client.getQueryData<ProfileRow>(keys.users.detail(nina))?.isFollowing).toBe(true));
  await waitFor(() => expect(follow.result.current.isError).toBe(true));
  expect(client.getQueryData<ProfileRow>(keys.users.detail(nina))?.isFollowing).toBe(false);

  controls.setLatency(0);
  await act(() => follow.result.current.mutateAsync(nina));
  await waitFor(() => expect(user.result.current.data?.isFollowing).toBe(true));
});

it('useSubmitRanking invalidates the bucket list the placement flow reads', async () => {
  await api.signIn({ username: 'demo', password: 'demo1234' });
  const { wrapper } = setup();
  const bucket = await renderHook(() => useBucket('FINE'), { wrapper });
  await waitFor(() => expect(bucket.result.current.isSuccess).toBe(true));
  const before = bucket.result.current.data!;
  const candidates = await api.bevs.getStarterCandidates();
  const ranked = new Set((await api.rankings.listMine({ page: { limit: 100 } })).items.map((r) => r.bevId));
  const bevId = candidates.find((b) => !ranked.has(b.id))!.id;

  const submit = await renderHook(() => useSubmitRanking(), { wrapper });
  await act(() =>
    submit.result.current
      .mutateAsync({ bevId, bucket: 'FINE', insertIndex: 0, expectedBucketSize: before.length, comparisons: [] })
      .then(() => undefined),
  );
  await waitFor(() => expect(bucket.result.current.data).toEqual([bevId, ...before]));
});
