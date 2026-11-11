import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { categoryById } from '@/lib/categories';
import { controls } from '@/testing/fakeApi';
import ListsScreen from '@/app/(tabs)/lists/index';
import { myScoreMeta } from '@/features/leaderboard/BevBoard';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function start(url = '/lists?tab=top') {
  const result = renderRouter(
    { _layout: Layout, 'lists/index': ListsScreen, 'bev/[id]': Stub, 'rank/[bevId]': Stub, add: Stub },
    { initialUrl: url },
  );
  await result;
  // Not returned directly: an async function would unwrap the thenable and drop these readers.
  return { searchParams: () => result.getSearchParams(), path: () => result.getPathnameWithParams() };
}

const rowName = (el: { props: { accessibilityLabel?: string } }) =>
  (el.props.accessibilityLabel as string).replace(/^\d+\. /, '');

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(() => client.clear());

describe('Lists, Top tab', () => {
  it('titles the screen Lists and offers four tabs, with Top selected by ?tab=top', async () => {
    await start();
    expect(await screen.findByLabelText(/^1\. /)).toBeTruthy();
    expect(screen.getByText('Lists')).toBeTruthy();
    expect(screen.queryByText('Your lists')).toBeNull();
    for (const label of ["Bev'd", 'Want to Try', 'For you', 'Top']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('tab', { name: 'Recommended' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Top' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('switches to Top through ?tab= and on to For you', async () => {
    const first = (await api.leaderboard.bevs()).items[0]!;
    const r = await start('/lists');
    await screen.findByLabelText(/^1\. /);

    await fireEvent.press(screen.getByLabelText('Top'));
    expect(r.searchParams()).toEqual({ tab: 'top' });
    expect(await screen.findByLabelText(`1. ${first.bev.name}`)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('For you'));
    expect(r.searchParams()).toEqual({ tab: 'recommended' });
  });

  it('numbers the board with the Bayesian score and "Your score"', async () => {
    const board = (await api.leaderboard.bevs()).items;
    expect(board.length).toBeGreaterThan(0);
    await start();
    const first = board[0]!;
    expect(await screen.findByLabelText(`1. ${first.bev.name}`)).toBeTruthy();
    expect(screen.getAllByText(myScoreMeta(first.myScore)).length).toBeGreaterThan(0);
    expect(myScoreMeta(9.5)).toBe('Your score 9.5');
    expect(myScoreMeta(8.94)).toBe('Your score 8.9');
    expect(myScoreMeta(null)).toBe('Not ranked yet');
  });

  it("shows each Bev's image", async () => {
    const first = (await api.leaderboard.bevs()).items[0]!;
    await start();
    await screen.findByLabelText(`1. ${first.bev.name}`);
    const named = screen.getAllByLabelText(first.bev.name);
    expect(named.some((el) => el.props.accessibilityRole === 'image' || el.props.role === 'image')).toBe(true);
  });

  it("applies the screen's category scope, with no ?category= param", async () => {
    const board = (await api.leaderboard.bevs()).items;
    const categoryId = board[0]!.bev.categoryId;
    const scoped = (await api.leaderboard.bevs({ categoryId })).items;
    const label = categoryById(categoryId).label;
    const r = await start();
    await screen.findByLabelText(/^1\. /);

    await fireEvent.press(screen.getByLabelText('All, choose a category'));
    await fireEvent.press(await screen.findByLabelText(label));
    expect(r.searchParams()).toEqual({ tab: 'top' });
    expect(await screen.findByLabelText(`${label}, choose a category`)).toBeTruthy();
    expect(await screen.findByLabelText(`1. ${scoped[0]!.bev.name}`)).toBeTruthy();
    const names = new Set(scoped.map((s) => s.bev.name));
    for (const row of screen.getAllByLabelText(/^\d+\. /)) expect(names.has(rowName(row))).toBe(true);
  });

  it('keeps one scope across tabs', async () => {
    const categoryId = (await api.leaderboard.bevs()).items[0]!.bev.categoryId;
    const label = categoryById(categoryId).label;
    await start();
    await screen.findByLabelText(/^1\. /);
    await fireEvent.press(screen.getByLabelText('All, choose a category'));
    await fireEvent.press(await screen.findByLabelText(label));
    await fireEvent.press(screen.getByLabelText("Bev'd"));
    expect(await screen.findByLabelText(`${label}, choose a category`)).toBeTruthy();
  });

  it('hides alcoholic categories in the scope sheet under 21', async () => {
    controls.signInAs('minor_user');
    await start();
    await fireEvent.press(await screen.findByLabelText('All, choose a category'));
    expect(await screen.findByLabelText('All Bevs')).toBeTruthy();
    expect(screen.queryByLabelText('Beer')).toBeNull();
    expect(screen.getByLabelText('Soda')).toBeTruthy();
  });

  it('loads the board under 21 with no alcoholic Bev on it', async () => {
    // The fixtures have no alcoholic Bev with enough rankings, so this guards the under-21 path
    // end to end (the board loads and nothing alcoholic is on it) rather than a filter.
    controls.signInAs('minor_user');
    const board = (await api.leaderboard.bevs()).items;
    expect(board.length).toBeGreaterThan(0);
    expect(board.some((b) => categoryById(b.bev.categoryId).isAlcoholic)).toBe(false);
    await start();
    expect(await screen.findByLabelText(`1. ${board[0]!.bev.name}`)).toBeTruthy();
    for (const row of screen.getAllByLabelText(/^\d+\. /)) {
      expect(board.some((b) => b.bev.name === rowName(row))).toBe(true);
    }
  });

  it('a category with no Bev at MIN_RATERS says "Not enough rankings yet"', async () => {
    // The fixtures have no juice ranked by two people.
    expect((await api.leaderboard.bevs({ categoryId: 'juice' })).items).toHaveLength(0);
    await start();
    await screen.findByLabelText(/^1\. /);
    await fireEvent.press(screen.getByLabelText('All, choose a category'));
    await fireEvent.press(await screen.findByLabelText(categoryById('juice').label));
    expect(await screen.findByText('Not enough rankings yet')).toBeTruthy();
  });

  it('shows ErrorState with Retry when the board fails', async () => {
    controls.failNext('network', 'leaderboard.bevs');
    await start();
    await fireEvent.press(await screen.findByLabelText('Retry'));
    expect(await screen.findByLabelText(/^1\. /)).toBeTruthy();
  });

  it('Rank it opens the ranking flow', async () => {
    const board = (await api.leaderboard.bevs()).items;
    const unranked = board.find((b) => b.myScore == null);
    expect(unranked).toBeTruthy();
    const r = await start();
    await screen.findByLabelText(/^1\. /);
    await fireEvent.press(screen.getAllByLabelText(`Rank ${unranked!.bev.name}`)[0]!);
    await waitFor(() => expect(r.path()).toBe(`/rank/${unranked!.bev.id}`));
  });

  it('a row opens the Bev', async () => {
    const first = (await api.leaderboard.bevs()).items[0]!;
    const r = await start();
    await fireEvent.press(await screen.findByLabelText(`1. ${first.bev.name}`));
    await waitFor(() => expect(r.path()).toBe(`/bev/${first.bev.id}`));
  });
});
