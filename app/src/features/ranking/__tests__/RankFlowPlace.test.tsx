// Where a Bev was had, in the ranking flow (BEV-22): the note step's location row, the picker, the
// nearby suggestion, and what each sends. Its own file because it replaces the position module,
// which RankFlow.test.tsx leaves as jest resolves it (no provider, so no suggestion there).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { BevSummary } from '@bevi/shared';

import { api } from '@/api/client';
import { ADD_LOCATION, PICKER_PLACEHOLDER, REMOVE_LOCATION } from '@/features/places/copy';
import type { PositionPermission, PositionResult } from '@/features/places/position';
import { controls } from '@/testing/fakeApi';

import { RankFlow } from '../RankFlow';

const mockRouter = { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => true,
}));

// The first seeded venue's own position: standing in it.
const HERE = { lat: 40.7762, lng: -73.9495 };
let mockPosition: PositionResult = { kind: 'unavailable' };
let mockPermission: PositionPermission = 'prompt';
jest.mock('@/features/places/position', () => ({
  ...jest.requireActual('@/features/places/position'),
  currentPosition: async () => mockPosition,
  positionPermission: async () => mockPermission,
}));

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);
let client: QueryClient;
let bev: BevSummary;

beforeEach(async () => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  // No rankings: every bucket is empty, so the flow goes from the gut check straight to the note.
  controls.emptyUser();
  mockPosition = { kind: 'unavailable' };
  mockPermission = 'prompt';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const page = await api.bevs.search({ q: 'a', limit: 50 });
  bev = page.items.find((b) => !['beer', 'wine', 'spirits_cocktails'].includes(b.categoryId))!;
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

async function toNoteStep(bevId = bev.id) {
  await render(
    <QueryClientProvider client={client}>
      <RankFlow bevId={bevId} />
    </QueryClientProvider>,
  );
  await screen.findByText('How was it?');
  await fireEvent.press(screen.getByLabelText('It was okay'));
  await screen.findByText('First one in Fine', {}, { timeout: 3000 });
}

const venueOf = async (bevId: string) => (await api.rankings.listMine()).items.find((r) => r.bev.id === bevId)?.venue ?? null;

it('the note step offers Add location; a place picked there is saved with the ranking', async () => {
  const [match] = await api.venues.search({ query: 'yorkville' });
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNoteStep();

  await fireEvent.press(screen.getByRole('button', { name: ADD_LOCATION }));
  await fireEvent.changeText(await screen.findByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));

  // Back on the step, the row now names the place.
  expect(await screen.findByRole('button', { name: `Location: ${match!.venue.name}. Change` })).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');

  expect(submit.mock.calls[0]![0]).toMatchObject({ bevId: bev.id, venueId: match!.venue.id });
  expect((await venueOf(bev.id))?.id).toBe(match!.venue.id);
});

it('Skip skips the note, not the place', async () => {
  const [match] = await api.venues.search({ query: 'yorkville' });
  await toNoteStep();
  await fireEvent.press(screen.getByRole('button', { name: ADD_LOCATION }));
  await fireEvent.changeText(await screen.findByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));
  await screen.findByRole('button', { name: `Location: ${match!.venue.name}. Change` });

  await fireEvent.press(screen.getByLabelText('Skip'));
  await screen.findByText('Done');
  expect((await venueOf(bev.id))?.id).toBe(match!.venue.id);
});

it('a place chosen and then removed saves none', async () => {
  const [match] = await api.venues.search({ query: 'yorkville' });
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNoteStep();
  await fireEvent.press(screen.getByRole('button', { name: ADD_LOCATION }));
  await fireEvent.changeText(await screen.findByPlaceholderText(PICKER_PLACEHOLDER), 'yorkville');
  await fireEvent.press(await screen.findByRole('button', { name: new RegExp(`^${match!.venue.name}`) }));

  await fireEvent.press(await screen.findByRole('button', { name: `Location: ${match!.venue.name}. Change` }));
  await fireEvent.press(await screen.findByLabelText(REMOVE_LOCATION));
  expect(await screen.findByRole('button', { name: ADD_LOCATION })).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('venueId');
  expect(await venueOf(bev.id)).toBeNull();
});

