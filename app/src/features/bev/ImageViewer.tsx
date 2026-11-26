import { Image } from 'expo-image';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { NO_TRANSFORM } from '@/components/PressFeedback';
import { project, RUBBER, SETTLE, settle } from '@/lib/fling';
import { motion, radius, spacing, useTheme } from '@/theme';

import { type Rect, takeImageOrigin, windowRect } from './imageOrigin';

export interface ImageViewerProps {
  /** The picture, or null when the address was not one: "Image not available". */
  url: string | null;
  /** Leave the viewer (go back). Called once, after the picture has gone. */
  onClose: () => void;
  /**
   * A profile photo (T-29): drawn as the largest circle the screen holds, cropped to fill it, and
   * grown out of the small round avatar it was opened from.
   */
  round?: boolean;
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
 * Under Reduce Motion it fades in and out and nothing moves but the drag itself.
 *
 * `round` (a profile photo) draws the picture as a circle of diameter D, the smaller side of the
 * body inside its padding, centred where the rectangle would be; it grows from scale
 * `origin.width / D`, so at the start it sits exactly over the avatar that was tapped.
 */
export function ImageViewer({ url, onClose, round = false }: ImageViewerProps) {
  const { colors } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const body = useRef<View>(null);
  // The round picture's diameter, once the body has been measured; until then a guess from the window.
  const [measured, setMeasured] = useState<number | null>(null);
  const circle = round && !!url && !failed;
  const diameter = measured ?? diameterIn(windowWidth, windowHeight);

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

  useLayoutEffect(() => {
    const origin = takeImageOrigin();
    const frame = windowRect(body.current);
    if (origin && frame && !reduced) {
      const from = openingTransform(origin, frame, round);
      fromX.value = from.x;
      fromY.value = from.y;
      fromScale.value = from.scale;
      anchored.value = true;
    }
    if (round && frame) setMeasured(diameterIn(frame.width, frame.height));
    open.value = reduced ? withTiming(1, { duration: motion.fast }) : withSpring(1, SETTLE);
    // Mount only: the viewer opens once.
  }, []);

  // A round photo that fails to load shows the plain "Image not available" state: that closes as a
  // viewer with nothing to go back into does, not by shrinking into the avatar.
  const failRound = () => {
    setFailed(true);
    anchored.value = false;
    fromX.value = 0;
    fromY.value = 0;
    fromScale.value = reduced ? 1 : FROM_CENTRE;
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

  const pan = Gesture.Pan()
    .withTestId('image-viewer-pan')
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-SIDE_FAIL, SIDE_FAIL])
    .onStart((e) => {
      if (closing.value) return;
      // Catch it where it is (a spring back may still be running), so it never jumps to the finger.
      grabX.value = e.translationX - dragX.value / RUBBER;
      grabY.value = e.translationY - (dragY.value > 0 ? dragY.value : dragY.value / RUBBER);
    })
    .onUpdate((e) => {
      if (closing.value) return;
      const y = e.translationY - grabY.value;
      dragX.value = (e.translationX - grabX.value) * RUBBER;
      dragY.value = y > 0 ? y : y * RUBBER;
    })
    .onEnd((e, success) => {
      if (closing.value) return;
      // Judged by where the release was heading, not where the finger lifted. A cancelled pan stays.
      if (success && dragY.value + project(e.velocityY) > windowHeight * LEAVE_SHARE) {
        close(e.velocityX * RUBBER, e.velocityY);
      } else {
        dragX.value = withSpring(0, settle(e.velocityX * RUBBER));
        dragY.value = withSpring(0, settle(e.velocityY > 0 ? e.velocityY : e.velocityY * RUBBER));
      }
    });

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
          <GestureDetector gesture={pan}>
            <View
              ref={body}
              style={styles.body}
              collapsable={false}
              onLayout={round ? (e) => setMeasured(diameterIn(e.nativeEvent.layout.width, e.nativeEvent.layout.height)) : undefined}
            >
              {circle ? (
                <Animated.View
                  style={[styles.circle, { width: diameter, height: diameter, backgroundColor: colors.avatarFill }, pictureStyle]}
                  testID="image-viewer-picture"
                >
                  <Image
                    source={{ uri: url }}
                    style={styles.fill}
                    contentFit="cover"
                    accessibilityLabel="Profile photo"
                    draggable={false}
                    onError={failRound}
                  />
                </Animated.View>
              ) : (
                <Animated.View style={[styles.fill, pictureStyle]} testID="image-viewer-picture">
                  {url && !failed ? (
                    <Image
                      source={{ uri: url }}
                      style={styles.fill}
                      contentFit="contain"
                      accessibilityLabel="Full-screen image"
                      // Web: a mouse press on an <img> starts the browser's own image drag, which cancels the swipe.
                      draggable={false}
                      onError={() => setFailed(true)}
                    />
                  ) : (
                    <ErrorState title="Image not available" message="Go back and try again." icon="image" />
                  )}
                </Animated.View>
              )}
            </View>
          </GestureDetector>
        </SafeAreaView>
      </View>
    </GestureHandlerRootView>
  );
}

/** The largest circle inside a body of this size, within its padding. */
function diameterIn(width: number, height: number): number {
  return Math.max(0, Math.min(width, height) - 2 * spacing.gutter);
}

/**
 * Where the picture starts as it opens from `origin`: the offset from the body's centre to the
 * origin's centre, and the scale that makes it the origin's width. The rectangle is scaled against
 * the body's whole width; the round picture against its diameter, so it starts exactly over the avatar.
 */
export function openingTransform(origin: Rect, frame: Rect, round: boolean): { x: number; y: number; scale: number } {
  return {
    x: origin.x + origin.width / 2 - (frame.x + frame.width / 2),
    y: origin.y + origin.height / 2 - (frame.y + frame.height / 2),
    scale: origin.width / (round ? diameterIn(frame.width, frame.height) : frame.width),
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The page shows through while the picture is dragged, so the header has no band of its own.
  header: { backgroundColor: 'transparent' },
  body: { flex: 1, justifyContent: 'center', padding: spacing.gutter },
  circle: { alignSelf: 'center', borderRadius: radius.pill, overflow: 'hidden' },
});
