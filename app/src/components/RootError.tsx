import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { captureError } from '@/lib/crashReporting';
import { scrubText } from '@/lib/crashScrub';
import { spacing, type, useTheme } from '@/theme';

import { StateMessage } from './EmptyState';
import { Pill } from './Pill';

/**
 * What the app shows when a screen throws while it renders: the root layout's `ErrorBoundary`
 * (src/app/_layout.tsx). Without it the error is uncaught, which on a phone closes the app.
 *
 * Expo Router renders this *in place of* the root layout, so nothing the layout provides is here:
 * no QueryClientProvider, no SafeAreaProvider of the app's own, no gesture root, no session gate.
 * So it uses none of them. It reads colours from the system appearance (`useTheme`), draws the
 * message other failures use (`StateMessage`) centred on the screen, where no inset can reach it,
 * and its one control is a plain Pressable (`Pill`).
 *
 * "Try again" is the router's `retry`: it clears the error and mounts the root layout afresh, with
 * a new query client, on the route the person was on. If the screen throws again, this shows again.
 *
 * The error goes to `captureError` once (lib/crashReporting.ts). Caught here it is no longer an
 * uncaught error, so nothing else would ever see it.
 *
 * The error itself is not shown until the person asks for it ("Show details"). There is no crash
 * reporter behind `captureError` yet, so on a phone this screen is the only place the error can be
 * read: a tester opens the details and sends a screenshot. What is shown is the error's name and
 * message and the top of its stack, scrubbed of anything shaped like a credential (crashScrub.ts).
 */

/** How much of the stack is shown: enough to name the component, short enough for one screenshot. */
const STACK_LINES = 8;

/** The error as text for the details: 'TypeError: …' and the first lines of its stack, scrubbed. */
export function errorDetails(error: unknown): string {
  const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null | undefined;
  const name = typeof e?.name === 'string' && e.name ? e.name : 'Error';
  const message = typeof e?.message === 'string' ? e.message : String(error);
  const head = `${name}: ${message}`;
  const stack =
    typeof e?.stack === 'string'
      ? e.stack
          .split('\n')
          .map((line) => line.trim())
          // The stack usually starts by repeating the message.
          .filter((line) => line && !head.includes(line) && !line.startsWith(`${name}:`))
          .slice(0, STACK_LINES)
      : [];
  return scrubText([head, ...stack].join('\n'));
}

export function RootError({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  const [details, setDetails] = useState(false);
  // Once per error, not once per render, and not twice when React replays effects in development.
  const reported = useRef<unknown>(undefined);
  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    captureError(error, { source: 'render' });
  }, [error]);
  return (
    // A ScrollView, so a large text size can't clip the message; it needs no provider.
    <ScrollView style={[styles.screen, { backgroundColor: colors.surface }]} contentContainerStyle={styles.center}>
      <StateMessage
        icon="triangle-alert"
        title="Something went wrong"
        body="Try again. If it keeps happening, close Bevi and open it again."
        alert
      >
        <Pill variant="outlined" icon="refresh-cw" accessibilityLabel="Try again" onPress={() => void retry()} style={styles.action}>
          Try again
        </Pill>
        <Pill
          variant="outlined"
          accessibilityLabel={details ? 'Hide details' : 'Show details'}
          onPress={() => setDetails((shown) => !shown)}
          style={styles.action}
        >
          {details ? 'Hide details' : 'Show details'}
        </Pill>
        {details ? (
          <Text selectable style={[type.caption, styles.details, { color: colors.textSecondary }]} testID="root-error-details">
            {errorDetails(error)}
          </Text>
        ) : null}
      </StateMessage>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  action: { alignSelf: 'center' },
  details: { alignSelf: 'stretch', paddingHorizontal: spacing.gutter, textAlign: 'left' },
});
