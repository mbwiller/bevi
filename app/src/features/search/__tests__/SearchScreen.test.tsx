import { MIN_RATERS } from '@bevi/ranking';
import type { LeaderboardRow } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import AddBevTab from '@/app/(tabs)/add/index';
import { readRecents } from '@/features/add-bev/recents';
import { controls } from '@/testing/fakeApi';

import { POPULAR_COUNT } from '../popular';
import { ADD_NEW, POPULAR_TITLE } from '../SearchPanel';
import { CANCEL_SETTLE_MS, SEARCH_PLACEHOLDER, SEARCH_TITLE } from '../SearchScreen';

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { focus?: string } = {};
// The tab navigator as the route sees it: tests fire its tabPress listeners to press the Add Bev tab.
const mockTab = { listeners: new Set<() => void>(), focused: true };
const mockNavigation = {
  addListener: (_type: string, listener: () => void) => {
    mockTab.listeners.add(listener);
    return () => void mockTab.listeners.delete(listener);
  },
  isFocused: () => mockTab.focused,
  setParams: (p: unknown) => mockSetParams(p),
};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams, canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useNavigation: () => mockNavigation,
  useIsFocused: () => mockTab.focused,
}));

configure({ asyncUtilTimeout: 5000 });
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockParams = {};
  mockTab.focused = true;
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
      <AddBevTab />
    </QueryClientProvider>,
  );

const bar = () => screen.getByLabelText(SEARCH_PLACEHOLDER);
const type = async (q: string) => fireEvent.changeText(bar(), q);
/** Section headings in the results list (level 2; the screen title is level 1). */
const headings = () =>
  screen
    .getAllByRole('heading')
    .filter((h) => h.props['aria-level'] === 2)
    .map((h) => h.props.children as string);
/** The Bev names the list offers to rank, in order. */
const rankable = () => screen.queryAllByLabelText(/^Rank /).map((b) => (b.props.accessibilityLabel as string).replace(/^Rank /, ''));

/** A localStorage for the test, optionally holding Recents for the test user; returns a restore function. */
function withStorage(recents: { id: string; name: string; brand: string | null }[] = []) {
  const store = new Map<string, string>(recents.length ? [[`bevi.add.recents:user-tester`, JSON.stringify(recents)]] : []);
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  return {
    store,
    restore: () => {
      g.localStorage = saved;
    },
  };
}

/** Puts `row` at the top of the all-categories board the screen reads. */
function withTopRow(row: LeaderboardRow) {
  const real = api.leaderboard.bevs.bind(api.leaderboard);
  jest.spyOn(api.leaderboard, 'bevs').mockImplementation(async (p) => {
    const page = await real(p);
    return { ...page, items: [row, ...page.items] };
  });
}

const LAGER: LeaderboardRow = {
  rank: 1,
  bev: {
    id: 'x-beer',
    name: 'Test Lager',
    brand: null,
    flavor: null,
    categoryId: 'beer',
    photoUrl: null,
    photoStatus: 'ready',
    priceTier: 1,
    priceEstimated: false,
    ratingCount: 40,
    bayesScore: 9.1,
  },
  bayesScore: 9.1,
  ratingCount: 40,
  myScore: null,
};

