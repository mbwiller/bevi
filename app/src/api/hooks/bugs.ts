import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, type BugReportInput, type BugReportSummary } from '@bevi/shared';

import { REPORTER_SUPPORTED } from '@/features/bug-report/supported';

import { api } from '../client';
import { keys } from '../keys';

/**
 * Whether this account may file internal bug reports. It decides whether the
 * reporter (the drop, Settings' Internal rows) loads at all; it is not the
 * access check, which the server runs again on every submission
 * (docs/bug-workflow.md).
 *
 * Cached for the session: an account's internal role does not change while the
 * app is open. `enabled: false` (the root layout before sign-in finishes) asks
 * nothing and leaves `data` undefined.
 *
 * Where there is no reporter (features/bug-report/supported.ts: anywhere but the web and
 * iOS) the answer is false for every account and the server is not asked.
 */
export function useCanReportBug({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.canReportBug(),
    queryFn: () => (REPORTER_SUPPORTED ? api.bugs.canReport() : false),
    enabled,
    staleTime: Infinity,
    // The gate answers false rather than throwing, so a retry buys nothing.
    retry: false,
  });
}

/**
 * Whether this account may rank its tickets against each other ("which is worse?", Place): a
 * founder's act, since it sets priority and place on the board's shared order. A tester reports
 * but does not rank. It decides whether Place is offered; the server refuses a placement from
 * anyone else whatever the app shows. Same options as `useCanReportBug`: cached for the session,
 * not retried, and false without asking where there is no reporter. While it is loading, `data`
 * is undefined: callers treat that as false.
 */
export function useCanRankBug({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.canRankBug(),
    queryFn: () => (REPORTER_SUPPORTED ? api.bugs.canRank() : false),
    enabled,
    staleTime: Infinity,
    // The gate answers false rather than throwing, so a retry buys nothing.
    retry: false,
  });
}

/**
 * Files one report. Filed reports is refetched so the new ticket shows up there;
 * nothing else in the app reads the tracker.
 */
export function useReportBug() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BugReportInput) => api.bugs.report(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.myBugReports() }),
  });
}

/**
 * The caller's own tickets with their live tracker state (Filed reports). Fresh
 * for 30 seconds, so flipping between screens does not ask the board each time;
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
 * refetched. A 'conflict' (the ticket is no longer in review: someone moved it on
 * the board) refetches the list too, so the row shows where it really is.
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
    onError: (error: unknown) => {
      if (isApiError(error) && error.code === 'conflict') void client.invalidateQueries({ queryKey: keys.myBugReports() });
    },
  });
}

/**
 * Places one of the caller's open tickets directly below `afterTicketId` in their ranked list (at
 * the top when null). The server answers with the whole list re-ranked, which replaces Filed reports'
 * cached rows as it is.
 */
export function usePlaceBug() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, afterTicketId }: { ticketId: string; afterTicketId: string | null }) =>
      api.bugs.place(ticketId, afterTicketId),
    onSuccess: (rows: BugReportSummary[]) => client.setQueryData<BugReportSummary[]>(keys.myBugReports(), rows),
  });
}
