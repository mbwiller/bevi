import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { formatCount } from '@/lib/format';
import { MAX_FONT_SCALE_DENSE, motion, size, spacing, type, useTheme } from '@/theme';

import { TARGET_MIN } from './HitTarget';
import { Icon } from './Icon';

export interface LikeButtonProps {
  /** The viewer liked the post: the heart is filled `primary`. */
  liked?: boolean;
  /** Likes on the post, printed like other counts ("12", "5k"); hidden at 0. */
  count?: number;
  /** Toggles the like. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `@keyframes bv-like-pop { 50% { transform: scale(1.2) } }` over `fast`. */
const POP_SCALE = 1.2;

/** "Like" / "Unlike", plus the count when there is one: "Unlike, 12 likes", "Like, 1 like". */
export function likeLabel(liked: boolean, count: number): string {
  return (liked ? 'Unlike' : 'Like') + (count > 0 ? `, ${count} ${count === 1 ? 'like' : 'likes'}` : '');
}

/**
 * The post's like control: a 28pt heart, outline in `text` until liked, then filled `primary`, with
 * the count beside it (in `text`; only the heart turns grape). A press pops the heart to 1.2× and
 * back in `fast`, transform only; Reduce Motion drops the pop. The count sits inside the 44pt target.
 */
export function LikeButton({ liked = false, count = 0, onPress, style }: LikeButtonProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = () => {
    if (!reduced) {
      scale.value = withSequence(
        withTiming(POP_SCALE, { duration: motion.fast / 2 }),
        withTiming(1, { duration: motion.fast / 2 }),
      );
    }
    onPress?.();
  };

  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={likeLabel(liked, count)}
      // react-native-web drops accessibilityState.selected/checked for buttons; aria-pressed renders (as SaveButton).
      {...({ 'aria-pressed': liked } as object)}
      style={[styles.target, style]}
    >
      <Animated.View style={popStyle} testID="like-heart">
        <Icon name="heart" size={size.icon} strokeWidth={1.6} filled={liked} color={liked ? colors.primary : colors.text} />
      </Animated.View>
      {count > 0 ? (
        <Text
          style={[type.body, styles.count, { color: colors.text }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
          importantForAccessibility="no"
          aria-hidden
        >
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

// bundle.css `.bv-like`: a 44pt box, `space-sm` side padding, `space-xs` between heart and count.
const styles = StyleSheet.create({
  target: { ...TARGET_MIN, flexDirection: 'row', paddingHorizontal: spacing.sm, gap: spacing.xs },
  count: { fontVariant: ['tabular-nums'] },
});
