import type { UserLeaderboardRow } from '@bevi/shared';
import { RANK_POINTS_WEIGHTS, STREAK_PERIOD } from '@bevi/ranking';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import PeopleRoute from '@/app/people';
import { pointsRules } from '@/features/leaderboard/copy';
import { pointsMeta } from '@/features/leaderboard/PeopleBoard';
import { controls } from '@/testing/fakeApi';

import { PEOPLE_PLACEHOLDER, SUGGESTED_PREVIEW, SUGGESTED_TITLE } from '../FindPeopleScreen';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url = '/people') {
  const result = renderRouter(
    {
      _layout: Layout,
      people: PeopleRoute,
      index: Stub,
      'user/[id]/index': Stub,
      'profile/index': Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

// Pin "now" (Date only; timers stay real) so the seeded streaks are the same on any day and in any
// timezone the tests run (as the Leaderboard suite does).
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
beforeAll(() => {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(async () => {
  controls.setLatency(0);
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

/** UserRow's accessible name. */
function rowLabel(p: { displayName: string; handle: string }, meta?: string, streak?: number, self = false) {
  return `${p.displayName}${self ? ' (you)' : ''}, @${p.handle}${meta ? `, ${meta}` : ''}${streak ? `, ${streak} day streak` : ''}`;
}

function boardLabel(r: UserLeaderboardRow, self = false) {
  return rowLabel(r.profile, pointsMeta(r.points, r.bevsRanked), r.currentStreak, self);
}

/**
 * The props the screen gave its one FlashList. `onEndReached` and `onViewableItemsChanged` never
 * reach the host ScrollView, so walk up from it to the FlashList element.
 */
function list(): { props: Record<string, any> } {
  type Fiber = { elementType: unknown; memoizedProps: Record<string, any>; return: Fiber | null };
  let f = screen.getByTestId('people-list').unstable_fiber as Fiber | null;
  while (f && f.elementType !== FlashList) f = f.return;
  if (!f) throw new Error('No FlashList above people-list');
  return { props: f.memoizedProps };
}

/** What the list reports on screen: the given ranking rows only (none of yours, unless passed). */
async function reportOnScreen(rows: UserLeaderboardRow[]) {
  await act(async () => {
    list().props.onViewableItemsChanged({
      viewableItems: rows.map((row, index) => ({
        item: { kind: 'rank-row', key: `rank:${row.profile.id}`, row },
        key: `rank:${row.profile.id}`,
        index,
        isViewable: true,
        timestamp: 0,
      })),
      changed: [],
    });
  });
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByPlaceholderText(PEOPLE_PLACEHOLDER), text);
}

describe('idle', () => {
  it('has a back header, the filled search bar, suggestions, then the ranking', async () => {
    const me = await api.profile.getMe();
    const board = (await api.leaderboard.users()).items;
    // More suggestions than the preview shows (the fixtures leave the tester two).
    const suggested = board.filter((r) => r.profile.id !== me.id).map((r) => ({ ...r.profile, isFollowing: false }));
    expect(suggested.length).toBeGreaterThan(SUGGESTED_PREVIEW);
    jest.spyOn(api.follows, 'suggested').mockResolvedValue(suggested);
    await start();

    expect(screen.getByText('People')).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.getByLabelText(PEOPLE_PLACEHOLDER)).toBeTruthy();
    expect(await screen.findByText(SUGGESTED_TITLE)).toBeTruthy();
    expect(await screen.findByText('Ranked by points')).toBeTruthy();
    // Suggestions come first, the ranking after them.
    const headings = screen.getAllByRole('heading').map((h) => h.props.children);
    expect(headings.indexOf(SUGGESTED_TITLE)).toBeLessThan(headings.indexOf('Ranked by points'));

    // The first few suggestions, each with Follow, then "See all" shows the rest.
    for (const row of suggested.slice(0, SUGGESTED_PREVIEW)) {
      expect(await screen.findByLabelText(rowLabel(row))).toBeTruthy();
    }
    const hidden = suggested[SUGGESTED_PREVIEW]!;
    expect(screen.queryByLabelText(rowLabel(hidden))).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'See all suggestions' }));
    expect(await screen.findByLabelText(rowLabel(hidden))).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'See all suggestions' })).toBeNull();

    // The board, numbered by points.
    expect((await screen.findAllByLabelText(boardLabel(board[0]!, board[0]!.profile.id === me.id))).length).toBeGreaterThan(0);
  });

  it('never suggests you', async () => {
    const me = await api.profile.getMe();
    jest.spyOn(api.follows, 'suggested').mockResolvedValue([{ ...me, isFollowing: false }]);
    await start();
    await screen.findAllByText(/\(you\)/);
    // Nothing left to suggest: the section is left out.
    await waitFor(() => expect(screen.queryByText(SUGGESTED_TITLE)).toBeNull());
  });

  it('opens a suggested person', async () => {
    const me = await api.profile.getMe();
    const first = (await api.follows.suggested()).filter((r) => r.id !== me.id)[0]!;
    const r = await start();
    await fireEvent.press(await screen.findByLabelText(rowLabel(first)));
    expect(r.path()).toBe(`/user/${first.id}`);
  });

  it('goes back', async () => {
    const r = await start();
    await screen.findByText('Ranked by points');
    await fireEvent.press(screen.getByLabelText('Back'));
    // A deep link has no history: back falls back to the gate at /.
    expect(r.path()).toBe('/');
  });
});

