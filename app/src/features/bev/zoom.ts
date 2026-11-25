/**
 * Maths for the full-screen image viewer's zoom. Positions are relative to the centre of the
 * image's box; the image is drawn at `size` (fitted, unzoomed), then scaled by `scale` about its
 * centre and moved by `x`/`y`. All are worklets so gestures can call them on the UI thread.
 */
export type Size = { width: number; height: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** What a double tap zooms to. */
export const DOUBLE_TAP_ZOOM = 2.5;

/** The size `contentFit="contain"` draws an image of `natural` size at inside `box`. */
export function fittedSize(box: Size, natural: Size | null): Size {
  'worklet';
  if (!natural || natural.width <= 0 || natural.height <= 0) return box;
  const ratio = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** The furthest the zoomed image may move on one axis and still cover the box (0 when it fits). */
export function maxOffset(fitted: number, box: number, scale: number): number {
  'worklet';
  return Math.max(0, (fitted * scale - box) / 2);
}

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Whether a point lands on the image as it is drawn now. */
export function isOnImage(px: number, py: number, fitted: Size, scale: number, x: number, y: number): boolean {
  'worklet';
  return Math.abs(px - x) <= (fitted.width * scale) / 2 && Math.abs(py - y) <= (fitted.height * scale) / 2;
}
