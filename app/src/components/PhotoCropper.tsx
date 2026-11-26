import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { cropBase, cropFor, clampView, clampZoom, type CropView, type PhotoCrop } from '@/lib/photoCrop';
import { useWheel } from '@/lib/useWheel';
import { motion, spacing, type, useTheme } from '@/theme';

import { Button } from './Button';
import { NO_TRANSFORM } from './PressFeedback';

export { CROP_MAX_ZOOM, type PhotoCrop } from '@/lib/photoCrop';

export interface PhotoCropperProps {
  /** The picked photo, upright. */
  src: string;
  /** Its size in pixels: the crop is worked out from it. */
  width: number;
  height: number;
  /** "Use photo": the framed square, in the photo's own pixels. */
  onDone?: (crop: PhotoCrop) => void;
  /** "Cancel": nothing is uploaded and the photo stays as it was. */
  onCancel?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The ring round the circle (bundle.css `.bv-cropper-mask`: a 2px `onDeep` shadow). */
const RING = 2;
/** A double tap zooms to this (design system README). */
const DOUBLE_TAP_ZOOM = 2;
/** The web wheel's step (the reference's 1.1 per notch). */
const WHEEL_STEP = 1.1;
/** VoiceOver's swipe up / down. */
const A11Y_STEP = 0.5;
const SETTLE_MS = motion.base;
/** bundle.css `.bv-move-*`'s easing. */
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** The caption's one line and its `paddingTop` (`styles.hint`), before it has been measured. */
const CAPTION_ROOM = type.caption.lineHeight + spacing.md;
const A11Y_ACTIONS = [{ name: 'increment' as const }, { name: 'decrement' as const }];

function zoomValue(zoom: number): string {
  return `Zoom ${(Math.round(zoom * 10) / 10).toFixed(1)} times`;
}

/**
 * "Move and scale" (design system `PhotoCropper`): the step between picking a profile photo and
 * uploading it. The whole screen's content (the caller hosts it, `AvatarCropStep`): the title, a
 * square stage with the photo under the circle the Avatar will show, cut out of `photoScrim` and
 * ringed in `onDeep`, the caption, then "Use photo" and "Cancel".
 *
 * The photo is drawn at its zoom-1 size and moved with a transform only. Drag moves it, pinch zooms
 * about the fingers, a double tap zooms to 2 and back, and on the web the wheel zooms about the
 * circle's centre; every frame is clamped (`clampView`), so the photo always covers the circle.
 * With VoiceOver the stage is one adjustable element whose swipes zoom. The maths is
 * `@/lib/photoCrop`, the same as the design system's web reference.
 */
export function PhotoCropper({ src, width, height, onDone, onCancel, style }: PhotoCropperProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const [hint, setHint] = useState(0);
  const [zoomShown, setZoomShown] = useState(1);
  const stage = useRef<View>(null);

  // The square is as big as the room allows: the whole width on a phone, never taller than the space left over.
  // Until the caption is measured, its room is reserved from its type and padding, so the first frame
  // is already the right size and the stage does not shrink a frame later.
  const hintRoom = hint > 0 ? hint : CAPTION_ROOM;
  const side = Math.max(0, Math.floor(Math.min(room.width, room.height - hintRoom)));
  const d = Math.max(0, side - 2 * spacing.gutter);
  const base = cropBase(width, height, d);

  const zoom = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);
  const lastScale = useSharedValue(1);

  /** Puts the photo at `view`, clamped so it covers the circle. */
  const apply = (view: CropView) => {
    'worklet';
    const c = clampView(view, width, height, d);
    zoom.value = c.zoom;
    x.value = c.x;
    y.value = c.y;
  };
  const halt = () => {
    'worklet';
    cancelAnimation(zoom);
    cancelAnimation(x);
    cancelAnimation(y);
  };
  /** Zooms to `to` about the circle's centre: the point under it stays put. */
  const zoomAboutCentre = (to: number) => {
    'worklet';
    const next = clampZoom(to);
    const k = next / zoom.value;
    apply({ zoom: next, x: x.value * k, y: y.value * k });
  };

  // A resized stage (rotation, a window resize) keeps the same framing.
  const lastD = useRef(d);
  useEffect(() => {
    const was = lastD.current;
    lastD.current = d;
    if (was > 0 && d > 0 && was !== d) apply({ zoom: zoom.value, x: (x.value * d) / was, y: (y.value * d) / was });
    // `apply` closes over `d`, the only input that matters here.
  }, [d]);

  const pan = Gesture.Pan()
    .withTestId('photo-cropper-pan')
    .onStart((e) => {
      halt();
      lastX.value = e.translationX;
      lastY.value = e.translationY;
    })
    .onUpdate((e) => {
      const dx = e.translationX - lastX.value;
      const dy = e.translationY - lastY.value;
      lastX.value = e.translationX;
      lastY.value = e.translationY;
      apply({ zoom: zoom.value, x: x.value + dx, y: y.value + dy });
    });

  const pinch = Gesture.Pinch()
    .withTestId('photo-cropper-pinch')
    .onStart((e) => {
      halt();
      lastScale.value = e.scale;
    })
    .onUpdate((e) => {
      const ratio = lastScale.value > 0 ? e.scale / lastScale.value : 1;
      lastScale.value = e.scale;
      const next = clampZoom(zoom.value * ratio);
      const k = next / zoom.value;
      // The point under the fingers stays under them, as far as the clamp allows.
      const fx = e.focalX - side / 2;
      const fy = e.focalY - side / 2;
      apply({ zoom: next, x: fx - (fx - x.value) * k, y: fy - (fy - y.value) * k });
    })
    .onEnd(() => {
      runOnJS(setZoomShown)(zoom.value);
    });

