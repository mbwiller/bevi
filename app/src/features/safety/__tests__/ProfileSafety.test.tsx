import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import FollowersScreen from '@/app/user/[id]/followers';
import FollowingScreen from '@/app/user/[id]/following';
import UserProfileScreen from '@/app/user/[id]/index';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';

// Another person's profile: More (Report profile, Block account), leaving it after a block, and the
// not-found state on the profile, followers and following once they are blocked.

jest.setTimeout(90_000);

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

/** A home screen with a link to the friend's profile, so the profile has somewhere to go back to. */
function Home() {
  const r = useRouter();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Open their profile" onPress={() => r.push({ pathname: '/user/[id]', params: { id: friendId() } })} />
  );
}
const friendId = () => userIdFor(FRIEND.handle);

async function open(url: string) {
  const result = renderRouter(
    {
      _layout: Layout,
      index: Home,
      'user/[id]/index': UserProfileScreen,
      'user/[id]/followers': FollowersScreen,
      'user/[id]/following': FollowingScreen,
      '(tabs)/profile/index': Stub,
      'bev/[id]': Stub,
      'rank/[bevId]': Stub,
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
  controls.signInAs(ME.handle);
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

const NOT_HERE = "This person isn't on Bevi anymore";

describe("another person's profile", () => {
  it('has a More button in the header that opens Report profile and Block account', async () => {
    await open(`/user/${friendId()}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('button', { name: 'Report profile' })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Block @${FRIEND.handle}` })).toBeTruthy();
  });

  it('Report profile files a profile report', async () => {
    const spy = jest.spyOn(api.reports, 'report');
    await open(`/user/${friendId()}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Report profile' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Something else' }));
    await fireEvent.changeText(screen.getByLabelText('Note'), 'pretending to be someone');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thanks, we got your report')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ kind: 'profile', id: friendId(), reason: 'other', note: 'pretending to be someone' });
    spy.mockRestore();
  });

  it('Block account leaves the profile, and it then reads as not found', async () => {
    const r = await open('/');
    // Reach the profile the way a person does, so there is a screen to go back to.
    await fireEvent.press(await screen.findByLabelText('Open their profile'));
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions' }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${FRIEND.handle}` }));
    await fireEvent.press(await screen.findByRole('button', { name: `Block @${FRIEND.handle}` }));
    await waitFor(() => expect(r.path()).toBe('/'));
    expect((await api.blocks.list()).items.map((b) => b.id)).toEqual([friendId()]);

    // A stale link to them now reads as not found: no spinner, no error, no More.
    await fireEvent.press(await screen.findByLabelText('Open their profile'));
    expect(await screen.findByText(NOT_HERE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByTestId('profile-skeleton')).toBeNull();
  });

  it('a profile that is open when they are blocked turns to not found', async () => {
    await open(`/user/${friendId()}`);
    await screen.findByRole('button', { name: 'More actions' });
    await api.blocks.block(friendId());
    await client.invalidateQueries();
    expect(await screen.findByText(NOT_HERE)).toBeTruthy();
  });
});

describe('followers and following of someone who is blocked', () => {
  it.each(['followers', 'following'] as const)('%s reads as not found, not an error or a spinner', async (which) => {
    await api.blocks.block(friendId());
    await open(`/user/${friendId()}/${which}`);
    expect(await screen.findByText(NOT_HERE)).toBeTruthy();
    expect(screen.queryByTestId('people-skeleton')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
