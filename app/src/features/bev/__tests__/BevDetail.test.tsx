import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api, mockControls } from '@/api/client';
import BevDetailScreen from '@/app/bev/[id]';

import { imageUrlFromParam } from '../imageUrl';

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

async function open(id: string) {
  const result = renderRouter(
    { _layout: Layout, 'bev/[id]': BevDetailScreen, 'rank/[bevId]': Stub, 'image/[url]': Stub, add: Stub },
    { initialUrl: `/bev/${id}` },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
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

it('a ranked Bev shows your score, its place in the bucket, and Re-rank', async () => {
  const ranked = (await api.rankings.listMine()).items[0]!;
  const r = await open(ranked.bevId);
  expect(await screen.findByText(ranked.bev.name)).toBeTruthy();
  expect(screen.getByText('Your score')).toBeTruthy();
  expect(screen.getByText(`#${ranked.position + 1} in Loved`)).toBeTruthy();
  expect(screen.getByText('Bevi score')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Re-rank ${ranked.bev.name}`));
  expect(r.path()).toBe(`/rank/${ranked.bevId}?mode=rerank`);
});

it('an unranked Bev offers Rank it and Want to Try, with a locked prediction when there is none', async () => {
  const rec = (await api.recs.getRecommendations()).items[0]!;
  const r = await open(rec.bev.id);
  expect(await screen.findByText(rec.bev.name)).toBeTruthy();
  expect(screen.getByText("You'd rate it")).toBeTruthy();
  // The mock returns no prediction yet; demo has enough rankings, so it isn't the "Rank 3" lock.
  expect(screen.getByText('Not enough to go on yet')).toBeTruthy();
  const save = screen.getByLabelText('Save to Want to Try');
  await fireEvent.press(save);
  expect(await screen.findByLabelText('Saved to Want to Try')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Rank ${rec.bev.name}`));
  expect(r.path()).toBe(`/rank/${rec.bev.id}`);
});

it('locks the prediction below 3 rankings', async () => {
  const rec = (await api.recs.getRecommendations()).items[0]!;
  controls.emptyUser();
  await open(rec.bev.id);
  expect(await screen.findByText('Rank 3 Bevs to see your prediction')).toBeTruthy();
  expect(screen.getByLabelText('Score hidden')).toBeTruthy();
});

it('not_found shows an empty state', async () => {
  await open('no-such-bev');
  expect(await screen.findByText("This Bev isn't here anymore")).toBeTruthy();
  expect(screen.getByLabelText('Back')).toBeTruthy();
});

it('an alcoholic Bev is "Not available" to an under-21 user', async () => {
  const beer = (await api.bevs.search({ q: 'a', categoryId: 'beer' })).items[0]!;
  controls.signInAs('theo');
  await open(beer.id);
  expect(await screen.findByText('Not available')).toBeTruthy();
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
