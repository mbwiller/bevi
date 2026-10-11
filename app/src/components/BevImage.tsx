import { Image } from 'expo-image';
import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { radius, useTheme } from '@/theme';

import { BevArt, type BevArtProps } from './BevArt';
import { Icon } from './Icon';

/** The design system's shimmer runs 1.4s per sweep (bundle.css `bv-shimmer`). */
const SHIMMER_MS = 1400;
/** Small tiles round less than `radius.photo`, as in the design system. */
const RADIUS_SMALL = 10;

export interface BevImageProps {
  /** Transparent cutout URL. */
  src?: string;
  /** Placeholder art when there is no photo yet (see `bevArtForCategory`). */
  art?: BevArtProps;
  /** The Bev's name. */
  alt?: string;
  /** 40, 56 (search rows), 96 (compare cards), 155 (feed strips, gut check, Bev detail). */
  size?: 40 | 56 | 96 | 155 | number;
  /** processing: the photo under a shimmer while background removal runs. loading: the skeleton. */
  status?: 'ready' | 'processing' | 'loading';
  style?: StyleProp<ViewStyle>;
}

/** A pulsing `surface` veil. Under reduced motion it holds still. */
export function Shimmer() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      t.value = 0.5;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: SHIMMER_MS / 2, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(t);
  }, [reduced, t]);
  const animated = useAnimatedStyle(() => ({ opacity: t.value * 0.6 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }, animated]}
      testID="shimmer"
    />
  );
}

/** Square Bev tile: the cutout centred with 8% padding on a soft tint of `input`, rounded by `radius.photo`. */
export function BevImage({ src, art, alt = '', size = 56, status = 'ready', style }: BevImageProps) {
  const { colors } = useTheme();
  const glowId = `bevimg-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = size <= 40 ? RADIUS_SMALL : size <= 56 ? radius.input : radius.photo;
  const pad = Math.round(size * 0.08);
  const loading = status === 'loading';
  const processing = status === 'processing';
  const label = loading ? `${alt ? `${alt}, ` : ''}loading` : alt + (processing ? ' (photo processing)' : '');
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: r, padding: pad, backgroundColor: colors.input }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label || undefined}
      aria-busy={loading || processing}
    >
      {loading ? null : (
        <>
          {/* radial-gradient(circle at 50% 40%, surface 60% over input, input 75%) */}
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="40%" r="75%" fx="50%" fy="40%">
                <Stop offset="0" stopColor={colors.surface} stopOpacity={0.6} />
                <Stop offset="1" stopColor={colors.surface} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${glowId})`} />
          </Svg>
          <View style={[styles.fill, processing && styles.dim]}>
            {src ? (
              <Image source={{ uri: src }} style={styles.fill} contentFit="contain" recyclingKey={src} accessible={false} />
            ) : art ? (
              <BevArt {...art} />
            ) : (
              <Icon name="image" size={Math.round(size * 0.36)} color={colors.textSecondary} />
            )}
          </View>
        </>
      )}
      {loading || processing ? <Shimmer /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  fill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.55 },
});
