// The ticket shapes the rest of the bug-report function works with: the
// contract's words for where a ticket is, one ticket's status as the status,
// verify and place routes read it from the board (board.ts), and the test an
// identifier must pass. Pure: no Deno APIs and no network.

/** Injected so tests can drive the board client without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The contract's `BugTicketState` (shared/src/api.ts). */
export type TicketState = "triage" | "todo" | "in_progress" | "in_review" | "done" | "canceled" | "unknown";

export interface TicketStatus {
  /** The name the caller's ledger holds for the ticket. */
  identifier: string;
  state: TicketState;
  stateLabel: string | null;
  priority: number | null;
  updatedAt: string | null;
  /** The ticket's place in the board's one shared order, lower first; null when the board sent none. */
  sortOrder: number | null;
}

/**
 * The number in a ticket identifier like 'T-19', or in an earlier name like
 * 'BEV-7' (a ticket filed before 2026-11-17 keeps answering to it); null for
 * anything else.
 */
export function ticketNumber(identifier: string): number | null {
  const m = /^[A-Z][A-Z0-9]*-(\d{1,9})$/.exec(identifier.trim());
  return m ? Number(m[1]) : null;
}
