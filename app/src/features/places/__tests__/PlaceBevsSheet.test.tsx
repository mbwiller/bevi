// The Map tab's "Add them" sheet (BEV-22): the viewer's Bevs with no place, one at a time.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { RankedBev } from '@bevi/shared';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { ME } from '@/testing/fakeApi/people';

import { BACKFILL_NONE, DONE, PICKER_PLACEHOLDER, RECENT, SKIP, backfillSummary } from '../copy';
import { PlaceBevsSheet } from '../PlaceBevsSheet';

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

const newestFirst = async (): Promise<RankedBev[]> => (await api.rankings.listMine({ sort: 'recent', page: { limit: 50 } })).items;
const venueOf = async (bevId: string) => (await api.rankings.listMine({ page: { limit: 50 } })).items.find((r) => r.bevId === bevId)?.venue ?? null;

async function renderSheet() {
  const onClose = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <PlaceBevsSheet open onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

it('starts on the newest Bev with no place, saves a pick and moves on, with that place first under Recent', async () => {
  const all = await newestFirst();
  const [a, b] = all;
  const [match] = await api.venues.search({ query: 'yorkville' });
  await renderSheet();

  expect(await screen.findByText(`1 of ${all.length}`)).toBeTruthy();
  expect(screen.getByText(a!.bev.name)).toBeTruthy();

  await fireEvent.changeText(screen.getByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));

  expect(await screen.findByText(`2 of ${all.length}`)).toBeTruthy();
  expect(screen.getByText(b!.bev.name)).toBeTruthy();
  expect(await venueOf(a!.bevId)).toMatchObject({ id: match!.venue.id });
  // The search was cleared for the next Bev, and the place just used leads the list.
  expect(screen.getByPlaceholderText(PICKER_PLACEHOLDER).props.value).toBe('');
  expect(await screen.findByText(RECENT)).toBeTruthy();

  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));
  expect(await screen.findByText(`3 of ${all.length}`)).toBeTruthy();
  expect(await venueOf(b!.bevId)).toMatchObject({ id: match!.venue.id });
});

it('leaves out the Bevs that already have a place', async () => {
  const [a, b] = await newestFirst();
  const [match] = await api.venues.search({ query: 'yorkville' });
  await api.rankings.setVenue(a!.bevId, match!.venue.id);
  const total = (await newestFirst()).length;
  await renderSheet();

  expect(await screen.findByText(`1 of ${total - 1}`)).toBeTruthy();
  expect(screen.getByText(b!.bev.name)).toBeTruthy();
  expect(screen.queryByText(a!.bev.name)).toBeNull();
});

it('Skip moves on without saving, and the end says what was done', async () => {
  const all = await newestFirst();
  const [match] = await api.venues.search({ query: 'yorkville' });
  // Leave one Bev without a place.
  for (const r of all.slice(1)) await api.rankings.setVenue(r.bevId, match!.venue.id);
  const onClose = await renderSheet();

  expect(await screen.findByText('1 of 1')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: `${SKIP} ${all[0]!.bev.name}` }));

  expect(await screen.findByText(backfillSummary(0, 1))).toBeTruthy();
  expect(await venueOf(all[0]!.bevId)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: DONE }));
  expect(onClose).toHaveBeenCalled();
});

it('Done stops partway through', async () => {
  const onClose = await renderSheet();
  await screen.findByText(/^1 of \d+$/);
  await fireEvent.press(screen.getByRole('button', { name: DONE }));
  expect(onClose).toHaveBeenCalled();
});

it('says so when every Bev already has a place', async () => {
  const [match] = await api.venues.search({ query: 'yorkville' });
  for (const r of await newestFirst()) await api.rankings.setVenue(r.bevId, match!.venue.id);
  await renderSheet();
  expect(await screen.findByText(BACKFILL_NONE)).toBeTruthy();
});

it('a failed save stays on the same Bev and says so', async () => {
  const all = await newestFirst();
  const [match] = await api.venues.search({ query: 'yorkville' });
  await renderSheet();
  await screen.findByText(`1 of ${all.length}`);
  await fireEvent.changeText(screen.getByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  const row = await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) });

  controls.failNext('network', 'rankings.setVenue');
  await fireEvent.press(row);
  expect(await screen.findByRole('alert')).toBeTruthy();
  await waitFor(() => expect(screen.getByText(`1 of ${all.length}`)).toBeTruthy());
  expect(screen.getByText(all[0]!.bev.name)).toBeTruthy();
  expect(await venueOf(all[0]!.bevId)).toBeNull();
});
