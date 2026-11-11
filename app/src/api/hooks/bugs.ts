import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BugReportInput, BugReportSummary } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';

/**
 * Whether this account may file internal bug reports. It decides whether the
 * Report a bug entry points appear; it is not the access check, which the
 * server runs again on every submission (docs/bug-workflow.md).
 *
 * Cached for the session: an account's internal role does not change while the
 * app is open, and every screen's header reads it. `enabled: false` (the root
 * layout before sign-in finishes) asks nothing and leaves `data` undefined.
 */
export function useCanReportBug({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.canReportBug(),
    queryFn: () => api.bugs.canReport(),
    enabled,
    staleTime: Infinity,
    // The gate answers false rather than throwing, so a retry buys nothing.
    retry: false,
  });
}

/**
 * Files one report. My reports is refetched so the new ticket shows up there;
 * nothing else in the app reads Linear.
 */
export function useReportBug() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BugReportInput) => api.bugs.report(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.myBugReports() }),
  });
}

/**
 * The caller's own tickets with their live tracker state (My reports). Fresh
 * for 30 seconds, so flipping between screens does not hit Linear each time;
 * the function caches its answer for a minute behind this anyway.
 */
export function useMyBugReports(enabled = true) {
  return useQuery({
    queryKey: keys.myBugReports(),
    queryFn: () => api.bugs.listMine(),
    staleTime: 30_000,
    enabled,
  });
}

/**
 * Moves one of the caller's tickets to Done after they checked the fix on the
 * device. The list is patched with the ticket the tracker returned and then
 * refetched.
 */
export function useMarkBugVerified() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => api.bugs.markVerified(ticketId),
    onSuccess: (summary: BugReportSummary) => {
      client.setQueryData<BugReportSummary[]>(keys.myBugReports(), (rows) =>
        rows?.map((r) => (r.ticketId === summary.ticketId ? summary : r)),
      );
      void client.invalidateQueries({ queryKey: keys.myBugReports() });
    },
  });
}
