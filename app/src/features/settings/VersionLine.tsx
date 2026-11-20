import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { crashNatively, crashReportingEnabled, sendTestError } from '@/lib/crashReporting';
import { size, spacing, type, useTheme } from '@/theme';

/** How the test error's message starts (lib/crashReporting.ts, `sendTestError`), so the alert can say what to look for. */
const TEST_ERROR_NAME = 'Bevi crash reporting test';

/**
 * Asks before doing either: one choice files a JavaScript error and the app carries on, the other
 * crashes the app in native code. The crash is only sent when the app is opened again, which the
 * message says, because a founder who does not reopen it will wait for a report that never left.
 */
function confirmCrashTest(): void {
  Alert.alert(
    'Test crash reporting',
    'Sends a test report from this build. Crashing closes Bevi at once: open it again so the report is sent.',
    [
      {
        text: 'Send a test error',
        onPress: () => {
          sendTestError();
          Alert.alert('Test error filed', `Look for "${TEST_ERROR_NAME}" in Sentry in a minute or two.`);
        },
      },
      { text: 'Crash Bevi now', style: 'destructive', onPress: crashNatively },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

/**
 * The version at the foot of Settings. The native file. On a build that reports crashes (an iOS
 * build with a DSN, lib/crashReporting.ts) it is also the way to prove that reporting works end to
 * end: press and hold it, and it offers a test error and a test crash, behind a confirmation. On
 * any other build it is the line of text it always was and nothing can be pressed. The web build
 * resolves VersionLine.web.tsx, which is only ever the line of text.
 */
export function VersionLine({ version }: { version: string }) {
  const { colors } = useTheme();
  const label = `Bevi ${version}`;
  if (!crashReportingEnabled()) {
    return <Text style={[type.caption, styles.line, { color: colors.textSecondary }]}>{label}</Text>;
  }
  return (
    <Pressable
      onLongPress={confirmCrashTest}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to test crash reporting"
      accessibilityActions={[{ name: 'longpress', label: 'Test crash reporting' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') confirmCrashTest();
      }}
      style={[styles.line, styles.target]}
    >
      <Text style={[type.caption, { color: colors.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  target: { minHeight: size.target },
});