describe('following', () => {
  it('follows a suggestion optimistically, and the same person on the board flips with it', async () => {
    const me = await api.profile.getMe();
    const board = (await api.leaderboard.users()).items;
    const onBoard = new Set(board.map((r) => r.profile.id));
    const target = (await api.follows.suggested()).find((r) => r.id !== me.id && onBoard.has(r.id))!;
    expect(target).toBeTruthy();
    await start();
    await screen.findByText('Ranked by points');
    const pills = () => screen.getAllByLabelText(`Follow ${target.displayName}`);
    await waitFor(() => expect(pills().length).toBe(2));
    expect(pills().map((p) => p.props['aria-pressed'])).toEqual([false, false]);

    controls.setLatency(400);
    await fireEvent.press(pills()[0]!);
    // Both flip before the server answers.
    await waitFor(() => expect(pills().map((p) => p.props['aria-pressed'])).toEqual([true, true]));
    expect(client.isMutating()).toBe(1);
    await waitFor(async () => expect((await api.profile.getUser(target.id)).isFollowing).toBe(true));
  });

  it('rolls a failed follow back', async () => {
    const me = await api.profile.getMe();
    const target = (await api.follows.suggested()).filter((r) => r.id !== me.id)[0]!;
    await start();
    const pills = () => screen.getAllByLabelText(`Follow ${target.displayName}`);
    await screen.findAllByLabelText(`Follow ${target.displayName}`);
    controls.setLatency(200);
    controls.failNext('network', 'follows.follow');
    await fireEvent.press(pills()[0]!);
    await waitFor(() => expect(pills()[0]!.props['aria-pressed']).toBe(true));
    await waitFor(() => expect(pills().every((p) => p.props['aria-pressed'] === false)).toBe(true));
  });
});

