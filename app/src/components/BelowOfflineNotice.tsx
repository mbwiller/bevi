import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Native: the screens' `SafeAreaView` takes the top inset of the nearest provider view, which is
 * UIKit's own and counts only the part of the safe area that view overlaps. A provider below the
 * notice therefore reports a top inset of 0 while it shows (the notice has cleared the status bar)
 * and the full inset when it does not. Always mounted, so a screen is never remounted by it.
 */
export function BelowOfflineNotice({ children }: { noticeShown: boolean; children: ReactNode }) {
  return <SafeAreaProvider>{children}</SafeAreaProvider>;
}
