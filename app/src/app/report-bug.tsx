import { useLocalSearchParams, useRouter } from 'expo-router';
import { lazy, Suspense } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/Skeleton';
import { size, spacing, useTheme } from '@/theme';

// Loaded on demand: the reporter is internal-only, so no ordinary session should
// ever pay for the image picker and manipulator this pulls in.
const BugReportForm = lazy(() => import('@/features/bug-report/BugReportForm').then((m) => ({ default: m.BugReportForm })));

function Loading() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: colors.surface }]}>
      <View style={styles.body} accessibilityLabel="Loading" aria-busy>
        <Skeleton variant="text" width="50%" />
        <Skeleton variant="block" height={size.target} />
        <Skeleton variant="block" height={size.target * 2} />
      </View>
    </SafeAreaView>
  );
}

/**
 * The internal bug reporter (docs/bug-workflow.md), a full-screen modal so it
 * opens over whatever screen found the bug and closes back onto it.
 *
 * `?from=` carries that screen's route, which becomes the ticket's Screen line;
 * the launcher fills it. Showing this route is gated on `bugs.canReport()`, but
 * that is only a gate on the entry points: the server refuses a submission from
 * an account that is not an internal reporter, whatever reaches this URL.
 */
export default function ReportBugScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/feed'));
  return (
    <Suspense fallback={<Loading />}>
      <BugReportForm fromRoute={typeof from === 'string' ? from : undefined} onClose={close} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: spacing.lg, padding: spacing.gutter },
});
