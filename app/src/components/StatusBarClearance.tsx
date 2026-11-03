import { useContext, useMemo, type ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * Height of the soft blur iOS 26+ draws under the status bar of a home-screen web app, measured from the top
 * safe-area inset. It is system chrome (a Liquid Glass scroll-edge effect over the web view): no CSS, meta
 * tag or status-bar style turns it off, in light or dark mode, so anything in it (a screen's title row, the
 * wordmark, a sheet's handle) reads as out of focus. About 38–40pt on an iPhone in portrait; not a design
 * token, it is the OS's number.
 */
export const EDGE_BLUR_BAND = 40;

/** True in the iPhone home-screen app. `navigator.standalone` exists only in iOS Safari and is true only there. */
export function isIosHomeScreenApp(): boolean {
  if (Platform.OS !== 'web') return false;
  return (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

/** Extra top inset for the blur band: the home-screen app in portrait only (landscape hides the status bar). */
export function edgeBlurClearance(homeScreenApp: boolean, window: { width: number; height: number }): number {
  return homeScreenApp && window.height >= window.width ? EDGE_BLUR_BAND : 0;
}

/**
 * Adds `EDGE_BLUR_BAND` to the top safe-area inset below it, so every screen's `SafeAreaView edges={['top']}`
 * (and `Sheet`'s height cap) starts its content under the blur instead of inside it. The band itself shows the
 * screen's own `surface`, so the blur has nothing to smear. Mounted once in the root layout, inside
 * `SafeAreaProvider`; everywhere else the insets are unchanged.
 */
export function StatusBarClearance({ children }: { children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  const window = useWindowDimensions();
  const extra = edgeBlurClearance(isIosHomeScreenApp(), window);
  const value = useMemo<EdgeInsets | null>(
    () => (insets && extra ? { ...insets, top: insets.top + extra } : insets),
    [insets, extra],
  );
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}
