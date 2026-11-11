import { usePathname, useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCanReportBug } from '@/api/hooks';
import type { HeaderAction } from '@/components/Header';
import { HeaderLeadActionProvider } from '@/components/HeaderActionContext';
import { HitTarget, PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { useSession } from '@/state/session';
import { radius, size, spacing, type, useTheme } from '@/theme';

/**
 * The always-available Report a bug entry, for internal reporters only.
 *
 * It lives in the screen header: a `triangle-alert` action, first in the right-hand icons of every
 * screen that draws the shared Header. A bug is found on the screen where it happens, and walking
 * to Settings loses that screen (and the route the ticket should record), so the entry opens the
 * reporter as a modal over the current screen and hands it the route: one tap from wherever the
 * problem was. It used to be a floating pill, which covered content (a post's note on the Feed,
 * the Add Bev screen's sticky button); the header has room for it and covers nothing. Settings
 * keeps a row too, for anyone who looks there first.
 *
 * Nothing shows unless `bugs.canReport()` says yes, so an ordinary account's headers are exactly
 * as before. That is presentation, not protection: the server refuses the submission itself
 * (supabase/functions/bug-report).
 */

/** Routes the entry stays off: the reporter itself, and the full-screen modals with their own controls. */
const HIDDEN_PREFIXES = ['/report-bug', '/rank/', '/add/', '/image/'];

export function hidesLauncher(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export const REPORT_BUG_LABEL = 'Report a bug';

/**
 * Whether the entry shows here, and what pressing it does: open the reporter over the current
 * screen with that screen's route as `from`. `active` is false until the session is signed in, so
 * nothing is asked of the API before then and a cached answer from an earlier session can't show it.
 */
function useReportBugEntry(active: boolean): { show: boolean; open: () => void } {
  const router = useRouter();
  const pathname = usePathname();
  const { data: canReport } = useCanReportBug({ enabled: active });
  const show = active && canReport === true && !hidesLauncher(pathname);
  const open = useCallback(() => router.push({ pathname: '/report-bug', params: { from: pathname } }), [router, pathname]);
  return { show, open };
}

/** The header action, or `undefined` where it should not show. */
export function useReportBugAction(active = true): HeaderAction | undefined {
  const { show, open } = useReportBugEntry(active);
  return useMemo<HeaderAction | undefined>(
    () => (show ? { icon: 'triangle-alert', label: REPORT_BUG_LABEL, onPress: open } : undefined),
    [show, open],
  );
}

/**
 * Mounted once by the root layout around the Stack: supplies the Report a bug action to every
 * `Header` underneath (HeaderActionContext). `active` is the signed-in check.
 */
export function ReportBugHeaderAction({ active, children }: { active: boolean; children: ReactNode }) {
  const action = useReportBugAction(active);
  return <HeaderLeadActionProvider action={action}>{children}</HeaderLeadActionProvider>;
}

/**
 * The floating pill, kept only for a signed-in screen that draws no shared Header (the not-found
 * page), so a reporter is never left without an entry. Bottom-left, at the offset it always used.
 */
export function ReportBugLauncher() {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  // The not-found page is outside every session guard, so the pill checks the session itself.
  const ready = useSession((s) => s.status === 'ready');
  const { show, open } = useReportBugEntry(ready);
  if (!show) return null;

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + BOTTOM_OFFSET }]} pointerEvents="box-none">
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={REPORT_BUG_LABEL}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.surface, borderColor: colors.borderStrong, boxShadow: elevation.floating },
          pressed && PRESSED,
        ]}
      >
        {/* The visual is a 30pt pill; this gives it the 44pt hit area the design system requires. */}
        <HitTarget height={size.pill} borderWidth={1} />
        <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.primary} />
        <Text style={[type.caption, styles.label, { color: colors.text }]}>{REPORT_BUG_LABEL}</Text>
      </Pressable>
    </View>
  );
}

/** Clear of a tab bar's height above the safe area. */
const BOTTOM_OFFSET = 76;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.gutter, zIndex: 10 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: size.pill,
    minHeight: size.pill,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  label: { fontWeight: '600' },
});
