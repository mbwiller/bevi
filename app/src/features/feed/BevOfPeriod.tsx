import type { PeriodWinner } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useBevOfPeriod, useMe } from '@/api/hooks';
import { BevOfCard, type BevOfCardPeriod, type BevOfPeriodKind } from '@/components/BevOfCard';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { formatPeriodStart } from '@/lib/time';
import { spacing } from '@/theme';

const PERIODS: BevOfPeriodKind[] = ['day', 'week'];

/** One card in the row: a period's winner, or the one Bev that won both. */
interface Card {
  period: BevOfCardPeriod;
  winner: PeriodWinner;
  date?: string;
}

/** The date line for a winner from an earlier period; the current period shows none. */
function dateOf(winner: PeriodWinner, period: BevOfPeriodKind): string | undefined {
  return winner.isCurrent ? undefined : formatPeriodStart(winner.periodStart, period);
}

/**
 * The row's cards. When the same Bev won the day and the week it is one `both` card, never the same Bev
 * twice side by side. Its date is the day's when the day is an earlier one (that day lies in the week
 * that also won, and is the more exact of the two), else the week's; with both current, none.
 */
export function bevOfPeriodCards(day: PeriodWinner | null, week: PeriodWinner | null): Card[] {
  if (day && week && day.bev.id === week.bev.id) {
    return [{ period: 'both', winner: day, date: dateOf(day, 'day') ?? dateOf(week, 'week') }];
  }
  return PERIODS.flatMap((period) => {
    const winner = period === 'day' ? day : week;
    return winner ? [{ period, winner, date: dateOf(winner, period) }] : [];
  });
}

/**
 * M-05: Bev of the day and Bev of the week, side by side under the Feed's search bar (the slot
 * Featured Bevs had). A winner from an earlier period carries its date. The same Bev winning both is
 * one card, "Bev of the day and week", at the width one of the pair has. Like Featured before it, this
 * is a nice-to-have above the feed: no winner at all, or an error, leaves the row out.
 */
export function BevOfPeriod() {
  const router = useRouter();
  const query = useBevOfPeriod();
  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;

  if (query.isPending) {
    return (
      <View style={styles.pair} testID="bev-of-period-loading">
        {PERIODS.map((p) => (
          <View key={p} style={styles.slot}>
            <Skeleton variant="block" width="100%" style={styles.fill} />
          </View>
        ))}
      </View>
    );
  }
  if (query.isError) return null;

  // The server age-filters already; hide alcohol client-side too (§6.17), as Featured did.
  const visible = (winner: PeriodWinner | null) =>
    winner && (canSeeAlcohol || !categoryById(winner.bev.categoryId)?.isAlcoholic) ? winner : null;
  const cards = bevOfPeriodCards(visible(query.data.day), visible(query.data.week));
  if (cards.length === 0) return null;

  return (
    <View style={styles.pair} testID="bev-of-period">
      {cards.map(({ period, winner, date }) => (
        <BevOfCard
          key={period}
          period={period}
          bev={winner.bev}
          score={winner.bev.bayesScore}
          date={date}
          onPress={() => router.push({ pathname: '/bev/[id]', params: { id: winner.bev.id } })}
        />
      ))}
      {/* A lone card (one winner, or one Bev that won both) keeps half the row, on the left. */}
      {cards.length === 1 ? <View style={styles.half} testID="bev-of-period-spacer" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // bundle.css `.bv-bevof-pair`.
  pair: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  half: { flex: 1 },
  slot: { flex: 1, aspectRatio: 1 },
  fill: { height: '100%' },
});
