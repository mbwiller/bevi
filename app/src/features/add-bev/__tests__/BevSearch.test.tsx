import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api, mockControls } from '@/api/client';
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

const controls = mockControls!;
configure({ asyncUtilTimeout: 5000 });
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
  mockParams = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
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
  await fireEvent.press(screen.getByRole('button', { name: first.name }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/bev/[id]', params: { id: first.id } });
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
  controls.signInAs('theo');
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
  expect(readRecents()[0]?.name).toBe(name);

  await fireEvent.press(screen.getByLabelText('Clear search'));
  expect(await screen.findByText('Recents')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Forget ${name}`));
  expect(screen.queryByText('Recents')).toBeNull();
  expect(readRecents()).toEqual([]);
  g.localStorage = saved;
});

it('the screen opens the People tab from ?tab=people', async () => {
  mockParams = { tab: 'people' };
  await render(
    <QueryClientProvider client={client}>
      <AddBevScreen />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Coming soon')).toBeTruthy();
  expect(screen.queryByLabelText('Search a Bev, brand or flavor')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Bevs'));
  expect(mockSetParams).toHaveBeenCalledWith({ tab: undefined });
});
