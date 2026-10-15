import type { Bucket } from '@bevi/ranking';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { formatScore } from '@/lib/format';
import { radius, scoreColor, size as sizes, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface ScoreBubbleProps {
  /** 0–10; colour follows the bucket band (≥ 7 high, ≥ 4 mid, else low). null shows the lock. */
  score?: number | null;
  size?: 40 | 56;
  variant?: 'default' | 'predicted' | 'locked';
  /** The user's own bucket when known: colour is the bucket, not the band (app addition, see `scoreColor`). */
  bucket?: Bucket;
  /**
   * Distinguishes this bubble's accessible label from a sibling bubble shown on the same screen
   * (e.g. "Bevi score" vs. "Your score"). Only affects the `locked` label, the one case where two
   * bubbles can otherwise read identically ("Score hidden") with nothing to tell them apart. Omit
   * when there's only one bubble in view.
   */
  context?: string;
  style?: StyleProp<ViewStyle>;
}

const NUM: Record<40 | 56, { default: TextStyle; predicted: TextStyle }> = {
  40: {
    default: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
    predicted: { fontSize: 14, lineHeight: 22, letterSpacing: -0.4 },
  },
  56: {
    default: { fontSize: 22, lineHeight: 26, letterSpacing: -0.3 },
    predicted: { fontSize: 19, lineHeight: 26, letterSpacing: -0.3 },
  },
};

/** Beli's score mark: a `surface` circle with a 2pt ring and the score in its bucket colour. */
export function ScoreBubble({ score, size = 40, variant = 'default', bucket, context, style }: ScoreBubbleProps) {
  const { colors } = useTheme();
  const locked = variant === 'locked' || score == null;
  const predicted = variant === 'predicted' && !locked;
  const dim = size === 56 ? sizes.scoreBubbleLg : sizes.scoreBubble;
  const label = locked
    ? context ? `${context} hidden` : 'Score hidden'
    : `${predicted ? 'Predicted score ' : 'Score '}${formatScore(score)}`;
  return (
    <View
      style={[
        styles.bubble,
        {
          width: dim,
          height: dim,
          backgroundColor: colors.surface,
          borderColor: predicted ? colors.textSecondary : colors.border,
          borderStyle: predicted ? 'dotted' : 'solid',
        },
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {locked ? (
        <Icon name="lock" size={size === 56 ? 22 : 18} strokeWidth={2} color={colors.textSecondary} />
      ) : (
        <Text
          style={[styles.num, NUM[size][predicted ? 'predicted' : 'default'], { color: colors[scoreColor(score, bucket)] }]}
          maxFontSizeMultiplier={1}
          numberOfLines={1}
        >
          {(predicted ? '~' : '') + formatScore(score)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    flexShrink: 0,
  },
  num: { fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'center' },
});