describe('search', () => {
  it('replaces the sections with results while typing, and comes back when cleared', async () => {
    const me = await api.profile.getMe();
    const board = (await api.leaderboard.users()).items;
    const other = board.find((r) => r.profile.id !== me.id)!.profile;
    const found = (await api.profile.searchUsers({ q: other.handle })).items;
    expect(found.length).toBeGreaterThan(0);
    await start();
    await screen.findByText('Ranked by points');

    await type(other.handle);
    // Debouncing: the results' skeleton holds the place, the sections are gone.
    expect(screen.getByLabelText('Loading people')).toBeTruthy();
    expect(screen.queryByText(SUGGESTED_TITLE)).toBeNull();
    expect(screen.queryByText('Ranked by points')).toBeNull();

    const result = found[0]!;
    expect(await screen.findByLabelText(rowLabel(result))).toBeTruthy();
    expect(screen.getByLabelText(`Follow ${result.displayName}`)).toBeTruthy();
    expect(screen.queryByText('Ranked by points')).toBeNull();
    expect(screen.queryByTestId('pinned-self')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Clear search'));
    expect(await screen.findByText('Ranked by points')).toBeTruthy();
    expect(screen.getByText(SUGGESTED_TITLE)).toBeTruthy();
  });

  it('never lists your own profile', async () => {
    const me = await api.profile.getMe();
    // Even if the server sent it back.
    jest.spyOn(api.profile, 'searchUsers').mockResolvedValue({ items: [{ ...me, isFollowing: false }], nextCursor: null });
    await start();
    await screen.findByText('Ranked by points');
    await type(me.handle);
    expect(await screen.findByText(`No one matches "${me.handle}"`)).toBeTruthy();
    expect(screen.queryByText(/\(you\)/)).toBeNull();
  });

  it('says when no one matches', async () => {
    await start();
    await screen.findByText('Ranked by points');
    await type('zzqx');
    expect(await screen.findByText('No one matches "zzqx"')).toBeTruthy();
  });

  it('shows the offline state with Retry when search fails', async () => {
    const me = await api.profile.getMe();
    const other = (await api.leaderboard.users()).items.find((r) => r.profile.id !== me.id)!.profile;
    await start();
    await screen.findByText('Ranked by points');
    controls.failNext('network', 'profile.searchUsers');
    await type(other.handle);
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByLabelText(new RegExp(`^${other.displayName}, @${other.handle}`))).toBeTruthy();
  });

  it('follows a result optimistically', async () => {
    const me = await api.profile.getMe();
    const following = new Set((await api.follows.listFollowing(me.id)).items.map((p) => p.id));
    const target = (await api.profile.searchUsers({ q: '' })).items.find((r) => !following.has(r.id) && r.id !== me.id)!;
    await start();
    await screen.findByText('Ranked by points');
    await type(target.handle);
    const pill = await screen.findByLabelText(`Follow ${target.displayName}`);
    expect(pill.props['aria-pressed']).toBe(false);
    controls.setLatency(400);
    await fireEvent.press(pill);
    await waitFor(() => expect(screen.getByLabelText(`Follow ${target.displayName}`).props['aria-pressed']).toBe(true));
    expect(client.isMutating()).toBe(1);
  });

  it('pages the results', async () => {
    const me = await api.profile.getMe();
    const other = (await api.leaderboard.users()).items.find((r) => r.profile.id !== me.id)!.profile;
    const second = { ...other, id: 'second-page', handle: 'second_page', displayName: 'Second Page' };
    const spy = jest
      .spyOn(api.profile, 'searchUsers')
      .mockImplementation(async ({ cursor }) =>
        cursor ? { items: [{ ...second, isFollowing: false }], nextCursor: null } : { items: [{ ...other, isFollowing: false }], nextCursor: 'p2' },
      );
    await start();
    await screen.findByText('Ranked by points');
    await type('pag');
    await screen.findByLabelText(new RegExp(`^${other.displayName}, @`));
    await act(async () => list().props.onEndReached());
    expect(await screen.findByLabelText(rowLabel(second))).toBeTruthy();
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'pag', cursor: 'p2' }));
  });
});

