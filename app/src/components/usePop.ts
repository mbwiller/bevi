import { useCallback, useEffect, useRef } from 'react';
import { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';

import { NO_TRANSFORM } from './PressFeedback';

/** bundle.css `@keyframes bv-pop { 45% { transform: scale(1.22) } }` over `base`. */
export const POP_SCALE = 1.22;
/** The share of `motion.base` spent growing; the rest settles back to 1. */
export const POP_PEAK = 0.45;
/** bundle.css `.bv-pop`'s `cubic-bezier(.2,.8,.2,1)`, as SegmentedTabs' underline. */
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Change (design system README, Motion): a toggle pops like the heart, scale 1 → 1.22 → 1 over
 * `motion.base`, transform only. Put `style` on an `Animated.View` around the part that pops and
 * call `pop()` from the control's own press handler, so it plays on the user's toggle and never
 * when the list re-renders with new data. Under Reduce Motion `pop()` does nothing.
 */
export function usePop() {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  // No transform at rest (`NO_TRANSFORM`); the pop always settles back on exactly 1.
  const style = useAnimatedStyle(() => ({ transform: scale.value === 1 ? NO_TRANSFORM : [{ scale: scale.value }] }));
  const pop = useCallback(() => {
    if (reduced) return;
    scale.value = withSequence(
      withTiming(POP_SCALE, { duration: motion.base * POP_PEAK, easing: EASE }),
      withTiming(1, { duration: motion.base * (1 - POP_PEAK), easing: EASE }),
    );
  }, [reduced, scale]);
  return { style, pop };
}

/**
 * The pop, played once each time `on` turns true after the first render (the TabBar's newly
 * active icon). Never on mount, so the tab showing at launch holds still.
 */
export function usePopWhenOn(on: boolean) {
  const { style, pop } = usePop();
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current) pop();
    was.current = on;
  }, [on, pop]);
  return style;
}