describe('the screen', () => {
  it('is headed "Add a Bev" with no close action, the outlined bar and Snap it, and no map', async () => {
    await renderSearch();
    expect(screen.getByRole('heading', { name: SEARCH_TITLE })).toBeTruthy();
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByTestId('search-map')).toBeNull();
    expect(bar()).toBeTruthy();
    expect(screen.getByLabelText('Snap it: add a Bev from a photo')).toBeTruthy();
    expect(await screen.findByText(POPULAR_TITLE)).toBeTruthy();
  });

  it('?focus=1 focuses the bar once and clears the param', async () => {
    mockParams = { focus: '1' };
    await renderSearch();
    expect(bar().props.autoFocus).toBe(true);
    expect(mockSetParams).toHaveBeenCalledWith({ focus: undefined });
  });

  it('opens without focusing the bar', async () => {
    await renderSearch();
    expect(bar().props.autoFocus).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('pressing the Add Bev tab while it shows clears and blurs the bar; a press from another tab does not', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    mockTab.focused = false;
    await act(async () => mockTab.listeners.forEach((l) => l()));
    expect(bar().props.value).toBe('coke');
    expect(dismiss).not.toHaveBeenCalled();
    mockTab.focused = true;
    await act(async () => mockTab.listeners.forEach((l) => l()));
    expect(bar().props.value).toBe('');
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(POPULAR_TITLE)).toBeTruthy();
  });

  it('Cancel shows only while the bar is in use; it clears the query and puts the keyboard away', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const cancel = () => screen.queryByRole('button', { name: 'Cancel' });
    await renderSearch();
    await screen.findByText(POPULAR_TITLE);
    expect(cancel()).toBeNull();

    await fireEvent(bar(), 'focus');
    expect(cancel()).toBeTruthy();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    expect(cancel()).toBeTruthy();

    await fireEvent.press(cancel()!);
    expect(bar().props.value).toBe('');
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(cancel()).toBeNull();
    expect(await screen.findByText(POPULAR_TITLE)).toBeTruthy();
  });

  describe('Cancel and blur', () => {
    const cancel = () => screen.queryByRole('button', { name: 'Cancel' });

    it('hides when the empty bar loses focus', async () => {
      await renderSearch();
      await screen.findByText(POPULAR_TITLE);
      await fireEvent(bar(), 'focus');
      expect(cancel()).toBeTruthy();
      await fireEvent(bar(), 'blur');
      expect(cancel()).toBeNull();
    });

    it('stays while the bar holds text, focused or not', async () => {
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await type('co');
      await fireEvent(bar(), 'blur');
      expect(cancel()).toBeTruthy();
    });

    /** A web blur's event, whose `relatedTarget` (the element taking focus) sits inside the element with `id`. */
    const focusTo = (id: string | null) => ({
      nativeEvent: { relatedTarget: id ? { closest: (selector: string) => (selector === `#${id}` ? {} : null) } : null },
    });
    const wrapper = () => screen.getByTestId('search-cancel');
    const afterSettle = () => act(() => new Promise((r) => setTimeout(r, CANCEL_SETTLE_MS + 20)));

    it('is still pressable: the blur its own press causes does not hide it first, and it lands once', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await renderSearch();
      await screen.findByText(POPULAR_TITLE);
      await fireEvent(bar(), 'focus');
      // A real press: pointer down on Cancel, the bar blurs, pointer up, then the press lands.
      await fireEvent(wrapper(), 'pointerDown');
      await fireEvent(bar(), 'blur', focusTo(null));
      expect(cancel()).toBeTruthy();
      await fireEvent(wrapper(), 'pointerUp');
      expect(cancel()).toBeTruthy();
      await fireEvent.press(cancel()!);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(cancel()).toBeNull();
      expect(bar().props.value).toBe('');
      // The settle timer the pointer up started does nothing more.
      await afterSettle();
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(cancel()).toBeNull();
    });

    it('a touch press (pointer up, then leave, then the press) still lands once', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await fireEvent(wrapper(), 'pointerDown');
      await fireEvent(bar(), 'blur', focusTo(null));
      await fireEvent(wrapper(), 'pointerUp');
      await fireEvent(wrapper(), 'pointerLeave');
      expect(cancel()).toBeTruthy();
      await fireEvent.press(cancel()!);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(cancel()).toBeNull();
    });

    it('a press dragged off and released elsewhere: once it settles, the empty, blurred bar has no Cancel', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await fireEvent(wrapper(), 'pointerDown');
      await fireEvent(bar(), 'blur', focusTo(null));
      await fireEvent(wrapper(), 'pointerLeave');
      expect(cancel()).toBeTruthy();
      await afterSettle();
      expect(cancel()).toBeNull();
      // Nothing was pressed.
      expect(dismiss).not.toHaveBeenCalled();
    });

    it('a cancelled pointer (a scroll took it) hides Cancel at once', async () => {
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await fireEvent(wrapper(), 'pointerDown');
      await fireEvent(bar(), 'blur', focusTo(null));
      await fireEvent(wrapper(), 'pointerCancel');
      expect(cancel()).toBeNull();
    });

    it('an abandoned press with text in the bar keeps Cancel', async () => {
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await type('co');
      await fireEvent(wrapper(), 'pointerDown');
      await fireEvent(bar(), 'blur', focusTo(null));
      await fireEvent(wrapper(), 'pointerCancel');
      expect(cancel()).toBeTruthy();
    });

    it('keyboard: Tab from the empty bar lands on Cancel, which stays until focus moves on', async () => {
      await renderSearch();
      await fireEvent(bar(), 'focus');
      // Tab: the bar blurs toward Cancel, and Cancel takes focus.
      await fireEvent(bar(), 'blur', focusTo('search-cancel'));
      expect(cancel()).toBeTruthy();
      await fireEvent(wrapper(), 'focus');
      expect(cancel()).toBeTruthy();
      // Shift+Tab back to the bar: still up.
      await fireEvent(wrapper(), 'blur', focusTo('search-q'));
      await fireEvent(bar(), 'focus');
      expect(cancel()).toBeTruthy();
      // Tab to Cancel, then on past it: gone.
      await fireEvent(bar(), 'blur', focusTo('search-cancel'));
      await fireEvent(wrapper(), 'focus');
      await fireEvent(wrapper(), 'blur', focusTo(null));
      expect(cancel()).toBeNull();
    });

    it('keyboard: Enter on the focused Cancel resets the bar once', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await renderSearch();
      await fireEvent(bar(), 'focus');
      await fireEvent(bar(), 'blur', focusTo('search-cancel'));
      await fireEvent(wrapper(), 'focus');
      await fireEvent.press(cancel()!);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(cancel()).toBeNull();
    });
  });

  it('typing without a focus event still shows Cancel; the Add Bev tab press hides it again', async () => {
    await renderSearch();
    await type('co');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await act(async () => mockTab.listeners.forEach((l) => l()));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('Snap it opens the create-Bev wizard', async () => {
    await renderSearch();
    await fireEvent.press(screen.getByLabelText('Snap it: add a Bev from a photo'));
    expect(mockPush).toHaveBeenCalledWith('/add/new');
  });
});

