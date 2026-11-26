import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import SettingsIndexScreen from '@/app/settings/index';
import BlockedAccountsScreen from '@/app/settings/blocked';
import { FRIEND, ME, controls, userIdFor } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { BLOCKED_EMPTY_TITLE } from '../BlockedAccounts';

// Settings > Blocked accounts, reached from the Settings index, against the FakeApi.

jest.setTimeout(60_000);

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
      'settings/index': SettingsIndexScreen,
      'settings/blocked': BlockedAccountsScreen,
      'user/[id]/index': Stub,
      'profile/index': Stub,
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
  useSession.setState({ status: 'ready', checked: true, devForced: true });
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

const friendId = () => userIdFor(FRIEND.handle);

it('Settings has a Blocked accounts row that opens the screen', async () => {
  const r = await open('/settings');
  await fireEvent.press(await screen.findByRole('link', { name: 'Blocked accounts' }));
  await waitFor(() => expect(r.path()).toBe('/settings/blocked'));
  expect(await screen.findByRole('heading', { name: 'Blocked accounts' })).toBeTruthy();
});

it('empty: says so, and what blocking does', async () => {
  await open('/settings/blocked');
  expect(await screen.findByText(BLOCKED_EMPTY_TITLE)).toBeTruthy();
  expect(screen.queryByTestId('blocked-skeleton')).toBeNull();
});

it('loading: skeleton rows until the list arrives', async () => {
  await api.blocks.block(friendId());
  controls.setLatency(150);
  await open('/settings/blocked');
  expect(await screen.findByTestId('blocked-skeleton')).toBeTruthy();
  expect(await screen.findByTestId(`blocked-row-${friendId()}`)).toBeTruthy();
  expect(screen.queryByTestId('blocked-skeleton')).toBeNull();
});

it('lists the people you blocked, newest first, with a name, a handle and Unblock', async () => {
  const b = (await api.profile.searchUsers({ q: 'friend_b' })).items.find((u) => u.handle === 'friend_b')!;
  await api.blocks.block(friendId());
  await api.blocks.block(b.id);
  await open('/settings/blocked');
  const rows = await screen.findAllByTestId(/^blocked-row-/);
  expect(rows.map((row) => row.props.testID)).toEqual([`blocked-row-${b.id}`, `blocked-row-${friendId()}`]);
  const row = rows[1]!;
  expect(within(row).getByText(FRIEND.displayName)).toBeTruthy();
  expect(within(row).getByText(`@${FRIEND.handle}`)).toBeTruthy();
  expect(within(row).getByRole('button', { name: `Unblock ${FRIEND.displayName}, @${FRIEND.handle}` })).toBeTruthy();
});

it('a row is not a link to their profile: its only control is Unblock', async () => {
  await api.blocks.block(friendId());
  const r = await open('/settings/blocked');
  const row = await screen.findByTestId(`blocked-row-${friendId()}`);
  expect(within(row).getAllByRole('button')).toHaveLength(1);
  expect(within(row).queryByRole('link')).toBeNull();
  await fireEvent.press(within(row).getByText(FRIEND.displayName));
  expect(r.path()).toBe('/settings/blocked');
});

it('Unblock takes the row away, and they are visible again', async () => {
  await api.blocks.block(friendId());
  await open('/settings/blocked');
  const row = await screen.findByTestId(`blocked-row-${friendId()}`);
  await fireEvent.press(within(row).getByRole('button', { name: /^Unblock/ }));
  await waitFor(() => expect(screen.queryByTestId(`blocked-row-${friendId()}`)).toBeNull());
  expect(await screen.findByText(BLOCKED_EMPTY_TITLE)).toBeTruthy();
  expect((await api.blocks.list()).items).toHaveLength(0);
  await expect(api.profile.getUser(friendId())).resolves.toMatchObject({ id: friendId() });
});

it('a failed Unblock brings the row back and says to check the connection', async () => {
  await api.blocks.block(friendId());
  await open('/settings/blocked');
  const row = await screen.findByTestId(`blocked-row-${friendId()}`);
  controls.failNext('network', 'blocks.unblock');
  await fireEvent.press(within(row).getByRole('button', { name: /^Unblock/ }));
  expect(await screen.findByText("Couldn't unblock this account. Check your connection and try again.")).toBeTruthy();
  expect(await screen.findByTestId(`blocked-row-${friendId()}`)).toBeTruthy();
  expect((await api.blocks.list()).items).toHaveLength(1);
});

it('two Unblocks in flight: the first failing still brings its row back, not stuck on Working', async () => {
  const b = (await api.profile.searchUsers({ q: 'friend_b' })).items.find((u) => u.handle === 'friend_b')!;
  await api.blocks.block(friendId());
  await api.blocks.block(b.id);
  await open('/settings/blocked');
  const rowA = await screen.findByTestId(`blocked-row-${friendId()}`);
  const rowB = await screen.findByTestId(`blocked-row-${b.id}`);
  controls.setLatency(150);
  controls.failNext('network', 'blocks.unblock');
  await fireEvent.press(within(rowA).getByRole('button', { name: /^Unblock/ }));
  await fireEvent.press(within(rowB).getByRole('button', { name: /^Unblock/ }));
  expect(await screen.findByText("Couldn't unblock this account. Check your connection and try again.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId(`blocked-row-${b.id}`)).toBeNull());
  const back = await screen.findByTestId(`blocked-row-${friendId()}`);
  await waitFor(() => expect(within(back).queryByText('Working…')).toBeNull());
  controls.setLatency(0);
  expect((await api.blocks.list()).items.map((u) => u.id)).toEqual([friendId()]);
});

it('error: ErrorState with Retry, and Retry loads the list', async () => {
  await api.blocks.block(friendId());
  controls.failNext('unknown', 'blocks.list');
  await open('/settings/blocked');
  await fireEvent.press(await screen.findByText('Retry'));
  expect(await screen.findByTestId(`blocked-row-${friendId()}`)).toBeTruthy();
});
