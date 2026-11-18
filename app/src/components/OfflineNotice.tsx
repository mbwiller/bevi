import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useContext } from 'react';

import { MAX_FONT_SCALE_DENSE, spacing, type, useTheme } from '@/theme';
import { useOnline } from '@/lib/useOnline';

import { Icon } from './Icon';
import { BelowOfflineNotice } from './BelowOfflineNotice';

/** Same words as `errorCopy`'s `network` title (src/lib/errorCopy.ts). */
export const OFFLINE_NOTICE = "You're offline";

/**
 * "You're offline", across the top of the app while the phone has no connection (`useOnline`: only
 * a definite "no connection" counts). It clears the status bar itself, so it sits in the layout
 * rather than over a screen's header, back button or sticky action.
 */
export function OfflineNotice() {
  const { colors } = useTheme();
  const top = useContext(SafeAreaInsetsContext)?.top ?? 0;
  return (
    <View
      testID="offline-notice"
      role="status"
      accessibilityLiveRegion="polite"
      style={[styles.strip, { paddingTop: top + spacing.sm, backgroundColor: colors.surface, borderBottomColor: colors.border }]}
    >
      <Icon name="wifi-off" size={16} strokeWidth={2} color={colors.textSecondary} />
      <Text style={[type.caption, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}>
        {OFFLINE_NOTICE}
      </Text>
    </View>
  );
}

/**
 * The root of the app's layout: the notice above, then the app. A column that is always there, so
 * the notice coming and going never remounts a screen. `BelowOfflineNotice` hands the screens the
 * safe area as it is below the notice, which has already cleared the status bar.
 */
export function OfflineNoticeHost({ children }: { children: ReactNode }) {
  const online = useOnline();
  return (
    <View style={styles.fill}>
      {online ? null : <OfflineNotice />}
      <BelowOfflineNotice noticeShown={!online}>{children}</BelowOfflineNotice>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
});