describe('ranking', () => {
  it('tints your own row and gives everyone else Follow', async () => {
    const me = await api.profile.getMe();
    const people = (await api.leaderboard.users()).items;
    const mine = people.find((r) => r.profile.id === me.id)!;
    expect(mine).toMatchObject({ currentStreak: 2 }); // seeded, on the pinned clock
    await start();
    const own = await screen.findAllByLabelText(boardLabel(mine, true));
    expect(own.length).toBeGreaterThan(0);
    const other = people.find((p) => p.profile.id !== me.id)!;
    expect(screen.getAllByLabelText(`Follow ${other.profile.displayName}`).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(`Follow ${me.displayName}`)).toBeNull();
  });

  it("doesn't flash the pinned own row before the list reports what's on screen", async () => {
    const me = await api.profile.getMe();
    await start();
    expect((await screen.findAllByText(/\(you\)/)).length).toBe(1);
    expect(screen.getAllByLabelText(new RegExp(`^${me.displayName} \\(you\\)`))).toHaveLength(1);
    expect(screen.queryByTestId('pinned-self')).toBeNull();
  });

  it('pins your own row while it is off screen, and not while searching', async () => {
    const me = await api.profile.getMe();
    const people = (await api.leaderboard.users()).items;
    const mine = people.find((r) => r.profile.id === me.id)!;
    const others = people.filter((r) => r.profile.id !== me.id);
    await start();
    await screen.findAllByText(/\(you\)/);

    await reportOnScreen(others.slice(0, 2));
    const pinned = await screen.findByTestId('pinned-self');
    expect(pinned).toBeTruthy();
    expect(screen.getAllByLabelText(boardLabel(mine, true))).toHaveLength(2);

    await reportOnScreen([mine]);
    await waitFor(() => expect(screen.queryByTestId('pinned-self')).toBeNull());

    await reportOnScreen(others.slice(0, 2));
    await screen.findByTestId('pinned-self');
    await type('zzqx');
    expect(screen.queryByTestId('pinned-self')).toBeNull();
  });

  it('pins your row from your stats when you are past the loaded pages', async () => {
    const me = await api.profile.getMe();
    const stats = await api.stats.getMine();
    const people = (await api.leaderboard.users()).items;
    const others = people.filter((r) => r.profile.id !== me.id);
    // You're on a later page than the one loaded. (The list may ask for it; it comes back empty.)
    jest
      .spyOn(api.leaderboard, 'users')
      .mockImplementation(async (page) => (page?.cursor ? { items: [], nextCursor: null } : { items: others.slice(0, 3), nextCursor: 'more' }));
    await start();
    await screen.findByLabelText(boardLabel(others[0]!));
    await reportOnScreen(others.slice(0, 3));
    await screen.findByTestId('pinned-self');
    expect(stats.rankOnBevi).not.toBeNull();
    expect(
      screen.getByLabelText(rowLabel(me, pointsMeta(stats.rankPoints, stats.bevdCount), stats.currentStreak, true)),
    ).toBeTruthy();
  });

  it('loads the next page at the end of the list', async () => {
    const people = (await api.leaderboard.users()).items;
    const [first, ...rest] = people;
    const spy = jest
      .spyOn(api.leaderboard, 'users')
      .mockImplementation(async (page) => (page?.cursor ? { items: rest, nextCursor: null } : { items: [first!], nextCursor: 'p2' }));
    const me = await api.profile.getMe();
    const label = (r: UserLeaderboardRow) => boardLabel(r, r.profile.id === me.id);
    await start();
    await screen.findByLabelText(label(first!));
    // Jest has no layout, so the list's end is always on screen and FlashList asks for the next
    // page on its own; a real scroll to the end does the same.
    const last = rest.filter((r) => r.profile.id !== me.id).at(-1)!;
    expect(await screen.findByLabelText(label(last))).toBeTruthy();
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'p2' }));
    // Nothing past the last page.
    const calls = spy.mock.calls.length;
    await act(async () => list().props.onEndReached());
    expect(spy).toHaveBeenCalledTimes(calls);
  });

  it('pull to refresh reloads the suggestions, the board and your stats', async () => {
    await start();
    await screen.findByText('Ranked by points');
    const board = jest.spyOn(api.leaderboard, 'users');
    const suggested = jest.spyOn(api.follows, 'suggested');
    const stats = jest.spyOn(api.stats, 'getMine');
    await act(async () => list().props.onRefresh());
    await waitFor(() => {
      expect(board).toHaveBeenCalled();
      expect(suggested).toHaveBeenCalled();
      expect(stats).toHaveBeenCalled();
    });
  });

  it('explains points in a sheet', async () => {
    await start();
    await screen.findAllByText(/\(you\)/);
    expect(screen.queryByTestId('sheet')).toBeNull();
    // The link's spoken name is just "How points work", not "How points work ranked by points".
    expect(screen.getByRole('link', { name: 'How points work' })).toBeTruthy();
    await fireEvent.press(screen.getByText('How points work'));
    expect(await screen.findByTestId('sheet')).toBeTruthy();
    for (const line of pointsRules()) expect(screen.getByText(line)).toBeTruthy();
  });

  it('opens your own profile from your row', async () => {
    const me = await api.profile.getMe();
    const mine = (await api.leaderboard.users()).items.find((r) => r.profile.id === me.id)!;
    const r = await start();
    await fireEvent.press((await screen.findAllByLabelText(boardLabel(mine, true)))[0]!);
    expect(r.path()).toBe('/profile');
  });

  it("opens someone else's profile from their row", async () => {
    const me = await api.profile.getMe();
    const other = (await api.leaderboard.users()).items.find((r) => r.profile.id !== me.id)!;
    const r = await start();
    await fireEvent.press((await screen.findAllByLabelText(boardLabel(other)))[0]!);
    expect(r.path()).toBe(`/user/${other.profile.id}`);
  });
});

