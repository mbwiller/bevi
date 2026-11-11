import type { ProfileRow, SuggestedProfile, UserLeaderboardRow } from '@bevi/shared';
import { RANK_POINTS_WEIGHTS, STREAK_PERIOD } from '@bevi/ranking';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Slot } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import PeopleRoute from '@/app/(tabs)/people/index';
import { BOARD_EMPTY, pointsRules } from '@/features/leaderboard/copy';
import { pointsMeta } from '@/features/leaderboard/PeopleBoard';
import { usePointsScope } from '@/features/leaderboard/pointsScope';
import { FAKE_INVITE_CODE, ME, controls, userIdFor } from '@/testing/fakeApi';

import { followedByContext } from '../copy';
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
      'people/index': PeopleRoute,
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
  // The scope outlives the screen, so each test starts from the default.
  usePointsScope.setState({ scope: 'friends' });
});

/** Most of the suite predates the pills and is about the Everyone board. */
const onEveryone = () => usePointsScope.setState({ scope: 'everyone' });

afterEach(async () => {
  controls.setLatency(0);
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

/** UserRow's accessible name. */
function rowLabel(p: { displayName: string; handle: string }, meta?: string, streak?: number, self = false, context?: string) {
  return `${p.displayName}${self ? ' (you)' : ''}, @${p.handle}${meta ? `, ${meta}` : ''}${streak ? `, ${streak} day streak` : ''}${context ? `, ${context}` : ''}`;
}

/** A suggestion's accessible name, with its "Followed by …" line. */
function suggestedLabel(r: SuggestedProfile) {
  return rowLabel(r, undefined, undefined, false, followedByContext(r.followedBy, r.followedByCount));
}

/** A ProfileRow as a suggestion nobody you follow follows. */
const asSuggestion = (r: ProfileRow): SuggestedProfile => ({ ...r, followedBy: [], followedByCount: 0 });

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
    const suggested = board.filter((r) => r.profile.id !== me.id).map((r) => asSuggestion({ ...r.profile, isFollowing: false }));
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

    // The board (Friends, the default), numbered by points.
    const friends = (await api.leaderboard.friends()).items;
    expect((await screen.findAllByLabelText(boardLabel(friends[0]!, friends[0]!.profile.id === me.id))).length).toBeGreaterThan(0);
  });

  it('never suggests you', async () => {
    const me = await api.profile.getMe();
    jest.spyOn(api.follows, 'suggested').mockResolvedValue([asSuggestion({ ...me, isFollowing: false })]);
    await start();
    await screen.findAllByText(/\(you\)/);
    // Nothing left to suggest: the section is left out.
    await waitFor(() => expect(screen.queryByText(SUGGESTED_TITLE)).toBeNull());
  });

  it('opens a suggested person', async () => {
    const me = await api.profile.getMe();
    const first = (await api.follows.suggested()).filter((r) => r.id !== me.id)[0]!;
    const r = await start();
    await fireEvent.press(await screen.findByLabelText(suggestedLabel(first)));
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
  it('follows a suggestion optimistically, and the same person on the Everyone board flips with it', async () => {
    onEveryone();
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

describe('ranking (Everyone)', () => {
  beforeEach(onEveryone);

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

  it('shows the Everyone board error with Retry', async () => {
    onEveryone();
    controls.failNext('network', 'leaderboard.users');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText('Ranked by points')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findAllByText(/\(you\)/)).toBeTruthy();
  });

  it('says when no one is on the Everyone board yet', async () => {
    onEveryone();
    jest.spyOn(api.leaderboard, 'users').mockResolvedValue({ items: [], nextCursor: null });
    await start();
    expect(await screen.findByText(BOARD_EMPTY.everyone.title)).toBeTruthy();
    expect(screen.getByText(BOARD_EMPTY.everyone.body)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Friends | Everyone (TASKS.md M-34, contract 2.12.0 `leaderboard.friends`)
// ---------------------------------------------------------------------------------------------

const pill = (name: 'Friends' | 'Everyone') => screen.getByRole('button', { name });
const pressedPills = () => ({ friends: pill('Friends').props['aria-pressed'], everyone: pill('Everyone').props['aria-pressed'] });

/**
 * The ranking rows, top to bottom, as "rank handle". The order is the list's data (FlashList recycles
 * cells, so the tree's order after an insert isn't the screen's); every one of them must also be
 * drawn with that rank, and nothing else ranked (the pinned row is outside the list).
 */
function boardOnScreen(): string[] {
  const listed: string[] = list()
    .props.data.filter((i: { kind: string }) => i.kind === 'rank-row')
    .map((i: { row: UserLeaderboardRow }) => `${i.row.rank} ${i.row.profile.handle}`);
  const drawn = within(screen.getByTestId('people-list'))
    .queryAllByTestId('user-row')
    .flatMap((row) => {
      const rank = within(row).queryByLabelText(/^Rank \d+$/);
      if (!rank) return [];
      const who = String(within(row).getAllByRole('button')[0]!.props.accessibilityLabel);
      return [`${rank.props.children} ${/@(\w+)/.exec(who)![1]}`];
    });
  expect([...drawn].sort()).toEqual([...listed].sort());
  return listed;
}
const asShown = (rows: UserLeaderboardRow[]) => rows.map((r) => `${r.rank} ${r.profile.handle}`);
const friendsBoard = async () => (await api.leaderboard.friends()).items;
const everyoneBoard = async () => (await api.leaderboard.users()).items;
const kinds = (): string[] => list().props.data.map((i: { kind: string }) => i.kind);
const settled = () => waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));

/** Signs up someone who has ranked nothing, and signs back in as the tester. */
async function newcomer(handle: string): Promise<string> {
  const { userId } = await api.signUp({ username: handle, password: 'newcomer-pass-1', inviteCode: FAKE_INVITE_CODE });
  controls.signInAs(ME.handle);
  return userId;
}

async function unfollowEveryone() {
  const me = await api.profile.getMe();
  for (const p of (await api.follows.listFollowing(me.id)).items) await api.follows.unfollow(p.id);
}

describe('Friends | Everyone', () => {
  it('opens on Friends: two pills between "Ranked by points" and the rows, the chosen one pressed', async () => {
    const friends = await friendsBoard();
    await start();
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(friends)));
    const pills = within(screen.getByTestId('points-scope')).getAllByRole('button');
    expect(pills.map((p) => p.props.accessibilityLabel)).toEqual(['Friends', 'Everyone']);
    expect(pressedPills()).toEqual({ friends: true, everyone: false });
    const at = kinds().indexOf('rank-header');
    expect(kinds().slice(at, at + 3)).toEqual(['rank-header', 'rank-slot', 'rank-row']);

    // Pressing the chosen one changes nothing.
    const calls = jest.spyOn(api.leaderboard, 'friends');
    await fireEvent.press(pill('Friends'));
    expect(pressedPills()).toEqual({ friends: true, everyone: false });
    expect(calls).not.toHaveBeenCalled();
  });

  it('Friends ranks you and the people you follow among yourselves; Everyone ranks everyone', async () => {
    const me = await api.profile.getMe();
    const friends = await friendsBoard();
    const everyone = await everyoneBoard();
    // The fixtures: you follow four of the six others, so you are 5th of 5 there and 7th of 7 here.
    expect(friends.map((r) => r.profile.handle)).toEqual(['friend_a', 'friend_b', 'friend_c', 'friend_d', ME.handle]);
    expect(friends.find((r) => r.profile.id === me.id)!.rank).toBe(5);
    expect(everyone.find((r) => r.profile.id === me.id)!.rank).toBe(7);

    await start();
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(friends)));
    expect(screen.getAllByLabelText(boardLabel(friends.at(-1)!, true)).length).toBeGreaterThan(0);

    await fireEvent.press(pill('Everyone'));
    expect(pressedPills()).toEqual({ friends: false, everyone: true });
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(everyone)));

    // Back to Friends: its rows are still there, with no skeleton in between.
    await fireEvent.press(pill('Friends'));
    expect(pressedPills()).toEqual({ friends: true, everyone: false });
    expect(boardOnScreen()).toEqual(asShown(friends));
    expect(kinds()).not.toContain('rank-loading');
  });

  it('remembers the choice after leaving People and coming back', async () => {
    const everyone = await everyoneBoard();
    const r = await start();
    await screen.findByText('Ranked by points');
    await fireEvent.press(pill('Everyone'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(r.path()).toBe('/');
    expect(screen.queryByText('Ranked by points')).toBeNull();

    await act(async () => router.push('/people'));
    await screen.findByText('Ranked by points');
    expect(pressedPills()).toEqual({ friends: false, everyone: true });
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(everyone)));
  });

  it('pages the Friends board at the end of the list', async () => {
    const me = await api.profile.getMe();
    const [first, ...rest] = await friendsBoard();
    const spy = jest
      .spyOn(api.leaderboard, 'friends')
      .mockImplementation(async (page) => (page?.cursor ? { items: rest, nextCursor: null } : { items: [first!], nextCursor: 'f2' }));
    const users = jest.spyOn(api.leaderboard, 'users');
    await start();
    // Jest has no layout, so the end is always on screen and the list asks for the next page itself.
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown([first!, ...rest])));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'f2' }));
    const calls = spy.mock.calls.length;
    await act(async () => list().props.onEndReached());
    expect(spy).toHaveBeenCalledTimes(calls);
    // The other board isn't asked for.
    expect(users).not.toHaveBeenCalled();
    expect(rest.some((r) => r.profile.id === me.id)).toBe(true);
  });

  it('pull to refresh on Friends reloads that board and your stats, not Everyone', async () => {
    await start();
    await waitFor(() => expect(boardOnScreen().length).toBeGreaterThan(0));
    const friends = jest.spyOn(api.leaderboard, 'friends');
    const users = jest.spyOn(api.leaderboard, 'users');
    const stats = jest.spyOn(api.stats, 'getMine');
    await act(async () => list().props.onRefresh());
    await waitFor(() => {
      expect(friends).toHaveBeenCalled();
      expect(stats).toHaveBeenCalled();
    });
    expect(users).not.toHaveBeenCalled();
  });

  it('shows a skeleton under the pills while Friends loads', async () => {
    controls.setLatency(300);
    await start();
    await waitFor(() => expect(kinds()).toContain('rank-loading'));
    expect(screen.getByTestId('points-scope')).toBeTruthy();
    await waitFor(() => expect(boardOnScreen().length).toBeGreaterThan(0), { timeout: 3000 });
    expect(kinds()).not.toContain('rank-loading');
  });

  it('shows the Friends error with Retry, and Everyone still loads', async () => {
    const friends = await friendsBoard();
    controls.failNext('network', 'leaderboard.friends');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByTestId('points-scope')).toBeTruthy();

    await fireEvent.press(pill('Everyone'));
    await waitFor(() => expect(boardOnScreen().length).toBeGreaterThan(0));
    expect(screen.queryByText("You're offline")).toBeNull();

    await fireEvent.press(pill('Friends'));
    // A board that failed is retried when it comes back into view, or from Retry.
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(friends)));
  });

  it('Retry on the Friends error reloads it', async () => {
    const friends = await friendsBoard();
    controls.failNext('network', 'leaderboard.friends');
    await start();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(boardOnScreen()).toEqual(asShown(friends)));
  });

  describe('empty', () => {
    it('following nobody, with no rankings: "Follow people to see how you compare", under the suggestions', async () => {
      controls.emptyUser();
      expect(await friendsBoard()).toEqual([]);
      await start();
      expect(await screen.findByText(BOARD_EMPTY.noFollows.title)).toBeTruthy();
      expect(screen.getByText(BOARD_EMPTY.noFollows.body)).toBeTruthy();
      expect(screen.getByText(SUGGESTED_TITLE)).toBeTruthy();
      expect(boardOnScreen()).toEqual([]);
      expect(screen.queryByText(BOARD_EMPTY.friends.title)).toBeNull();
    });

    it('following nobody, with rankings: you alone at 1, and the same nudge under your row', async () => {
      await unfollowEveryone();
      const friends = await friendsBoard();
      expect(asShown(friends)).toEqual([`1 ${ME.handle}`]);
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual([`1 ${ME.handle}`]));
      expect(await screen.findByText(BOARD_EMPTY.noFollows.title)).toBeTruthy();
      expect(kinds().slice(-2)).toEqual(['rank-row', 'rank-empty']);
    });

    it('following people, none of whom (you included) has ranked: "No one here has ranked a Bev yet"', async () => {
      const id = await newcomer('newcomer_one');
      controls.emptyUser();
      await api.follows.follow(id);
      expect(await friendsBoard()).toEqual([]);
      await start();
      expect(await screen.findByText(BOARD_EMPTY.friends.title)).toBeTruthy();
      expect(screen.getByText(BOARD_EMPTY.friends.body)).toBeTruthy();
      expect(screen.queryByText(BOARD_EMPTY.noFollows.title)).toBeNull();
    });
  });

  describe('your pinned row', () => {
    it('on Friends pins your row from the Friends board, with your rank there', async () => {
      const me = await api.profile.getMe();
      const friends = await friendsBoard();
      const mine = friends.find((r) => r.profile.id === me.id)!;
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual(asShown(friends)));
      await reportOnScreen(friends.filter((r) => r.profile.id !== me.id).slice(0, 2));
      const pinned = await screen.findByTestId('pinned-self');
      expect(within(pinned).getByLabelText(boardLabel(mine, true))).toBeTruthy();
      expect(within(pinned).getByLabelText(`Rank ${mine.rank}`)).toBeTruthy();

      // On Everyone it is your rank there.
      const everyone = await everyoneBoard();
      const there = everyone.find((r) => r.profile.id === me.id)!;
      await fireEvent.press(pill('Everyone'));
      await waitFor(() => expect(boardOnScreen()).toEqual(asShown(everyone)));
      expect(screen.queryByTestId('pinned-self')).toBeNull(); // unknown again until the list reports
      await reportOnScreen(everyone.filter((r) => r.profile.id !== me.id).slice(0, 2));
      const again = await screen.findByTestId('pinned-self');
      expect(within(again).getByLabelText(`Rank ${there.rank}`)).toBeTruthy();
    });

    it('with no rankings: nothing pinned on Friends; "Unranked" from your stats on Everyone', async () => {
      const me = await api.profile.getMe();
      controls.emptyUser();
      await api.follows.follow(userIdFor('friend_a'));
      const friends = await friendsBoard();
      expect(asShown(friends)).toEqual(['1 friend_a']);
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual(['1 friend_a']));
      await reportOnScreen(friends);
      await settled();
      expect(screen.queryByTestId('pinned-self')).toBeNull();

      const everyone = await everyoneBoard();
      await fireEvent.press(pill('Everyone'));
      await waitFor(() => expect(boardOnScreen()).toEqual(asShown(everyone)));
      await reportOnScreen(everyone.slice(0, 2));
      const pinned = await screen.findByTestId('pinned-self');
      expect(within(pinned).getByLabelText(rowLabel(me, 'Unranked', undefined, true))).toBeTruthy();
    });
  });

  describe('following, and what it does to Friends', () => {
    it('a follow from a suggestion leaves the ranking still while it is pending, then adds them once the server has it', async () => {
      const suggestions = await api.follows.suggested();
      const target = suggestions.find((r) => r.handle === 'friend_e')!;
      const before = asShown(await friendsBoard());
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual(before));
      const follow = () => screen.getAllByLabelText(`Follow ${target.displayName}`);
      expect(follow()).toHaveLength(1); // not on the Friends board yet

      controls.setLatency(300);
      await fireEvent.press(follow()[0]!);
      await waitFor(() => expect(follow()[0]!.props['aria-pressed']).toBe(true));
      expect(client.isMutating()).toBe(1);
      // Nothing in the ranking moves while the follow is in flight.
      expect(boardOnScreen()).toEqual(before);
      controls.setLatency(0);

      await waitFor(() => expect(boardOnScreen().some((r) => r.endsWith(' friend_e'))).toBe(true), { timeout: 3000 });
      await settled();
      expect(boardOnScreen()).toEqual(asShown(await friendsBoard()));
      // The suggestion stays where it was, now Following.
      expect(screen.getByLabelText(suggestedLabel(target))).toBeTruthy();
      expect(follow().every((p) => p.props['aria-pressed'] === true)).toBe(true);
    });

    it('a follow from an Everyone row shows on Friends when you switch back', async () => {
      // As fresh as the app keeps reads (createQueryClient), so only the follow's invalidation
      // makes the cached Friends board refetch on the way back.
      client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, staleTime: 30_000 } });
      const friendsBefore = asShown(await friendsBoard());
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual(friendsBefore));
      await fireEvent.press(pill('Everyone'));
      const everyone = await everyoneBoard();
      await waitFor(() => expect(boardOnScreen()).toEqual(asShown(everyone)));

      const target = everyone.find((r) => r.profile.handle === 'friend_e')!;
      // The suggestion's pill comes first in the list, the ranking row's after it.
      const onBoard = screen.getAllByLabelText(`Follow ${target.profile.displayName}`).at(-1)!;
      await fireEvent.press(onBoard);
      await waitFor(async () => expect((await api.profile.getUser(target.profile.id)).isFollowing).toBe(true));
      await settled();
      // Everyone doesn't depend on follows.
      expect(boardOnScreen()).toEqual(asShown(everyone));

      await fireEvent.press(pill('Friends'));
      const after = asShown(await friendsBoard());
      expect(after).not.toEqual(friendsBefore);
      await waitFor(() => expect(boardOnScreen()).toEqual(after));
    });

    it('an unfollow from a Friends row keeps the row (now Follow) until pull to refresh', async () => {
      const friends = await friendsBoard();
      const target = friends.find((r) => r.profile.handle === 'friend_b')!.profile;
      const before = asShown(friends);
      await start();
      await waitFor(() => expect(boardOnScreen()).toEqual(before));
      const button = () => screen.getByLabelText(`Follow ${target.displayName}`);
      expect(button().props['aria-pressed']).toBe(true);

      await fireEvent.press(button());
      await waitFor(() => expect(button().props['aria-pressed']).toBe(false));
      await waitFor(async () => expect((await api.profile.getUser(target.id)).isFollowing).toBe(false));
      await settled();
      // The server's Friends board no longer has them; the screen holds still.
      const after = asShown(await friendsBoard());
      expect(after).not.toContain(`2 ${target.handle}`);
      expect(boardOnScreen()).toEqual(before);
      expect(button().props['aria-pressed']).toBe(false);

      await act(async () => list().props.onRefresh());
      await waitFor(() => expect(boardOnScreen()).toEqual(after));
    });
  });
});

