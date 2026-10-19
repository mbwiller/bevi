import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatTried, spokenTried } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, size, spacing, type, useTheme } from '@/theme';

import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';

export interface ProgressStripProps {
  /** The scoped category's label, or "All Bevs". */
  label?: string;
  ranked: number;
  total: number;
  /** Opens the CollectionSheet; without it the strip is plain text. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Bev'd's progress line under the filters: "Soda · 4 of 61 tried · 6%" over a 4pt `primary` bar.
 * With `onPress` it is a button (chevron right) that opens the CollectionSheet.
 */
export function ProgressStrip({ label = 'All Bevs', ranked, total, onPress, style }: ProgressStripProps) {
  const { colors } = useTheme();
  const name = `${label}, ${spokenTried(ranked, total)}${onPress ? '. Show your collection' : ''}`;
  const body = (
    <>
      <View style={styles.top}>
        <Text style={[type.body, styles.text, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
          {`${label} · ${formatTried(ranked, total)}`}
        </Text>
        {onPress ? <Icon name="chevron-right" size={20} strokeWidth={2} color={colors.textSecondary} /> : null}
      </View>
      <ProgressBar value={total > 0 ? ranked / total : 0} />
    </>
  );
  const boxStyle = [styles.strip, { backgroundColor: colors.surface }, style];
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name} style={boxStyle}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={name} style={boxStyle}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: size.target,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.gutter,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1, minWidth: 0, fontVariant: ['tabular-nums'] },
});
