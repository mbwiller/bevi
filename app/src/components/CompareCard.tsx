import type { BevSummary } from '@bevi/shared';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion, radius, spacing, type, useTheme } from '@/theme';

import { bevImageProps } from './BevParts';
import { BevImage } from './BevImage';
import { Icon } from './Icon';

export interface CompareCardProps {
  bev: BevSummary;
  /** Where the incumbent sits now: "#3 in Loved". */
  rankLabel?: string;
  /** The Bev being ranked (top card): a "New" tag. */
  isNew?: boolean;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-compare:active { transform: scale(.98) }` and the 28pt check. */
const PRESSED_SCALE = 0.98;
const CHECK = 28;

/** One side of "Which was better?": the whole card is the target. BevImage 96, name, brand, and its current rank. */
export function CompareCard({ bev, rankLabel, isNew = false, selected = false, onPress, style }: CompareCardProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const press = (to: number) => {
    if (!reduced) scale.value = withTiming(to, { duration: motion.fast });
  };
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(PRESSED_SCALE)}
      onPressOut={() => press(1)}
      accessibilityRole="button"
      accessibilityLabel={bev.name + (isNew ? ', candidate' : rankLabel ? `, currently ${rankLabel}` : '')}
      {...({ 'aria-pressed': selected } as object)}
      style={style}
    >
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border },
          // The design's 1pt border plus a 1pt inset ring: 2pt, with the padding giving back the extra point.
          selected && styles.selected,
          pressStyle,
        ]}
      >
        <BevImage size={96} {...bevImageProps(bev)} />
        <View style={styles.text}>
          {isNew ? (
            <Text style={[type.caption, styles.tag, { backgroundColor: colors.primaryTint, color: colors.primary }]}>New</Text>
          ) : rankLabel ? (
            <Text style={[type.caption, { color: colors.textSecondary }]}>{rankLabel}</Text>
          ) : null}
          <Text style={[type.screenTitle, { color: colors.text }]} numberOfLines={2}>
            {bev.name}
          </Text>
          {bev.brand ? (
            <Text style={[type.body, { color: colors.textSecondary }]} numberOfLines={1}>
              {bev.brand}
            </Text>
          ) : null}
        </View>
        {selected ? (
          <View style={[styles.check, { backgroundColor: colors.primary }]}>
            <Icon name="check" size={18} strokeWidth={3} color={colors.onPrimary} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    width: '100%',
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  selected: { borderWidth: 2, padding: spacing.lg - 1 },
  text: { flex: 1, minWidth: 0, gap: 2, paddingRight: CHECK },
  tag: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, borderRadius: radius.pill, overflow: 'hidden', fontWeight: '600' },
  check: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: CHECK,
    height: CHECK,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
