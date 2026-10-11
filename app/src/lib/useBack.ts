import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * Back for a pushed or modal screen. A deep link (or a reload) has no history inside the app, so
 * it falls back to `/`, which the gate sends to the right place.
 */
export function useBack() {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
}
