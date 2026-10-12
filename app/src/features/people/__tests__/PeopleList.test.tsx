import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import FollowersScreen from '@/app/user/[id]/followers';
import FollowingScreen from '@/app/user/[id]/following';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function open(url: string) {
  const result = renderRouter(
    {
      _layout: Layout,
      'user/[id]/followers': FollowersScreen,
      'user/[id]/following': FollowingScreen,
      'user/[id]/index': Stub,
      '(tabs)/profile/index': Stub,
      '(tabs)/add/index': Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

it('lists followers with follow pills that toggle, and opens a profile', async () => {
  const me = await api.profile.getMe();
  const followers = (await api.follows.listFollowers(me.id)).items;
  expect(followers.length).toBeGreaterThan(0);
  const first = followers[0]!;
  const r = await open(`/user/${me.id}/followers`);
  const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
  expect(pill.props['aria-pressed']).toBe(first.isFollowing);
  await fireEvent.press(pill);
  await waitFor(() => expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(!first.isFollowing));
  await waitFor(async () => expect((await api.profile.getUser(first.id)).isFollowing).toBe(!first.isFollowing));

  await fireEvent.press(screen.getByLabelText(new RegExp(`^${first.displayName}, @${first.handle}`)));
  expect(r.path()).toBe(`/user/${first.id}`);
});

it('filters the list by search', async () => {
  const me = await api.profile.getMe();
  const followers = (await api.follows.listFollowers(me.id)).items;
  const [a, b] = followers;
  await open(`/user/${me.id}/followers`);
  await screen.findByText(a!.displayName);
  await fireEvent.changeText(screen.getByPlaceholderText('Search'), a!.handle);
  expect(screen.getByText(a!.displayName)).toBeTruthy();
  if (b && !b.handle.includes(a!.handle) && !b.displayName.toLowerCase().includes(a!.handle)) {
    expect(screen.queryByText(b.displayName)).toBeNull();
  }
});

it('a new user following no one sees the empty state with Find people', async () => {
  controls.emptyUser();
  const me = await api.profile.getMe();
  const r = await open(`/user/${me.id}/following`);
  expect(await screen.findByText("You're not following anyone yet")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Find people'));
  expect(r.path()).toBe('/add?tab=people');
});
