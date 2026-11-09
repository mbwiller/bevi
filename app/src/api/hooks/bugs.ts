import { useMutation, useQuery } from '@tanstack/react-query';
import type { BugReportInput } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';

/**
 * Whether this account may file internal bug reports. It decides whether the
 * Report a bug entry points appear; it is not the access check, which the
 * server runs again on every submission (docs/bug-workflow.md).
 *
 * Cached for the session: an account's internal role does not change while the
 * app is open, and the launcher mounts on every screen.
 */
export function useCanReportBug() {
  return useQuery({
    queryKey: keys.canReportBug(),
    queryFn: () => api.bugs.canReport(),
    staleTime: Infinity,
    // The gate answers false rather than throwing, so a retry buys nothing.
    retry: false,
  });
}

/**
 * Files one report. Nothing is invalidated: Linear owns the issue and no
 * screen in this app reads it.
 */
export function useReportBug() {
  return useMutation({ mutationFn: (input: BugReportInput) => api.bugs.report(input) });
}
