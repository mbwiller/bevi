// The place picker against the FakeApi (BEV-22): what is nearby with a position, searching by name,
// the outside-directory fallback, and working without a position. `../position` is replaced, since
// the file jest resolves has no provider.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Venue } from '@bevi/shared';

import { api } from '@/api/client';
import { SEARCH_DEBOUNCE_MS } from '@/features/add-bev/useDebouncedValue';
import { controls } from '@/testing/fakeApi';

import { LOCATION_OFF, MORE_LIMITED, NO_MATCH, PICKER_HINT, PICKER_PLACEHOLDER, REMOVE_LOCATION, searchMoreLabel } from '../copy';
import { PlacePickerBody } from '../PlacePicker';
import type { PositionPermission, PositionResult } from '../position';

// The seeded venues are on the Upper East Side; this is among them.
const HERE = { lat: 40.7762, lng: -73.9495 };
let mockPosition: PositionResult = { kind: 'ok', position: HERE };
let mockPermission: PositionPermission = 'granted';
jest.mock('../position', () => ({
  ...jest.requireActual('../position'),
  currentPosition: async () => mockPosition,
  positionPermission: async () => mockPermission,
}));

configure({ asyncUtilTimeout: SEARCH_DEBOUNCE_MS + 4000 });
jest.setTimeout(30000);
let client: QueryClient;

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockPosition = { kind: 'ok', position: HERE };
  mockPermission = 'granted';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

async function renderPicker(props: Partial<Parameters<typeof PlacePickerBody>[0]> = {}) {
  const onSelect = jest.fn<void, [Venue]>();
  const onRemove = jest.fn();
  await render(
    <QueryClientProvider client={client}>
      <PlacePickerBody active onSelect={onSelect} onRemove={onRemove} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect, onRemove };
}

const type = (text: string) => fireEvent.changeText(screen.getByPlaceholderText(PICKER_PLACEHOLDER), text);

it('with a position and nothing typed it lists what is nearby, nearest first, each with its distance', async () => {
  const nearest = (await api.venues.search({ query: '', near: HERE, limit: 3 })).map((m) => m.venue.name);
  await renderPicker();

  expect(await screen.findByText('Nearby')).toBeTruthy();
  const rows = await screen.findAllByRole('button', { name: /ft|mi/ });
  expect(rows.length).toBeGreaterThanOrEqual(3);
  expect(rows.slice(0, 3).map((r) => r.props.accessibilityLabel.split(',')[0])).toEqual(nearest);
  // Hidden venues never show.
  expect(screen.queryByText(/Hidden/)).toBeNull();
});

it('the places you used last lead the list, newest first, and are not repeated under Nearby', async () => {
  const [near, next, third] = (await api.venues.search({ query: '', near: HERE, limit: 3 })).map((m) => m.venue);
  const [a, b] = (await api.rankings.listMine()).items;
  await api.rankings.setVenue(a!.bev.id, third!.id);
  await api.rankings.setVenue(b!.bev.id, near!.id);
  const { onSelect } = await renderPicker();

  expect(await screen.findByText('Recent')).toBeTruthy();
  await screen.findByText('Nearby');
  const names = screen.getAllByRole('button').map((r) => String(r.props.accessibilityLabel).split(',')[0]);
  // Recent: the one set last first. Then Nearby, without those two.
  expect(names.slice(0, 3)).toEqual([near!.name, third!.name, next!.name]);
  expect(names.filter((n) => n === near!.name)).toHaveLength(1);

  await fireEvent.press(screen.getAllByRole('button')[1]!);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: third!.id }));
});

it('typing hides the recent places: a search is only its matches', async () => {
  const [near] = (await api.venues.search({ query: '', near: HERE, limit: 1 })).map((m) => m.venue);
  const [a] = (await api.rankings.listMine()).items;
  await api.rankings.setVenue(a!.bev.id, near!.id);
  await renderPicker();
  expect(await screen.findByText('Recent')).toBeTruthy();

  await type(near!.name);
  await waitFor(() => expect(screen.queryByText('Recent')).toBeNull());
  expect(await screen.findByText('Places')).toBeTruthy();
});

