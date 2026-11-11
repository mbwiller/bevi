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

describe('the same Bev won the day and the week', () => {
  /** The fixture's two winners, made into one Bev if they aren't already: the week's winner is the day's. */
  async function sameBev(day: Partial<PeriodWinner> = {}, week: Partial<PeriodWinner> = {}) {
    const w = await fixtureWinners();
    const both: BevOfPeriodData = { day: { ...w.day!, ...day }, week: { ...w.week!, bev: w.day!.bev, ...week } };
    jest.spyOn(api.feed, 'getBevOfPeriod').mockResolvedValue(both);
    return both;
  }

  it('the fixture as it is: its day and week winners are one Bev, so the row is one card', async () => {
    const { day, week } = await fixtureWinners();
    expect(week!.bev.id).toBe(day!.bev.id);
    // Both wins are from the same kind of period (current or earlier), so they merge.
    expect(week!.isCurrent).toBe(day!.isCurrent);
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByText('Bev of the day and week')).toBeTruthy();
  });

  it('shows one card, "Bev of the day and week", at half the row, and it opens the Bev', async () => {
    const { day } = await sameBev({ isCurrent: true }, { isCurrent: true });
    const r = await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(1);
    expect(within(row).getByText('Bev of the day and week')).toBeTruthy();
    expect(within(row).queryByText('Bev of the day')).toBeNull();
    expect(within(row).queryByText('Bev of the week')).toBeNull();
    expect(within(row).getAllByText(day!.bev.name)).toHaveLength(1);
    const card = within(row).getByRole('button');
    expect(card.props.accessibilityLabel).toBe(bevOfCardLabel('both', day!.bev.name, day!.bev.bayesScore));
    // One card of the pair's width: flex 1 beside the half-row spacer.
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(StyleSheet.flatten(within(row).getByTestId('bev-of-period-spacer').props.style)).toMatchObject({ flex: 1 });
    await fireEvent.press(card);
    expect(r.path()).toBe(`/bev/${day!.bev.id}`);
  });

  it('from an earlier day: the card carries the day\'s date', async () => {
    await sameBev({ periodStart: '2026-10-14', isCurrent: false }, { periodStart: '2026-10-12', isCurrent: false });
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getByText(formatPeriodStart('2026-10-14', 'day'))).toBeTruthy();
    expect(within(row).queryByText(formatPeriodStart('2026-10-12', 'week'))).toBeNull();
  });

  it('one win current and the other earlier: the usual two cards, each with its own label and date', async () => {
    const { day } = await sameBev({ isCurrent: true }, { periodStart: '2026-10-12', isCurrent: false });
    await start();
    const row = await screen.findByTestId('bev-of-period');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(within(row).queryByText('Bev of the day and week')).toBeNull();
    expect(within(row).getByLabelText(bevOfCardLabel('day', day!.bev.name, day!.bev.bayesScore))).toBeTruthy();
    expect(
      within(row).getByLabelText(bevOfCardLabel('week', day!.bev.name, day!.bev.bayesScore, formatPeriodStart('2026-10-12', 'week'))),
    ).toBeTruthy();
  });

  it('under 21 and alcoholic: the one card is hidden and the row left out', async () => {
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
  it('two different winners stay two cards, day first; one side alone is one card', async () => {
    const { day, week } = await winners();
    expect(bevOfPeriodCards(day, week).map((c) => c.period)).toEqual(['day', 'week']);
    expect(bevOfPeriodCards(null, week).map((c) => c.period)).toEqual(['week']);
    expect(bevOfPeriodCards(day, null).map((c) => c.period)).toEqual(['day']);
    expect(bevOfPeriodCards(null, null)).toEqual([]);
  });

  describe('the same Bev won both', () => {
    async function pair(dayCurrent: boolean, weekCurrent: boolean) {
      const { day, week } = await winners();
      return bevOfPeriodCards(
        { ...day!, isCurrent: dayCurrent, periodStart: '2026-10-14' },
        { ...week!, bev: day!.bev, isCurrent: weekCurrent, periodStart: '2026-10-12' },
      );
    }

    it('both current: one "both" card with no date', async () => {
      const cards = await pair(true, true);
      expect(cards.map((c) => c.period)).toEqual(['both']);
      expect(cards[0]!.date).toBeUndefined();
    });

    it("both from earlier periods: one \"both\" card with the day's date", async () => {
      const cards = await pair(false, false);
      expect(cards.map((c) => c.period)).toEqual(['both']);
      expect(cards[0]!.date).toBe(formatPeriodStart('2026-10-14', 'day'));
    });

    it("the day current, the week from an earlier week: two cards, only the week's dated", async () => {
      const cards = await pair(true, false);
      expect(cards.map((c) => [c.period, c.date])).toEqual([
        ['day', undefined],
        ['week', formatPeriodStart('2026-10-12', 'week')],
      ]);
    });

    it("the week current, the day from an earlier day: two cards, only the day's dated", async () => {
      const cards = await pair(false, true);
      expect(cards.map((c) => [c.period, c.date])).toEqual([
        ['day', formatPeriodStart('2026-10-14', 'day')],
        ['week', undefined],
      ]);
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
