/**
 * The maths behind the PhotoCropper ("Move and scale", design system `PhotoCropper`): where a
 * photo may sit under the circle, and which square of it that framing is. The same maths as the
 * design system's web reference (`design/system/src/primitives.jsx`, `PhotoCropper`); keep the two
 * equal. Every function is a worklet: the cropper's gestures clamp on the UI thread every frame.
 *
 * A view is `{ zoom, x, y }`: `zoom` 1 is "the photo just fills the circle", and `x`, `y` are how far
 * the photo's centre is from the circle's centre, in points.
 */

/** How far past "just fills the circle" a photo can be zoomed (design system `CROP_MAX_ZOOM`). */
export const CROP_MAX_ZOOM = 4;

/** The square of a photo framed in the PhotoCropper, in the photo's own pixels (`x`, `y`: its top-left corner). */
export interface PhotoCrop {
  x: number;
  y: number;
  size: number;
}

/** A framing of the photo under the circle. */
export interface CropView {
  zoom: number;
  x: number;
  y: number;
}

/** Points per photo pixel at zoom 1: the photo's shorter side spans the circle's diameter `d`. */
export function cropBase(width: number, height: number, d: number): number {
  'worklet';
  const short = Math.min(width, height);
  return short > 0 && d > 0 ? d / short : 0;
}

/** `zoom` kept within [1, `CROP_MAX_ZOOM`]. */
export function clampZoom(zoom: number): number {
  'worklet';
  return Math.min(CROP_MAX_ZOOM, Math.max(1, zoom));
}

/** How far the photo's centre may move from the circle's along a side of `length` px, at `zoom`. */
export function cropReach(length: number, base: number, zoom: number, d: number): number {
  'worklet';
  return Math.max(0, (length * base * zoom - d) / 2);
}

/** `view` with its zoom in range and the photo covering the circle: it stops at its own edges. */
export function clampView(view: CropView, width: number, height: number, d: number): CropView {
  'worklet';
  const base = cropBase(width, height, d);
  const zoom = clampZoom(view.zoom);
  const maxX = cropReach(width, base, zoom, d);
  const maxY = cropReach(height, base, zoom, d);
  // `+ 0` turns a -0 (from `-maxX` when it is 0) into 0.
  return { zoom, x: Math.min(maxX, Math.max(-maxX, view.x)) + 0, y: Math.min(maxY, Math.max(-maxY, view.y)) + 0 };
}

/**
 * The square inside the circle for `view`, in the photo's pixels: rounded to whole pixels and kept
 * inside the photo. The view is clamped first, so any view gives a square the photo covers.
 */
export function cropFor(view: CropView, width: number, height: number, d: number): PhotoCrop {
  'worklet';
  const v = clampView(view, width, height, d);
  const base = cropBase(width, height, d);
  const short = Math.min(width, height);
  const size = short / v.zoom;
  const scale = base * v.zoom;
  const x = width / 2 - (scale > 0 ? v.x / scale : 0) - size / 2;
  const y = height / 2 - (scale > 0 ? v.y / scale : 0) - size / 2;
  const whole = Math.max(1, Math.min(Math.round(size), width, height));
  return {
    x: Math.min(width - whole, Math.max(0, Math.round(x))),
    y: Math.min(height - whole, Math.max(0, Math.round(y))),
    size: whole,
  };
}
