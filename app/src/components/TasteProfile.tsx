import type { TasteProfileRow } from '@bevi/shared';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';

import { TasteBar } from './TasteBar';

export interface TasteProfileProps {
  /** `stats.getTasteProfile(userId)`, already sorted by mean, highest first. Not re-sorted here. */
  rows: readonly Pick<TasteProfileRow, 'categoryId' | 'mean' | 'rankingCount'>[];
  /** The one-line preference read-out ("You prefer coffee and boba over soda"); the app writes it. */
  readout?: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Taste Profile tab's block: an optional one-line read-out over a TasteBar per category, high to
 * low, on the 16pt gutter. Empty `rows` render nothing; the screen shows its EmptyState.
 */
export function TasteProfile({ rows, readout, style }: TasteProfileProps) {
  const { colors } = useTheme();
  if (rows.length === 0) return null;
  return (
    <View style={[styles.block, { backgroundColor: colors.surface }, style]}>
      {readout ? (
        <Text style={[type.body, styles.readout, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {readout}
        </Text>
      ) : null}
      <View style={styles.list}>
        {rows.map((r) => (
          <TasteBar key={r.categoryId} categoryId={r.categoryId} mean={r.mean} rankingCount={r.rankingCount} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.gutter },
  readout: { marginBottom: spacing.xs },
  list: { gap: spacing.sm },
});
