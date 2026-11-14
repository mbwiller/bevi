import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { useReducedTransparency } from '@/lib/glass';
import { MAX_FONT_SCALE_DENSE, motion, radius, size, spacing, type, useTheme } from '@/theme';

import type { Dock } from './draft';
import { safePickAt } from './engine';
import { REPORT_UI, useLayer } from './ReportLayer';
import { hasFailed, isSending, markLevels, openReports, pressDrop, setDock, setPicking, useReport } from './store';

/**
 * The drop: the reporter's one entry, floating at the edge of every signed-in screen.
 *
 * Press it to capture the screen (or reopen the note), hold it for the reports sheet, drag it onto
 * something to point at it: the component under its tip lights up with its name, and letting go
 * marks it. Let go of it in the strip along either edge and it docks there instead.
 *
 * The gesture is raw pointer events (react-native-web forwards onPointerDown/Move/Up on a View),
 * captured to the drop so a drag can leave it, with `touch-action: none` so it never scrolls the
 * page. The drop follows the finger through Reanimated shared values, so a move re-renders nothing;
 * the highlight changes only when the component under the tip does (store.setPicking).
 */

/** The drop's 44pt target; the teardrop is drawn inside it. */
const BOX_W = size.target;
const BOX_H = 52;
const DROP_W = 32;
const DROP_H = 44;
const DROP_LEFT = (BOX_W - DROP_W) / 2;
const DROP_TOP = (BOX_H - DROP_H) / 2;
/** The tip, the pick point, in the box's coordinates. */
const TIP_X = BOX_W / 2;
const TIP_Y = DROP_TOP + 1;
/** While dragging the tip rides this far above the finger, so the finger doesn't cover what it points at. */
export const TIP_ABOVE = 36;
/** Movement under this is still a press. */
export const SLOP = 8;
export const LONG_PRESS_MS = 500;
/** A tip this close to the column's left or right edge is in the dock strip: no highlight, and letting go docks. */
export const DOCK_STRIP = 28;
/** Clear of a tab bar's height above the safe area. */
const TAB_BAR_CLEARANCE = 76;
const REST_OPACITY = 0.92;

/** Teardrop, tip up: a circle of radius 15 at (16, 28), its sides meeting at (16, 1). */
const DROP_PATH = 'M16 1 C16 1 31 17 31 28 A15 15 0 0 1 1 28 C1 17 16 1 16 1 Z';

/** The box's height, for what sits next to the drop (the toast). */
export const DROP_BOX_H = BOX_H;

/** Where the drop rests until the tester moves it: the right edge, just above the tab bar. */
export function defaultDock(insetBottom: number): Dock {
  return { side: 'right', bottom: insetBottom + TAB_BAR_CLEARANCE + spacing.sm };
}

export function inDockStrip(tipX: number, width: number): boolean {
  return tipX <= DOCK_STRIP || tipX >= width - DOCK_STRIP;
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  origin: { x: number; y: number };
  moved: boolean;
  long: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  tip: { x: number; y: number };
}

/** The fields of a DOM PointerEvent this reads; React's synthetic event or the native one. */
type PointerLike = { clientX?: number; clientY?: number; pageX?: number; pageY?: number; pointerId?: number };

function pointOf(e: unknown): { x: number; y: number; id: number } {
  const ev = e as { nativeEvent?: PointerLike } & PointerLike;
  const n = ev.nativeEvent ?? ev;
  return { x: n.clientX ?? n.pageX ?? 0, y: n.clientY ?? n.pageY ?? 0, id: n.pointerId ?? 1 };
}

