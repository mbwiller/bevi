import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { NO_TRANSFORM } from '@/components/PressFeedback';
import { project, RUBBER, SETTLE, settle } from '@/lib/fling';
import { motion, spacing, useTheme } from '@/theme';

import { takeImageOrigin, windowRect } from './imageOrigin';
import { clamp, DOUBLE_TAP_ZOOM, fittedSize, isOnImage, MAX_ZOOM, MIN_ZOOM, maxOffset, type Size } from './zoom';

export interface ImageViewerProps {
  /** The picture, or null when the address was not one: "Image not available". */
  url: string | null;
  /** Leave the viewer (go back). Called once, after the picture has gone. */
  onClose: () => void;
}

/** A release headed further down than this share of the screen's height closes the viewer. */
const LEAVE_SHARE = 0.2;
/** Dragged down by this share of the height, the screen behind shows through completely. */
const CLEAR_SHARE = 0.45;
/** How much smaller the picture is once dragged a full screen down. */
const DRAG_SHRINK = 0.35;
/** The Close button is gone by the time the picture has been dragged this far (pt). */
const CHROME_FADE = 80;
/** With no frame to grow from, the picture arrives from this scale, centred. */
const FROM_CENTRE = 0.92;
/** The share of the opening over which the picture itself fades in (and of the closing over which it fades out). */
const PICTURE_FADE = 0.4;
/** A drag starts once the finger has moved this far up or down, and not at all if it went this far sideways first. */
const DRAG_SLOP = 8;
const SIDE_FAIL = 24;
/** bundle.css `.bv-move-*`'s easing. */
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** If the closing animation never reports its end, the viewer still leaves after this long. */
const LEAVE_FALLBACK_MS = 600;
/** A tap that moves further than this (pt) is a drag, not a tap: it neither closes nor zooms. */
const TAP_SLOP = 10;

/**
 * The full-screen picture (§6.19): a Bev's photo or nutrition label fitted to the screen, over the
 * page it was opened from. The route is a transparent modal with no transition of its own
 * (app/_layout.tsx), so everything that moves is drawn here.
 *
 * It grows out of the picture that was tapped (`openingFrom`, imageOrigin.ts) while the page dims
 * behind it, and goes back into it on Close. With nothing to grow from (a link, a reload) it comes
 * up from the centre.
 *
 * Swipe down to leave: the picture follows the finger and shrinks a little, and the page shows
 * through more the further it goes. Let go and it is judged by where it was heading (`project`):
 * far enough down and it closes, carrying on at the finger's speed; otherwise it springs back into
 * place, with no wobble. Pulled up or sideways it only gives a little (`RUBBER`).
 *
 * Pinch or double tap to zoom; zoomed, one finger moves the picture about instead of swiping it
 * away, and a double tap fits it again. A tap anywhere off the picture closes the viewer.
 *
 * Under Reduce Motion it fades in and out and nothing moves but the drag itself.
 */
