import type { BevSummary } from '@bevi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { ALCOHOLIC_BEV_ID, controls, MINOR } from '@/testing/fakeApi';
import BevDetailScreen from '@/app/bev/[id]';
import { categoryById } from '@/lib/categories';
import { formatRatings } from '@/lib/format';

import { visibleSimilar } from '../SimilarBevs';

// "Bevs like this" (M-27 b) on Bev detail. The FakeApi derives its edges from the catalog with the real
// edgeWeight/topEdges, so the neighbours of Coca-Cola Classic are real Bevs in a real order.
const COKE = 'coca-cola-classic';
const SECTION = 'Bevs like this';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function open(id: string) {
  const result = renderRouter(
    { _layout: Layout, 'bev/[id]': BevDetailScreen, 'rank/[bevId]': Stub, 'image/[url]': Stub, add: Stub },
    { initialUrl: `/bev/${id}` },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

/** A row's main button (its BevImage carries the name as a label too, so role + name, not label alone). */
const rowFor = (name: string) => screen.queryByRole('button', { name });

/** Names of the rows on screen, in order (a BevRow's main button is labelled with the Bev's name). */
function rowNames(among: readonly string[]): string[] {
  return screen
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string)
    .filter((label) => among.includes(label));
}

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

afterEach(() => {
  jest.restoreAllMocks();
  client.clear();
});

it('lists the five nearest Bevs in the server order, under a heading', async () => {
  const spy = jest.spyOn(api.bevs, 'similar');
  const expected = (await api.bevs.similar(COKE, 5)).map((b) => b.name);
  expect(expected).toHaveLength(5);
  await open(COKE);
  expect(await screen.findByRole('heading', { name: SECTION })).toBeTruthy();
  expect(spy).toHaveBeenCalledWith(COKE, 5);
  expect(rowNames(expected)).toEqual(expected);
});

it('shows each neighbour with its rating count and no Rank or Save buttons', async () => {
  const [first] = await api.bevs.similar(COKE, 5);
  await open(COKE);
  await screen.findByRole('heading', { name: SECTION });
  expect(rowFor(first!.name)).toBeTruthy();
  expect(screen.queryByLabelText(`Rank ${first!.name}`)).toBeNull();
  if (first!.ratingCount > 0) expect(screen.getAllByText(formatRatings(first!.ratingCount)).length).toBeGreaterThan(0);
});

it('hides the section when the Bev has no edges', async () => {
  const spy = jest.spyOn(api.bevs, 'similar').mockResolvedValue([]);
  await open(COKE);
  expect(await screen.findByText('Coca-Cola Classic')).toBeTruthy();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await spy.mock.results[0]!.value;
  expect(screen.queryByText(SECTION)).toBeNull();
});

it('hides the section, without an error state, when the request fails', async () => {
  const spy = jest.spyOn(api.bevs, 'similar');
  controls.failNext('network', 'bevs.similar');
  await open(COKE);
  // The rest of the page is unaffected...
  expect(await screen.findByText('Coca-Cola Classic')).toBeTruthy();
  expect(screen.getByLabelText('Rank Coca-Cola Classic')).toBeTruthy();
  // ...the call was made and rejected (not skipped)...
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await expect(spy.mock.results[0]!.value).rejects.toMatchObject({ code: 'network' });
  // ...and nothing about it reaches the screen.
  expect(screen.queryByText(SECTION)).toBeNull();
  expect(screen.queryByText(/something went wrong|try again|retry/i)).toBeNull();
});

it('opens a neighbour when you tap its row', async () => {
  const [first] = await api.bevs.similar(COKE, 5);
  const r = await open(COKE);
  await screen.findByRole('heading', { name: SECTION });
  await fireEvent.press(rowFor(first!.name)!);
  expect(r.path()).toBe(`/bev/${first!.id}`);
  expect(await screen.findByRole('header', { name: first!.name })).toBeTruthy();
});

it('never lists the Bev it sits under', async () => {
  const [self] = await api.bevs.search({ q: 'Coca-Cola Classic', limit: 1 }).then((p) => p.items);
  const [other] = await api.bevs.similar(COKE, 1);
  jest.spyOn(api.bevs, 'similar').mockResolvedValue([self!, other!]);
  await open(COKE);
  await screen.findByRole('heading', { name: SECTION });
  expect(rowFor(other!.name)).toBeTruthy();
  expect(rowFor(self!.name)).toBeNull();
});

describe('age', () => {
  it('a minor sees only non-alcoholic neighbours (the server filters)', async () => {
    controls.signInAs(MINOR.handle);
    const near = await api.bevs.similar(COKE, 5);
    expect(near.length).toBeGreaterThan(0);
    await open(COKE);
    expect(await screen.findByRole('heading', { name: SECTION })).toBeTruthy();
    for (const b of near) expect(categoryById(b.categoryId).isAlcoholic).toBe(false);
  });

  it('a minor never sees an alcoholic neighbour even if one slips through', async () => {
    const beer = (await api.bevs.search({ q: 'a', categoryId: 'beer' })).items[0]!;
    const [soda] = await api.bevs.similar(COKE, 1);
    controls.signInAs(MINOR.handle);
    jest.spyOn(api.bevs, 'similar').mockResolvedValue([beer, soda!]);
    await open(COKE);
    await screen.findByRole('heading', { name: SECTION });
    expect(rowFor(soda!.name)).toBeTruthy();
    expect(rowFor(beer.name)).toBeNull();
  });

  it('an adult sees alcoholic neighbours of an alcoholic Bev', async () => {
    const near = await api.bevs.similar(ALCOHOLIC_BEV_ID, 5);
    expect(near.length).toBeGreaterThan(0);
    await open(ALCOHOLIC_BEV_ID);
    await screen.findByRole('heading', { name: SECTION });
    expect(rowFor(near[0]!.name)).toBeTruthy();
  });
});

describe('visibleSimilar', () => {
  const bev = (id: string, categoryId: BevSummary['categoryId']) => ({ id, categoryId }) as BevSummary;
  const items = [bev('a', 'soda'), bev('self', 'soda'), bev('b', 'beer')];

  it('drops the current Bev, and alcohol unless the viewer can see it', () => {
    expect(visibleSimilar(items, 'self', false).map((b) => b.id)).toEqual(['a']);
    expect(visibleSimilar(items, 'self', true).map((b) => b.id)).toEqual(['a', 'b']);
    expect(visibleSimilar(undefined, 'self', true)).toEqual([]);
  });
});
