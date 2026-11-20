import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';


import { apiConfig } from '@/api/client';
import { useCanReportBug } from '@/api/hooks';
import { createQueryClient } from '@/api/queryClient';
import { OfflineNoticeHost } from '@/components/OfflineNotice';
import { StackScene } from '@/components/ScreenMotion';
import { StatusBarClearance } from '@/components/StatusBarClearance';
import { clearReportCommand, useReportCommands } from '@/features/bug-report/commands';
import { loadReportHost } from '@/features/bug-report/loadHost';
import { AppGate } from '@/features/app-gate/AppGate';
import { loadNutritionDemo } from '@/features/create-bev/loadNutritionDemo';
import { ConfigError, Splash } from '@/features/auth/Splash';
import { useSessionBootstrap } from '@/features/auth/useSessionBootstrap';
import { clearLegacyStorage } from '@/lib/clearLegacyStorage';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';
import { RootError } from '@/components/RootError';

// The old in-browser mock's data (fake users, plain-text passwords) may still sit in localStorage.
clearLegacyStorage();

// The internal bug reporter (docs/bug-workflow.md): its own chunk, fetched only for an internal reporter.
const ReportHost = lazy(loadReportHost);
const NutritionDemo = lazy(loadNutritionDemo);

// Root layout. One agent at a time owns this file and (tabs)/_layout.tsx (app/CLAUDE.md).
//
// Session gate: each group of routes is only registered while the session allows it
// (Stack.Protected). A URL for a route that isn't available — a deep link, a reload, or the
// screen on display when the status changes — falls back to `index`, which redirects to the
// status's home: signedOut → /sign-in, onboarding → /onboarding/profile, ready → /feed.
// index and +not-found are outside every guard. A new route file must be added to the right guard
// below, or it is reachable in every status.
//
// The session comes from the API (useSessionBootstrap: getSession / onAuthChange → getMe →
// setSession, or signOut). Until the first check settles the layout shows the Splash (wordmark)
// instead of the Stack, so a signed-in user never sees sign in flash and a deep link survives the
// check. A build without a usable Supabase config shows ConfigError instead of the app.
export default function RootLayout() {
  const { scheme } = useTheme();
  const [queryClient] = useState(createQueryClient);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Pushes every screen's top edge below iOS's status-bar blur in the home-screen app. */}
        <StatusBarClearance>
          <QueryClientProvider client={queryClient}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            {/* "You're offline" above everything below it, the launch Splash included (not iOS full-screen modals). */}
            <OfflineNoticeHost>
              {__DEV__ && process.env.EXPO_PUBLIC_NUTRITION_SCAN_DEMO === '1'
                ? <Suspense fallback={null}><NutritionDemo /></Suspense>
                : apiConfig.ok ? <AppGate><SessionGate /></AppGate> : <ConfigError problem={apiConfig.problem} />}
            </OfflineNoticeHost>
          </QueryClientProvider>
        </StatusBarClearance>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * A screen that throws while it renders shows this instead of closing the app. Expo Router wraps
 * the root layout in a boundary when the layout's file exports `ErrorBoundary`, and renders this in
 * the layout's place, outside every provider above (components/RootError.tsx).
 */
export function ErrorBoundary(props: ComponentProps<typeof RootError>) {
  return <RootError {...props} />;
}

type ScreenLayout = NonNullable<ComponentProps<typeof Stack>['screenLayout']>;

function SessionGate() {
  const { colors } = useTheme();
  const { error, retry } = useSessionBootstrap();
  const status = useSession((s) => s.status);
  const checked = useSession((s) => s.checked);
  // Move: a screen pushed after the Stack's first render slides in (a full-screen modal rises);
  // the screens it starts with, and the bottom of the stack, just show (StackScene).
  const stackUp = useRef(false);
  useEffect(() => {
    stackUp.current = checked;
  }, [checked]);
  const screenLayout: ScreenLayout = ({ route, navigation, options, children }) => (
    <StackScene
      variant={options.presentation === 'fullScreenModal' ? 'rise' : 'push'}
      enter={stackUp.current && navigation.getState().routes.findIndex((r: { key: string }) => r.key === route.key) > 0}
    >
      {children}
    </StackScene>
  );
  // Only the launch check can show the splash (and its error); once the Stack is up it stays up.
  if (!checked) return <Splash error={error || undefined} onRetry={retry} />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} screenLayout={screenLayout}>
        <Stack.Screen name="index" />

        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)/sign-in" />
          <Stack.Screen name="(auth)/sign-up" />
        </Stack.Protected>

        <Stack.Protected guard={status === 'onboarding'}>
          <Stack.Screen name="onboarding/profile" />
          <Stack.Screen name="onboarding/starter" />
        </Stack.Protected>

        <Stack.Protected guard={status === 'ready'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" />
          <Stack.Screen name="leaderboard" />
          <Stack.Screen name="bev/[id]" />
          <Stack.Screen name="user/[id]/index" />
          <Stack.Screen name="user/[id]/followers" />
          <Stack.Screen name="user/[id]/following" />
          <Stack.Screen name="rank/[bevId]" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="add/new" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="settings/index" />
          <Stack.Screen name="settings/account" />
          <Stack.Screen name="settings/privacy" />
          <Stack.Screen name="settings/blocked" />
          <Stack.Screen name="settings/delete-account" />
          <Stack.Screen name="image/[url]" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="report-bug" options={{ presentation: 'fullScreenModal' }} />
        </Stack.Protected>
      </Stack>
      {/* A sibling of the Stack, so it coming and going never remounts a screen. */}
      <Reporter ready={status === 'ready'} />
    </>
  );
}

/**
 * The bug reporter's drop, on every signed-in screen including the full-screen flows, for an
 * internal reporter only. `bugs.canReport()` is not asked until the session is ready, and an
 * ordinary account never loads the reporter's code. Presentation, not protection: the server
 * refuses a report from anyone else (supabase/functions/bug-report).
 */
function Reporter({ ready }: { ready: boolean }) {
  const { data: canReport } = useCanReportBug({ enabled: ready });
  const allowed = ready && canReport === true;
  // A request (Settings, /report-bug) is only for an account that can report: one made, or still
  // waiting, while this account can't is dropped, never left for the next one to sign in.
  const pending = useReportCommands((s) => s.pending);
  useEffect(() => {
    if (!allowed && pending) clearReportCommand();
  }, [allowed, pending]);
  if (!allowed) return null;
  return (
    <Suspense fallback={null}>
      <ReportHost />
    </Suspense>
  );
}
