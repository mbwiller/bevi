import { createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, type NativeGesture } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { COLUMN_MAX_WIDTH, isWideViewport } from '@/lib/column';
import { nearest, project, RUBBER, settle } from '@/lib/fling';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { motion, radius, spacing, type, useTheme } from '@/theme';

export interface SheetProps {
  open?: boolean;
  /** Shown centred under the handle and used as the dialog's accessible name. */
  title?: string;
  /** Height as a percentage of the window. */
  snap?: 40 | 60 | 90;
  /**
   * The sheet opens at `snap`, and its top drags up to the whole screen (below the status bar),
   * where it rests too. From there it comes back down to `snap`, or closes, by how the finger let
   * go. For a sheet people stay in (CommentsSheet). It goes to the whole screen by itself while the
   * keyboard is up.
   */
  expand?: boolean;
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
  /**
   * Pinned under the body, on the bottom edge of the screen at whichever height the sheet rests and
   * all the way between them (CommentsSheet's composer); it leaves with the sheet. With `scroll={false}`.
   */
  footer?: ReactNode;
  /**
   * With `scroll={false}`, on a phone: how far the body's own list is scrolled, kept up to date by
   * the caller (0 when nothing in it scrolls). With it the body moves the sheet as its top does: a
   * drag down while the list is at its top, and a drag up while the sheet is at `snap`. Any other
   * drag is the list's own scroll. The list must scroll in a `SheetScrollView`, which waits for the
   * sheet to say whose touch it is.
   */
  scrollTop?: SharedValue<number>;
}

// From bundle.css: the handle bar and the sheet's easing.
const HANDLE = { width: 36, height: 5 };
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/**
 * Where a release is heading decides what the sheet does (`project`, lib/fling.ts). Heading past
 * this share of the way from its lowest resting height to the bottom edge, it closes: leaving is the
 * easy direction, so it wins before the halfway point.
 */
const CLOSE_AT = 0.35;
/** A drag only starts once the finger has moved this far, so a tap on the title stays a tap. */
const DRAG_SLOP = 6;
/** A drag on the body that goes this far sideways first is not for the sheet. */
const SIDE_SLOP = 12;
/** A flung sheet is sent this far past the bottom edge, so it is off the screen before it is unmounted. */
const PAST_EDGE = 32;
/** How long a flung sheet has to get there (its spring has all but stopped by then). */
const FLING_OUT_MS = 400;
/** A parent that has not closed a flung sheet by now ignored `onClose`: the sheet comes back. */
const IGNORED_MS = 350;
/** The panel's own colour carries on this far below it, so a spring that lands a little high uncovers nothing. */
const BLEED = 120;
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

/** The scroll gesture of the list inside a Sheet whose body can move it (`scrollTop`); null in any other sheet. */
const SheetScrollContext = createContext<NativeGesture | null>(null);

/**
 * The ScrollView for a list inside a Sheet that takes `scrollTop` (pass it as FlashList's
 * `renderScrollComponent`). There its scroll waits for the Sheet's own drag to decline the touch,
 * which it does within a few points unless the touch is the sheet's. Without that the two start in
 * the same instant on a quick flick and the list wins it, bouncing where the sheet should have
 * moved. In any other sheet, and on the web, it is a plain ScrollView.
 */
export const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(props, ref) {
  const scrolling = useContext(SheetScrollContext);
  const view = <ScrollView ref={ref} {...props} />;
  return scrolling ? <GestureDetector gesture={scrolling}>{view}</GestureDetector> : view;
});

