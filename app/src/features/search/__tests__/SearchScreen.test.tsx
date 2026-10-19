import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import SearchTab from '@/app/(tabs)/add/index';
import { readRecents } from '@/features/add-bev/recents';
import { controls } from '@/testing/fakeApi';

import { ADD_NEW } from '../SearchPanel';
import { SEARCH_PLACEHOLDER } from '../SearchScreen';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { tab?: string; focus?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams, canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

// Counts mounts of the map area: the live map (M-16) must be created once, so the placeholder that
// stands in for it must survive the panel opening and closing.
const mockMap = { mounts: 0 };
jest.mock('../MapPlaceholder', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MapPlaceholder: () => {
      React.useEffect(() => {
        mockMap.mounts += 1;
      }, []);
      return React.createElement(Text, null, 'Map coming soon');
    },
  };
});

configure({ asyncUtilTimeout: 5000 });
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockParams = {};
  mockMap.mounts = 0;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
  mockPush.mockClear();
  mockSetParams.mockClear();
});

const renderSearch = () =>
  render(
    <QueryClientProvider client={client}>
      <SearchTab />
    </QueryClientProvider>,
  );

const bar = () => screen.getByLabelText(SEARCH_PLACEHOLDER);
const type = async (q: string) => fireEvent.changeText(bar(), q);

