import { MAX_CATEGORY_PICKS } from '@bevi/shared';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { selectionHaptic } from '@/lib/haptics';
import { MAX_FONT_SCALE_DENSE, radius, spacing, type, useTheme } from '@/theme';

import type { BevArtProps } from './BevArt';
import { BevImage } from './BevImage';
import { FeedbackPressable } from './PressFeedback';
import { usePop } from './usePop';

export interface PickTileProps {
  /** The category's label ("Coffee", "Spirits & cocktails"). */
  label: string;
  /** The art, as BevImage takes it: the category's most-rated starter Bev's icon or cutout (`bevImageProps`). */
  src?: string;
  /** The category's own art, when it has no starter Bev to show (`bevArtForCategory`). */
  art?: BevArtProps;
  /** Picked, in this place (the order it was tapped in): `primaryTint`, a 2pt `primary` rim and the number badge. */
  rank?: 1 | 2 | 3;
  /** Three are picked and this one isn't: the art fades, the label goes `textSecondary`, and a tap does nothing. */
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

// Geometry from the design system's bundle.css (`.bv-pick*`); these have no token.
const ART = 56;
const BADGE = 26;
/** `.bv-pick-dim .bv-pick-art`, the same fade as a dimmed BucketButton's ring. */
const DIMMED_OPACITY = 0.35;
const HAIRLINE = 1;
const RIM = 2;

/** "Coffee", "Coffee, your number 1 pick", or "Coffee. You've picked 3 already" while it can't be picked. */
export function pickTileLabel(label: string, rank?: number, disabled = false): string {
  if (rank) return `${label}, your number ${rank} pick`;
  return disabled ? `${label}. You've picked ${MAX_CATEGORY_PICKS} already` : label;
}

/**
 * One category in onboarding's go-tos grid: a Bev's art (BevImage 56) over the category's label.
 * Picked, it takes `primaryTint` with a 2pt `primary` rim and its `rank` in a `primary` badge, so the
 * state never rests on colour. A tap gives way under the finger (Press), ticks the selection haptic,
 * and pops the badge in when it picks the tile (Change; nothing under Reduce Motion). `disabled`
 * dims an unpicked tile once three are picked; it takes no taps and says why to a screen reader.
 */
export function PickTile({ label, src, art, rank, disabled = false, onPress, style }: PickTileProps) {
  const { colors } = useTheme();
  const pop = usePop();
  const picked = rank != null;
  const press = () => {
    if (!picked) pop.pop();
    selectionHaptic();
    onPress?.();
  };
  return (
    <FeedbackPressable
      onPress={onPress ? press : undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={pickTileLabel(label, rank, disabled)}
      // React Native maps no `aria-pressed` on iOS; VoiceOver reads the state from here.
      accessibilityState={{ selected: picked, disabled }}
      {...({ 'aria-pressed': picked } as object)}
      style={[
        styles.tile,
        picked && styles.picked,
        { backgroundColor: picked ? colors.primaryTint : colors.surface, borderColor: picked ? colors.primary : colors.border },
        style,
      ]}
    >
      <View testID="pick-art" style={disabled && styles.dimmed} aria-hidden importantForAccessibility="no-hide-descendants">
        <BevImage src={src} art={art} size={ART} />
      </View>
      <Text
        style={[styles.label, { color: disabled ? colors.textSecondary : colors.text }]}
        numberOfLines={2}
        maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
      >
        {label}
      </Text>
      {picked ? (
        <Animated.View
          testID="pick-badge"
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.badge, { backgroundColor: colors.primary }, pop.style]}
        >
          <Text style={[styles.number, { color: colors.onPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
            {rank}
          </Text>
        </Animated.View>
      ) : null}
    </FeedbackPressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderWidth: HAIRLINE,
    borderRadius: radius.card,
  },
  // The 2pt rim; the padding gives the extra point back, so nothing inside moves.
  picked: { borderWidth: RIM, paddingVertical: spacing.md - (RIM - HAIRLINE), paddingHorizontal: spacing.sm - (RIM - HAIRLINE) },
  dimmed: { opacity: DIMMED_OPACITY },
  label: { ...type.body, fontWeight: '600', textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    minWidth: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { ...type.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
