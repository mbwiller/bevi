import type { BugReportKind, BugReportSummary } from '@bevi/shared';

import { formatRelativeTime } from '@/lib/time';

/** The kinds in words, as the note's chip and the reports sheet say them. */
export const KIND_LABEL: Record<BugReportKind, string> = {
  bug: 'Bug',
  fix: 'Fix suggestion',
  idea: 'Idea',
  design: 'Design nit',
};

/** The contract's 0–4 priority in words (the board uses High, Normal and Low). 0 is "No priority". */
export function priorityLabel(priority: number | null | undefined): string | null {
  switch (priority) {
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Medium';
    case 4:
      return 'Low';
    default:
      return null;
  }
}

/** The states a reporter's tickets are ranked in (by a founder; a tester does not rank): still waiting for a fix. */
export function isOpen(row: Pick<BugReportSummary, 'state'>): boolean {
  return row.state === 'triage' || row.state === 'todo' || row.state === 'in_progress';
}

/** Rank ascending, unranked last, then newest first. */
export function byRank(a: BugReportSummary, b: BugReportSummary): number {
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  return b.createdAt.localeCompare(a.createdAt);
}

/** Newest first: how Filed reports lists open tickets for an account that may not rank. */
export function byNewest(a: BugReportSummary, b: BugReportSummary): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** The reporter's open tickets, worst first: the list the rank sheet compares against. */
export function openInRankOrder(rows: readonly BugReportSummary[] | undefined): BugReportSummary[] {
  return (rows ?? []).filter(isOpen).sort(byRank);
}

/** 'T-14 · New · 2 days ago'; the state reads "Status unavailable" when the tracker couldn't say. */
export function ticketMeta(row: BugReportSummary, now: Date = new Date()): string {
  const state = row.state === 'unknown' || !row.stateLabel ? 'Status unavailable' : row.stateLabel;
  return [row.ticketId, state, formatRelativeTime(row.createdAt, now)].filter(Boolean).join(' · ');
}
