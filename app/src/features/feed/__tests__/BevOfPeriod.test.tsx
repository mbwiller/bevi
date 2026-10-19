import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { BevOfPeriod as BevOfPeriodData, PeriodWinner } from '@bevi/shared';

import { api } from '@/api/client';
import { useSubmitRanking } from '@/api/hooks';
import { bevOfCardLabel } from '@/components/BevOfCard';
import { formatPeriodStart } from '@/lib/time';
import { MINOR, controls } from '@/testing/fakeApi';

import { BevOfPeriod } from '../BevOfPeriod';

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

/** Just the row, on a tiny route tree: the whole Feed is covered by Feed.test.tsx. */
async function start() {
  const result = renderRouter({ _layout: Layout, index: BevOfPeriod, 'bev/[id]': Stub }, { initialUrl: '/' });
  await result;
  return { path: () => result.getPathnameWithParams() };
}

function cardName(period: 'day' | 'week', w: PeriodWinner): string {
  return bevOfCardLabel(period, w.bev.name, w.bev.bayesScore, w.isCurrent ? undefined : formatPeriodStart(w.periodStart, period));
}

async function winners(): Promise<BevOfPeriodData> {
  const period = await api.feed.getBevOfPeriod();
  expect(period.day && period.week).toBeTruthy();
  return period;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

it('shows both cards and opens the Bev from one', async () => {
  const { day, week } = await winners();
  const r = await start();
  const row = await screen.findByTestId('bev-of-period');
  expect(within(row).getByLabelText(cardName('week', week!))).toBeTruthy();
  await fireEvent.press(within(row).getByLabelText(cardName('day', day!)));
  expect(r.path()).toBe(`/bev/${day!.bev.id}`);
});

it('each card takes half the row and its tile follows that width: no fixed width, so the pair fits any phone', async () => {
  // jest has no layout engine, so a 320pt-wide check can't measure positions; this checks the styles
  // that make two cards share any width instead.
  const { day, week } = await winners();
  await start();
  for (const name of [cardName('day', day!), cardName('week', week!)]) {
    const card = StyleSheet.flatten((await screen.findByLabelText(name)).props.style);
    expect(card).toMatchObject({ flex: 1, minWidth: 0 });
    expect(card.width).toBeUndefined();
  }
  for (const bev of [day!.bev, week!.bev]) {
    const tile = screen.getAllByRole('image').find((n) => n.props.accessibilityLabel === bev.name)!;
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({ width: '100%', height: '100%' });
    expect(StyleSheet.flatten(tile.parent!.props.style)).toMatchObject({ width: '100%', aspectRatio: 1 });
  }
});

it('no winner in either period: the row is left out', async () => {
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: null, week: null });
  await start();
  await waitFor(() => expect(screen.queryByTestId('bev-of-period-loading')).toBeNull());
  expect(screen.queryByTestId('bev-of-period')).toBeNull();
});

it('only a week winner from an earlier week: one card on the left with its date, half the row', async () => {
  const { week } = await winners();
  const old: PeriodWinner = { ...week!, periodStart: '2026-10-05', isCurrent: false };
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: null, week: old });
  await start();
  const row = await screen.findByTestId('bev-of-period');
  expect(within(row).getAllByRole('button')).toHaveLength(1);
  expect(within(row).getByText(formatPeriodStart('2026-10-05', 'week'))).toBeTruthy();
  expect(within(row).queryByText('Bev of the day')).toBeNull();
  // The spacer after it takes the other half.
  expect(StyleSheet.flatten(within(row).getByTestId('bev-of-period-spacer').props.style)).toMatchObject({ flex: 1 });
});

it('an error hides the row quietly', async () => {
  controls.failNext('network', 'feed.getBevOfPeriod');
  await start();
  await waitFor(() => expect(screen.queryByTestId('bev-of-period-loading')).toBeNull());
  expect(screen.queryByTestId('bev-of-period')).toBeNull();
  expect(screen.queryByText(/couldn't|try again/i)).toBeNull();
});

it('under 21: an alcoholic day winner is hidden client-side; the week card stays, alone at half width', async () => {
  const { week } = await winners();
  const beer: PeriodWinner = { ...week!, bev: { ...week!.bev, id: 'beer-winner', name: 'Pilsner', categoryId: 'beer' } };
  controls.signInAs(MINOR.handle);
  expect((await api.profile.getMe()).canSeeAlcohol).toBe(false);
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: beer, week: week! });
  await start();
  const row = await screen.findByTestId('bev-of-period');
  expect(within(row).getAllByRole('button')).toHaveLength(1);
  expect(within(row).getByLabelText(cardName('week', week!))).toBeTruthy();
  expect(within(row).queryByText('Pilsner')).toBeNull();
  expect(within(row).queryByText('Bev of the day')).toBeNull();
  expect(StyleSheet.flatten(within(row).getByTestId('bev-of-period-spacer').props.style)).toMatchObject({ flex: 1 });
});

it('a ranking refetches the winners (invalidates keys.bevOfPeriod)', async () => {
  const fetches = jest.spyOn(api.feed, 'getBevOfPeriod');
  // Only the mutation's settling matters here, not what the server does with it.
  jest.spyOn(api.rankings, 'submitRanking').mockResolvedValue({} as Awaited<ReturnType<typeof api.rankings.submitRanking>>);
  function RowAndRank() {
    const submit = useSubmitRanking();
    return (
      <>
        <BevOfPeriod />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rank"
          onPress={() => submit.mutate({ bevId: 'any', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] })}
        >
          <Text>Rank</Text>
        </Pressable>
      </>
    );
  }
  await renderRouter({ _layout: Layout, index: RowAndRank }, { initialUrl: '/' });
  await screen.findByTestId('bev-of-period');
  expect(fetches).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText('Rank'));
  await waitFor(() => expect(fetches).toHaveBeenCalledTimes(2));
});
