import type { Bucket } from '@bevi/ranking';
import { BUCKET_LABEL } from '@bevi/shared';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { MAX_FONT_SCALE_DENSE, motion, radius, spacing, type, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface BucketButtonProps {
  bucket: Bucket;
  selected?: boolean;
  /** Another bucket is chosen: the ring fades and the label goes `textSecondary`. */
  dimmed?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

// Geometry from the design system's bundle.css (`.bv-bucket*`); these sizes have no token.
const DISC = 76;
const RING = 2.5;
const RING_GAP = 4;
const BADGE = 26;
const BADGE_OFFSET = -6;
const BADGE_GAP = 3;
const DIMMED_OPACITY = 0.35;
const PRESSED_SCALE = 0.94;
const BADGE_HIDDEN_SCALE = 0.6;

/** How full the ring is. The level carries the order, so a bucket is never told apart by colour. */
const LEVEL: Record<Bucket, DimensionValue> = { LOVED: '100%', FINE: '50%', DISLIKED: '0%' };

/**
 * Gut-check choice: a `primary` ring filled to a level (loved full, fine half, disliked empty) over its
 * label. Always show all three, in `BUCKET_ORDER`, in one row on plain `surface`. The chosen one gets a
 * check badge; pass `dimmed` to the other two once one is chosen.
 */
export function BucketButton({ bucket, selected = false, dimmed = false, onPress, style }: BucketButtonProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const shown = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    const to = selected ? 1 : 0;
    shown.value = reduced ? to : withTiming(to, { duration: motion.fast });
  }, [selected, reduced, shown]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: BADGE_HIDDEN_SCALE + (1 - BADGE_HIDDEN_SCALE) * shown.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={BUCKET_LABEL[bucket]}
      aria-pressed={selected}
      style={[styles.base, style]}
    >
      {({ pressed }) => (
        <>
          <View
            testID="bucket-disc"
            style={[styles.disc, { borderColor: colors.primary }, dimmed && styles.dimmed, pressed && styles.pressed]}
          >
            <View style={styles.well}>
              <View testID="bucket-fill" style={[styles.fill, { height: LEVEL[bucket], backgroundColor: colors.primary }]} />
            </View>
            <Animated.View
              testID="bucket-badge"
              style={[styles.badge, { backgroundColor: colors.text, boxShadow: `0 0 0 ${BADGE_GAP}px ${colors.surface}` }, badgeStyle]}
            >
              <Icon name="check" size={16} strokeWidth={3} color={colors.surface} />
            </Animated.View>
          </View>
          <Text
            style={[styles.label, { color: dimmed ? colors.textSecondary : colors.text }]}
            maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          >
            {BUCKET_LABEL[bucket]}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  disc: { width: DISC, height: DISC, padding: RING_GAP, borderWidth: RING, borderRadius: radius.pill },
  dimmed: { opacity: DIMMED_OPACITY },
  pressed: { transform: [{ scale: PRESSED_SCALE }] },
  well: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  badge: {
    position: 'absolute',
    top: BADGE_OFFSET,
    right: BADGE_OFFSET,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...type.body, fontWeight: '600', textAlign: 'center' },
});
