import { CONFIDENCE_LOCK } from '@bevi/ranking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import BevDetailScreen from '@/app/bev/[id]';

import { ICON_JOB_STATE_VISIBLE } from '../GeneratedIconPanel';
import { imageUrlFromParam } from '../imageUrl';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

// A neighbour in "Bevs like this" can share a name with this Bev (the catalog has same-named Bevs from different
// brands), so the title is found by its header role, not by text.
const Stub = () => null;

async function open(id: string) {
  const result = renderRouter(
    { _layout: Layout, 'bev/[id]': BevDetailScreen, 'rank/[bevId]': Stub, 'image/[url]': Stub, add: Stub },
    { initialUrl: `/bev/${id}` },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
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

it('a ranked Bev shows your score, its place in the bucket, and Bev it again', async () => {
  const ranked = (await api.rankings.listMine()).items[0]!;
  const r = await open(ranked.bevId);
  expect(await screen.findByRole('header', { name: ranked.bev.name })).toBeTruthy();
  expect(screen.getByText('Your score')).toBeTruthy();
  expect(screen.getByText(`#${ranked.position + 1} in Loved`)).toBeTruthy();
  expect(screen.getByText('Bevi score')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Bev ${ranked.bev.name} again`));
  expect(r.path()).toBe(`/rank/${ranked.bevId}?mode=rerank`);
});

it('an unranked Bev offers Rank it and Want to Try, with a locked prediction when confidence is low', async () => {
  // Demo has enough rankings, so a low-confidence prediction is "Not enough to go on yet", not the "Rank 3" lock.
  const rec = (await api.recs.getRecommendations()).items.find((x) => x.confidence < CONFIDENCE_LOCK)!;
  const r = await open(rec.bev.id);
  expect(await screen.findByRole('header', { name: rec.bev.name })).toBeTruthy();
  expect(screen.getByText("You'd rate it")).toBeTruthy();
  expect(screen.getByText('Not enough to go on yet')).toBeTruthy();
  const save = screen.getByLabelText('Save to Want to Try');
  await fireEvent.press(save);
  expect(await screen.findByLabelText('Saved to Want to Try')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Rank ${rec.bev.name}`));
  expect(r.path()).toBe(`/rank/${rec.bev.id}`);
});

it('shows a confident prediction from your tastes', async () => {
  const rec = (await api.recs.getRecommendations()).items.find((x) => x.confidence >= CONFIDENCE_LOCK)!;
  await open(rec.bev.id);
  expect(await screen.findByRole('header', { name: rec.bev.name })).toBeTruthy();
  expect(screen.getByText('from your tastes')).toBeTruthy();
});

it('locks the prediction below 3 rankings', async () => {
  const rec = (await api.recs.getRecommendations()).items[0]!;
  controls.emptyUser();
  await open(rec.bev.id);
  expect(await screen.findByText('Rank 3 Bevs to see your prediction')).toBeTruthy();
  // The Bevi-score tile can independently be locked too (not enough global ratings on this Bev);
  // assert on the specific prediction lock this test is about, now that each tile's lock carries a
  // distinct label (ScoreBubble's `context` prop) instead of two indistinguishable "Score hidden"s.
  expect(screen.getByLabelText('Your score hidden')).toBeTruthy();
});

it('not_found shows an empty state', async () => {
  await open('no-such-bev');
  expect(await screen.findByText("This Bev isn't here anymore")).toBeTruthy();
  expect(screen.getByLabelText('Back')).toBeTruthy();
});

it('an alcoholic Bev is "Not available" to an under-21 user', async () => {
  const beer = (await api.bevs.search({ q: 'a', categoryId: 'beer' })).items[0]!;
  controls.signInAs('minor_user');
  await open(beer.id);
  expect(await screen.findByText('Not available')).toBeTruthy();
});

// `ICON_JOB_STATE_VISIBLE` is off until the worker is enabled, so a queued job -- which
// is every photo-backed Bev while generation is disabled -- tells its creator nothing.
it('keeps queued generation state off the screen while generation is disabled', async () => {
  const bev = await api.bevs.create({
    name: 'Private icon state test',
    brand: 'Test Co',
    categoryId: 'soda',
    priceTier: 2,
    priceEstimated: false,
  });
  controls.setIconStatus(bev.id, 'pending');
  await open(bev.id);
  expect(await screen.findByRole('header', { name: 'Private icon state test' })).toBeTruthy();
  expect(ICON_JOB_STATE_VISIBLE).toBe(false);
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
});

// Contract 3.0.0: a finished illustration IS the Bev's image, so this screen says nothing
// about it -- no panel, no second tile, and the wordmark set across the hero from the brand.
it('makes a finished illustration the Bev image, with no panel about it', async () => {
  const bev = await api.bevs.create({
    name: 'Finished icon test',
    brand: 'Test Co',
    categoryId: 'soda',
    priceTier: 2,
    priceEstimated: false,
  });
  controls.setIconStatus(bev.id, 'completed');
  await open(bev.id);
  expect(await screen.findByRole('header', { name: 'Finished icon test' })).toBeTruthy();
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
  expect(screen.queryByText(/your illustration/i)).toBeNull();
  // The hero is 155px, big enough to letter: the brand is set across the band, which is the
  // second "Test Co" on the screen -- the first is the brand line under the name.
  expect(screen.getAllByText('Test Co')).toHaveLength(2);
});

it('does not show private generation progress to another viewer', async () => {
  const bev = await api.bevs.create({
    name: 'Private icon state test for friend',
    brand: 'Test Co',
    categoryId: 'soda',
    priceTier: 2,
    priceEstimated: false,
  });
  controls.setIconStatus(bev.id, 'pending');
  controls.signInAs('friend_a');
  await open(bev.id);
  expect(await screen.findByRole('header', { name: 'Private icon state test for friend' })).toBeTruthy();
  expect(screen.queryByTestId('generated-icon-panel')).toBeNull();
});

// T-26: the hero was a Pressable with the Pills' brightness dim. On iOS that dim is a pale layer over
// the Pressable's whole square box, so around the rounded tile it showed as four light corners on a
// dark page while the finger was down.
it('the photo opens the viewer, and the press never uses the brightness dim', async () => {
  const { StyleSheet } = require('react-native');
  const ranked = (await api.rankings.listMine()).items[0]!;
  const get = api.bevs.get.bind(api.bevs);
  const spy = jest.spyOn(api.bevs, 'get').mockImplementation(async (id) => ({ ...(await get(id)), photoUrl: 'https://example.test/p.jpg' }));
  const r = await open(ranked.bevId);
  const hero = await screen.findByRole('imagebutton', { name: `View photo of ${ranked.bev.name}` });
  await fireEvent(hero, 'pressIn');
  expect(StyleSheet.flatten(hero.props.style).filter).toBeUndefined();
  await fireEvent(hero, 'pressOut');
  await fireEvent.press(hero);
  expect(r.path()).toBe('/image/https://example.test/p.jpg');
  spy.mockRestore();
});

it('opens the report sheet from the overflow', async () => {
  const ranked = (await api.rankings.listMine()).items[0]!;
  await open(ranked.bevId);
  await fireEvent.press(await screen.findByLabelText('More'));
  expect(await screen.findByText(`Report ${ranked.bev.name}`)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Wrong category'));
  await fireEvent.press(screen.getByLabelText('Send report'));
  expect(await screen.findByText('Thanks for the report')).toBeTruthy();
});

describe('imageUrlFromParam', () => {
  it('passes web URLs through and decodes a double-encoded one', () => {
    expect(imageUrlFromParam('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(imageUrlFromParam(encodeURIComponent('https://x.test/a b.png'))).toBe('https://x.test/a b.png');
  });
  it('rejects anything else', () => {
    expect(imageUrlFromParam(undefined)).toBeNull();
    expect(imageUrlFromParam('javascript:alert(1)')).toBeNull();
  });
});

it('shows persisted barcode nutrition on the Bev page', async () => {
  const ranked = (await api.rankings.listMine()).items[0]!;
  const bev = await api.bevs.get(ranked.bevId);
  const nutrition = {
    barcode: '012345678901', productName: 'Scanned product', basis: 'Per serving (355 ml)',
    calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
    sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901', source: 'openfoodfacts' as const,
  };
  const get = jest.spyOn(api.bevs, 'get').mockResolvedValue({ ...bev, nutrition });
  try {
    await open(bev.id);
    expect(await screen.findByText('Nutrition Facts')).toBeTruthy();
    expect(screen.getByLabelText('0 calories')).toBeTruthy();
    expect(screen.getByText('Scanned product')).toBeTruthy();
  } finally { get.mockRestore(); }
});
