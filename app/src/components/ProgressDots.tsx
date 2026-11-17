import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, useTheme } from '@/theme';

export interface ProgressDotsProps {
  /** One dot per possible comparison: the placement's `maxSteps`, which is `maxComparisons(n)` for a plain search and the larger anchored bound with tiers (@bevi/ranking). */
  total: number;
  /** 0-based index of the comparison on screen. It can finish early: binary search often needs fewer. */
  current: number;
  style?: StyleProp<ViewStyle>;
}

// Dot geometry from bundle.css (`.bv-dot`); no token names these.
const DOT = 8;
const DOT_NOW = 20;
const GAP = 6;
const RING = 1.5;

/** Comparison progress for the ranking flow: done dots filled, the current one stretched. */
export function ProgressDots({ total, current, style }: ProgressDotsProps) {
  const { colors } = useTheme();
  const shown = Math.min(current + 1, total);
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Comparison ${shown} of up to ${total}`}
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          testID="progress-dot"
          style={[
            styles.dot,
            i === current && styles.now,
            i <= current ? { backgroundColor: colors.primary } : { borderWidth: RING, borderColor: colors.borderStrong },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
  now: { width: DOT_NOW },
});