describe('Suggested for you: who you follow already follows them', () => {
  it('says so on each suggestion, by display name', async () => {
    const suggestions = await api.follows.suggested();
    // The fixtures: two people you don't follow, followed by two and by one of the people you do.
    expect(suggestions.map((r) => r.followedByCount).sort()).toEqual([1, 2]);
    await start();
    for (const r of suggestions) {
      expect(await screen.findByLabelText(suggestedLabel(r))).toBeTruthy();
      const [a, b] = r.followedBy;
      expect(screen.getByText(b ? `Followed by ${a!.displayName} and ${b.displayName}` : `Followed by ${a!.displayName}`)).toBeTruthy();
    }
  });

  it('counts the rest past two, and says nothing when no one you follow follows them', async () => {
    const [two, one] = [...(await api.follows.suggested())].sort((a, z) => z.followedByCount - a.followedByCount);
    jest.spyOn(api.follows, 'suggested').mockResolvedValue([
      { ...two!, followedByCount: 5 },
      { ...one!, followedBy: [], followedByCount: 0 },
    ]);
    await start();
    const [a, b] = two!.followedBy;
    expect(await screen.findByText(`Followed by ${a!.displayName}, ${b!.displayName} and 3 others`)).toBeTruthy();
    expect(await screen.findByLabelText(rowLabel(one!))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`^Followed by .*${one!.displayName}`))).toBeNull();
    expect(screen.getAllByText(/^Followed by/)).toHaveLength(1);
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
