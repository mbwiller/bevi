/**
 * Where the keyboard's top edge is, in the same window coordinates `measureInWindow` reports: the
 * layout viewport's height minus the part the keyboard hides (`useKeyboardInset`). On the web that
 * height must be `window.innerHeight`, which iOS Safari keeps fixed while the keyboard is open.
 * react-native-web's `useWindowDimensions().height` is the visual viewport there, already shrunk by
 * the keyboard, so subtracting the inset from it would count the keyboard twice.
 */
export function keyboardTop(layoutHeight: number, inset: number): number {
  return layoutHeight - inset;
}

/** How far to raise content whose bottom edge sits at `bottom` so the keyboard doesn't cover it. */
export function footLift(bottom: number, top: number): number {
  return Math.max(0, Math.round(bottom - top));
}
