import { useContext, useMemo, type ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

// iOS 26+ blurs the top of a home-screen web app (a Liquid Glass edge effect). What clears it depends on the status bar
// style iOS took when the icon was added, which the page can tell from the top inset. Measured on Matt's iPhone
// (402x874pt) with five test installs on 2026-11-09:
//
// - Translucent bar (older installs; top inset 62): the page runs under the status bar and the blur reaches about
//   40pt past the inset. A fixed strip doesn't stop it, so content moves below it: EDGE_BLUR_BAND.
// - Opaque bar (`default` / `black`, what public/index.html asks for now; top inset 0): the page starts below the
//   status bar, and the 12px fixed `#edge-strip` in index.html stops the blur. Content clears the strip: EDGE_STRIP.
//
// Neither is a design token: one is the OS's band, the other the strip's height.

/** How far iOS's blur reaches past the top inset when the page runs under a translucent status bar. */
export const EDGE_BLUR_BAND = 40;

/** Height of `#edge-strip` in public/index.html (`max(12px, env(safe-area-inset-top))`). */
export const EDGE_STRIP = 12;

/** True in the iPhone home-screen app. `navigator.standalone` exists only in iOS Safari and is true only there. */
export function isIosHomeScreenApp(): boolean {
  if (Platform.OS !== 'web') return false;
  return (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

/**
 * Extra top inset in the home-screen app in portrait (landscape hides the status bar, and the strip with it): the
 * blur band under a translucent status bar (top inset > 0), else the strip's height under an opaque one.
 */
export function edgeBlurClearance(
  homeScreenApp: boolean,
  window: { width: number; height: number },
  topInset: number,
): number {
  if (!homeScreenApp || window.height < window.width) return 0;
  return topInset > 0 ? EDGE_BLUR_BAND : EDGE_STRIP;
}

/**
 * Adds `edgeBlurClearance` to the top safe-area inset below it, so every screen's `SafeAreaView edges={['top']}`
 * (and `Sheet`'s height cap) starts its content clear of the blur or the strip. Mounted once in the root layout,
 * inside `SafeAreaProvider`; everywhere else the insets are unchanged.
 */
export function StatusBarClearance({ children }: { children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  const window = useWindowDimensions();
  const extra = insets ? edgeBlurClearance(isIosHomeScreenApp(), window, insets.top) : 0;
  const value = useMemo<EdgeInsets | null>(
    () => (insets && extra ? { ...insets, top: insets.top + extra } : insets),
    [insets, extra],
  );
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}