/**
 * Bottom sheet over a `scrim`, at 40%, 60% or 90% of the window. Built on React Native's Modal (a
 * portal on the web, with its own Escape handling and focus trap), Reanimated and Gesture Handler. It
 * slides up from the bottom edge and back down.
 *
 * The top of the panel (the handle and the title) is a grab area: drag it and the sheet follows the
 * finger, the scrim fading as it goes down. Letting go is judged by where the release was heading,
 * not by where the finger lifted (`project`, lib/fling.ts): heading far enough down, the sheet
 * closes (`onClose`); otherwise it goes to its nearest resting height. Either way it carries on at
 * the finger's own speed on a spring that does not wobble (`settle`), so a quick flick closes it
 * however short, and a slow small drag goes back. Pulled above its top it only gives a little.
 * It also closes with the scrim, Escape or a row inside.
 *
 * `expand`: a second resting height, the whole screen below the status bar. The sheet opens at
 * `snap`; its top drags up to the whole screen and back, and from the whole screen a quick swipe
 * down closes it outright while a slower one stops at `snap`. The panel is always laid out at the
 * whole screen's height and slid down to `snap`, so moving between the two is a transform only:
 * `footer` is slid back up by the same amount to stay on the bottom edge, and the body is padded by
 * it once the sheet rests at `snap`, so its last rows are not under the fold.
 *
 * Only the top grabs on the web: there a gesture claims its view's touches (`touch-action: none`),
 * which would stop the body from scrolling. On a phone a body that scrolls itself can move the
 * sheet too (`scrollTop`).
 *
 * On a wide viewport the scrim and the panel stay inside the app's centred column (`lib/column.ts`).
 * The Modal's portal is a child of `<body>`, outside `#root`, so `public/index.html` also narrows the
 * portal itself; this keeps the sheet in the column even if that CSS doesn't match.
 */
