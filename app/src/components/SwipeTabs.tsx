import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';

import { NO_TRANSFORM } from './PressFeedback';

export interface SwipeTabsProps<T extends string> {
  /** The tabs in the order SegmentedTabs shows them: a swipe left goes to the next one. */
  tabs: readonly T[];
  value: T;
  onChange: (id: T) => void;
  /** The active tab's content. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The content follows the finger at this rate while it is dragged sideways. */
const FOLLOW = 0.35;
/** A swipe this far, or a flick this fast (pt/s), changes the tab. */
const SWIPE = 60;
const FLICK = 500;
/** Past the first or last tab the content gives less, so there is nowhere further to go. */
const EDGE = 0.12;
/** A new tab slides in from this far on the side it came from. */
const ENTER = 32;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * The body under a SegmentedTabs: swipe left or right across it to move to the next or previous
 * tab, as on Instagram's profile. The content leans with the finger, and the new tab slides in from
 * the side it came from (a tap on a segment gets the same entrance). Only a sideways swipe is taken:
 * vertical scrolling inside is left alone, on the web too (`touch-action: pan-y`). Reduce Motion
 * keeps the swipe and drops the movement.
 */
export function SwipeTabs<T extends string>({ tabs, value, onChange, children, style }: SwipeTabsProps<T>) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const index = tabs.indexOf(value);
  const last = useRef(index);

  // Every change of tab, by swipe or by tap, slides the new content in from its side. A layout
  // effect, so the new tab is placed before it is painted, not first drawn where the old one leaned.
  useLayoutEffect(() => {
    const from = last.current;
    last.current = index;
    if (from === index || reduced) {
      x.value = 0;
      return;
    }
    x.value = (index > from ? 1 : -1) * ENTER;
    x.value = withTiming(0, { duration: motion.base, easing: EASE });
  }, [index, reduced, x]);

  const go = (step: number) => {
    const next = tabs[index + step];
    if (next !== undefined) onChange(next);
  };

  const hasPrev = index > 0;
  const hasNext = index < tabs.length - 1;
  const swipe = Gesture.Pan()
    .withTestId('swipe-tabs')
    .activeOffsetX([-20, 20])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      if (reduced) return;
      const open = e.translationX > 0 ? hasPrev : hasNext;
      x.value = e.translationX * (open ? FOLLOW : EDGE);
    })
    // `success` is false for a cancelled pan (a pointercancel on the web): that never changes tab.
    .onEnd((e, success) => {
      const left = success && (e.translationX < -SWIPE || e.velocityX < -FLICK);
      const right = success && (e.translationX > SWIPE || e.velocityX > FLICK);
      const step = left && hasNext ? 1 : right && hasPrev ? -1 : 0;
      if (step === 0) {
        x.value = withSpring(0, motion.springy);
        return;
      }
      // The old tab carries on the way it was swiped while the new one is rendered.
      if (!reduced) x.value = withTiming(-step * ENTER, { duration: motion.fast, easing: EASE });
      runOnJS(go)(step);
    });

  const lean = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.abs(x.value) / 300, 0.25),
    // No transform at rest (see `NO_TRANSFORM`).
    transform: x.value === 0 ? NO_TRANSFORM : [{ translateX: x.value }],
  }));

  return (
    <GestureDetector gesture={swipe} touchAction="pan-y">
      <Animated.View style={[styles.body, style, lean]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
