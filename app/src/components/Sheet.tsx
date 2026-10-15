import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion, radius, spacing, type, useTheme } from '@/theme';

export interface SheetProps {
  open?: boolean;
  /** Shown centred under the handle and used as the dialog's accessible name. */
  title?: string;
  /** Height as a percentage of the window. */
  snap?: 40 | 90;
  /** Scrim press, Escape (web) or the system back gesture. */
  onClose?: () => void;
  /** Option rows: 48pt, 1pt dividers, a `primary` check on the chosen one. */
  children?: ReactNode;
  /**
   * false: the body is a plain flex column instead of a ScrollView, for content that scrolls itself
   * and pins something to the bottom (CommentsSheet's list and composer). Default true.
   */
  scroll?: boolean;
}

// From bundle.css: the handle bar, and the sheet's entrance (`bv-sheet-in`: 24pt rise, from 60% opacity).
const HANDLE = { width: 36, height: 5 };
const RISE = 24;
const FROM_OPACITY = 0.6;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Clears the iPhone home indicator in the home-screen web app; react-native-web passes calc() through. */
const SAFE_BOTTOM = (Platform.OS === 'web'
  ? { paddingBottom: `calc(${spacing.xxl}px + env(safe-area-inset-bottom))` }
  : { paddingBottom: spacing.xxl }) as ViewStyle;

/**
 * Bottom sheet over a `scrim`, at 40% or 90% of the window. Built on React Native's Modal (a portal on
 * the web, with its own Escape handling and focus trap) and Reanimated. The handle is a visual cue
 * only: there are no drag gestures, so close with the scrim, Escape or a row inside.
 */
export function Sheet({ open = false, title, snap = 40, onClose, children, scroll = true }: SheetProps) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(open ? 1 : 0);
  const panel = useRef<View>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = reduced ? 1 : withTiming(1, { duration: motion.base, easing: EASE });
      return;
    }
    if (reduced) {
      progress.value = 0;
      setMounted(false);
      return;
    }
    progress.value = withTiming(0, { duration: motion.fast });
    const t = setTimeout(() => setMounted(false), motion.fast);
    return () => clearTimeout(t);
  }, [open, reduced, progress]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: FROM_OPACITY + (1 - FROM_OPACITY) * progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));

  // Move focus into the sheet once it is on screen, so keyboard and screen-reader users start there.
  const focusPanel = () => (panel.current as unknown as { focus?: () => void } | null)?.focus?.();

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={focusPanel}
      // react-native-web renders the Modal's own wrapper as role="dialog"; name it too.
      {...({ 'aria-label': title } as object)}
    >
      <View style={styles.wrap}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            focusable={false}
            testID="sheet-scrim"
          />
        </Animated.View>
        <Animated.View
          ref={panel}
          // The Modal wrapper above is the dialog (role, aria-modal, name); the panel only takes focus.
          tabIndex={-1}
          testID="sheet"
          style={[
            styles.sheet,
            SAFE_BOTTOM,
            { height: (windowHeight * snap) / 100, backgroundColor: colors.surface },
            sheetStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} aria-hidden />
          {title ? (
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {scroll ? <ScrollView style={styles.body}>{children}</ScrollView> : <View style={styles.body}>{children}</View>}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.gutter,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  handle: { alignSelf: 'center', ...HANDLE, marginBottom: spacing.md, borderRadius: radius.pill },
  title: { ...type.heading, textAlign: 'center', marginBottom: spacing.sm },
  body: { flex: 1, marginHorizontal: -spacing.gutter },
});
