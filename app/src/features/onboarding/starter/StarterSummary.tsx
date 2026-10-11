import { FlashList } from '@shopify/flash-list';
import type { RankedBev } from '@bevi/shared';
import { StyleSheet, Text, View } from 'react-native';

import { BevRow } from '@/components/BevRow';
import { Button } from '@/components/Button';
import { FormError } from '@/features/auth/AuthScreen';
import { formErrorMessage } from '@/features/auth/formError';
import { formatScore } from '@/lib/format';
import { spacing, type, useTheme } from '@/theme';

import { STARTER_COPY, summaryTitle } from './copy';

export interface StarterSummaryProps {
  /** The user's rankings, best first. */
  rankings: readonly RankedBev[];
  finishing: boolean;
  finishError?: unknown;
  onFinish: () => void;
  onRankMore: () => void;
}

/** The finished starter set (§6.3): "You ranked 6 Bevs. Your top: Coke 8.3", the list, then the feed. */
export function StarterSummary({ rankings, finishing, finishError, onFinish, onRankMore }: StarterSummaryProps) {
  const { colors } = useTheme();
  const top = rankings[0];
  return (
    <View style={styles.fill}>
      <FlashList
        data={rankings as RankedBev[]}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => (
          <BevRow bev={item.bev} number={index + 1} score={item.score} bucket={item.bucket} divider={index < rankings.length - 1} />
        )}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text style={[type.displayDrop, { color: colors.text }]} accessibilityRole="header">
              {summaryTitle(rankings.length)}
            </Text>
            {top ? (
              <Text style={[type.bodyLarge, { color: colors.textSecondary }]}>
                Your top: {top.bev.name} {formatScore(top.score)}
              </Text>
            ) : null}
          </View>
        }
      />
      <View style={[styles.foot, { borderTopColor: colors.border }]}>
        <FormError>{finishError ? formErrorMessage(finishError) : null}</FormError>
        <Button variant="primary" block loading={finishing} onPress={onFinish}>
          {STARTER_COPY.finish}
        </Button>
        <Button variant="outlined" block size="lg" disabled={finishing} onPress={onRankMore}>
          {STARTER_COPY.rankMore}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { gap: spacing.xs, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.md },
  foot: { gap: spacing.md, padding: spacing.gutter, borderTopWidth: 1 },
});
