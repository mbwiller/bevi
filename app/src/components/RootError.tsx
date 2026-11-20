import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { captureError } from '@/lib/crashReporting';
import { useTheme } from '@/theme';

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
 * uncaught error, so nothing else would ever see it. The person is never shown the error itself:
 * no message, no code, no stack.
 */
export function RootError({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  // Once per error, not once per render, and not twice when React replays effects in development.
  const reported = useRef<unknown>(undefined);
  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    captureError(error, { source: 'render' });
  }, [error]);
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      <StateMessage
        icon="triangle-alert"
        title="Something went wrong"
        body="Try again. If it keeps happening, close Bevi and open it again."
        alert
      >
        <Pill variant="outlined" icon="refresh-cw" accessibilityLabel="Try again" onPress={() => void retry()} style={styles.action}>
          Try again
        </Pill>
      </StateMessage>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  action: { alignSelf: 'center' },
});
