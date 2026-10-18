import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import LeaderboardScreen from '@/app/(tabs)/leaderboard/index';
import { categoryById } from '@/lib/categories';

import { RANK_POINTS_WEIGHTS, STREAK_PERIOD } from '@bevi/ranking';

import { pointsRules } from '../copy';
import { myScoreMeta } from '../BevBoard';
import { pointsMeta } from '../PeopleBoard';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url = '/leaderboard') {
  const result = renderRouter(
    {
      _layout: Layout,
      'leaderboard/index': LeaderboardScreen,
      'bev/[id]': Stub,
      'rank/[bevId]': Stub,
      'user/[id]/index': Stub,
      'profile/index': Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { searchParams: () => result.getSearchParams(), path: () => result.getPathnameWithParams() };
}

// Pin "now" (Date only; timers stay real) so demo's seeded streak and predictions are the same on
// any day and in any timezone the tests run.
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

afterEach(() => client.clear());

it('numbers the Bevs board with the Bayesian score and "Your score"', async () => {
  const board = (await api.leaderboard.bevs()).items;
  expect(board.length).toBeGreaterThan(0);
  await start();
  const first = board[0]!;
  expect(await screen.findByLabelText(`1. ${first.bev.name}`)).toBeTruthy();
  expect(screen.getAllByText(myScoreMeta(first.myScore)).length).toBeGreaterThan(0);
  expect(myScoreMeta(8.94)).toBe('Your score 8.9');
  expect(myScoreMeta(null)).toBe('Not ranked yet');
});

it('switches to People through ?scope= and highlights your own row', async () => {
  const me = await api.profile.getMe();
  const people = (await api.leaderboard.users()).items;
  const mine = people.find((r) => r.profile.id === me.id)!;
  expect(mine).toMatchObject({ currentStreak: 2 }); // seeded, on the pinned clock
  const r = await start();
  await screen.findByLabelText(/^1\. /);

  await fireEvent.press(screen.getByLabelText('People'));
  expect(r.searchParams()).toEqual({ scope: 'users' });
  const own = await screen.findAllByLabelText(
    `${me.displayName} (you), @${me.handle}, ${pointsMeta(mine.points, mine.bevsRanked)}${mine.currentStreak ? `, ${mine.currentStreak} day streak` : ''}`,
  );
  expect(own.length).toBeGreaterThan(0);
  // Others get a Follow button; your own row never does.
  const other = people.find((p) => p.profile.id !== me.id)!;
  expect(screen.getAllByLabelText(`Follow ${other.profile.displayName}`).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(`Follow ${me.displayName}`)).toBeNull();

  await fireEvent.press(screen.getByLabelText('Bevs'));
  expect(r.searchParams()).toEqual({ scope: 'bevs' });
});

it('follows from the People board optimistically', async () => {
  const me = await api.profile.getMe();
  const following = new Set((await api.follows.listFollowing(me.id)).items.map((p) => p.id));
  const people = (await api.leaderboard.users()).items;
  const target = people.find((p) => p.profile.id !== me.id && !following.has(p.profile.id))!;
  expect(target).toBeTruthy();
  await start('/leaderboard?scope=users');
  const button = await screen.findByLabelText(`Follow ${target.profile.displayName}`);
  expect(button.props['aria-pressed']).toBe(false);
  controls.setLatency(400);
  await fireEvent.press(button);
  expect(screen.getByLabelText(`Follow ${target.profile.displayName}`).props['aria-pressed']).toBe(true);
});

it('scopes the Bevs board by category through ?category=', async () => {
  const board = (await api.leaderboard.bevs()).items;
  const categoryId = board[0]!.bev.categoryId;
  const scoped = (await api.leaderboard.bevs({ categoryId })).items;
  const label = categoryById(categoryId).label;
  const r = await start();
  await screen.findByLabelText(/^1\. /);

  await fireEvent.press(screen.getByLabelText('All, choose a category'));
  await fireEvent.press(await screen.findByLabelText(label));
  expect(r.searchParams()).toEqual({ category: categoryId });
  expect(await screen.findByLabelText(`${label}, choose a category`)).toBeTruthy();
  expect(await screen.findByLabelText(`1. ${scoped[0]!.bev.name}`)).toBeTruthy();
});

it('hides alcoholic categories under 21 and ignores them in the URL', async () => {
  controls.signInAs('minor_user');
  await start('/leaderboard?category=beer');
  const dropdown = await screen.findByLabelText('All, choose a category');
  await fireEvent.press(dropdown);
  const sheet = await screen.findByLabelText('All Bevs');
  expect(sheet).toBeTruthy();
  expect(screen.queryByLabelText('Beer')).toBeNull();
  expect(screen.getByLabelText('Soda')).toBeTruthy();
});

it('a category with no Bev at MIN_RATERS says "Not enough rankings yet"', async () => {
  // The fixtures have no juice ranked by two people.
  expect((await api.leaderboard.bevs({ categoryId: 'juice' })).items).toHaveLength(0);
  await start('/leaderboard?category=juice');
  expect(await screen.findByText('Not enough rankings yet')).toBeTruthy();
});

it('shows ErrorState with Retry when the board fails', async () => {
  controls.failNext('network', 'leaderboard.bevs');
  await start();
  const retry = await screen.findByLabelText('Retry');
  await fireEvent.press(retry);
  expect(await screen.findByLabelText(/^1\. /)).toBeTruthy();
});

it("doesn't flash the pinned own row before the list reports what's on screen", async () => {
  const me = await api.profile.getMe();
  await start('/leaderboard?scope=users');
  expect((await screen.findAllByText(/\(you\)/)).length).toBe(1);
  expect(screen.getAllByLabelText(new RegExp(`^${me.displayName} \\(you\\)`))).toHaveLength(1);
  expect(screen.queryByTestId('pinned-self')).toBeNull();
});

it('shows each Bev\'s image on the Bevs board', async () => {
  const first = (await api.leaderboard.bevs()).items[0]!;
  await start();
  await screen.findByLabelText(`1. ${first.bev.name}`);
  const named = screen.getAllByLabelText(first.bev.name);
  expect(named.some((el) => el.props.accessibilityRole === 'image' || el.props.role === 'image')).toBe(true);
});

it('explains People points in a sheet', async () => {
  await start('/leaderboard?scope=users');
  await screen.findAllByText(/\(you\)/);
  expect(screen.queryByTestId('sheet')).toBeNull();
  // The link's spoken name is just "How points work", not "How points work ranked by points".
  expect(screen.getByRole('link', { name: 'How points work' })).toBeTruthy();
  await fireEvent.press(screen.getByText('How points work'));
  expect(await screen.findByTestId('sheet')).toBeTruthy();
  for (const line of pointsRules()) expect(screen.getByText(line)).toBeTruthy();
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
