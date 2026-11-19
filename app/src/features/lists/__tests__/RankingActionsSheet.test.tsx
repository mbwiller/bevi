// A Bev'd row's actions: adding, changing and removing where the Bev was had (BEV-22).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { RankedBev } from '@bevi/shared';

import { api } from '@/api/client';
import { ADD_LOCATION, CHANGE_LOCATION, PICKER_PLACEHOLDER, PICKER_TITLE, REMOVE_LOCATION } from '@/features/places/copy';
import { controls } from '@/testing/fakeApi';

import { RankingActionsSheet } from '../RankingActionsSheet';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

const firstRanked = async (): Promise<RankedBev> => (await api.rankings.listMine()).items[0]!;

async function renderSheet(ranked: RankedBev) {
  const onClose = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <RankingActionsSheet ranked={ranked} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

it('a Bev with no place offers Add location, which opens the picker in the sheet and saves the pick', async () => {
  const ranked = await firstRanked();
  const [match] = await api.venues.search({ query: 'yorkville' });
  const onClose = await renderSheet(ranked);

  await fireEvent.press(screen.getByLabelText(ADD_LOCATION));
  // The sheet is now the picker.
  expect(screen.getByLabelText(PICKER_TITLE)).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect((await firstRanked()).venue?.id).toBe(match!.venue.id);
});

it('a Bev with a place offers Change location, names it, and can remove it', async () => {
  const before = await firstRanked();
  const [match] = await api.venues.search({ query: 'yorkville' });
  await api.rankings.setVenue(before.bev.id, match!.venue.id);
  const ranked = await firstRanked();
  const onClose = await renderSheet(ranked);

  expect(screen.queryByLabelText(ADD_LOCATION)).toBeNull();
  await fireEvent.press(screen.getByLabelText(CHANGE_LOCATION));
  await fireEvent.press(await screen.findByLabelText(REMOVE_LOCATION));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect((await firstRanked()).venue).toBeNull();
});

it('a failed save stays in the picker and says so', async () => {
  const ranked = await firstRanked();
  const [match] = await api.venues.search({ query: 'yorkville' });
  const onClose = await renderSheet(ranked);
  await fireEvent.press(screen.getByLabelText(ADD_LOCATION));
  await fireEvent.changeText(screen.getByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  const row = await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) });

  controls.failNext('network', 'rankings.setVenue');
  await fireEvent.press(row);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect((await firstRanked()).venue).toBeNull();
});