describe('the map area and the panel', () => {
  it('opens on the map; focusing the bar slides the panel over it and Cancel slides it away', async () => {
    await renderSearch();
    expect(screen.getByText('Map coming soon')).toBeTruthy();
    expect(screen.queryByTestId('search-panel')).toBeNull();
    expect(screen.getByTestId('search-map').props.pointerEvents).toBe('auto');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    await fireEvent(bar(), 'focus');
    expect(screen.getByTestId('search-panel')).toBeTruthy();
    // The map takes no gestures and is hidden from screen readers while the panel is up.
    expect(screen.queryByTestId('search-map')).toBeNull();
    expect(screen.getByTestId('search-map', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
    expect(await screen.findByText('Suggested for you')).toBeTruthy();

    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('search-panel')).toBeNull();
    expect(bar().props.value).toBe('');
    expect(screen.getByTestId('search-map').props.pointerEvents).toBe('auto');
    // Never re-mounted: one map for the whole visit.
    expect(mockMap.mounts).toBe(1);
  });

  it('clearing the bar keeps the panel up on Recents and suggestions', async () => {
    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(screen.getByTestId('search-panel')).toBeTruthy();
    expect(await screen.findByText('Suggested for you')).toBeTruthy();
  });

  it.each([{ tab: 'people' }, { focus: '1' }])('%p opens the panel once and clears the params', async (params) => {
    mockParams = params;
    await renderSearch();
    expect(screen.getByTestId('search-panel')).toBeTruthy();
    expect(mockSetParams).toHaveBeenCalledWith({ tab: undefined, focus: undefined });
    expect(await screen.findByText('Suggested for you')).toBeTruthy();
  });
});

describe('grouped results', () => {
  it('debounces typing into one Bev search and one people search, grouped under Bevs and People', async () => {
    const bevSearch = jest.spyOn(api.bevs, 'search');
    const userSearch = jest.spyOn(api.profile, 'searchUsers');
    const friend = (await api.follows.suggested())[0]!;
    await renderSearch();
    // A prefix of a real person's name, so both groups have rows.
    const q = friend.displayName.slice(0, 2);
    for (let i = 1; i <= q.length; i++) await type(q.slice(0, i));
    expect(bevSearch).not.toHaveBeenCalled();
    expect(userSearch).not.toHaveBeenCalled();

    expect(await screen.findByText('People')).toBeTruthy();
    expect(userSearch).toHaveBeenCalledTimes(1);
    expect(userSearch.mock.calls[0]![0]).toMatchObject({ q });
    if ((await bevSearch.mock.results[0]?.value)?.items.length) expect(screen.getByText('Bevs')).toBeTruthy();
  });

  it('leaves out an empty group', async () => {
    jest.spyOn(api.profile, 'searchUsers').mockResolvedValue({ items: [], nextCursor: null });
    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    expect(screen.getByText('Bevs')).toBeTruthy();
    expect(screen.queryByText('People')).toBeNull();
  });

  it('an @handle searches people only, and never lists yourself', async () => {
    const me = await api.profile.getMe();
    const target = (await api.follows.suggested())[0]!;
    const bevSearch = jest.spyOn(api.bevs, 'search');
    await renderSearch();
    await type(`@${target.handle}`);
    const row = await screen.findByLabelText(new RegExp(`^${target.displayName}, @${target.handle}`));
    expect(bevSearch).not.toHaveBeenCalled();
    expect(screen.queryByText('Bevs')).toBeNull();
    expect(screen.queryByText(new RegExp(`${me.displayName} \\(you\\)`))).toBeNull();
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/user/[id]', params: { id: target.id } });
  });

  it('leaves yourself out even when your own handle is the only match', async () => {
    const me = await api.profile.getMe();
    jest.spyOn(api.profile, 'searchUsers').mockResolvedValue({ items: [await api.profile.getUser(me.id)], nextCursor: null });
    await renderSearch();
    await type(`@${me.handle}`);
    expect(await screen.findByText(`No Bevs or people match "@${me.handle}"`)).toBeTruthy();
  });

  it('nothing matches: one empty state and a primary "Add a new Bev"', async () => {
    await renderSearch();
    await type('zzqqxx');
    expect(await screen.findByText('No Bevs or people match "zzqqxx"')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(ADD_NEW));
    expect(mockPush).toHaveBeenCalledWith('/add/new');
  });

  it('Snap it opens the create-Bev wizard', async () => {
    await renderSearch();
    await fireEvent.press(screen.getByLabelText('Snap it: add a Bev from a photo'));
    expect(mockPush).toHaveBeenCalledWith('/add/new');
  });

  it.each([
    ['Bev', 'bevs.search'],
    ['people', 'profile.searchUsers'],
  ] as const)('a failed %s search shows ErrorState, and Retry recovers', async (_what, method) => {
    controls.failNext('network', method);
    await renderSearch();
    await type('coke');
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
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    await waitFor(() => expect(screen.queryByText('Test Lager')).toBeNull());
  });
});

describe('Bev rows', () => {
  it('plus ranks a result; tapping ranks it, or opens its detail when already ranked', async () => {
    const items = (await api.bevs.search({ q: 'coke', limit: 25 })).items;
    const details = await Promise.all(items.map((b) => api.bevs.get(b.id)));
    const unranked = details.find((d) => !d.myRanking)!;
    const loved = await api.rankings.listBucket('LOVED');
    const ranked = details.find((d) => d.id !== unranked.id && !d.myRanking)!;
    await api.rankings.submitRanking({ bevId: ranked.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });

    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    await waitFor(() => expect(client.getQueryData(['bevi', 'bevs', 'detail', ranked.id])).toBeTruthy());
    await waitFor(() => expect(client.getQueryData(['bevi', 'bevs', 'detail', unranked.id])).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(`Rank ${unranked.name}`));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/rank/[bevId]', params: { bevId: unranked.id } });
    await fireEvent.press(screen.getByRole('button', { name: unranked.name }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/rank/[bevId]', params: { bevId: unranked.id } });
    await fireEvent.press(screen.getByRole('button', { name: ranked.name }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/bev/[id]', params: { id: ranked.id } });
  });

  it('the bookmark saves a result to Want to Try and back', async () => {
    const add = jest.spyOn(api.wantToTry, 'add');
    const remove = jest.spyOn(api.wantToTry, 'remove');
    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    const [save] = await screen.findAllByLabelText('Save to Want to Try');
    await fireEvent.press(save!);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const [savedBtn] = await screen.findAllByLabelText('Saved to Want to Try');
    await fireEvent.press(savedBtn!);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0]));
  });

  it('remembers opened Bevs as Recents (in localStorage) and forgets them', async () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    await renderSearch();
    await type('coke');
    const [rank] = await screen.findAllByLabelText(/^Rank /);
    const name = rank!.props.accessibilityLabel.replace(/^Rank /, '');
    await fireEvent.press(screen.getByRole('button', { name }));
    expect(readRecents('user-tester')[0]?.name).toBe(name);
    // Another account on this browser has its own (empty) list; the key predates the Search tab.
    expect(readRecents('user-friend_a')).toEqual([]);
    expect([...store.keys()]).toEqual(['bevi.add.recents:user-tester']);

    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(await screen.findByText('Recents')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(`Forget ${name}`));
    expect(screen.queryByText('Recents')).toBeNull();
    expect(readRecents('user-tester')).toEqual([]);
    g.localStorage = saved;
  });
});

describe('people rows', () => {
  it('suggestions carry follow pills that toggle optimistically', async () => {
    const first = (await api.follows.suggested())[0]!;
    expect(first.isFollowing).toBe(false);
    mockParams = { tab: 'people' };
    await renderSearch();
    const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
    expect(pill.props['aria-pressed']).toBe(false);

    controls.setLatency(1000);
    await fireEvent.press(pill);
    // Flips while the server is still answering.
    await waitFor(() => expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(true));
    expect(client.isMutating()).toBe(1);
    await waitFor(async () => expect((await api.profile.getUser(first.id)).isFollowing).toBe(true));
    expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(true);
  });

  it('rolls a failed follow back', async () => {
    const first = (await api.follows.suggested())[0]!;
    mockParams = { tab: 'people' };
    await renderSearch();
    const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
    controls.failNext('network', 'follows.follow');
    await fireEvent.press(pill);
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(false);
  });
});