it('with the position already allowed, the venue you are standing in is offered and one tap takes it', async () => {
  mockPosition = { kind: 'ok', position: HERE };
  mockPermission = 'granted';
  const [nearest] = await api.venues.search({ query: '', near: HERE, limit: 1 });
  expect(nearest!.distanceMeters).toBeLessThan(120);
  const submit = jest.spyOn(api.rankings, 'submitRanking');
  await toNoteStep();

  await fireEvent.press(await screen.findByRole('button', { name: `Add location: ${nearest!.venue.name}` }));
  expect(await screen.findByRole('button', { name: `Location: ${nearest!.venue.name}. Change` })).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Save'));
  await screen.findByText('Done');
  expect(submit.mock.calls[0]![0]).toMatchObject({ venueId: nearest!.venue.id });
});

it('nothing is suggested when asking would mean a permission prompt, or when nothing is close', async () => {
  mockPosition = { kind: 'ok', position: HERE };
  mockPermission = 'prompt';
  await toNoteStep();
  expect(screen.getByRole('button', { name: ADD_LOCATION })).toBeTruthy();
  expect(screen.queryByText(/^At .*\?$/)).toBeNull();
});

it('nothing is suggested from across town', async () => {
  mockPosition = { kind: 'ok', position: { lat: 40.60, lng: -74.05 } };
  mockPermission = 'granted';
  await toNoteStep();
  // Give the quiet lookup time to answer before asserting it offered nothing.
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByRole('button', { name: ADD_LOCATION })).toBeTruthy();
  expect(screen.queryByText(/^At .*\?$/)).toBeNull();
});

describe('a re-rank', () => {
  let kept: { id: string; name: string };
  let other: { id: string; name: string };

  beforeEach(async () => {
    const [a] = await api.venues.search({ query: 'yorkville' });
    const b = (await api.venues.search({ query: '', near: HERE, limit: 5 })).find((m) => m.venue.id !== a!.venue.id)!;
    kept = a!.venue;
    other = b.venue;
    await api.rankings.submitRanking({ bevId: bev.id, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [], venueId: kept.id });
  });

  it('shows the place the Bev has and, left alone, sends nothing about it: the server keeps it', async () => {
    const rerank = jest.spyOn(api.rankings, 'rerankBev');
    await toNoteStep();
    expect(await screen.findByRole('button', { name: `Location: ${kept.name}. Change` })).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText('Done');
    expect(rerank.mock.calls[0]![0]).not.toHaveProperty('venueId');
    expect((await venueOf(bev.id))?.id).toBe(kept.id);
  });

  it('changing it sends the new venue', async () => {
    await toNoteStep();
    await fireEvent.press(await screen.findByRole('button', { name: `Location: ${kept.name}. Change` }));
    await fireEvent.changeText(await screen.findByPlaceholderText(PICKER_PLACEHOLDER), other.name);
    const sheet = await screen.findByTestId('sheet');
    await fireEvent.press(await within(sheet).findByRole('button', { name: new RegExp(`^${other.name}`) }));
    await screen.findByRole('button', { name: `Location: ${other.name}. Change` });

    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText('Done');
    expect((await venueOf(bev.id))?.id).toBe(other.id);
  });

  it('removing it sends null, which clears it', async () => {
    const rerank = jest.spyOn(api.rankings, 'rerankBev');
    await toNoteStep();
    await fireEvent.press(await screen.findByRole('button', { name: `Location: ${kept.name}. Change` }));
    await fireEvent.press(await screen.findByLabelText(REMOVE_LOCATION));
    await screen.findByRole('button', { name: ADD_LOCATION });

    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByText('Done');
    expect(rerank.mock.calls[0]![0]).toMatchObject({ venueId: null });
    expect(await venueOf(bev.id)).toBeNull();
  });
});
