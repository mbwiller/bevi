import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiConfig } from '@/api/client';
import { createQueryClient } from '@/api/queryClient';
import { ConfigError, Splash } from '@/features/auth/Splash';
import { useSessionBootstrap } from '@/features/auth/useSessionBootstrap';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

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
        <QueryClientProvider client={queryClient}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {apiConfig.ok ? <SessionGate /> : <ConfigError problem={apiConfig.problem} />}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function SessionGate() {
  const { colors } = useTheme();
  const { error, retry } = useSessionBootstrap();
  const status = useSession((s) => s.status);
  const checked = useSession((s) => s.checked);
  // Only the launch check can show the splash (and its error); once the Stack is up it stays up.
  if (!checked) return <Splash error={error || undefined} onRetry={retry} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
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
        <Stack.Screen name="bev/[id]" />
        <Stack.Screen name="user/[id]/index" />
        <Stack.Screen name="user/[id]/followers" />
        <Stack.Screen name="user/[id]/following" />
        <Stack.Screen name="rank/[bevId]" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="add/new" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/account" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="settings/delete-account" />
        <Stack.Screen name="image/[url]" options={{ presentation: 'fullScreenModal' }} />
      </Stack.Protected>
    </Stack>
  );
}