  const doubleTap = Gesture.Tap()
    .withTestId('photo-cropper-double-tap')
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      if (!success) return;
      halt();
      // In to 2 times about the circle's centre, or from anything zoomed back to the start.
      const to =
        zoom.value > 1
          ? { zoom: 1, x: 0, y: 0 }
          : clampView({ zoom: DOUBLE_TAP_ZOOM, x: (x.value * DOUBLE_TAP_ZOOM) / zoom.value, y: (y.value * DOUBLE_TAP_ZOOM) / zoom.value }, width, height, d);
      if (reduced) {
        apply(to);
      } else {
        // Zoom and offset move together on one curve, so every frame in between still covers the circle.
        const timing = { duration: SETTLE_MS, easing: EASE };
        zoom.value = withTiming(to.zoom, timing);
        x.value = withTiming(to.x, timing);
        y.value = withTiming(to.y, timing);
      }
      runOnJS(setZoomShown)(to.zoom);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  /** The wheel and VoiceOver: a step in or out about the circle's centre. */
  const zoomBy = (to: (zoom: number) => number) => {
    if (!d) return;
    halt();
    zoomAboutCentre(to(zoom.value));
    setZoomShown(zoom.value);
  };
  useWheel(stage, (deltaY) => zoomBy((z) => (deltaY < 0 ? z * WHEEL_STEP : z / WHEEL_STEP)));
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'increment') zoomBy((z) => z + A11Y_STEP);
    else if (name === 'decrement') zoomBy((z) => z - A11Y_STEP);
  };

  const done = () => {
    if (!onDone || !d) return;
    onDone(cropFor({ zoom: zoom.value, x: x.value, y: y.value }, width, height, d));
  };

  const photoStyle = useAnimatedStyle(() => {
    const z = zoom.value;
    const tx = x.value;
    const ty = y.value;
    // No transform at rest (see PressFeedback's NO_TRANSFORM).
    return { transform: z === 1 && tx === 0 && ty === 0 ? NO_TRANSFORM : [{ translateX: tx }, { translateY: ty }, { scale: z }] };
  });

  const onRoom = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setRoom((r) => (r.width === w && r.height === h ? r : { width: w, height: h }));
  };
  const onHint = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHint(h);
  };

  const photoWidth = width * base;
  const photoHeight = height * base;
  // Wide enough that its outer edge clears the stage's corners whatever the circle's size.
  const scrimBorder = side;

  return (
    <View style={[styles.root, style]}>
      <Text style={[type.heading, styles.title, { color: colors.text }]} accessibilityRole="header">
        Move and scale
      </Text>
      <View style={styles.room} onLayout={onRoom} testID="photo-cropper-room">
        {side > 0 ? (
          <GestureDetector gesture={gesture} touchAction="none" userSelect="none">
            <View
              ref={stage}
              collapsable={false}
              testID="photo-cropper-stage"
              style={[styles.stage, { width: side, height: side, backgroundColor: colors.input }]}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Photo"
              accessibilityValue={{ text: zoomValue(zoomShown) }}
              accessibilityActions={A11Y_ACTIONS}
              onAccessibilityAction={onAccessibilityAction}
            >
              {d > 0 && base > 0 ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.photo,
                    { width: photoWidth, height: photoHeight, left: (side - photoWidth) / 2, top: (side - photoHeight) / 2 },
                    photoStyle,
                  ]}
                  testID="photo-cropper-photo"
                >
                  <Image
                    source={{ uri: src }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessible={false}
                    // Web: a mouse press on an <img> starts the browser's own image drag, which cancels the pan.
                    draggable={false}
                  />
                </Animated.View>
              ) : null}
              {/* The circle cut out of the scrim: a round View whose border is the scrim. */}
              <View
                pointerEvents="none"
                style={[
                  styles.mask,
                  {
                    left: spacing.gutter - scrimBorder,
                    top: spacing.gutter - scrimBorder,
                    width: d + 2 * scrimBorder,
                    height: d + 2 * scrimBorder,
                    borderRadius: d / 2 + scrimBorder,
                    borderWidth: scrimBorder,
                    borderColor: colors.photoScrim,
                  },
                ]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.mask,
                  {
                    left: spacing.gutter - RING,
                    top: spacing.gutter - RING,
                    width: d + 2 * RING,
                    height: d + 2 * RING,
                    borderRadius: d / 2 + RING,
                    borderWidth: RING,
                    borderColor: colors.onDeep,
                  },
                ]}
              />
            </View>
          </GestureDetector>
        ) : null}
        <Text style={[type.caption, styles.hint, { color: colors.textSecondary }]} onLayout={onHint}>
          Drag to move. Pinch to zoom.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="primary" block onPress={done}>
          Use photo
        </Button>
        <Button variant="ghost" block onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: { paddingVertical: spacing.lg, paddingHorizontal: spacing.gutter, textAlign: 'center' },
  room: { flex: 1, alignItems: 'center', overflow: 'hidden' },
  stage: { overflow: 'hidden' },
  photo: { position: 'absolute' },
  mask: { position: 'absolute' },
  hint: { alignSelf: 'stretch', paddingTop: spacing.md, paddingHorizontal: spacing.gutter, textAlign: 'center' },
  actions: { gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.gutter },
});
