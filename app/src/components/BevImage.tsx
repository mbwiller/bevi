import type { BevIconLabelBand } from '@bevi/shared';
import { Image } from 'expo-image';
import { useEffect, useId } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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

import { radius, type as typeScale, useTheme } from '@/theme';

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
  /** Override the processing label for non-photo work that uses the same tile treatment. */
  processingLabel?: string;
  /**
   * Where `src`'s label sits (`BevSummary.iconLabelBand`), when it is a
   * generated icon with a band. The wordmark is drawn across it rather than
   * baked into the image: the image model refuses a recognisable brand mark,
   * and type set here stays crisp at every tile size.
   */
  labelBand?: BevIconLabelBand | null;
  /** The text to set across `labelBand`, normally the Bev's brand or its name. */
  wordmark?: string;
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
export function BevImage({ src, art, alt = '', size = 56, status = 'ready', processingLabel = 'photo processing', labelBand, wordmark, style }: BevImageProps) {
  const { colors } = useTheme();
  const glowId = `bevimg-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = size <= 40 ? RADIUS_SMALL : size <= 56 ? radius.input : radius.photo;
  const pad = Math.round(size * 0.08);
  const loading = status === 'loading';
  const processing = status === 'processing';
  // The band is normalised against the artwork, which sits inside the tile's
  // 8% padding. Below one line of type there is no room to set anything in it,
  // so a small tile shows the illustration alone -- the contract's own answer
  // for icon sizes, where lettering would only be a smudge.
  const content = size - pad * 2;
  const bandHeight = labelBand ? labelBand.height * content : 0;
  const showWordmark =
    !loading && !!src && !!labelBand && !!wordmark?.trim() && bandHeight >= typeScale.tabBar.lineHeight;
  const label = loading ? `${alt ? `${alt}, ` : ''}loading` : alt + (processing ? ` (${processingLabel})` : '');
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
      {showWordmark && labelBand ? (
        <Text
          accessible={false}
          numberOfLines={1}
          style={[
            styles.wordmark,
            {
              left: `${((pad + labelBand.x * content) / size) * 100}%`,
              top: `${((pad + labelBand.y * content) / size) * 100}%`,
              width: `${((labelBand.width * content) / size) * 100}%`,
              // One line centred in the band by its own leading: react-native-web
              // ignores `textAlignVertical`, so the height has to do the centring.
              height: bandHeight,
              lineHeight: bandHeight,
              color: labelBand.dark ? colors.onDeep : colors.text,
            },
          ]}
        >
          {wordmark}
        </Text>
      ) : null}
      {loading || processing ? <Shimmer /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  fill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.55 },
  wordmark: {
    position: 'absolute',
    textAlign: 'center',
    ...typeScale.tabBar,
    fontWeight: '700',
  },
});
