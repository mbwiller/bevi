import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@bevi/shared';

import { connectQueryLifecycle } from './queryLifecycle';

/**
 * Sensible defaults for the app's QueryClient (the root layout owns the instance): only `network`
 * errors are retried (an `unauthorized`, `not_found` or `validation` won't fix itself), reads stay
 * fresh for 30s, and mutations never retry (submitRanking is not idempotent).
 *
 * Reads wait while offline and run on reconnect (the default `networkMode: 'online'`). Mutations do
 * not: `'always'` runs the call at once, so a save made offline fails with a `network` error the
 * screen can show, instead of sitting on a spinner and being sent unattended later, possibly after
 * the person left, with a stale `expectedBucketSize`.
 *
 * It also connects React Query to the phone's connection and to the app coming to the foreground
 * (queryLifecycle.ts), which a browser provides by itself.
 */
export function createQueryClient(): QueryClient {
  connectQueryLifecycle();
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => (!isApiError(error) || error.code === 'network') && failureCount < 2,
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
