// The Map tab against the FakeApi (BEV-22), drawn as the list of places: You and Friends, the
// nudge, the sheet a place opens, the empty states and arriving from a post's place line.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { FRIEND, ME } from '@/testing/fakeApi/people';

import { BevdMapScreen } from '../BevdMapScreen';
import { ADD_LOCATIONS, ADD_THEM, MAP_EMPTY_ACTION, MAP_EMPTY_FRIENDS, MAP_EMPTY_TITLE } from '../copy';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { venue?: string; scope?: string } = {};
const mockRouter = { push: mockPush, setParams: mockSetParams, back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

// FlashList's own jest setup (@shopify/flash-list/jestSetup): a 400 × 900 window of 100pt rows.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => ({
  ...jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout'),
  measureParentSize: () => ({ x: 0, y: 0, width: 400, height: 900 }),
  measureFirstChildLayout: () => ({ x: 0, y: 0, width: 400, height: 900 }),
  measureItemLayout: () => ({ x: 0, y: 0, width: 100, height: 100 }),
}));

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

const HERE = { lat: 40.7762, lng: -73.9495 };

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  mockParams = {};
  mockPush.mockClear();
  mockSetParams.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

/**
 * Tags Bevs with places: two of mine at the first venue and the second, and one of a friend's at
 * the first. Returns the two venues.
 */
async function seedPlaces() {
  const [first, second] = (await api.venues.search({ query: '', near: HERE, limit: 2 })).map((m) => m.venue);
  controls.signInAs(FRIEND.handle);
  const theirs = (await api.rankings.listMine()).items[0]!;
  await api.rankings.setVenue(theirs.bev.id, first!.id);
  controls.signInAs(ME.handle);
  const [a, b] = (await api.rankings.listMine()).items;
  await api.rankings.setVenue(a!.bev.id, first!.id);
  await api.rankings.setVenue(b!.bev.id, second!.id);
  return { first: first!, second: second!, mine: [a!, b!] as const, theirs };
}

async function renderScreen() {
  await render(
    <QueryClientProvider client={client}>
      <BevdMapScreen />
    </QueryClientProvider>,
  );
}

it('with no places yet it says so, counts the Bevs that have none, and adds them without leaving the map', async () => {
  await renderScreen();
  expect(await screen.findByText(MAP_EMPTY_TITLE)).toBeTruthy();
  const ranked = (await api.rankings.listMine()).items.length;
  expect(await screen.findByText(`${ranked} of your Bevs have no location yet.`)).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: ADD_LOCATIONS }));
  expect(await screen.findByText(`1 of ${ranked}`)).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

it('with nothing Bev\'d yet the empty map still leads to Bev\'d', async () => {
  for (const r of (await api.rankings.listMine({ page: { limit: 50 } })).items) await api.rankings.removeRanking(r.bevId);
  await renderScreen();
  await fireEvent.press(await screen.findByRole('button', { name: MAP_EMPTY_ACTION }));
  expect(mockPush).toHaveBeenCalledWith('/lists');
});

it('"Add them" on the line under the tabs opens the one-at-a-time sheet over the map', async () => {
  await seedPlaces();
  const ranked = (await api.rankings.listMine()).items.length;
  await renderScreen();
  const nudge = await screen.findByTestId('bevd-map-nudge');
  expect(within(nudge).getByText(ADD_THEM)).toBeTruthy();

  await fireEvent.press(nudge);
  expect(await screen.findByText(`1 of ${ranked - 2}`)).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

it('has two views, You and Friends, and opens on You: a place per venue with how many Bevs you had there', async () => {
  const { first, second } = await seedPlaces();
  await renderScreen();

  expect(screen.getByText('You')).toBeTruthy();
  expect(screen.getByText('Friends')).toBeTruthy();
  expect(screen.queryByText('Everyone')).toBeNull();
  // The friend's Bev at the first place is not counted here.
  expect(await screen.findByRole('button', { name: new RegExp(`^${first.name}, 1 Bev ·`) })).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(`^${second.name}, 1 Bev ·`) })).toBeTruthy();
});

