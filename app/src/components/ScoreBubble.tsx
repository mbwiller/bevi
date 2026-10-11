import type { Bucket } from '@bevi/ranking';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { formatCount, formatScore } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, radius, scoreColor, size as sizes, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface ScoreBubbleProps {
  /** 0–10; colour follows the bucket band (≥ 7 high, ≥ 4 mid, else low). null shows the lock. */
  score?: number | null;
  size?: 40 | 56;
  /** Rating count badge ("362", "5k"). */
  count?: number;
  variant?: 'default' | 'predicted' | 'locked';
  /** The user's own bucket when known: colour is the bucket, not the band (app addition, see `scoreColor`). */
  bucket?: Bucket;
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
export function ScoreBubble({ score, size = 40, count, variant = 'default', bucket, style }: ScoreBubbleProps) {
  const { colors } = useTheme();
  const locked = variant === 'locked' || score == null;
  const predicted = variant === 'predicted' && !locked;
  const dim = size === 56 ? sizes.scoreBubbleLg : sizes.scoreBubble;
  const label = locked
    ? 'Score hidden'
    : `${predicted ? 'Predicted score ' : 'Score '}${formatScore(score)}${count != null ? `, ${count} ratings` : ''}`;
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
      {count != null && !locked ? (
        <View
          style={[
            styles.count,
            size === 56 && styles.countLg,
            { backgroundColor: colors.primary, borderColor: colors.surface },
          ]}
        >
          <Text
            style={[styles.countText, size === 56 && styles.countTextLg, { color: colors.onPrimary }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
            numberOfLines={1}
          >
            {formatCount(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Badge geometry is the design system's (bundle.css `.bv-score-count`); no token names these values.
const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    flexShrink: 0,
  },
  num: { fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'center' },
  count: {
    position: 'absolute',
    right: -9,
    bottom: -7,
    minWidth: 24,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLg: { minWidth: 26, height: 22 },
  countText: { fontSize: 10, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countTextLg: { fontSize: 11 },
});
