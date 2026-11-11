import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { columnWidth } from '@/lib/column';
import { motion } from '@/theme';

import { NO_TRANSFORM } from './PressFeedback';

/**
 * Move (design system README, Motion): how a screen comes on.
 * - `fade`: a tab's content fades in over `motion.fast` (bundle.css `.bv-move-fade`).
 * - `push`: a pushed screen slides in from the right by 22% of the screen's width (the column's on a wide window), fading in, over `motion.base` (`.bv-move-push`).
 * - `rise`: a full-screen modal rises by 8% of the height, fading in, over `motion.base` (`.bv-move-rise`).
 * Under Reduce Motion each is a fade only, over the same time.
 */
export type MoveVariant = 'fade' | 'push' | 'rise';

/** bundle.css `@keyframes bv-push { from { transform: translateX(22%) } }`, as a share of the width. */
export const PUSH_SHIFT = 0.22;
/** bundle.css `@keyframes bv-rise { from { transform: translateY(8%) } }`, as a share of the height. */
export const RISE_SHIFT = 0.08;
/** `.bv-move-push` / `.bv-move-rise`'s `cubic-bezier(.2,.8,.2,1)`. */
const EASE_MOVE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** `.bv-move-fade`'s `ease`. */
const EASE_FADE = Easing.bezier(0.25, 0.1, 0.25, 1);

export const moveDuration = (variant: MoveVariant) => (variant === 'fade' ? motion.fast : motion.base);

/** Runs `progress` from 0 to 1: the screen's first frame is its start pose. */
function play(progress: SharedValue<number>, variant: MoveVariant) {
  progress.value = 0;
  progress.value = withTiming(1, { duration: moveDuration(variant), easing: variant === 'fade' ? EASE_FADE : EASE_MOVE });
}

/**
 * The animated wrapper: fills the scene, so the screen's own layout is unchanged. The shifts are
 * shares of the scene's own size: on a wide window the app is the centred column (`@/lib/column`),
 * so the push takes 22% of the column's width, not the window's; the column is the window's full
 * height, so the rise takes 8% of that.
 */
function MoveView({ progress, variant, children }: { progress: SharedValue<number>; variant: MoveVariant; children: ReactNode }) {
  const reduced = useReducedMotion();
  const window = useWindowDimensions();
  const dx = !reduced && variant === 'push' ? columnWidth(window) * PUSH_SHIFT : 0;
  const dy = !reduced && variant === 'rise' ? window.height * RISE_SHIFT : 0;
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    // No transform once settled, nor ever for a fade (`NO_TRANSFORM`).
    transform:
      (dx === 0 && dy === 0) || progress.value >= 1
        ? NO_TRANSFORM
        : [{ translateX: (1 - progress.value) * dx }, { translateY: (1 - progress.value) * dy }],
  }));
  return (
    <Animated.View style={[styles.fill, style]} testID="screen-move">
      {children}
    </Animated.View>
  );
}

export interface StackSceneProps {
  variant: Exclude<MoveVariant, 'fade'>;
  /**
   * Whether this screen arrives by a push (true) or was there from the start (false: the app's
   * first screen, a deep link, a status change). Read once, on mount.
   */
  enter: boolean;
  children: ReactNode;
}

/**
 * A screen of the root Stack. On the web the navigator draws every screen in its stack and shows
 * only the top one (`display: none` for the rest), with no transition of its own, so the screen's
 * entrance is played here, once, when it mounts. Going back unmounts the top screen and shows the
 * one underneath exactly as it was: nothing replays and no frame is blank. The browser's history is
 * the router's; this only draws.
 */
export function StackScene({ variant, enter, children }: StackSceneProps) {
  const [entering] = useState(enter);
  const progress = useSharedValue(entering ? 0 : 1);
  useLayoutEffect(() => {
    if (entering) play(progress, variant);
    // Mount only: a later render (the Stack re-renders on every navigation) never replays it.
  }, []);
  return (
    <MoveView progress={progress} variant={variant}>
      {children}
    </MoveView>
  );
}

/** What the tab navigator showed last: a tab (`fade`) or a screen pushed inside it (`push`, People). */
export type TabHistory = { current: { name: string; variant: 'fade' | 'push' } | null };

export interface TabSceneProps {
  /** The route's name in the tab navigator. */
  name: string;
  /** `fade` for the five tabs, `push` for a screen opened inside the tab group (People). */
  variant: 'fade' | 'push';
  /** This route is the tab navigator's current one (its own index, not the app's focus). */
  active: boolean;
  /** One per tab navigator, shared by its scenes. */
  history: TabHistory;
  children: ReactNode;
}

/**
 * A screen of the tab navigator. Switching tabs fades the new tab in; People slides in like a
 * pushed screen. Never at launch (the first scene the navigator shows), never when the tab group
 * itself comes back from under a pushed screen (`active` is the tab navigator's own index, which a
 * push on the root Stack doesn't change), and never on leaving People, which is going back.
 */
export function TabScene({ name, variant, active, history, children }: TabSceneProps) {
  const [enterOnMount] = useState(() => active && shouldEnter(variant, history.current, name));
  const progress = useSharedValue(enterOnMount ? 0 : 1);
  const mounted = useRef(false);
  // A layout effect: on the web the start pose is applied before the browser paints the newly shown screen.
  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (!active) return;
    const from = history.current;
    history.current = { name, variant };
    if (first ? enterOnMount : shouldEnter(variant, from, name)) play(progress, variant);
    // `active` is the trigger; the rest are stable for the scene's life.
  }, [active]);
  return (
    <MoveView progress={progress} variant={variant}>
      {children}
    </MoveView>
  );
}

function shouldEnter(variant: 'fade' | 'push', from: TabHistory['current'], name: string): boolean {
  if (!from || from.name === name) return false;
  // Leaving People for a tab is going back (or leaving it): the tab underneath just shows.
  return !(variant === 'fade' && from.variant === 'push');
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
