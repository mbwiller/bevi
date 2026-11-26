import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A list's `refreshing` / `onRefresh` pair for `RefreshControl`. `refreshing` is true only from a
 * person's pull until the refetch they started settles (success or error). Binding `refreshing` to
 * a query's `isRefetching` instead turns it on for every background refetch (a bookmark, a follow,
 * the app coming back to the foreground), and on iOS that shifts the list's content offset by the
 * control's height wherever it is scrolled. react-native-web's RefreshControl draws nothing, which
 * is why the web build never showed it.
 *
 * `refetch` may return a promise (or several, combined); anything else settles at once.
 */
export function usePullToRefresh(refetch: () => unknown): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(refetch);
  latest.current = refetch;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    const settle = () => {
      if (mounted.current) setRefreshing(false);
    };
    let result: unknown;
    try {
      result = latest.current();
    } catch {
      settle();
      return;
    }
    void Promise.resolve(result).then(settle, settle);
  }, []);

  return { refreshing, onRefresh };
}
