import type { Bucket } from '@bevi/ranking';
import { BUCKET_LABEL } from '@bevi/shared';
import { useEffect, useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { fade, mix, shade } from '@/lib/color';
import { MAX_FONT_SCALE_DENSE, motion, radius, scoreColor, spacing, type, useTheme, type Colors } from '@/theme';

import { Icon, type IconName } from './Icon';

/** The fixed gut-check copy and faces, in display order (design system `BUCKETS`). */
const BUCKET_ICON: Record<Bucket, IconName> = { LOVED: 'laugh', FINE: 'meh', DISLIKED: 'frown' };

export interface BucketButtonProps {
  bucket: Bucket;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

// Geometry from the design system's bundle.css (`.bv-bucket*`); these sizes have no token.
const HEIGHT = 64;
const ORB = 40;
const CHECK = 26;
const TINT_BAR = 4;
const TINT_PAD_LEFT = 14;
/** Two-thirds full puts the meniscus just above the label's cap height, never across it. */
const FILL = 0.66;
const LIQUID_H = HEIGHT * FILL;
const WAVE_H = 12;
const WAVE = 'M0 8 Q30 1 60 8 T120 8 T180 8 T240 8 V16 H0 Z';
const WAVE_MS = { front: 5000, back: 7000 };
const POUR_EASING = Easing.bezier(0.3, 1.25, 0.5, 1);
const FIZZ = [
  { left: '58%', size: 5, delay: 0 },
  { left: '71%', size: 4, delay: 900 },
  { left: '84%', size: 6, delay: 1700 },
] as const;
const FIZZ_MS = 2600;
const FIZZ_RISE = 28;
const PRESSED_SCALE = 0.98;
const FILL_BOX = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * Gut-check choice: a capsule with a glossy orb in its bucket colour; choosing it pours that colour in.
 * Always show all three, in `BUCKET_ORDER`, on a BevGlow. The label always shows, so a bucket is
 * never told apart by colour alone; the chosen one also gets a ring and a filled check.
 *
 * App adaptation: the design system's `material` prop is omitted. Bevi is web-only and real glass is the
 * native GlassView on iOS 26+, which it never has (and it never imitates glass with `backdrop-filter`),
 * so the button is always the tint material: 12% bucket tint, a 4pt bucket bar, no blur, no shadow.
 * Reduce Transparency therefore needs no special case here.
 */
export function BucketButton({ bucket, selected = false, onPress, style }: BucketButtonProps) {
  const { colors } = useTheme();
  const band = colors[scoreColor(0, bucket)];
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const surface: ViewStyle = {
    borderRadius: radius.card,
    paddingLeft: TINT_PAD_LEFT,
    backgroundColor: mix(band, colors.surface, 0.12),
    boxShadow: selected ? `inset 0 0 0 2px ${band}` : undefined,
  };

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={BUCKET_LABEL[bucket]}
      aria-pressed={selected}
      style={({ pressed }) => [styles.base, surface, pressed && styles.pressed, style]}
    >
      <Liquid band={band} colors={colors} selected={selected} width={width} />
      <View style={[styles.bar, { backgroundColor: band }]} />
      <Orb band={band} colors={colors} icon={BUCKET_ICON[bucket]} />
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {BUCKET_LABEL[bucket]}
      </Text>
      <View
        style={[
          styles.check,
          selected ? { backgroundColor: band } : { boxShadow: `inset 0 0 0 1.5px ${colors.borderStrong}` },
        ]}
      >
        {selected ? <Icon name="check" size={16} strokeWidth={3} color={colors.onScore} /> : null}
      </View>
    </Pressable>
  );
}

/** The bucket colour mixed 45% into `surface` at 70%: pale in light, deep in dark, so `text` reads on it. */
function liquidColor(band: string, colors: Colors) {
  return fade(mix(band, colors.surface, 0.45), 0.7);
}

/** The pour: rises to two-thirds in 450ms with a slight overshoot, under a drifting surface and rising bubbles. */
function Liquid({ band, colors, selected, width }: { band: string; colors: Colors; selected: boolean; width: number }) {
  const reduced = useReducedMotion();
  const level = useSharedValue(selected ? 1 : 0);
  const shown = useSharedValue(selected ? 1 : 0);
  const front = useSharedValue(0);
  const back = useSharedValue(0);
  const ambient = selected && !reduced;

  useEffect(() => {
    const to = selected ? 1 : 0;
    level.value = reduced ? to : withTiming(to, { duration: motion.pour, easing: POUR_EASING });
    shown.value = reduced ? to : withTiming(to, { duration: motion.fast });
  }, [selected, reduced, level, shown]);

  useEffect(() => {
    if (!ambient) {
      cancelAnimation(front);
      cancelAnimation(back);
      front.value = 0;
      back.value = 0;
      return;
    }
    front.value = withRepeat(withTiming(1, { duration: WAVE_MS.front, easing: Easing.linear }), -1, false);
    back.value = withRepeat(withTiming(1, { duration: WAVE_MS.back, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(front);
      cancelAnimation(back);
    };
  }, [ambient, front, back]);

  const liquidStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - level.value) * (LIQUID_H + WAVE_H + 2) }],
  }));
  // The front wave drifts left over 5s, the back one right over 7s (design system `bv-wave`).
  const frontStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -front.value * width }] }));
  const backStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (back.value - 1) * width }] }));

  const fill = liquidColor(band, colors);
  return (
    <Animated.View style={[styles.liquid, { backgroundColor: fill }, liquidStyle]} pointerEvents="none" aria-hidden>
      {width > 0 ? (
        <>
          <Animated.View style={[styles.wave, styles.waveBack, { width: width * 2 }, backStyle]}>
            <Wave width={width * 2} fill={fade(colors.glassHighlight, 0.7)} />
          </Animated.View>
          <Animated.View style={[styles.wave, styles.waveFront, { width: width * 2 }, frontStyle]}>
            <Wave width={width * 2} fill={fill} />
          </Animated.View>
        </>
      ) : null}
      {FIZZ.map((f) => (
        <Fizz key={f.left} {...f} color={colors.glassHighlight} running={ambient} />
      ))}
    </Animated.View>
  );
}

