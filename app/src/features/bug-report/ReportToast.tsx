import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { BUTTON_SIZE, buttonBottom } from './ReportButton';
import { REPORT_UI, useLayer } from './ReportLayer';
import { hideToast, openRank, sheetsAvailable, useReport } from './store';

const TOAST_MS = 4000;

/**
 * "Filed BEV-14", for about four seconds, just above the floating button. "Place it" starts ranking the ticket
 * when there is at least one other open ticket to compare it with, and only for an account that may
 * rank: the host's `canPlace` answers false for a tester (ReportHost, `bugs.canRank()`).
 */
export function ReportToast({ canPlace }: { canPlace: (ticketId: string) => boolean }) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const layer = useLayer();
  const keyboard = useKeyboardInset();
  const toast = useReport((s) => s.toast);
  const panelHeight = useReport((s) => (s.panel === 'open' && s.draft ? s.panelHeight : 0));
  // Over a full-screen flow the rank sheet can't open (capabilities.ts), so the toast just says it was filed.
  const sheets = useReport(sheetsAvailable);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => hideToast(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  // A note open over the keyboard may reach the top of the screen: the toast then stays on screen,
  // over the note's top edge, instead of above it and out of sight. (On the web the layer's height
  // already has the keyboard taken out, and `bottom` is measured from under the keyboard.)
  const screen = Platform.OS === 'web' ? layer.height + keyboard : layer.height;
  const bottom = toastBottom(buttonBottom(insets.bottom, panelHeight) + BUTTON_SIZE + spacing.sm, screen, insets.top);
  const place = toast.duplicate || !sheets ? false : canPlace(toast.ticketId);
  return (
    <View
      {...REPORT_UI}
      style={[
        styles.toast,
        { right: spacing.sm },
        { bottom, backgroundColor: colors.surface, borderColor: colors.border, boxShadow: elevation.floating },
      ]}
      accessibilityLiveRegion="polite"
      role="status"
    >
      <Text style={[type.body, styles.text, { color: colors.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE} numberOfLines={1}>
        {toast.duplicate ? `Already filed as ${toast.ticketId}` : `Filed ${toast.ticketId}`}
      </Text>
      {place ? (
        <Button variant="ghost" onPress={() => openRank([toast.ticketId])} accessibilityLabel={`Place ${toast.ticketId}`}>
          Place it
        </Button>
      ) : null}
    </View>
  );
}

/** Where the toast's bottom goes: where it was asked to, or as high as leaves all of it on a `screen` tall. */
export function toastBottom(wanted: number, screen: number, topInset: number): number {
  return Math.min(wanted, Math.max(0, screen - topInset - size.target - spacing.sm));
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: size.target,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  text: { fontWeight: '600' },
});
