import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/state/session';
import { useTheme } from '@/theme';

// Root layout. One agent at a time owns this file and (tabs)/_layout.tsx (app/CLAUDE.md).
//
// Session gate: each group of routes is only registered while the session allows it
// (Stack.Protected). A URL for a route that isn't available — a deep link, a reload, or the
// screen on display when the status changes — falls back to `index`, which redirects to the
// status's home: signedOut → /sign-in, onboarding → /onboarding/profile, ready → /feed.
// index and the /dev routes are outside every guard. A new route file must be added to the
// right guard below, or it is reachable in every status.
export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const [queryClient] = useState(() => new QueryClient());
  const status = useSession((s) => s.status);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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

            <Stack.Screen name="dev/gallery" />
            <Stack.Screen name="dev/tokens" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
