import { forwardRef, useCallback } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';

/** bundle.css `.bv-press:active { transform: scale(.98); opacity: .7 }`. */
export const PRESS_SCALE = 0.98;
export const PRESS_OPACITY = 0.7;

/**
 * The transform of something at rest: an empty list, which react-native-web writes as no transform
 * at all. Leaving the key out would not do: on the web Reanimated merges each update into the last
 * one, so the previous inline transform would stay. A resting `translate(0)` or `scale(1)` still
 * makes the element a stacking context and a containing block for fixed descendants, and can
 * soften its text, so Press, Arrive, Change and Move all drop theirs once settled.
 */
export const NO_TRANSFORM: [] = [];

/** A Pressable that takes Reanimated styles. Plain (non-function) styles only. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press (design system README, Motion): a tappable row, card or icon gives way a little under the
 * finger, scale 0.98 and opacity 0.7 over `motion.fast`, and comes back on release. Under Reduce
 * Motion only the opacity changes. Transform and opacity only, so nothing around it moves.
 *
 * The handlers only drive the animation: wire them to the Pressable's `onPressIn` / `onPressOut`
 * next to its own `onPress`, which still fires on release with no delay. Put `style` on the
 * Pressable (`AnimatedPressable`), or, for a full-bleed row whose background and divider must stay
 * put, on an `Animated.View` holding its content. Pills, Buttons and the other controls with
 * `PRESSED` keep their own dim.
 */
export function usePressFeedback() {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * (1 - PRESS_OPACITY),
    // No transform at rest (see `NO_TRANSFORM`).
    transform: reduced || pressed.value === 0 ? NO_TRANSFORM : [{ scale: 1 - pressed.value * (1 - PRESS_SCALE) }],
  }));
  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, { duration: motion.fast });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withTiming(0, { duration: motion.fast });
  }, [pressed]);
  return { style, onPressIn, onPressOut };
}

/**
 * What `usePressFeedback` hands out. `style` goes on what gives way under the finger: the Pressable
 * itself, or the content inside a full-bleed row. Its type is the one Reanimated infers from the
 * worklet (as LikeButton's and Sheet's are), so it fits an `Animated.View`'s `style`.
 */
export type PressFeedback = ReturnType<typeof usePressFeedback>;

export type FeedbackPressableProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> };

/**
 * A Pressable with Press built in: the whole control scales and dims while held. For a control
 * whose own box can shrink without uncovering anything (a row's button, a picture, an icon). Any
 * `onPressIn` / `onPressOut` passed in still run, after the feedback starts. Without an `onPress`,
 * or while disabled, it gives no feedback: nothing happens on a tap, so nothing should look as if
 * it will.
 */
export const FeedbackPressable = forwardRef<View, FeedbackPressableProps>(function FeedbackPressable(
  { style, onPressIn, onPressOut, ...rest },
  ref,
) {
  const press = usePressFeedback();
  const live = !!rest.onPress && !rest.disabled;
  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        if (live) press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (live) press.onPressOut();
        onPressOut?.(e);
      }}
      style={[style, press.style]}
    />
  );
});
