import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@bevi/shared';

/**
 * Sensible defaults for the app's QueryClient (the root layout owns the instance): only `network`
 * errors are retried (an `unauthorized`, `not_found` or `validation` won't fix itself), reads stay
 * fresh for 30s, and mutations never retry (submitRanking is not idempotent).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => (!isApiError(error) || error.code === 'network') && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
}
