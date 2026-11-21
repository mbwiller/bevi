import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
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
  /**
   * The sheet has finished closing: its exit animation is done and, on iOS, the Modal is really gone
   * (its `onDismiss`). Navigate or open another modal from here, never in the same tick as the close:
   * popping a screen under a Modal that is still presented leaves iOS with a stuck or blank screen.
   * Fires once per close, not for a sheet that was never opened.
   */
  onClosed?: () => void;
  /** Option rows: 48pt, 1pt dividers, a `primary` check on the chosen one. */
  children?: ReactNode;
  /**
   * false: the body is a plain flex column instead of a ScrollView, for content that scrolls itself
   * and pins something to the bottom (CommentsSheet's list and composer). Default true.
   */
  scroll?: boolean;
}

// From bundle.css: the handle bar and the sheet's easing.
const HANDLE = { width: 36, height: 5 };
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** A drag past this share of the sheet's height, or a flick down faster than FLICK (pt/s), closes it. */
const DISMISS_SHARE = 0.25;
const FLICK = 800;
/** A drag only starts once the finger has moved this far down, so a tap on the title stays a tap. */
const DRAG_SLOP = 6;
/** Dragged up, the sheet follows the finger at this rate: it gives a little, it doesn't lift off. */
const RUBBER = 0.15;
// iOS reports the end of a dismissal through the Modal's `onDismiss`; if it never does (UIKit refused
// or dropped it), `onClosed` still fires after this long so whatever waits on it is not stranded.
const DISMISS_FALLBACK_MS = 1000;

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
 * the web, with its own Escape handling and focus trap), Reanimated and Gesture Handler. It slides up
 * from the bottom edge and back down. The top of the panel (the handle and the title) is a grab
 * area: drag it down and the sheet follows the finger, the scrim fading with it; let go past a
 * quarter of its height, or flick it, and it closes (`onClose`), otherwise it springs back. It also
 * closes with the scrim, Escape or a row inside. Only the top grabs: on the web a gesture claims its
 * view's touches (`touch-action: none`), which would stop the body from scrolling.
 *
 * On a wide viewport the scrim and the panel stay inside the app's centred column (`lib/column.ts`).
 * The Modal's portal is a child of `<body>`, outside `#root`, so `public/index.html` also narrows the
 * portal itself; this keeps the sheet in the column even if that CSS doesn't match.
 */
export function Sheet({ open = false, title, snap = 40, onClose, onClosed, children, scroll = true }: SheetProps) {
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
  // How far the panel is dragged below its resting place (negative: pulled up, rubber-banded).
  const drag = useSharedValue(0);
  // The finger's travel when the drag took hold, so the panel moves from there without a jump.
  const grabFrom = useSharedValue(0);
  const panel = useRef<View>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // `onClosed`: armed while mounted, fired once when the close is complete. No `onDismiss` exists on
  // the web (react-native-web) or Android, so there it fires as soon as the Sheet unmounts its Modal.
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const awaitingClose = useRef(false);
  const stillMounted = useRef(mounted);
  stillMounted.current = mounted;
  const fireClosed = () => {
    if (!awaitingClose.current || stillMounted.current) return;
    awaitingClose.current = false;
    closedRef.current?.();
  };
  useEffect(() => {
    if (mounted) {
      awaitingClose.current = true;
      return;
    }
    if (Platform.OS !== 'ios') {
      fireClosed();
      return;
    }
    const t = setTimeout(fireClosed, DISMISS_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [mounted]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      drag.value = 0;
      progress.value = reduced ? 1 : withTiming(1, { duration: motion.base, easing: EASE });
      return;
    }
    if (reduced) {
      progress.value = 0;
      setMounted(false);
      return;
    }
    // Closing from a drag carries on from where the finger let go: the drag is folded into the
    // progress (which also stops a spring back still running), so the panel never lurches up first.
    if (drag.value !== 0) {
      progress.value = Math.min(1, Math.max(0, 1 - drag.value / height));
      drag.value = 0;
    }
    progress.value = withTiming(0, { duration: motion.base, easing: EASE });
    const t = setTimeout(() => setMounted(false), motion.base);
    return () => clearTimeout(t);
  }, [open, reduced, progress, drag]);

  // Called when a drag is let go far enough. A parent that keeps the sheet open (it ignored
  // onClose) gets it back in place rather than left hanging where the finger let go.
  const dismiss = () => {
    onClose?.();
    setTimeout(() => {
      if (openRef.current) drag.value = withSpring(0, motion.springy);
    }, 0);
  };
  const canDismiss = !!onClose;
  const grab = Gesture.Pan()
    .withTestId('sheet-grab')
    // Not while it is closing: a second drag would move the panel that is leaving and close it twice.
    .enabled(canDismiss && open)
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .onStart((e) => {
      grabFrom.value = e.translationY - drag.value;
    })
    .onUpdate((e) => {
      const t = e.translationY - grabFrom.value;
      drag.value = t > 0 ? t : t * RUBBER;
    })
    // A flick down closes; so does a drag past the share, unless it ends in a flick back up (the
    // user changed their mind). A cancelled pan (`success` false) never closes.
    .onEnd((e, success) => {
      const far = drag.value > height * DISMISS_SHARE && e.velocityY > -FLICK;
      if (success && (e.velocityY > FLICK || far)) runOnJS(dismiss)();
      else drag.value = withSpring(0, motion.springy);
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(1, Math.max(0, drag.value) / height)),
  }));
  const sheetStyle = useAnimatedStyle(() => {
    const y = (1 - progress.value) * height + drag.value;
    // No transform at rest (see PressFeedback's NO_TRANSFORM).
    return { opacity: reduced ? progress.value : 1, transform: y === 0 ? [] : [{ translateY: y }] };
  });

  // Move focus into the sheet once it is on screen, so keyboard and screen-reader users start there.
  const focusPanel = () => (panel.current as unknown as { focus?: () => void } | null)?.focus?.();

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={focusPanel}
      onDismiss={fireClosed}
      // react-native-web renders the Modal's own wrapper as role="dialog"; name it too.
      {...({ 'aria-label': title } as object)}
    >
      {/* iOS presents a Modal outside the app's root view, so gestures inside it need a root of their own. */}
      <GestureHandlerRootView style={styles.root}>
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
            <GestureDetector gesture={grab}>
              <View testID="sheet-grab" style={styles.grab}>
                <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} aria-hidden />
                {title ? (
                  <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
              </View>
            </GestureDetector>
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
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  column: { width: '100%', maxWidth: COLUMN_MAX_WIDTH, alignSelf: 'center' },
  sheet: {
    paddingHorizontal: spacing.gutter,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  // The panel's top padding lives in the grab area, so the whole strip above the body can be dragged.
  grab: { paddingTop: spacing.sm, marginHorizontal: -spacing.gutter, paddingHorizontal: spacing.gutter },
  handle: { alignSelf: 'center', ...HANDLE, marginBottom: spacing.md, borderRadius: radius.pill },
  title: { ...type.heading, textAlign: 'center', marginBottom: spacing.sm },
  body: { flex: 1, marginHorizontal: -spacing.gutter },
});
