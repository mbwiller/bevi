import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { COLUMN_MAX_WIDTH, isWideViewport } from '@/lib/column';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
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

/**
 * The panel's bottom padding. Web: clears the iPhone home indicator in the home-screen web app
 * (react-native-web passes calc() through). Native: `xxl` plus the bottom safe-area inset, which is
 * 0 while the keyboard is up (it covers the home indicator, and the panel then sits on the keyboard).
 */
export function sheetBottomPadding(bottomInset: number, keyboard: number): ViewStyle {
  if (Platform.OS === 'web') return { paddingBottom: `calc(${spacing.xxl}px + env(safe-area-inset-bottom))` } as unknown as ViewStyle;
  return { paddingBottom: spacing.xxl + (keyboard > 0 ? 0 : bottomInset) };
}

/**
 * Bottom sheet over a `scrim`, at 40% or 90% of the window. Built on React Native's Modal (a portal on
 * the web, with its own Escape handling and focus trap) and Reanimated. The handle is a visual cue
 * only: there are no drag gestures, so close with the scrim, Escape or a row inside.
 *
 * On a wide viewport the scrim and the panel stay inside the app's centred column (`lib/column.ts`).
 * The Modal's portal is a child of `<body>`, outside `#root`, so `public/index.html` also narrows the
 * portal itself; this keeps the sheet in the column even if that CSS doesn't match.
 */
export function Sheet({ open = false, title, snap = 40, onClose, children, scroll = true }: SheetProps) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const windowHeight = win.height;
  const wide = isWideViewport(win);
  // A 90% sheet would reach into the status bar (and its blur band, see StatusBarClearance): stop below the top inset.
  const [mounted, setMounted] = useState(open);
  const insets = useContext(SafeAreaInsetsContext);
  const safeTop = insets?.top ?? 0;
  // Native: the keyboard doesn't resize the window, so the panel rides up by its height and a tall
  // one shrinks to stay below the status bar; any sheet with a field stays above it. Counted here
  // once: a sheet's own content must not lift itself too. The web has its own handling (CommentsSheet
  // and SafetyFlow read `visualViewport` themselves), so it is left as it was.
  const keyboard = useKeyboardInset(Platform.OS !== 'web' && mounted);
  const height = Math.min((windowHeight * snap) / 100, windowHeight - safeTop - keyboard);
  const reduced = useReducedMotion();
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
      <View
        style={[styles.wrap, wide && styles.column]}
        testID="sheet-frame"
        // iOS: the Modal is presented over the screen, not instead of it, so VoiceOver could still reach
        // the page behind. On the frame (not the panel) so the scrim's Close stays reachable.
        {...(Platform.OS === 'web' ? {} : { accessibilityViewIsModal: true })}
      >
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
            sheetBottomPadding(insets?.bottom ?? 0, keyboard),
            { height, backgroundColor: colors.surface },
            keyboard > 0 && { marginBottom: keyboard },
            sheetStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} aria-hidden />
          {title ? (
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {scroll ? (
            // "handled": with the keyboard up a tap on a row or button works at once, rather than the first tap only dismissing it.
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  column: { width: '100%', maxWidth: COLUMN_MAX_WIDTH, alignSelf: 'center' },
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
