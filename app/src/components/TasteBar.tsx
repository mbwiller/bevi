import type { CategoryId } from '@bevi/shared';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { categoryById } from '@/lib/categories';
import { formatScore } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, scoreColor, useTheme } from '@/theme';

import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';

export interface TasteBarProps {
  categoryId: CategoryId;
  /** The user's average score in the category, 0–10. */
  mean: number;
  rankingCount: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * One category of a Taste Profile: icon and label, "8.1 · 9 ranked" (the score in its band colour) and a
 * 4pt bar filled to mean / 10 in the same colour. Not a button; a screen reader hears one sentence,
 * "Coffee, average 8.1, 9 ranked". The number always shows, so colour is never the only signal.
 */
export function TasteBar({ categoryId, mean, rankingCount, style }: TasteBarProps) {
  const { colors } = useTheme();
  const cat = categoryById(categoryId);
  const label = cat?.label ?? categoryId;
  const tone = scoreColor(mean);
  const score = formatScore(mean);
  return (
    <View accessible accessibilityLabel={`${label}, average ${score}, ${rankingCount} ranked`} style={[styles.bar, style]}>
      <View style={styles.top}>
        <View style={styles.label}>
          {cat ? <Icon name={cat.icon} size={20} strokeWidth={1.75} color={colors.text} /> : null}
          <Text style={[type.body, styles.name, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {label}
          </Text>
        </View>
        <Text style={[type.body, styles.value, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          <Text style={{ color: colors[tone] }}>{score}</Text>
          {` · ${rankingCount} ranked`}
        </Text>
      </View>
      <ProgressBar value={mean / 10} tone={tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { justifyContent: 'center', gap: spacing.xs, minHeight: size.target, paddingVertical: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1, minWidth: 0 },
  value: { flexShrink: 0, fontVariant: ['tabular-nums'] },
});
