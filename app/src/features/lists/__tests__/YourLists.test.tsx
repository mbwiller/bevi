import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import ListsScreen from '@/app/(tabs)/lists/index';

import { basedOnLine } from '../RecommendedTab';

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

async function start(url = '/lists') {
  const result = renderRouter(
    { _layout: Layout, 'lists/index': ListsScreen, 'bev/[id]': Stub, 'rank/[bevId]': Stub, add: Stub },
    { initialUrl: url },
  );
  await result;
  // Not returned directly: an async function would unwrap the thenable and drop these readers.
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

it("Bev'd lists the user's rankings numbered across buckets", async () => {
  const first = (await api.rankings.listMine()).items[0]!;
  await start();
  expect(await screen.findByLabelText(`1. ${first.bev.name}`)).toBeTruthy();
  expect(screen.getByLabelText(`More for ${first.bev.name}`)).toBeTruthy();
});

it('switches tabs through ?tab=', async () => {
  const saved = (await api.wantToTry.list()).items[0]!;
  const recs = await api.recs.getRecommendations();
  const r = await start();
  await screen.findByLabelText(/^1\. /);

  await fireEvent.press(screen.getByLabelText('Want to Try'));
  expect(r.searchParams()).toEqual({ tab: 'want' });
  expect(await screen.findByLabelText(saved.bev.name)).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Recommended'));
  expect(r.searchParams()).toEqual({ tab: 'recommended' });
  expect(await screen.findByText(new RegExp(`^Based on ${recs.basedOnCount} Bevs you've ranked`))).toBeTruthy();
  expect(await screen.findByLabelText(recs.items[0]!.bev.name)).toBeTruthy();
});

it('shows each tab’s empty state, and Recommended locked below 3 rankings', async () => {
  controls.emptyUser();
  await start('/lists?tab=bevd');
  expect(await screen.findByText('Add your first Bev')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Want to Try'));
  expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Recommended'));
  expect(await screen.findByText('Rank 3 Bevs to see recommendations')).toBeTruthy();
});

it('removes from Want to Try optimistically, and rolls back on error', async () => {
  const target = (await api.wantToTry.list()).items[0]!;
  await start('/lists?tab=want');
  await screen.findByLabelText(target.bev.name);
  controls.setLatency(400);
  controls.failNext('network', 'wantToTry.remove');
  await fireEvent.press(screen.getAllByLabelText('Saved to Want to Try')[0]!);
  // Gone before the server answers…
  await waitFor(() => expect(screen.queryByLabelText(target.bev.name)).toBeNull(), { timeout: 300 });
  // …and back when it fails.
  expect(await screen.findByLabelText(target.bev.name, undefined, { timeout: 3000 })).toBeTruthy();
});

it('opens the row actions sheet with Re-rank, Edit note and Remove', async () => {
  const first = (await api.rankings.listMine()).items[0]!;
  await start();
  await fireEvent.press(await screen.findByLabelText(`More for ${first.bev.name}`));
  expect(await screen.findByLabelText('Re-rank')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Remove from Bev'd"));
  expect(await screen.findByText(`Remove ${first.bev.name}?`)).toBeTruthy();
});

it('Re-rank opens the ranking flow in re-rank mode', async () => {
  const first = (await api.rankings.listMine()).items[0]!;
  const r = await start();
  await fireEvent.press(await screen.findByLabelText(`More for ${first.bev.name}`));
  await fireEvent.press(await screen.findByLabelText('Re-rank'));
  expect(r.path()).toBe(`/rank/${first.bevId}?mode=rerank`);
});

it('formats the Recommended summary line', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  expect(basedOnLine(12, '2026-10-11T10:00:00Z', now)).toBe("Based on 12 Bevs you've ranked · Updated 2 hours ago");
  expect(basedOnLine(1, '2026-10-11T12:00:00Z', now)).toBe("Based on 1 Bev you've ranked · Updated just now");
});
