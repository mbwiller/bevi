import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCanReportBug } from '@/api/hooks';
import { HitTarget, PRESSED } from '@/components/HitTarget';
import { Icon } from '@/components/Icon';
import { radius, size, spacing, type, useTheme } from '@/theme';

/**
 * The always-available Report a bug control, for internal reporters only.
 *
 * Why it floats rather than living in Settings alone: a bug is found on the
 * screen where it happens, and walking to Settings loses that screen (and the
 * route the ticket should record). This opens a modal over the current screen
 * and hands it the route, so reporting costs one tap from wherever the problem
 * was. Settings keeps a row too, for anyone who looks there first.
 *
 * It renders nothing at all unless `bugs.canReport()` says yes, so an ordinary
 * account never sees it. That is presentation, not protection: the server
 * refuses the submission itself (supabase/functions/bug-report).
 */
export function ReportBugLauncher() {
  const { colors, elevation } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { data: canReport } = useCanReportBug();

  // Never over the reporter itself, and never over the full-screen modals,
  // whose bottom-left corner holds their own controls (the rank flow's
  // bucket buttons, the create wizard, the photo viewer).
  if (!canReport || hidesLauncher(pathname)) return null;

  return (
    <View
      // The bar sits above the tab bar's safe area, out of the thumb's way at
      // the bottom-left where no screen puts a primary action.
      style={[styles.wrap, { bottom: insets.bottom + BOTTOM_OFFSET }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => router.push({ pathname: '/report-bug', params: { from: pathname } })}
        accessibilityRole="button"
        accessibilityLabel="Report a bug"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.surface, borderColor: colors.borderStrong, boxShadow: elevation.floating },
          pressed && PRESSED,
        ]}
      >
        {/* The visual is a 30pt pill; this gives it the 44pt hit area the design system requires. */}
        <HitTarget height={size.pill} borderWidth={1} />
        <Icon name="triangle-alert" size={18} strokeWidth={2} color={colors.primary} />
        <Text style={[type.caption, styles.label, { color: colors.text }]}>Report a bug</Text>
      </Pressable>
    </View>
  );
}

/** Routes the launcher stays off: the reporter, and the full-screen modals. */
const HIDDEN_PREFIXES = ['/report-bug', '/rank/', '/add/', '/image/'];

export function hidesLauncher(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** Clear of the 5-tab bar, which the tab screens draw above the safe area. */
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