describe('idle', () => {
  it('Recents, then "Popular on Bevi"; no "Suggested for you"', async () => {
    const { restore } = withStorage([{ id: 'b-1', name: 'Topo Chico', brand: 'Topo Chico' }]);
    try {
      // Recents are keyed by your id: with it known up front they're in the list before Popular
      // arrives (FlashList's cells otherwise sit in arrival order in the test tree, not on screen).
      client.setQueryData(keys.me(), await api.profile.getMe());
      await renderSearch();
      await screen.findByText(POPULAR_TITLE);
      expect(headings()).toEqual(['Recents', POPULAR_TITLE]);
      expect(screen.queryByText('Suggested for you')).toBeNull();
      expect(screen.queryAllByLabelText(/^Follow /)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('clearing the bar goes back to "Popular on Bevi"', async () => {
    await renderSearch();
    await type('coke');
    await screen.findAllByLabelText(/^Rank /);
    expect(screen.queryByText(POPULAR_TITLE)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(await screen.findByText(POPULAR_TITLE)).toBeTruthy();
    expect(screen.queryByText('Bevs')).toBeNull();
  });
});

describe('Popular on Bevi', () => {
  it('lists the top Bevs you have not ranked, at most ten, with the board score and rating count', async () => {
    const board = (await api.leaderboard.bevs()).items;
    // Rank the board's top unranked Bev: it must drop out of the list.
    const top = board.find((r) => r.myScore == null)!;
    const loved = await api.rankings.listBucket('LOVED');
    await api.rankings.submitRanking({ bevId: top.bev.id, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: loved.length, comparisons: [] });
    const after = (await api.leaderboard.bevs()).items;
    const expected = after.filter((r) => r.myScore == null && r.ratingCount >= MIN_RATERS).slice(0, POPULAR_COUNT);
    expect(expected.length).toBeGreaterThan(0);
    expect(after.some((r) => r.myScore != null)).toBe(true);

    await renderSearch();
    await waitFor(() => expect(rankable()).toEqual(expected.map((r) => r.bev.name)));
    expect(rankable()).not.toContain(top.bev.name);
    for (const ranked of after.filter((r) => r.myScore != null)) expect(rankable()).not.toContain(ranked.bev.name);
    const first = expected[0]!;
    expect(screen.getAllByText(`${first.ratingCount} ratings`).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^Saved? to Want to Try$/)).toHaveLength(expected.length);
  });

  it('stops at ten', async () => {
    const rows = Array.from({ length: POPULAR_COUNT + 5 }, (_, i): LeaderboardRow => ({
      ...LAGER,
      rank: i + 1,
      bev: { ...LAGER.bev, id: `pop-${i}`, name: `Popular ${i}`, categoryId: 'soda' },
    }));
    jest.spyOn(api.leaderboard, 'bevs').mockResolvedValue({ items: rows, nextCursor: null });
    await renderSearch();
    await waitFor(() => expect(rankable()).toHaveLength(POPULAR_COUNT));
    expect(rankable()).toEqual(rows.slice(0, POPULAR_COUNT).map((r) => r.bev.name));
  });

  it('never lists an alcoholic Bev to an under-21 viewer', async () => {
    controls.signInAs('minor_user');
    withTopRow(LAGER);
    await renderSearch();
    await waitFor(() => expect(rankable().length).toBeGreaterThan(0));
    expect(screen.queryByText('Test Lager')).toBeNull();
  });

  it('lists it to an adult', async () => {
    withTopRow(LAGER);
    await renderSearch();
    await waitFor(() => expect(rankable()[0]).toBe('Test Lager'));
  });

  it('See all opens Lists on the Top tab', async () => {
    await renderSearch();
    await fireEvent.press(await screen.findByLabelText(`See all ${POPULAR_TITLE.toLowerCase()}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/lists', params: { tab: 'top' } });
  });

  it('Rank it ranks the Bev and remembers it in Recents', async () => {
    const { restore } = withStorage();
    try {
      await renderSearch();
      await waitFor(() => expect(rankable().length).toBeGreaterThan(0));
      const name = rankable()[0]!;
      const id = (await api.leaderboard.bevs()).items.find((r) => r.bev.name === name)!.bev.id;
      await fireEvent.press(screen.getByLabelText(`Rank ${name}`));
      expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/rank/[bevId]', params: { bevId: id } });
      expect(readRecents('user-tester')[0]?.name).toBe(name);
    } finally {
      restore();
    }
  });

  it('holds its place with Skeleton rows while it loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = api.leaderboard.bevs.bind(api.leaderboard);
    jest.spyOn(api.leaderboard, 'bevs').mockImplementation(async (p) => {
      await gate;
      return real(p);
    });
    await renderSearch();
    expect(screen.getByText(POPULAR_TITLE)).toBeTruthy();
    expect(screen.getByLabelText('Loading popular Bevs')).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByLabelText('Loading popular Bevs')).toBeNull());
    expect(rankable().length).toBeGreaterThan(0);
  });

  it('offline: ErrorState under its header, and Retry loads it', async () => {
    controls.failNext('network', 'leaderboard.bevs');
    await renderSearch();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText(POPULAR_TITLE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(rankable().length).toBeGreaterThan(0));
    expect(screen.queryByText("You're offline")).toBeNull();
  });

  it('is left out once you have ranked everything on it; with no Recents either, the empty state shows', async () => {
    jest
      .spyOn(api.leaderboard, 'bevs')
      .mockResolvedValue({ items: [{ ...LAGER, bev: { ...LAGER.bev, categoryId: 'soda' }, myScore: 8 }], nextCursor: null });
    await renderSearch();
    expect(await screen.findByText('Find a Bev or a friend')).toBeTruthy();
    expect(screen.queryByText(POPULAR_TITLE)).toBeNull();
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
    await waitFor(() => expect(bevSearch).toHaveBeenCalledTimes(1));
    expect(bevSearch.mock.calls[0]![0]).toMatchObject({ q, limit: 25 });
    expect(userSearch).toHaveBeenCalledTimes(1);
    expect(userSearch.mock.calls[0]![0]).toMatchObject({ q });
    if ((await bevSearch.mock.results[0]!.value).items.length) expect(screen.getByText('Bevs')).toBeTruthy();
    expect(screen.queryByText(POPULAR_TITLE)).toBeNull();
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

  it('a failed Bev search errors in its own group, keeps the People results, and Retry recovers', async () => {
    const friend = (await api.follows.suggested())[0]!;
    controls.failNext('network', 'bevs.search');
    await renderSearch();
    await type(friend.displayName);
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(await screen.findByLabelText(new RegExp(`^${friend.displayName}, @`))).toBeTruthy();
    expect(headings()).toEqual(['Bevs', 'People']);
    jest.spyOn(api.bevs, 'search').mockResolvedValueOnce({ items: [(await api.bevs.search({ q: 'coke', limit: 1 })).items[0]!], nextCursor: null });
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect((await screen.findAllByLabelText(/^Rank /)).length).toBe(1);
    expect(screen.queryByText("You're offline")).toBeNull();
  });

  it('a failed people search errors in its own group, keeps the Bev results, and Retry recovers', async () => {
    controls.failNext('network', 'profile.searchUsers');
    await renderSearch();
    await type('coke');
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect((await screen.findAllByLabelText(/^Rank /)).length).toBeGreaterThan(0);
    expect(headings()).toEqual(['Bevs', 'People']);
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.queryByText("You're offline")).toBeNull());
  });

  it('the Bevs group holds its place above People while it loads', async () => {
    const friend = (await api.follows.suggested())[0]!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = api.bevs.search.bind(api.bevs);
    jest.spyOn(api.bevs, 'search').mockImplementation(async (p) => {
      await gate;
      return real(p);
    });
    await renderSearch();
    await type(friend.displayName);
    expect(await screen.findByLabelText(new RegExp(`^${friend.displayName}, @`))).toBeTruthy();
    expect(screen.getByLabelText('Loading Bevs')).toBeTruthy();
    expect(headings()).toEqual(['Bevs', 'People']);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByLabelText('Loading Bevs')).toBeNull());
  });

  it('hides alcoholic results from an under-21 viewer', async () => {
    controls.signInAs('minor_user');
    const real = api.bevs.search.bind(api.bevs);
    jest.spyOn(api.bevs, 'search').mockImplementation(async (p) => {
      const page = await real(p);
      return { ...page, items: [LAGER.bev, ...page.items] };
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
    const { store, restore } = withStorage();
    try {
      await renderSearch();
      await type('coke');
      const [rank] = await screen.findAllByLabelText(/^Rank /);
      const name = rank!.props.accessibilityLabel.replace(/^Rank /, '');
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(readRecents('user-tester')[0]?.name).toBe(name);
      // Another account on this browser has its own (empty) list; the key predates the Add Bev tab.
      expect(readRecents('user-friend_a')).toEqual([]);
      expect([...store.keys()]).toEqual(['bevi.add.recents:user-tester']);

      await fireEvent.press(screen.getByLabelText('Clear search'));
      expect(await screen.findByText('Recents')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText(`Forget ${name}`));
      expect(screen.queryByText('Recents')).toBeNull();
      expect(readRecents('user-tester')).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('people rows', () => {
  it('results carry follow pills that toggle optimistically', async () => {
    const first = (await api.follows.suggested())[0]!;
    expect(first.isFollowing).toBe(false);
    await renderSearch();
    await type(`@${first.handle}`);
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
    await renderSearch();
    await type(`@${first.handle}`);
    const pill = await screen.findByLabelText(`Follow ${first.displayName}`);
    controls.failNext('network', 'follows.follow');
    await fireEvent.press(pill);
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByLabelText(`Follow ${first.displayName}`).props['aria-pressed']).toBe(false);
  });
});
