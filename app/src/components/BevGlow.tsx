import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedTransparency } from '@/lib/glass';
import { radius, useTheme } from '@/theme';

export interface BevGlowProps {
  /** The drink's main colour (a product colour, the one its photo is mostly made of). Defaults to `primary`. */
  color?: string;
  children?: ReactNode;
  /** It fills its container; size the container. */
  style?: StyleProp<ViewStyle>;
}

/** CSS-only style keys react-native-web passes through to the DOM. */
type WebViewStyle = ViewStyle & { isolation?: 'isolate' };

const BLUR: ViewStyle = Platform.OS === 'web' ? { filter: 'blur(48px)' } : {};

/**
 * Soft colour field behind the gut check's glass: the Bev's colour, `primary` and `fizz`, blurred into
 * `surface`. Decorative and static (the design system doesn't animate it, so reduced motion changes
 * nothing). Under Reduce Transparency the blobs go and it is plain `surface`.
 */
export function BevGlow({ color, children, style }: BevGlowProps) {
  const { colors } = useTheme();
  const reducedTransparency = useReducedTransparency();
  return (
    <View style={[styles.glow, { backgroundColor: colors.surface }, style]}>
      {reducedTransparency ? null : (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" testID="bev-glow-blobs">
          <View style={[styles.blob, styles.a, { backgroundColor: color ?? colors.primary }]} />
          <View style={[styles.blob, styles.b, { backgroundColor: colors.fizz }]} />
          <View style={[styles.blob, styles.c, { backgroundColor: colors.primary }]} />
        </View>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// Blob sizes, positions and strengths from bundle.css (`.bv-glow-a/b/c`).
const styles = StyleSheet.create({
  glow: { position: 'relative', overflow: 'hidden', isolation: 'isolate' } as WebViewStyle,
  blob: { position: 'absolute', aspectRatio: 1, borderRadius: radius.pill, ...BLUR },
  a: { width: '78%', left: '11%', top: '2%', opacity: 0.55 },
  b: { width: '58%', right: '-18%', top: '46%', opacity: 0.4 },
  c: { width: '64%', left: '-20%', bottom: '-6%', opacity: 0.35 },
  content: { position: 'relative', zIndex: 1 },
});
