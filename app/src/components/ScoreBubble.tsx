import type { Bucket } from '@bevi/ranking';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { formatScore } from '@/lib/format';
import { useCountUp } from '@/lib/useCountUp';
import { radius, scoreColor, size as sizes, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface ScoreBubbleProps {
  /** 0–10; colour follows the bucket band (≥ 7 high, ≥ 4 mid, else low). null shows the lock. */
  score?: number | null;
  /** 40 rows and posts, 56 Bev detail and the ranking result, 72 the ranking note step's score reveal. */
  size?: 40 | 56 | 72;
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
  /**
   * App addition for the ranking note step: the number counts up from here to `score` over
   * `motion.pour` (at once under Reduce Motion). The accessible label is always the final `score`.
   */
  countFrom?: number;
  style?: StyleProp<ViewStyle>;
}

type Size = NonNullable<ScoreBubbleProps['size']>;

const NUM: Record<Size, { default: TextStyle; predicted: TextStyle }> = {
  40: {
    default: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
    predicted: { fontSize: 14, lineHeight: 22, letterSpacing: -0.4 },
  },
  56: {
    default: { fontSize: 22, lineHeight: 26, letterSpacing: -0.3 },
    predicted: { fontSize: 19, lineHeight: 26, letterSpacing: -0.3 },
  },
  72: {
    default: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
    predicted: { fontSize: 24, lineHeight: 34, letterSpacing: -0.4 },
  },
};

const DIM: Record<Size, number> = { 40: sizes.scoreBubble, 56: sizes.scoreBubbleLg, 72: sizes.scoreBubbleXl };
const LOCK: Record<Size, number> = { 40: 18, 56: 22, 72: 28 };

/** Beli's score mark: a `surface` circle with a 2pt ring and the score in its bucket colour. */
export function ScoreBubble({ score, size = 40, variant = 'default', bucket, context, countFrom, style }: ScoreBubbleProps) {
  const { colors } = useTheme();
  const locked = variant === 'locked' || score == null;
  const predicted = variant === 'predicted' && !locked;
  const dim = DIM[size];
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
        <Icon name="lock" size={LOCK[size]} strokeWidth={2} color={colors.textSecondary} />
      ) : (
        <Num
          style={[styles.num, NUM[size][predicted ? 'predicted' : 'default'], { color: colors[scoreColor(score, bucket)] }]}
          prefix={predicted ? '~' : ''}
          score={score}
          countFrom={countFrom}
        />
      )}
    </View>
  );
}

interface NumProps {
  style: StyleProp<TextStyle>;
  prefix: string;
  score: number;
  countFrom?: number;
}

function Num({ countFrom, ...rest }: NumProps) {
  return countFrom == null ? <NumText {...rest} /> : <CountingNum {...rest} countFrom={countFrom} />;
}

/** Only this re-renders per frame while the number counts up. */
function CountingNum({ countFrom, score, ...rest }: NumProps & { countFrom: number }) {
  return <NumText {...rest} score={useCountUp(score, countFrom)} />;
}

function NumText({ style, prefix, score }: Omit<NumProps, 'countFrom'>) {
  return (
    <Text style={style} maxFontSizeMultiplier={1} numberOfLines={1}>
      {prefix + formatScore(score)}
    </Text>
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
