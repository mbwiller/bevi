// The Map tab against the FakeApi (BEV-22). jest resolves BevdCanvas.tsx, the list, so this covers
// everything but Google: the scopes, the nudge, the sheet a place opens, the empty states and
// arriving from a post's place line. BevdCanvas.web.test.tsx covers the map itself.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { FRIEND, ME } from '@/testing/fakeApi/people';

import { BevdMapScreen } from '../BevdMapScreen';
import { MAP_EMPTY_ACTION, MAP_EMPTY_FRIENDS, MAP_EMPTY_TITLE } from '../copy';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { venue?: string } = {};
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
  return { first: first!, second: second!, mine: [a!, b!], theirs };
}

async function renderScreen() {
  await render(
    <QueryClientProvider client={client}>
      <BevdMapScreen />
    </QueryClientProvider>,
  );
}

it('with no places yet it says so, counts the Bevs that have none, and leads to Bev\'d', async () => {
  await renderScreen();
  expect(await screen.findByText(MAP_EMPTY_TITLE)).toBeTruthy();
  const ranked = (await api.rankings.listMine()).items.length;
  expect(await screen.findByText(`${ranked} of your Bevs have no location yet.`)).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: MAP_EMPTY_ACTION }));
  expect(mockPush).toHaveBeenCalledWith('/lists');
});

it('lists a place per venue with how many Bevs were had there and how many are yours', async () => {
  const { first, second } = await seedPlaces();
  await renderScreen();

  const shared = await screen.findByRole('button', { name: new RegExp(`^${first.name}, 2 Bevs · 1 yours`) });
  expect(shared).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(`^${second.name}, 1 Bev`) })).toBeTruthy();
});

it('You shows only your places, Friends only theirs, and each empty scope says its own thing', async () => {
  const { first, second } = await seedPlaces();
  await renderScreen();
  await screen.findByRole('button', { name: new RegExp(`^${second.name}`) });

  await fireEvent.press(screen.getByText('Friends'));
  await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${second.name}`) })).toBeNull());
  expect(screen.getByRole('button', { name: new RegExp(`^${first.name}, 1 Bev`) })).toBeTruthy();

  await fireEvent.press(screen.getByText('You'));
  expect(await screen.findByRole('button', { name: new RegExp(`^${second.name}, 1 Bev`) })).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(`^${first.name}, 1 Bev`) })).toBeTruthy();
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

  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(mine[0].bev.name)).toBeTruthy();
  expect(within(sheet).getByText(theirs.bev.name)).toBeTruthy();
  expect(within(sheet).getByText(/^You · /)).toBeTruthy();
  expect(within(sheet).getByText(/^Friend · /)).toBeTruthy();

  await fireEvent.press(within(sheet).getByText(mine[0].bev.name));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/bev/[id]', params: { id: mine[0].bev.id } });
});

it('arriving from a post (?venue=) opens on that place and forgets the param', async () => {
  const { second, mine } = await seedPlaces();
  mockParams = { venue: second.id };
  await renderScreen();

  const sheet = await screen.findByTestId('sheet');
  expect(await within(sheet).findByText(mine[1].bev.name)).toBeTruthy();
  expect(mockSetParams).toHaveBeenCalledWith({ venue: undefined });
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