function Wave({ width, fill }: { width: number; fill: string }) {
  return (
    <Svg width={width} height={WAVE_H} viewBox="0 0 240 16" preserveAspectRatio="none">
      <Path d={WAVE} fill={fill} />
    </Svg>
  );
}

function Fizz({ left, size, delay, color, running }: { left: string; size: number; delay: number; color: string; running: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!running) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: FIZZ_MS, easing: Easing.in(Easing.ease) }), -1, false));
    return () => cancelAnimation(t);
  }, [running, delay, t]);
  return <Bubble t={t} left={left} size={size} color={color} />;
}

function Bubble({ t, left, size, color }: { t: SharedValue<number>; left: string; size: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 1], [0, 0.9, 0]),
    transform: [{ translateY: -t.value * FIZZ_RISE }],
  }));
  return (
    <Animated.View
      style={[styles.fizz, { left: left as `${number}%`, width: size, height: size, backgroundColor: color }, style]}
    />
  );
}

/** A glossy 40pt orb in the bucket colour with its face. */
function Orb({ band, colors, icon }: { band: string; colors: Colors; icon: IconName }) {
  const id = `orb-${useId().replace(/:/g, '')}`;
  return (
    <View style={[styles.orb, { boxShadow: `0 3px 10px ${fade(band, 0.35)}` }]}>
      <Svg width={ORB} height={ORB} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* CSS `radial-gradient(circle at 32% 26%, …)` reaches the farthest corner: ~1.005 × the width. */}
          <RadialGradient id={id} cx="32%" cy="26%" r="100.5%" fx="32%" fy="26%">
            <Stop offset="0" stopColor={mix(band, colors.glassHighlight, 0.4)} />
            <Stop offset="0.56" stopColor={band} />
            <Stop offset="1" stopColor={shade(band, 0.78)} />
          </RadialGradient>
        </Defs>
        <Rect width={ORB} height={ORB} rx={ORB / 2} fill={`url(#${id})`} />
      </Svg>
      <View
        style={[styles.orbGloss, { boxShadow: `inset 0 1px 1px ${colors.glassHighlight}, inset 0 -3px 6px ${shade(band, 0.6)}` }]}
        pointerEvents="none"
      />
      <Icon name={icon} size={22} strokeWidth={2.25} color={colors.onScore} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    height: HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.md,
    overflow: 'hidden',
  },
  pressed: { transform: [{ scale: PRESSED_SCALE }] },
  liquid: { position: 'absolute', left: 0, right: 0, bottom: 0, height: LIQUID_H, zIndex: 0 },
  wave: { position: 'absolute', left: 0, height: WAVE_H },
  waveFront: { top: -(WAVE_H - 1) },
  waveBack: { top: -(WAVE_H + 1) },
  fizz: { position: 'absolute', bottom: 6, borderRadius: radius.pill, opacity: 0 },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: TINT_BAR, zIndex: 1 },
  orb: { width: ORB, height: ORB, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  orbGloss: { ...FILL_BOX, borderRadius: radius.pill },
  label: { ...type.heading, flex: 1, minWidth: 0, zIndex: 2 },
  check: {
    width: CHECK,
    height: CHECK,
    marginRight: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
});