it('opens with the keyboard down, so the nearby places are in view', async () => {
  await renderPicker();
  await screen.findByText('Nearby');
  expect(screen.getByPlaceholderText(PICKER_PLACEHOLDER).props.autoFocus).toBeFalsy();
});

it('tapping a place selects it', async () => {
  const [first] = await api.venues.search({ query: '', near: HERE, limit: 1 });
  const { onSelect } = await renderPicker();
  await fireEvent.press(await screen.findByText(first!.venue.name));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: first!.venue.id }));
});

it('a query matches by name, and the chosen place carries a check and can be removed', async () => {
  const [match] = await api.venues.search({ query: 'yorkville' });
  const { onRemove } = await renderPicker({ selected: match!.venue });

  await type('yorkville');
  expect(await screen.findByText('Places')).toBeTruthy();
  const row = await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) });
  expect(row.props.accessibilityState).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByLabelText(REMOVE_LOCATION));
  expect(onRemove).toHaveBeenCalled();
});

it('nothing matches: it says so, and offers the outside search, which is never automatic', async () => {
  const searchMore = jest.spyOn(api.venues, 'searchMore');
  const { onSelect } = await renderPicker();

  await type('bread');
  expect(await screen.findByText(NO_MATCH)).toBeTruthy();
  expect(searchMore).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText(searchMoreLabel('bread')));
  expect(await screen.findByText('More places')).toBeTruthy();
  await fireEvent.press(await screen.findByText('Bread & Butter Market'));

  // The picked place became a venue, and that venue is what is selected.
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bread & Butter Market' })));
  expect((await api.venues.search({ query: 'bread butter' })).map((m) => m.venue.name)).toEqual(['Bread & Butter Market']);
});

it('typing again disarms the outside search, so each query asks for it once', async () => {
  const searchMore = jest.spyOn(api.venues, 'searchMore');
  await renderPicker();
  await type('bread');
  await fireEvent.press(await screen.findByLabelText(searchMoreLabel('bread')));
  await screen.findByText('Bread & Butter Market');
  expect(searchMore).toHaveBeenCalledTimes(1);

  await type('long hall');
  expect(await screen.findByLabelText(searchMoreLabel('long hall'))).toBeTruthy();
  expect(screen.queryByText('More places')).toBeNull();
  expect(searchMore).toHaveBeenCalledTimes(1);
});

it('a rate limit on the outside search reads as one', async () => {
  await renderPicker();
  await type('bread');
  controls.failNext('rate_limited', 'venues.searchMore');
  await fireEvent.press(await screen.findByLabelText(searchMoreLabel('bread')));
  expect(await screen.findByText(MORE_LIMITED)).toBeTruthy();
});

it('with location denied it explains, and still searches by name', async () => {
  mockPosition = { kind: 'denied' };
  await renderPicker();
  expect(await screen.findByText(LOCATION_OFF)).toBeTruthy();
  expect(screen.queryByText('Nearby')).toBeNull();

  await type('yorkville');
  const [match] = await api.venues.search({ query: 'yorkville' });
  const row = await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) });
  // No position, so no distance on the row.
  expect(row.props.accessibilityLabel).not.toMatch(/ ft| mi/);
});

it('with no position to be had it asks for a name', async () => {
  mockPosition = { kind: 'unavailable' };
  await renderPicker();
  expect(await screen.findByText(PICKER_HINT)).toBeTruthy();
});

it('while the caller saves, rows take no press', async () => {
  const { onSelect } = await renderPicker({ saving: true });
  const rows = await screen.findAllByRole('button', { name: /ft|mi/ });
  await fireEvent.press(rows[0]!);
  expect(onSelect).not.toHaveBeenCalled();
});
