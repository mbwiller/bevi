import { useContext, useMemo, type ReactNode } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * Web: a provider measures `env(safe-area-inset-*)` of the window, not of its own view, and
 * `SafeAreaView` pads by that in JS, so the screens below the notice would clear the status bar a
 * second time. While it shows, they get a top inset of 0 instead (the home-screen app's blur
 * clearance, StatusBarClearance, is already in the notice's own padding).
 */
export function BelowOfflineNotice({ noticeShown, children }: { noticeShown: boolean; children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  const value = useMemo<EdgeInsets | null>(
    () => (insets && noticeShown && insets.top ? { ...insets, top: 0 } : insets),
    [insets, noticeShown],
  );
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}