it('Friends shows only the places of people you follow, and You brings yours back', async () => {
  const { first, second } = await seedPlaces();
  await renderScreen();
  await screen.findByRole('button', { name: new RegExp(`^${second.name}`) });

  await fireEvent.press(screen.getByText('Friends'));
  await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${second.name}`) })).toBeNull());
  expect(screen.getByRole('button', { name: new RegExp(`^${first.name}, 1 Bev ·`) })).toBeTruthy();

  await fireEvent.press(screen.getByText('You'));
  expect(await screen.findByRole('button', { name: new RegExp(`^${second.name}, 1 Bev ·`) })).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(`^${first.name}, 1 Bev ·`) })).toBeTruthy();
});

it('Friends with nothing to show does not send you to your own list', async () => {
  const [a] = (await api.rankings.listMine()).items;
  const [here] = (await api.venues.search({ query: '', near: HERE, limit: 1 })).map((m) => m.venue);
  await api.rankings.setVenue(a!.bev.id, here!.id);
  await renderScreen();
  await screen.findByRole('button', { name: new RegExp(`^${here!.name}`) });

  await fireEvent.press(screen.getByText('Friends'));
  expect(await screen.findByText(MAP_EMPTY_FRIENDS)).toBeTruthy();
  expect(screen.queryByRole('button', { name: MAP_EMPTY_ACTION })).toBeNull();
});

it('a place opens what was had there: whose, which Bev, and the Bev opens from it', async () => {
  const { first, mine, theirs } = await seedPlaces();
  await renderScreen();
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${first.name}`) }));

  // You: only what you had there.
  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(mine[0].bev.name)).toBeTruthy();
  expect(within(sheet).getByText(/^You · /)).toBeTruthy();
  expect(within(sheet).queryByText(theirs.bev.name)).toBeNull();

  // The Bev opens once the sheet has closed, not in the same tick: iOS is still dismissing the Modal then.
  const opened = { pathname: '/bev/[id]', params: { id: mine[0].bev.id } };
  await fireEvent.press(within(sheet).getByText(mine[0].bev.name));
  expect(mockPush).not.toHaveBeenCalledWith(opened);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(opened), { timeout: 3000 });
});

it('under Friends a place opens what the people you follow had there', async () => {
  const { first, second, mine, theirs } = await seedPlaces();
  await renderScreen();
  await screen.findByRole('button', { name: new RegExp(`^${second.name}`) });
  await fireEvent.press(screen.getByText('Friends'));
  // Wait for the Friends places themselves: until they load, You's stay up, and the first place is
  // in both.
  await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${second.name}`) })).toBeNull());
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${first.name}, 1 Bev ·`) }));

  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(theirs.bev.name)).toBeTruthy();
  expect(within(sheet).getByText(/^Friend · /)).toBeTruthy();
  expect(within(sheet).queryByText(mine[0].bev.name)).toBeNull();
});

it('arriving from a post (?venue=) opens on that place and forgets the param', async () => {
  const { second, mine } = await seedPlaces();
  mockParams = { venue: second.id };
  await renderScreen();

  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(mine[1].bev.name)).toBeTruthy();
  expect(mockSetParams).toHaveBeenCalledWith({ venue: undefined, scope: undefined });
});

it("arriving from a friend's post (?venue=&scope=friends) opens Friends on that place", async () => {
  const { first, theirs } = await seedPlaces();
  mockParams = { venue: first.id, scope: 'friends' };
  await renderScreen();

  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(theirs.bev.name)).toBeTruthy();
  expect(mockSetParams).toHaveBeenCalledWith({ venue: undefined, scope: undefined });
});

it('the nudge goes once every Bev has a place', async () => {
  const [here] = (await api.venues.search({ query: '', near: HERE, limit: 1 })).map((m) => m.venue);
  for (const r of (await api.rankings.listMine({ page: { limit: 100 } })).items) await api.rankings.setVenue(r.bev.id, here!.id);
  await renderScreen();
  await screen.findByRole('button', { name: new RegExp(`^${here!.name}`) });
  expect(screen.queryByTestId('bevd-map-nudge')).toBeNull();
});

it('a failed load can be retried', async () => {
  await seedPlaces();
  controls.failNext('network', 'venues.bevdMap');
  await renderScreen();
  await fireEvent.press(await screen.findByRole('button', { name: /try again|retry/i }));
  expect(await screen.findAllByRole('button', { name: / Bevs? /})).not.toHaveLength(0);
});