export function ReportDrop({ toPlace }: { toPlace: number }) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const layer = useLayer();
  const reduced = useReducedMotion();
  // Resting slightly see-through, so it reads as floating over the app; solid under Reduce Transparency.
  const solid = useReducedTransparency();
  const dockSaved = useReport((s) => s.dock);
  const panelOpen = useReport((s) => s.panel === 'open' && s.draft !== null && s.sheet === null);
  const panelHeight = useReport((s) => s.panelHeight);
  const aside = useReport((s) => s.draft !== null && s.panel === 'closed');
  const sending = useReport(isSending);
  const failed = useReport(hasFailed);
  const [dragging, setDragging] = useState(false);

  const minBottom = insets.bottom + spacing.sm;
  const maxBottom = Math.max(minBottom, layer.height - insets.top - spacing.sm - BOX_H);
  const dock: Dock = dockSaved ?? defaultDock(insets.bottom);
  const restBottom = Math.min(maxBottom, Math.max(minBottom, panelOpen ? Math.max(dock.bottom, panelHeight + spacing.sm) : dock.bottom));
  const restX = dock.side === 'right' ? layer.width - BOX_W : 0;
  const restY = layer.height - restBottom - BOX_H;

  const x = useSharedValue(restX);
  const y = useSharedValue(restY);
  const gesture = useRef<Gesture | null>(null);
  const lastGestureEnd = useRef(0);
  const node = useRef<View>(null);

  const moveTo = useCallback(
    (toX: number, toY: number, animate: boolean) => {
      if (!animate || reduced) {
        x.value = toX;
        y.value = toY;
      } else {
        x.value = withSpring(toX, motion.springy);
        y.value = withSpring(toY, motion.springy);
      }
    },
    [reduced, x, y],
  );

  // Back to the dock whenever it, the layer or the note moves (not mid-drag).
  useEffect(() => {
    if (!gesture.current?.moved) moveTo(restX, restY, true);
  }, [restX, restY, moveTo]);

  // On the web: no scrolling, text selection or callout from a press on the drop.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = node.current as unknown as HTMLElement | null;
    if (!el?.style) return;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.style.userSelect = 'none';
    el.style.setProperty('-webkit-user-select', 'none');
    el.style.setProperty('-webkit-touch-callout', 'none');
  }, []);

  const pickAtTip = useCallback((g: Gesture) => {
    const levels = inDockStrip(g.tip.x, layer.width) ? [] : safePickAt(g.tip.x + g.origin.x, g.tip.y + g.origin.y);
    setPicking(levels.length ? levels : null);
    return levels;
  }, [layer.width]);

  const end = useCallback(() => {
    const g = gesture.current;
    if (g?.timer) clearTimeout(g.timer);
    if (g?.frame != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(g.frame);
    gesture.current = null;
    lastGestureEnd.current = Date.now();
    setDragging(false);
  }, []);

  const onPointerDown = useCallback(
    (e: unknown) => {
      const p = pointOf(e);
      const target = (e as { currentTarget?: { setPointerCapture?: (id: number) => void } }).currentTarget;
      try {
        target?.setPointerCapture?.(p.id);
      } catch {
        // A synthetic pointer (a screen reader's) can't be captured; the gesture still works.
      }
      if (gesture.current?.timer) clearTimeout(gesture.current.timer);
      const g: Gesture = {
        pointerId: p.id,
        startX: p.x,
        startY: p.y,
        startedAt: Date.now(),
        origin: layer.origin(),
        moved: false,
        long: false,
        timer: null,
        frame: null,
        tip: { x: 0, y: 0 },
      };
      g.timer = setTimeout(() => {
        if (gesture.current !== g || g.moved) return;
        g.long = true;
        openReports();
      }, LONG_PRESS_MS);
      gesture.current = g;
    },
    [layer],
  );

  const onPointerMove = useCallback(
    (e: unknown) => {
      const g = gesture.current;
      if (!g || g.long) return;
      const p = pointOf(e);
      if (!g.moved) {
        if (Math.hypot(p.x - g.startX, p.y - g.startY) < SLOP) return;
        g.moved = true;
        if (g.timer) clearTimeout(g.timer);
        g.timer = null;
        setDragging(true);
      }
      g.tip = { x: p.x - g.origin.x, y: p.y - g.origin.y - TIP_ABOVE };
      x.value = g.tip.x - TIP_X;
      y.value = g.tip.y - TIP_Y;
      // One pick per frame, at the latest tip.
      if (g.frame == null) {
        const run = () => {
          g.frame = null;
          if (gesture.current === g) pickAtTip(g);
        };
        g.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : null;
        if (g.frame == null) run();
      }
    },
    [pickAtTip, x, y],
  );

  const onPointerUp = useCallback(
    (e: unknown) => {
      const g = gesture.current;
      if (!g) return;
      if (g.long) {
        end();
        return;
      }
      if (!g.moved) {
        end();
        pressDrop();
        return;
      }
      const p = pointOf(e);
      g.tip = { x: p.x - g.origin.x, y: p.y - g.origin.y - TIP_ABOVE };
      if (inDockStrip(g.tip.x, layer.width)) {
        setPicking(null);
        const dropBottom = layer.height - (g.tip.y - TIP_Y) - BOX_H;
        setDock({ side: g.tip.x < layer.width / 2 ? 'left' : 'right', bottom: Math.round(Math.min(maxBottom, Math.max(minBottom, dropBottom))) });
        end();
        return;
      }
      const levels = pickAtTip(g);
      end();
      if (levels.length) markLevels(levels);
      else setPicking(null);
      moveTo(restX, restY, true);
    },
    [end, layer.height, layer.width, maxBottom, minBottom, moveTo, pickAtTip, restX, restY],
  );

  const onPointerCancel = useCallback(() => {
    end();
    setPicking(null);
    moveTo(restX, restY, true);
  }, [end, moveTo, restX, restY]);

  // A screen reader's activation or a keyboard arrives as a click or a key, with no pointer gesture before it.
  const onClick = useCallback(() => {
    if (Date.now() - lastGestureEnd.current < 700 || gesture.current) return;
    pressDrop();
  }, []);
  const onKeyDown = useCallback((e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const key = e.key ?? e.nativeEvent?.key;
    if (key === 'Enter' || key === ' ') {
      e.preventDefault?.();
      pressDrop();
    }
  }, []);

  const position = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  const states = [
    aside ? 'Note set aside' : null,
    sending ? 'Sending' : null,
    toPlace > 0 ? `${toPlace} to place` : null,
    failed ? "A report didn't send" : null,
  ].filter(Boolean);

  return (
    <Animated.View
      ref={node}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Report"
      accessibilityHint="Drag onto something to point at it, or press to capture the screen"
      accessibilityValue={states.length ? { text: states.join(', ') } : undefined}
      focusable
      testID="report-drop"
      {...REPORT_UI}
      {...({
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onClick,
        onKeyDown,
        onContextMenu: (e: { preventDefault?: () => void }) => e.preventDefault?.(),
        tabIndex: 0,
      } as object)}
      style={[
        styles.box,
        { opacity: dragging || solid ? 1 : REST_OPACITY, filter: `drop-shadow(${elevation.floating})` },
        position,
      ]}
    >
      <Svg width={DROP_W} height={DROP_H} viewBox={`0 0 ${DROP_W} ${DROP_H}`} style={styles.svg} pointerEvents="none">
        <Path d={DROP_PATH} fill={colors.primary} />
      </Svg>
      {sending ? <SendingRing color={colors.onPrimary} reduced={reduced} /> : null}
      {toPlace > 0 ? (
        <View style={styles.centre} pointerEvents="none">
          <Text style={[styles.count, { color: colors.onPrimary }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
            {toPlace > 9 ? '9+' : String(toPlace)}
          </Text>
        </View>
      ) : aside ? (
        <View style={styles.centre} pointerEvents="none">
          <View style={[styles.dot, { backgroundColor: colors.onPrimary }]} testID="report-drop-aside" />
        </View>
      ) : null}
      {failed ? (
        <View
          style={[styles.alert, { backgroundColor: colors.badgeRed, borderColor: colors.surface }]}
          pointerEvents="none"
          testID="report-drop-failed"
        />
      ) : null}
    </Animated.View>
  );
}

/** A ring turning round the drop's body while a report files; still under Reduce Motion. */
function SendingRing({ color, reduced }: { color: string; reduced: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={[styles.ring, spin]} pointerEvents="none" testID="report-drop-sending">
      <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 2} stroke={color} strokeWidth={2} strokeDasharray="12 8" fill="none" />
      </Svg>
    </Animated.View>
  );
}

const RING = 24;
/** The body's centre in the box: the circle at (16, 28) of the teardrop. */
const BODY_X = DROP_LEFT + 16;
const BODY_Y = DROP_TOP + 28;

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 0, top: 0, width: BOX_W, height: BOX_H },
  svg: { position: 'absolute', left: DROP_LEFT, top: DROP_TOP },
  centre: {
    position: 'absolute',
    left: BODY_X - 12,
    top: BODY_Y - 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  count: { ...type.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ring: { position: 'absolute', left: BODY_X - RING / 2, top: BODY_Y - RING / 2, width: RING, height: RING },
  alert: { position: 'absolute', left: BODY_X + 6, top: DROP_TOP + 8, width: 12, height: 12, borderRadius: radius.pill, borderWidth: 2 },
});
