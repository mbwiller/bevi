import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import LeaderboardScreen from '@/app/(tabs)/leaderboard/index';
import { categoryById } from '@/lib/categories';

import { myScoreMeta } from '../BevBoard';
import { pointsMeta } from '../PeopleBoard';

const controls = mockControls!;
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

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('demo');
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
  expect(mine).toBeTruthy();
  const r = await start();
  await screen.findByLabelText(/^1\. /);

  await fireEvent.press(screen.getByLabelText('People'));
  expect(r.searchParams()).toEqual({ scope: 'users' });
  const own = await screen.findAllByLabelText(
    `${me.displayName} (you), @${me.handle}, ${pointsMeta(mine.points, mine.bevsRanked)}`,
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
  controls.signInAs('theo');
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

it('pins your own row from your stats when the board is loaded', async () => {
  await start('/leaderboard?scope=users');
  const pinned = await screen.findByTestId('pinned-self');
  expect(within(pinned).getByText(/\(you\)/)).toBeTruthy();
});