export function Sheet({ open = false, title, snap = 40, expand = false, onClose, onClosed, children, scroll = true, footer, scrollTop }: SheetProps) {
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
  // and SafetyFlow read `visualViewport` themselves), so there it only tells an `expand` sheet to
  // take the whole screen.
  const keyboardSeen = useKeyboardInset(mounted && (Platform.OS !== 'web' || expand));
  const keyboard = Platform.OS === 'web' ? 0 : keyboardSeen;
  const keyboardUp = keyboardSeen > 0;
  const tallest = windowHeight - safeTop - keyboard;
  const snapHeight = Math.min((windowHeight * snap) / 100, tallest);
  // The panel's laid-out height: the whole screen for an `expand` sheet, which is slid down to `snap`.
  const height = expand ? tallest : snapHeight;
  // How far an `expand` sheet at `snap` is slid down from the whole screen. None while the keyboard is up.
  const fold = expand && !keyboardUp ? height - snapHeight : 0;
  const reduced = useReducedMotion();
  // How far the panel is slid down from its laid-out place: 0 at its tallest, `fold` at `snap`,
  // `height` when it is off the bottom edge. Negative while it is pulled above its top.
  const y = useSharedValue(open ? fold : height);
  // Where it rests now: 0 or `fold`.
  const rest = useSharedValue(fold);
  // The finger's travel, less the panel's own, when a drag took hold: the panel moves from where it is, without a jump.
  const grabFrom = useSharedValue(0);
  // Whether the body is padded by `fold` (the sheet rests at `snap`).
  const [folded, setFolded] = useState(expand);
  const panel = useRef<View>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // `onClosed`: armed while mounted, fired once when the close is complete. No `onDismiss` exists on
  // the web (react-native-web) or Android, so there it fires as soon as the Sheet unmounts its Modal.
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const awaitingClose = useRef(false);
  // A sheet that has never opened has nothing to close: no close animation, no timers.
  const everOpened = useRef(open);
  if (open) everOpened.current = true;
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
    if (!awaitingClose.current) return;
    if (Platform.OS !== 'ios') {
      fireClosed();
      return;
    }
    const t = setTimeout(fireClosed, DISMISS_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [mounted]);

  // Whether this close was asked for by a release that is already carrying the panel off the bottom.
  const flung = useRef(false);
  const ignored = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (ignored.current && clearTimeout(ignored.current)), []);
  // The geometry the last opening or resting used, so the effect below only answers a change.
  const laidOut = useRef({ fold, height });

  useEffect(() => {
    if (open) {
      // Each opening starts at `snap`, from off the bottom edge (unless it is caught on its way out).
      if (!stillMounted.current) y.value = height;
      setMounted(true);
      setFolded(expand);
      rest.value = fold;
      laidOut.current = { fold, height };
      y.value = reduced ? fold : withTiming(fold, { duration: motion.base, easing: EASE });
      return;
    }
    if (!everOpened.current) return;
    const wasFlung = flung.current;
    flung.current = false;
    if (ignored.current) clearTimeout(ignored.current);
    if (reduced) {
      y.value = height + keyboard;
      setMounted(false);
      return;
    }
    // From wherever the panel is: a close in the middle of a drag never lurches back up first. A
    // flung sheet is already on its way out at the finger's speed (`release`); any other close takes
    // the sheet's own easing. `+ keyboard`: the panel is that much taller once the keyboard has gone.
    if (!wasFlung) y.value = withTiming(height + keyboard, { duration: motion.base, easing: EASE });
    const t = setTimeout(() => setMounted(false), wasFlung ? FLING_OUT_MS : motion.base);
    return () => clearTimeout(t);
    // Only `open` (and Reduce Motion) starts an opening or a closing: the shared values are not
    // dependencies, and the geometry is read as it is at that moment (the effect below follows it).
  }, [open, reduced]);

  // The keyboard, a rotation or a resized window changes where the sheet rests: go there. With the
  // keyboard up an `expand` sheet takes the whole screen, and stays there once it is down again.
  useEffect(() => {
    const was = laidOut.current;
    if (!open || (was.fold === fold && was.height === height)) return;
    laidOut.current = { fold, height };
    const stayTall = expand && (keyboardUp || rest.value === 0);
    const to = stayTall ? 0 : fold;
    rest.value = to;
    setFolded(to > 0);
    y.value = reduced ? to : withTiming(to, { duration: motion.base, easing: EASE });
  }, [open, fold, height, keyboardUp, expand, reduced]);

  // Called when a release is heading off the bottom; the panel is already on its way there. A parent
  // may close a moment later (a state update, a navigation), so it is given `IGNORED_MS`; one that
  // keeps the sheet open (it ignored onClose) gets it back in place rather than left off the screen.
  const dismiss = () => {
    flung.current = true;
    onClose?.();
    if (ignored.current) clearTimeout(ignored.current);
    ignored.current = setTimeout(() => {
      if (!openRef.current) return;
      flung.current = false;
      y.value = withSpring(rest.value, settle(0));
    }, IGNORED_MS);
  };
  const canDismiss = !!onClose;
  // The body is padded once the sheet has landed at `snap` (under the footer, unseen), and unpadded
  // as it leaves for the whole screen (the extra room is still under the fold then).
  const land = (tall: boolean) => {
    if (tall) setFolded(false);
  };
  const landed = (tall: boolean) => {
    if (!tall && openRef.current) setFolded(true);
  };

  /** A drag takes hold: remember the finger against the panel as it is (a spring may still be moving it). */
  const take = (translationY: number) => {
    'worklet';
    grabFrom.value = translationY - (y.value < 0 ? y.value / RUBBER : y.value);
  };
  /** The panel follows the finger; above its top it only gives a little. */
  const follow = (translationY: number) => {
    'worklet';
    const to = translationY - grabFrom.value;
    y.value = to < 0 ? to * RUBBER : to;
  };
  /** Let go: judged by where the release was heading. A cancelled drag (`success` false) goes back. */
  const release = (velocityY: number, success: boolean) => {
    'worklet';
    if (!success) {
      y.value = withSpring(rest.value, settle(0));
      return;
    }
    const heading = y.value + project(velocityY);
    if (canDismiss && heading > fold + (height - fold) * CLOSE_AT) {
      // Off the bottom at the finger's own speed, at once: nothing waits for the parent to answer.
      y.value = withSpring(height + keyboard + PAST_EDGE, settle(velocityY));
      runOnJS(dismiss)();
      return;
    }
    const to = fold > 0 ? nearest(heading, [0, fold]) : 0;
    const tall = to === 0 && fold > 0;
    rest.value = to;
    if (fold > 0) runOnJS(land)(tall);
    y.value = withSpring(to, settle(velocityY), (finished) => {
      if (finished && fold > 0) runOnJS(landed)(tall);
    });
  };

  const draggable = open && (canDismiss || expand);
  const grab = Gesture.Pan()
    .withTestId('sheet-grab')
    // Not while it is closing: a second drag would move the panel that is leaving and close it twice.
    .enabled(draggable)
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .onStart((e) => take(e.translationY))
    .onUpdate((e) => follow(e.translationY))
    .onEnd((e, success) => release(e.velocityY, success));

  // The body's own drag (`scrollTop`). It starts by hand, so the list keeps every touch that is its
  // own: down while the list is at its top moves the sheet, and so does up while the sheet is at
  // `snap`; anything else fails this pan at once and the list scrolls as it would without it.
  // Whether the body has the drag at all decides the tree's shape, so it must not change while the
  // sheet is open or closing (that would remount the body mid-exit); `enabled` turns it off instead.
  const bodyDrags = !scroll && !!scrollTop && Platform.OS !== 'web';
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  // Whether this touch has been given to the sheet or to the list yet: it is decided once.
  const decided = useSharedValue(true);
  // The list's own scroll (SheetScrollView): it waits until this pan has declined the touch.
  const listScroll = useMemo(() => Gesture.Native(), []);
  const bodyGrab = Gesture.Pan()
    .withTestId('sheet-body')
    .enabled(bodyDrags && draggable)
    .manualActivation(true)
    .blocksExternalGesture(listScroll)
    .onTouchesDown((e) => {
      const touch = e.allTouches[0];
      if (!touch) return;
      touchX.value = touch.absoluteX;
      touchY.value = touch.absoluteY;
      decided.value = false;
    })
    .onTouchesMove((e, manager) => {
      if (decided.value) return;
      const touch = e.allTouches[0];
      if (!touch) return;
      const dx = touch.absoluteX - touchX.value;
      const dy = touch.absoluteY - touchY.value;
      // Down while the list is at its top, or up while the sheet is at `snap`, is the sheet's.
      const mine = dy > DRAG_SLOP ? (scrollTop?.value ?? 0) <= 0 : dy < -DRAG_SLOP ? rest.value > 0 && y.value > 0 : null;
      const sideways = Math.abs(dx) > SIDE_SLOP && Math.abs(dx) > Math.abs(dy);
      if (e.numberOfTouches !== 1 || sideways || mine === false) {
        decided.value = true;
        manager.fail();
      } else if (mine) {
        decided.value = true;
        manager.activate();
      }
    })
    .onStart((e) => take(e.translationY))
    .onUpdate((e) => follow(e.translationY))
    .onEnd((e, success) => release(e.velocityY, success));

  // Full while the sheet is at or above its lowest resting height; it fades as the sheet goes down from there.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (height - y.value) / Math.max(1, height - fold))),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    // No transform at rest (see PressFeedback's NO_TRANSFORM).
    transform: y.value === 0 ? [] : [{ translateY: y.value }],
  }));
  // Back up by as much as the panel is slid down, as far as `snap`: on the bottom edge of the screen
  // between the two heights. Below `snap` it goes down with the panel.
  const footerStyle = useAnimatedStyle(() => {
    const up = Math.min(y.value, fold);
    return { transform: up === 0 ? [] : [{ translateY: -up }] };
  });

  // Move focus into the sheet once it is on screen, so keyboard and screen-reader users start there.
  const focusPanel = () => (panel.current as unknown as { focus?: () => void } | null)?.focus?.();

  const bottomPadding = sheetBottomPadding(insets?.bottom ?? 0, keyboard);
  const content = scroll ? (
    // "handled": with the keyboard up a tap on a row or button works at once, rather than the first tap only dismissing it.
    <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View testID="sheet-body" style={[styles.body, folded && fold > 0 && { paddingBottom: fold }]}>
      {children}
    </View>
  );

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
              // A footer carries the bottom padding itself, so nothing of the body shows under it.
              footer ? null : bottomPadding,
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
            {bodyDrags ? (
              <SheetScrollContext.Provider value={listScroll}>
                <GestureDetector gesture={bodyGrab}>{content}</GestureDetector>
              </SheetScrollContext.Provider>
            ) : (
              content
            )}
            {footer ? (
              <Animated.View testID="sheet-footer" style={[styles.footer, bottomPadding, { backgroundColor: colors.surface }, footerStyle]}>
                {footer}
              </Animated.View>
            ) : null}
            <View style={[styles.bleed, { backgroundColor: colors.surface }]} pointerEvents="none" aria-hidden />
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
  footer: { marginHorizontal: -spacing.gutter },
  bleed: { position: 'absolute', left: 0, right: 0, top: '100%', height: BLEED },
});
