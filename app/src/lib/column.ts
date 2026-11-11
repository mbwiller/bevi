import { useWindowDimensions } from 'react-native';

/**
 * On a viewport bigger than a phone's the app is one phone-width column in the middle of the window
 * (design system README, "Layout and shape"). The column itself is CSS in `public/index.html`: `#root`
 * and every react-native-web Modal portal stop at this width there, under the media query
 * `(min-width: 481px) and (min-height: 481px)`. The window is still the whole browser window, so code
 * that sizes something by the window's width reads `columnWidth` / `useColumnWidth` instead.
 *
 * Both sides must exceed it: a phone is narrower in portrait and shorter in landscape (the largest
 * iPhone is 440 x 956pt), so no phone, in either orientation, ever gets the column.
 */
export const COLUMN_MAX_WIDTH = 480;

type WindowSize = { width: number; height: number };

/** True when the window is wider and taller than any phone: the app sits in the centred column. */
export function isWideViewport({ width, height }: WindowSize): boolean {
  return width > COLUMN_MAX_WIDTH && height > COLUMN_MAX_WIDTH;
}

/** The width the app's screens actually get: the column's on a wide viewport, the window's on a phone. */
export function columnWidth(window: WindowSize): number {
  return isWideViewport(window) ? COLUMN_MAX_WIDTH : window.width;
}

/** `columnWidth` of the live window. */
export function useColumnWidth(): number {
  return columnWidth(useWindowDimensions());
}
