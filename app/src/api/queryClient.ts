import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '@bevi/shared';

import { captureError } from '@/lib/crashReporting';

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
 *
 * A read or a save that fails for good (after its retries) is handed to `captureError`
 * (lib/crashReporting.ts), which keeps only the unexpected ones: an `ApiError` the contract gives a
 * meaning to (offline, signed out, not found …) is what the screen already explains and is never
 * reported (lib/crashScrub.ts, `isExpectedError`). Of a query's key only the family is passed
 * (`users`, `rankings`): the rest of a key holds ids and what a person typed into a search.
 */
export function createQueryClient(): QueryClient {
  connectQueryLifecycle();
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => captureError(error, { source: 'query', extra: { read: String(query.queryKey[1] ?? '') } }),
    }),
    mutationCache: new MutationCache({ onError: (error) => captureError(error, { source: 'mutation' }) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => (!isApiError(error) || error.code === 'network') && failureCount < 2,
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
