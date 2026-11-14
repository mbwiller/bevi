import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { MAX_FONT_SCALE_DENSE, radius, size, spacing, type, useTheme } from '@/theme';

import { defaultDock, DROP_BOX_H } from './ReportDrop';
import { REPORT_UI } from './ReportLayer';
import { hideToast, openRank, useReport } from './store';

const TOAST_MS = 4000;

/**
 * "Filed BEV-14", for about four seconds, next to the drop. "Place it" starts ranking the ticket
 * when there is at least one other open ticket to compare it with.
 */
export function ReportToast({ canPlace }: { canPlace: (ticketId: string) => boolean }) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useReport((s) => s.toast);
  const dock = useReport((s) => s.dock);
  const panelHeight = useReport((s) => (s.panel === 'open' && s.draft ? s.panelHeight : 0));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => hideToast(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  const { side, bottom: dockBottom } = dock ?? defaultDock(insets.bottom);
  const bottom = Math.max(dockBottom, panelHeight + spacing.sm) + DROP_BOX_H + spacing.sm;
  const place = toast.duplicate ? false : canPlace(toast.ticketId);
  return (
    <View
      {...REPORT_UI}
      style={[
        styles.toast,
        side === 'right' ? { right: spacing.sm } : { left: spacing.sm },
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
