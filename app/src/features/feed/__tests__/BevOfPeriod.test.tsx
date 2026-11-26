import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { BevOfPeriod as BevOfPeriodData, PeriodWinner } from '@bevi/shared';

import { api } from '@/api/client';
import { useSubmitRanking } from '@/api/hooks';
import { bevOfCardLabel } from '@/components/BevOfCard';
import { categoryById } from '@/lib/categories';
import { formatPeriodStart } from '@/lib/time';
import { MINOR, controls } from '@/testing/fakeApi';

import { BevOfPeriod, bevOfPeriodCards } from '../BevOfPeriod';

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

/** The fixture's winners as they are: today the same Bev won the day and the week. */
async function fixtureWinners(): Promise<BevOfPeriodData> {
  const period = await api.feed.getBevOfPeriod();
  expect(period.day && period.week).toBeTruthy();
  return period;
}

/**
 * Two different winners, for the pair: the fixture's day winner, and for the week another Bev from
 * the leaderboard when the fixture's week winner is the same Bev. The screen is served these.
 */
async function winners(): Promise<BevOfPeriodData> {
  const period = await fixtureWinners();
  if (period.day!.bev.id !== period.week!.bev.id) return period;
  const board = await api.leaderboard.bevs();
  const other = board.items.map((r) => r.bev).find((b) => b.id !== period.day!.bev.id && !categoryById(b.categoryId)?.isAlcoholic)!;
  expect(other).toBeTruthy();
  const pair: BevOfPeriodData = { day: period.day, week: { ...period.week!, bev: other } };
  jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue(pair);
  return pair;
}

// Pin "now" (Date only; timers stay real), as Profile.test does, at Sunday noon in New York: the fixture dates its
// rankings back from now, and from 00:20 to 00:43 there only the newest is in the latest day, so day and week differ.
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

// BEV-10: one Bev winning both periods used to merge into one "Bev of the day and week" card, alone on the
// left, which read as a missing winner. It is two cards, as for any other pair.
describe('the same Bev won the day and the week', () => {
  /** The fixture's two winners, made into one Bev if they aren't already: the week's winner is the day's. */
  async function sameBev(day: Partial<PeriodWinner> = {}, week: Partial<PeriodWinner> = {}) {
    const w = await fixtureWinners();
    const same: BevOfPeriodData = { day: { ...w.day!, ...day }, week: { ...w.week!, bev: w.day!.bev, ...week } };
    jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue(same);
    return same;
  }

  it('the fixture as it is: its day and week winners are one Bev, and the row is still two cards', async () => {
    const { day, week } = await fixtureWinners();
    expect(week!.bev.id).toBe(day!.bev.id);
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(within(row).getByLabelText(cardName('day', day!))).toBeTruthy();
    expect(within(row).getByLabelText(cardName('week', week!))).toBeTruthy();
  });

  it('shows the Bev twice, as "Bev of the day" and "Bev of the week", each half the row, and either opens it', async () => {
    const { day, week } = await sameBev({ isCurrent: true }, { isCurrent: true });
    const r = await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(within(row).getByText('Bev of the day')).toBeTruthy();
    expect(within(row).getByText('Bev of the week')).toBeTruthy();
    expect(within(row).queryByText('Bev of the day and week')).toBeNull();
    expect(within(row).getAllByText(day!.bev.name)).toHaveLength(2);
    // A full pair: both cards share the row and no spacer holds a half open.
    for (const name of [cardName('day', day!), cardName('week', week!)]) {
      expect(StyleSheet.flatten(within(row).getByLabelText(name).props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    }
    expect(within(row).queryByTestId('bev-of-period-spacer')).toBeNull();
    await fireEvent.press(within(row).getByLabelText(cardName('week', week!)));
    expect(r.path()).toBe(`/bev/${day!.bev.id}`);
  });

  it('both from earlier periods: each card carries its own date', async () => {
    await sameBev({ periodStart: '2026-10-14', isCurrent: false }, { periodStart: '2026-10-12', isCurrent: false });
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(within(row).getByText(formatPeriodStart('2026-10-14', 'day'))).toBeTruthy();
    expect(within(row).getByText(formatPeriodStart('2026-10-12', 'week'))).toBeTruthy();
  });

  it('one win current and the other earlier: two cards, only the earlier one dated', async () => {
    const { day } = await sameBev({ isCurrent: true }, { periodStart: '2026-10-12', isCurrent: false });
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(within(row).getByLabelText(bevOfCardLabel('day', day!.bev.name, day!.bev.bayesScore))).toBeTruthy();
    expect(
      within(row).getByLabelText(bevOfCardLabel('week', day!.bev.name, day!.bev.bayesScore, formatPeriodStart('2026-10-12', 'week'))),
    ).toBeTruthy();
  });

  it('under 21 and alcoholic: both cards are hidden and the row left out', async () => {
    const { week } = await winners();
    const beer: PeriodWinner = { ...week!, bev: { ...week!.bev, id: 'beer-winner', name: 'Pilsner', categoryId: 'beer' } };
    controls.signInAs(MINOR.handle);
    jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue({ day: beer, week: { ...beer } });
    await start();
    await waitFor(() => expect(screen.queryByTestId('bev-of-period-loading')).toBeNull());
    expect(screen.queryByTestId('bev-of-period')).toBeNull();
  });
});

describe('bevOfPeriodCards', () => {
  it('two different winners are two cards, day first; one side alone is one card', async () => {
    const { day, week } = await winners();
    expect(bevOfPeriodCards(day, week).map((c) => c.period)).toEqual(['day', 'week']);
    expect(bevOfPeriodCards(null, week).map((c) => c.period)).toEqual(['week']);
    expect(bevOfPeriodCards(day, null).map((c) => c.period)).toEqual(['day']);
    expect(bevOfPeriodCards(null, null)).toEqual([]);
  });

  describe('the same Bev won both: always two cards, each dated only when its own period is an earlier one', () => {
    // Built before the clock is pinned (a describe body runs first), so they are given the pinned now.
    const DAY = formatPeriodStart('2026-10-14', 'day', FIXED_NOW);
    const WEEK = formatPeriodStart('2026-10-12', 'week', FIXED_NOW);

    it.each([
      [true, true, undefined, undefined],
      [false, false, DAY, WEEK],
      [true, false, undefined, WEEK],
      [false, true, DAY, undefined],
    ])('day current %s, week current %s', async (dayCurrent, weekCurrent, dayDate, weekDate) => {
      const { day, week } = await winners();
      const cards = bevOfPeriodCards(
        { ...day!, isCurrent: dayCurrent, periodStart: '2026-10-14' },
        { ...week!, bev: day!.bev, isCurrent: weekCurrent, periodStart: '2026-10-12' },
      );
      expect(cards.map((c) => [c.period, c.date])).toEqual([
        ['day', dayDate],
        ['week', weekDate],
      ]);
      expect(cards.map((c) => c.winner.bev.id)).toEqual([day!.bev.id, day!.bev.id]);
    });
  });
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