describe('states', () => {
  it('shows skeletons while suggestions and the board load', async () => {
    controls.setLatency(400);
    await start();
    expect(screen.getByLabelText('Loading suggestions')).toBeTruthy();
    expect(screen.getAllByTestId('people-skeleton').length).toBeGreaterThan(1);
    expect(await screen.findByText('Ranked by points')).toBeTruthy();
    expect(await screen.findAllByText(/\(you\)/)).toBeTruthy();
    expect(screen.queryByLabelText('Loading suggestions')).toBeNull();
  });

  it('shows the suggestions error with Retry under its header, and the board still loads', async () => {
    controls.failNext('network', 'follows.suggested');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText(SUGGESTED_TITLE)).toBeTruthy();
    expect(await screen.findAllByText(/\(you\)/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.queryByText("You're offline")).toBeNull());
    expect(screen.getByText(SUGGESTED_TITLE)).toBeTruthy();
  });

  it('shows the board error with Retry', async () => {
    controls.failNext('network', 'leaderboard.users');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText('Ranked by points')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findAllByText(/\(you\)/)).toBeTruthy();
  });

  it('says when no one is on the board yet', async () => {
    jest.spyOn(api.leaderboard, 'users').mockResolvedValue({ items: [], nextCursor: null });
    await start();
    expect(await screen.findByText("No one's on the board yet")).toBeTruthy();
    expect(screen.getByText('Rank a Bev to get on the board.')).toBeTruthy();
  });
});

describe('pointsRules', () => {
  it('builds the rules from the default weights', () => {
    expect(RANK_POINTS_WEIGHTS).toEqual({ bevsRanked: 1, currentStreak: 3, bevsCreated: 2 });
    expect(pointsRules()).toEqual([
      '1 point for each Bev you rank',
      '3 points for each day of your current streak',
      '2 points for each Bev you added that someone else ranked',
      "Followers don't count",
      'Rank a Bev to get on the board',
    ]);
  });

  it('pluralises from custom weights', () => {
    const [a, b, c] = pointsRules({ bevsRanked: 2, currentStreak: 1, bevsCreated: 1 });
    expect(a).toBe('2 points for each Bev you rank');
    expect(b).toBe('1 point for each day of your current streak');
    expect(c).toBe('1 point for each Bev you added that someone else ranked');
  });

  it('names the streak period', () => {
    expect(STREAK_PERIOD).toBe('day');
    expect(pointsRules(RANK_POINTS_WEIGHTS, 'week')[1]).toBe('3 points for each week of your current streak');
  });
});
