import { View, type ViewStyle } from 'react-native';

import { size } from '@/theme';

/**
 * 44pt hit areas for controls drawn smaller than `size.target` (30pt Pills, 36pt Buttons, chips, tabs).
 *
 * Don't use `hitSlop`: react-native-web's Pressable ignores it. Instead put a `<HitTarget>` as the
 * first child of the Pressable, passing the visual's height (and width, if it can be narrower than
 * 44) and the Pressable's border width if it has one. It is a transparent, absolutely positioned box centred on the control and `size.target` tall,
 * so taps just outside the visual still land on (and bubble to) the Pressable, the way the design
 * system's `::before` expander does, without changing layout. The Pressable must not clip it
 * (no `overflow: 'hidden'`), and an ancestor that clips (a horizontal ScrollView) needs enough
 * vertical padding to keep the expander inside.
 *
 * Controls that can afford the layout space take `TARGET_MIN` on the Pressable instead (IconButton).
 */
export function HitTarget({ height, width, borderWidth = 0 }: { height: number; width?: number; borderWidth?: number }) {
  return <View style={hitTargetStyle(height, width, borderWidth)} testID="hit-target" />;
}

/** How far the expander reaches past a visual of `extent` pt on each side. */
export function hitInset(extent: number): number {
  return Math.max(0, (size.target - extent) / 2);
}

/** `borderWidth` is the Pressable's own border: absolute children are placed inside it, so the inset grows by it. */
export function hitTargetStyle(height: number, width?: number, borderWidth = 0): ViewStyle {
  const v = hitInset(height) + borderWidth;
  const h = (width == null ? 0 : hitInset(width)) + borderWidth;
  return { position: 'absolute', top: -v, bottom: -v, left: -h, right: -h };
}

/** For a Pressable that is itself the 44pt box, with the smaller visual centred inside. */
export const TARGET_MIN: ViewStyle = {
  minWidth: size.target,
  minHeight: size.target,
  alignItems: 'center',
  justifyContent: 'center',
};

/** Pressed state for Pills and Buttons, as the design system's `:active { filter: brightness(.94) }`. */
export const PRESSED: ViewStyle = { filter: 'brightness(0.94)' };
