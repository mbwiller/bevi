import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import AddBevScreen from '@/app/(tabs)/add/index';

import { PEOPLE_PLACEHOLDER } from '../PeopleSearch';

const mockPush = jest.fn();
let mockParams: { tab?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

configure({ asyncUtilTimeout: 5000 });
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockParams = { tab: 'people' };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
  mockPush.mockClear();
});

const renderAdd = () =>
  render(
    <QueryClientProvider client={client}>
      <AddBevScreen />
    </QueryClientProvider>,
  );

it('opens on People with ?tab=people and shows suggestions with follow pills that toggle optimistically', async () => {
  const suggested = await api.follows.suggested();
  expect(suggested.length).toBeGreaterThan(0);
  const first = suggested[0]!;
  expect(first.isFollowing).toBe(false);

  await renderAdd();
  expect(screen.getByText('Suggested for you')).toBeTruthy();
  const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
  expect(pill.props['aria-pressed']).toBe(false);

  controls.setLatency(1000);
  await fireEvent.press(pill);
  // Flips while the server is still answering.
  await waitFor(() => expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(true));
  expect(client.isMutating()).toBe(1);
  await waitFor(async () => expect((await api.profile.getUser(first.id)).isFollowing).toBe(true));
  // The suggestion stays on screen as "Following".
  expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(true);
});

it('rolls a failed follow back', async () => {
  const first = (await api.follows.suggested())[0]!;
  await renderAdd();
  const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
  controls.failNext('network', 'follows.follow');
  await fireEvent.press(pill);
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(false);
});

it('debounces typing into one search, lists results without yourself, and opens a profile', async () => {
  const me = await api.profile.getMe();
  const target = (await api.follows.suggested())[0]!;
  const handle = target.handle;
  const search = jest.spyOn(api.profile, 'searchUsers');

  await renderAdd();
  await screen.findByLabelText(`Follow ${target.displayName}`);
  const input = screen.getByLabelText(PEOPLE_PLACEHOLDER);
  for (let i = 1; i <= handle.length; i++) await fireEvent.changeText(input, `@${handle.slice(0, i)}`);
  expect(search).not.toHaveBeenCalled();
  expect(screen.queryByText('Suggested for you')).toBeNull();

  const row = await screen.findByLabelText(new RegExp(`^${target.displayName}, @${handle}`));
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]![0]).toMatchObject({ q: `@${handle}` });
  expect(screen.queryByText(new RegExp(`${me.displayName} \\(you\\)`))).toBeNull();

  await fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/user/[id]', params: { id: target.id } });
});

it('leaves yourself out even when your own handle matches', async () => {
  const me = await api.profile.getMe();
  jest.spyOn(api.profile, 'searchUsers').mockResolvedValueOnce({
    items: [{ ...(await api.profile.getUser(me.id)) }],
    nextCursor: null,
  });
  await renderAdd();
  await fireEvent.changeText(screen.getByLabelText(PEOPLE_PLACEHOLDER), me.handle);
  expect(await screen.findByText(`No one matches "${me.handle}"`)).toBeTruthy();
});

it('shows the empty state when no one matches', async () => {
  await renderAdd();
  await fireEvent.changeText(screen.getByLabelText(PEOPLE_PLACEHOLDER), 'zzqxnobody');
  expect(await screen.findByText('No one matches "zzqxnobody"')).toBeTruthy();
});

it('shows an error with Retry that refetches', async () => {
  await renderAdd();
  controls.failNext('network', 'profile.searchUsers');
  await fireEvent.changeText(screen.getByLabelText(PEOPLE_PLACEHOLDER), 'a');
  const retry = await screen.findByLabelText('Retry');
  await fireEvent.press(retry);
  expect(await screen.findAllByLabelText(/^Follow /)).toBeTruthy();
});
