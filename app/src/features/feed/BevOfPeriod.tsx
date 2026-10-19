import type { PeriodWinner } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useBevOfPeriod, useMe } from '@/api/hooks';
import { BevOfCard, type BevOfPeriodKind } from '@/components/BevOfCard';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { formatPeriodStart } from '@/lib/time';
import { spacing } from '@/theme';

const PERIODS: BevOfPeriodKind[] = ['day', 'week'];

/**
 * M-05: Bev of the day and Bev of the week, side by side under the Feed's search bar (the slot
 * Featured Bevs had). A winner from an earlier period carries its date. Like Featured before it, this
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
  const cards = PERIODS.flatMap((period) => {
    const winner: PeriodWinner | null = query.data[period];
    if (!winner || (!canSeeAlcohol && categoryById(winner.bev.categoryId)?.isAlcoholic)) return [];
    return [{ period, winner }];
  });
  if (cards.length === 0) return null;

  return (
    <View style={styles.pair} testID="bev-of-period">
      {cards.map(({ period, winner }) => (
        <BevOfCard
          key={period}
          period={period}
          bev={winner.bev}
          score={winner.bev.bayesScore}
          date={winner.isCurrent ? undefined : formatPeriodStart(winner.periodStart, period)}
          onPress={() => router.push({ pathname: '/bev/[id]', params: { id: winner.bev.id } })}
        />
      ))}
      {/* A lone winner keeps half the row, on the left. */}
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
