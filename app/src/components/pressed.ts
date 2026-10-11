import type { ViewStyle } from 'react-native';

import { size } from '@/theme';

/** Pressed state for Pills and Buttons, as the design system's `:active { filter: brightness(.94) }`. */
export const PRESSED: ViewStyle = { filter: 'brightness(0.94)' };

/** Extra hit area that brings a control of height `h` up to the 44pt target. */
export function hitSlopFor(h: number) {
  const v = Math.max(0, Math.ceil((size.target - h) / 2));
  return v ? { top: v, bottom: v } : undefined;
}
