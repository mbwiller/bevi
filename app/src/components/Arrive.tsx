import { useEffect, useRef, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '@/theme';

import { NO_TRANSFORM } from './PressFeedback';

/** bundle.css `@keyframes bv-arrive { from { opacity: 0; transform: translateY(6px) } }`, in pt. */
export const ARRIVE_RISE = 6;
/** bundle.css `.bv-arrive`'s `ease`. */
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * How far content that replaced a Skeleton has arrived: 0 to 1 over `motion.base`. Pass the
 * query's `isPending`. The value drops to 0 while the skeleton shows and runs to 1 when content
 * takes its place, so it plays once per skeleton actually shown: never on a refetch or a next page
 * (TanStack keeps `isPending` false while it has data), never for content that was already cached
 * when the screen mounted, and never on a re-render.
 *
 * One value per query, shared by every `Arrive` that draws its content: in a virtualised list each
 * row reads it, so the rows of the first paint rise together like one block, and a row recycled or
 * scrolled into view later reads 1 and holds still.
 */
export function useArrival(pending: boolean): SharedValue<number> {
  // One object for the screen's life, so the lists' `renderItem` callbacks that close over it stay
  // stable (Reanimated's shared value already is; the pin also holds under the test mock).
  const progress = useRef(useSharedValue(pending ? 0 : 1)).current;
  const waiting = useRef(pending);
  useEffect(() => {
    if (pending) {
      waiting.current = true;
      // Nothing it drives is on screen while the skeleton shows.
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    if (!waiting.current) return;
    waiting.current = false;
    progress.value = withTiming(1, { duration: motion.base, easing: EASE });
  }, [pending, progress]);
  return progress;
}

export interface ArriveProps {
  /** From `useArrival`. */
  progress: SharedValue<number>;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Arrive (design system README, Motion): content that replaces a Skeleton rises 6pt and fades in
 * over `motion.base`. Under Reduce Motion it only fades. Transform and opacity only, so the layout
 * is the content's own: the wrapper is a plain column box.
 */
export function Arrive({ progress, children, style }: ArriveProps) {
  const reduced = useReducedMotion();
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    // No transform once arrived, nor ever under Reduce Motion (`NO_TRANSFORM`).
    transform: reduced || progress.value >= 1 ? NO_TRANSFORM : [{ translateY: (1 - progress.value) * ARRIVE_RISE }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
