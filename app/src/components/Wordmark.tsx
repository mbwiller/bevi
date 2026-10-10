import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

import { WORDMARK } from './wordmark-data';

export interface WordmarkProps {
  /** Rendered height in pt; the header uses 28. */
  height?: number;
  /** brand: grape letters, fizz bubbles. inverse: white letters, for photos and deep fills. mono: one colour. */
  tone?: 'brand' | 'inverse' | 'mono';
  /** Colour for tone="mono"; defaults to `text`. */
  color?: string;
  title?: string;
}

/** The lowercase "bevi" logo, outlined from Fredoka Bold. The app never loads the font. */
export function Wordmark({ height = 28, tone = 'brand', color, title = 'bevi' }: WordmarkProps) {
  const { colors } = useTheme();
  const width = Math.round((WORDMARK.w / WORDMARK.h) * height * 10) / 10;
  const mono = color ?? colors.text;
  const ink = tone === 'brand' ? colors.primary : tone === 'inverse' ? colors.onDeep : mono;
  const fizz = tone === 'mono' ? mono : colors.fizz;
  return (
    <Svg width={width} height={height} viewBox={WORDMARK.viewBox} accessibilityRole="image" accessibilityLabel={title}>
      <Path d={WORDMARK.letters} fill={ink} />
      <Circle cx={WORDMARK.bubble.cx} cy={WORDMARK.bubble.cy} r={WORDMARK.bubble.r} fill={fizz} />
      <Circle cx={WORDMARK.fizz.cx} cy={WORDMARK.fizz.cy} r={WORDMARK.fizz.r} fill={fizz} />
    </Svg>
  );
}