export function ImageViewer({ url, onClose }: ImageViewerProps) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const body = useRef<View>(null);

  // 0: not there (the page as it was). 1: open.
  const open = useSharedValue(0);
  // Where the picture's frame starts and ends: an offset from its own centre, and a scale.
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const fromScale = useSharedValue(reduced ? 1 : FROM_CENTRE);
  // Whether there is a frame to go back into; without one a swipe sends the picture off the bottom.
  const anchored = useSharedValue(false);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const closing = useSharedValue(false);
  // Whether the pan that is running swipes the picture away (unzoomed) or moves it about (zoomed).
  const swiping = useSharedValue(false);

  // Zoom: the picture's box (the body inside its padding), the picture's own pixel size once it has
  // loaded, and the zoom's scale and offset from the box's centre.
  const box = useSharedValue<Size>({ width: 0, height: 0 });
  const natural = useSharedValue<Size | null>(null);
  const zoom = useSharedValue(MIN_ZOOM);
  const zoomX = useSharedValue(0);
  const zoomY = useSharedValue(0);
  const zoomStart = useSharedValue({ scale: MIN_ZOOM, x: 0, y: 0, focalX: 0, focalY: 0 });

  useLayoutEffect(() => {
    const origin = takeImageOrigin();
    const frame = windowRect(body.current);
    if (origin && frame && !reduced) {
      fromX.value = origin.x + origin.width / 2 - (frame.x + frame.width / 2);
      fromY.value = origin.y + origin.height / 2 - (frame.y + frame.height / 2);
      fromScale.value = origin.width / frame.width;
      anchored.value = true;
    }
    open.value = reduced ? withTiming(1, { duration: motion.fast }) : withSpring(1, SETTLE);
    // Mount only: the viewer opens once.
  }, []);

  /** Zooms to `scale` and offset, kept within their limits: never smaller than fitted, never off the box. */
  const zoomTo = (scale: number, x: number, y: number) => {
    'worklet';
    const s = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    const fitted = fittedSize(box.value, natural.value);
    const mx = maxOffset(fitted.width, box.value.width, s);
    const my = maxOffset(fitted.height, box.value.height, s);
    const duration = reduced ? 0 : motion.base;
    zoom.value = withTiming(s, { duration, easing: EASE });
    zoomX.value = withTiming(clamp(x, -mx, mx), { duration, easing: EASE });
    zoomY.value = withTiming(clamp(y, -my, my), { duration, easing: EASE });
  };

  // A gesture's point is from the body's corner; the zoom's maths works from the box's centre.
  const fromCentre = (px: number, py: number) => {
    'worklet';
    return { cx: px - spacing.gutter - box.value.width / 2, cy: py - spacing.gutter - box.value.height / 2 };
  };

  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    onClose();
  }, [onClose]);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (fallback.current && clearTimeout(fallback.current)), []);
  const armFallback = useCallback(() => {
    fallback.current = setTimeout(leave, LEAVE_FALLBACK_MS);
  }, [leave]);

  /** Close from where the picture is now, at the finger's speed (0 for the Close button). */
  const close = (velocityX: number, velocityY: number) => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    runOnJS(armFallback)();
    // Fitted again, so it goes back into its frame whole.
    zoomTo(MIN_ZOOM, 0, 0);
    if (anchored.value) {
      // Back into the frame it came from.
      dragX.value = withSpring(0, settle(velocityX));
      dragY.value = withSpring(0, settle(velocityY));
    } else if (dragY.value > 0 && !reduced) {
      // Nothing to go back into: off the bottom, the way it was already going.
      dragY.value = withSpring(windowHeight, settle(velocityY));
    }
    open.value = withTiming(0, { duration: reduced ? motion.fast : motion.base, easing: EASE }, (finished) => {
      if (finished) runOnJS(leave)();
    });
  };
  const closeNow = () => close(0, 0);

  const pinch = Gesture.Pinch()
    .withTestId('image-viewer-pinch')
    .onStart((e) => {
      if (closing.value) return;
      const { cx, cy } = fromCentre(e.focalX, e.focalY);
      zoomStart.value = { scale: zoom.value, x: zoomX.value, y: zoomY.value, focalX: cx, focalY: cy };
    })
    .onUpdate((e) => {
      if (closing.value) return;
      // It gives a little past its limits while held, and settles back on release.
      const s = clamp(zoomStart.value.scale * e.scale, MIN_ZOOM / 2, MAX_ZOOM * 1.5);
      const ratio = s / zoomStart.value.scale;
      const { cx, cy } = fromCentre(e.focalX, e.focalY);
      // The point under the fingers stays under the fingers.
      zoom.value = s;
      zoomX.value = cx - (zoomStart.value.focalX - zoomStart.value.x) * ratio;
      zoomY.value = cy - (zoomStart.value.focalY - zoomStart.value.y) * ratio;
    })
    .onEnd(() => {
      if (closing.value) return;
      if (zoom.value <= MIN_ZOOM) zoomTo(MIN_ZOOM, 0, 0);
      else zoomTo(zoom.value, zoomX.value, zoomY.value);
    });

  // Zoomed, one finger moves the picture about, in any direction.
  const move = Gesture.Pan()
    .withTestId('image-viewer-move')
    .maxPointers(1)
    .onStart(() => {
      zoomStart.value = { ...zoomStart.value, x: zoomX.value, y: zoomY.value };
    })
    .onUpdate((e) => {
      if (closing.value || zoom.value <= MIN_ZOOM) return;
      zoomX.value = zoomStart.value.x + e.translationX;
      zoomY.value = zoomStart.value.y + e.translationY;
    })
    .onEnd(() => {
      // Always settled, even if the zoom reached fitted mid-drag (a double tap still running), so it never rests off-centre.
      if (closing.value) return;
      zoomTo(zoom.value, zoomX.value, zoomY.value);
    });

  const doubleTap = Gesture.Tap()
    .withTestId('image-viewer-double-tap')
    .numberOfTaps(2)
    .maxDistance(TAP_SLOP)
    .onEnd((e) => {
      if (closing.value) return;
      if (zoom.value > MIN_ZOOM) {
        zoomTo(MIN_ZOOM, 0, 0);
        return;
      }
      // In about the tapped point, so it stays where it was.
      const { cx, cy } = fromCentre(e.x, e.y);
      zoomTo(DOUBLE_TAP_ZOOM, cx * (1 - DOUBLE_TAP_ZOOM), cy * (1 - DOUBLE_TAP_ZOOM));
    });

  // A tap off the picture closes, as the Close button does.
  const tap = Gesture.Tap()
    .withTestId('image-viewer-tap')
    .maxDistance(TAP_SLOP)
    .onEnd((e) => {
      const { cx, cy } = fromCentre(e.x, e.y);
      // Zoomed, the picture is clipped to its box: the padding around it is off it.
      const inBox = Math.abs(cx) <= box.value.width / 2 && Math.abs(cy) <= box.value.height / 2;
      if (!inBox || !isOnImage(cx, cy, fittedSize(box.value, natural.value), zoom.value, zoomX.value, zoomY.value)) close(0, 0);
    });

  const pan = Gesture.Pan()
    .withTestId('image-viewer-pan')
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-SIDE_FAIL, SIDE_FAIL])
    // Two fingers are a pinch.
    .maxPointers(1)
    .onStart((e) => {
      // Zoomed, `move` has the finger instead.
      swiping.value = zoom.value <= MIN_ZOOM;
      if (closing.value || !swiping.value) return;
      // Catch it where it is (a spring back may still be running), so it never jumps to the finger.
      grabX.value = e.translationX - dragX.value / RUBBER;
      grabY.value = e.translationY - (dragY.value > 0 ? dragY.value : dragY.value / RUBBER);
    })
    .onUpdate((e) => {
      if (closing.value || !swiping.value) return;
      const y = e.translationY - grabY.value;
      dragX.value = (e.translationX - grabX.value) * RUBBER;
      dragY.value = y > 0 ? y : y * RUBBER;
    })
    .onEnd((e, success) => {
      if (closing.value || !swiping.value) return;
      // Judged by where the release was heading, not where the finger lifted. A cancelled pan stays.
      if (success && dragY.value + project(e.velocityY) > windowHeight * LEAVE_SHARE) {
        close(e.velocityX * RUBBER, e.velocityY);
      } else {
        dragX.value = withSpring(0, settle(e.velocityX * RUBBER));
        dragY.value = withSpring(0, settle(e.velocityY > 0 ? e.velocityY : e.velocityY * RUBBER));
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, move, Gesture.Exclusive(doubleTap, tap));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    box.value = { width: width - spacing.gutter * 2, height: height - spacing.gutter * 2 };
  };

  const down = () => {
    'worklet';
    return Math.max(0, dragY.value);
  };
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: open.value * (1 - Math.min(1, down() / (windowHeight * CLEAR_SHARE))),
  }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: open.value * (1 - Math.min(1, down() / CHROME_FADE)),
  }));
  const pictureStyle = useAnimatedStyle(() => {
    const away = 1 - open.value;
    const x = away * fromX.value + dragX.value;
    const y = away * fromY.value + dragY.value;
    const scale = (1 + away * (fromScale.value - 1)) * (1 - Math.min(1, down() / windowHeight) * DRAG_SHRINK);
    return {
      opacity: Math.min(1, open.value / PICTURE_FADE),
      // No transform at rest (see PressFeedback's NO_TRANSFORM).
      transform: x === 0 && y === 0 && scale === 1 ? NO_TRANSFORM : [{ translateX: x }, { translateY: y }, { scale }],
    };
  });

  const zoomStyle = useAnimatedStyle(() => ({
    transform:
      zoom.value === MIN_ZOOM && zoomX.value === 0 && zoomY.value === 0
        ? NO_TRANSFORM
        : [{ translateX: zoomX.value }, { translateY: zoomY.value }, { scale: zoom.value }],
  }));

  return (
    // The modal is presented outside the app's root view on iOS, so its gesture needs a root of its own.
    <GestureHandlerRootView style={styles.fill}>
      <View
        style={styles.fill}
        testID="image-viewer"
        // The page stays drawn behind a transparent modal: keep VoiceOver in the viewer.
        {...(Platform.OS === 'web' ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Image' } : { accessibilityViewIsModal: true })}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }, scrimStyle]} testID="image-viewer-scrim" />
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.fill}>
          <Animated.View style={chromeStyle}>
            <Header style={styles.header} actions={[{ icon: 'x', label: 'Close', variant: 'filled', onPress: closeNow }]} />
          </Animated.View>
          <GestureDetector gesture={gesture}>
            <View ref={body} style={styles.body} collapsable={false} onLayout={onLayout} testID="image-viewer-body">
              <Animated.View style={[styles.picture, pictureStyle]} testID="image-viewer-picture">
                {url && !failed ? (
                  <Animated.View style={[styles.fill, zoomStyle]}>
                    <Image
                      source={{ uri: url }}
                      style={styles.fill}
                      contentFit="contain"
                      accessibilityLabel="Full-screen image"
                      accessibilityHint="Pinch or double tap to zoom. Tap outside the image to close."
                      // Web: a mouse press on an <img> starts the browser's own image drag, which cancels the swipe.
                      draggable={false}
                      onLoad={(e) => {
                        natural.value = { width: e.source.width, height: e.source.height };
                      }}
                      onError={() => setFailed(true)}
                    />
                  </Animated.View>
                ) : (
                  <ErrorState title="Image not available" message="Go back and try again." icon="image" />
                )}
              </Animated.View>
            </View>
          </GestureDetector>
        </SafeAreaView>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Zoomed, the picture stays inside its box, so it never covers Close.
  picture: { flex: 1, overflow: 'hidden' },
  // The page shows through while the picture is dragged, so the header has no band of its own.
  header: { backgroundColor: 'transparent' },
  body: { flex: 1, justifyContent: 'center', padding: spacing.gutter },
});
