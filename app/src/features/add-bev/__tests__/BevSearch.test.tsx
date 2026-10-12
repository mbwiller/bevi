import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import AddBevScreen from '@/app/(tabs)/add/index';

import { BevSearch } from '../BevSearch';
import { readRecents } from '../recents';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { tab?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams, canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

configure({ asyncUtilTimeout: 5000 });
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockParams = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
  mockPush.mockClear();
  mockSetParams.mockClear();
});

const renderSearch = () =>
  render(
    <QueryClientProvider client={client}>
      <BevSearch />
    </QueryClientProvider>,
  );

it('debounces typing into one search and lists the results', async () => {
  const search = jest.spyOn(api.bevs, 'search');
  await renderSearch();
  expect(screen.getByText('Find a Bev to rank')).toBeTruthy();
  const input = screen.getByLabelText('Search a Bev, brand or flavor');
  for (const q of ['c', 'co', 'cok', 'coke']) await fireEvent.changeText(input, q);
  expect(search).not.toHaveBeenCalled();

  const rank = await screen.findAllByLabelText(/^Rank /);
  expect(rank.length).toBeGreaterThan(0);
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]![0]).toMatchObject({ q: 'coke', limit: 25 });

  const first = (await search.mock.results[0]!.value).items[0];
  await fireEvent.press(screen.getByLabelText(`Rank ${first.name}`));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/rank/[bevId]', params: { bevId: first.id } });
});

it('tapping a result ranks it, or opens its detail when already ranked', async () => {
  const items = (await api.bevs.search({ q: 'coke', limit: 25 })).items;
  const details = await Promise.all(items.map((b) => api.bevs.get(b.id)));
  const unranked = details.find((d) => !d.myRanking)!;
  // Rank one so the list has a ranked row too.
  const loved = await api.rankings.listBucket('LOVED');
  const ranked = details.find((d) => d.id !== unranked.id && !d.myRanking)!;
  await api.rankings.submitRanking({ bevId: ranked.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });

  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'coke');
  await screen.findAllByLabelText(/^Rank /);
  // Each row reads its Bev's detail; wait for both rows to know.
  await waitFor(() => expect(client.getQueryData(['bevi', 'bevs', 'detail', ranked.id])).toBeTruthy());
  await waitFor(() => expect(client.getQueryData(['bevi', 'bevs', 'detail', unranked.id])).toBeTruthy());

  await fireEvent.press(screen.getByRole('button', { name: unranked.name }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/rank/[bevId]', params: { bevId: unranked.id } });
  await fireEvent.press(screen.getByRole('button', { name: ranked.name }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/bev/[id]', params: { id: ranked.id } });
});

it('the bookmark saves a result to Want to Try and back', async () => {
  const add = jest.spyOn(api.wantToTry, 'add');
  const remove = jest.spyOn(api.wantToTry, 'remove');
  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'coke');
  await screen.findAllByLabelText(/^Rank /);
  const [save] = await screen.findAllByLabelText('Save to Want to Try');
  await fireEvent.press(save!);
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  const [savedBtn] = await screen.findAllByLabelText('Saved to Want to Try');
  await fireEvent.press(savedBtn!);
  await waitFor(() => expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0]));
});

it('shows an empty state and a primary "Add a new Bev" when nothing matches', async () => {
  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'zzqqxx');
  expect(await screen.findByText('No Bevs match "zzqqxx"')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Can't find it? Add a new Bev"));
  expect(mockPush).toHaveBeenCalledWith('/add/new');
});

it('shows ErrorState with Retry when search fails', async () => {
  controls.failNext('network', 'bevs.search');
  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'coke');
  expect(await screen.findByText("You're offline")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Retry'));
  expect((await screen.findAllByLabelText(/^Rank /)).length).toBeGreaterThan(0);
});

it('hides alcoholic results from an under-21 viewer', async () => {
  controls.signInAs('minor_user');
  const alcoholic = { id: 'x-beer', name: 'Test Lager', brand: null, flavor: null, categoryId: 'beer', photoUrl: null, photoStatus: 'ready', priceTier: 1, priceEstimated: false, ratingCount: 0, bayesScore: null } as const;
  const real = api.bevs.search.bind(api.bevs);
  jest.spyOn(api.bevs, 'search').mockImplementation(async (p) => {
    const page = await real(p);
    return { ...page, items: [alcoholic, ...page.items] };
  });
  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'coke');
  await screen.findAllByLabelText(/^Rank /);
  await waitFor(() => expect(screen.queryByText('Test Lager')).toBeNull());
});

it('remembers opened Bevs as Recents (in localStorage) and forgets them', async () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  await renderSearch();
  await fireEvent.changeText(screen.getByLabelText('Search a Bev, brand or flavor'), 'coke');
  const [rank] = await screen.findAllByLabelText(/^Rank /);
  const name = rank!.props.accessibilityLabel.replace(/^Rank /, '');
  await fireEvent.press(screen.getByRole('button', { name }));
  expect(readRecents('user-tester')[0]?.name).toBe(name);
  // Another account on this browser has its own (empty) list.
  expect(readRecents('user-friend_a')).toEqual([]);
  expect([...store.keys()]).toEqual(['bevi.add.recents:user-tester']);

  await fireEvent.press(screen.getByLabelText('Clear search'));
  expect(await screen.findByText('Recents')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Forget ${name}`));
  expect(screen.queryByText('Recents')).toBeNull();
  expect(readRecents('user-tester')).toEqual([]);
  g.localStorage = saved;
});

it('the screen opens the People tab from ?tab=people', async () => {
  mockParams = { tab: 'people' };
  await render(
    <QueryClientProvider client={client}>
      <AddBevScreen />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText('Search by name or @handle')).toBeTruthy();
  expect(screen.queryByLabelText('Search a Bev, brand or flavor')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Bevs'));
  expect(mockSetParams).toHaveBeenCalledWith({ tab: undefined });
});
