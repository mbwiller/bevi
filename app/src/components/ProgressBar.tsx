import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, useTheme, type ScoreColorName } from '@/theme';

/** bundle.css `.bv-progress-track { height: 4px }`. */
const BAR_HEIGHT = 4;

export interface ProgressBarProps {
  /** 0–1; clamped. */
  value: number;
  /** The fill's colour: `primary` (default), or a score band (the TasteBar). */
  tone?: 'primary' | ScoreColorName;
  style?: StyleProp<ViewStyle>;
}

/** A 4pt track in `input` with a `primary` fill: a share you've earned. `tone` recolours the fill with a score band. Decorative; its parent says the number. */
export function ProgressBar({ value, tone = 'primary', style }: ProgressBarProps) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" style={[styles.track, { backgroundColor: colors.input }, style]}>
      <View testID="progress-fill" style={[styles.fill, { width: `${pct}%`, backgroundColor: colors[tone] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: BAR_HEIGHT, overflow: 'hidden', borderRadius: radius.pill },
  fill: { height: '100%', borderRadius: radius.pill },
});
