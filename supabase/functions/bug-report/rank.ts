// The reporter's ranked list of their own open tickets, read from the board:
// the rank is the ticket's place in the board's one shared order
// (`TicketStatus.sortOrder`, lower first) and the priority that position
// implies. Pure: no Deno APIs and no network, so test.ts can pin every case.
// index.ts does the reads and the write; the board rewrites its order itself,
// so nothing here works out a new order value, only where in the caller's
// list a ticket lands.

import type { TicketState } from "./ticket.ts";

/** The states a ticket is ranked in. In review, done, canceled and unknown are not. */
export const OPEN_STATES: readonly TicketState[] = ["triage", "todo", "in_progress"];

export function isOpen(state: TicketState): boolean {
  return OPEN_STATES.includes(state);
}

export interface Ordered {
  identifier: string;
  sortOrder: number;
}

function numberOf(identifier: string): number {
  const m = /-(\d+)$/.exec(identifier);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function compare(a: Ordered, b: Ordered): number {
  return a.sortOrder - b.sortOrder || numberOf(a.identifier) - numberOf(b.identifier);
}

/** The identifiers in rank order: ascending `sortOrder`, ties by ticket number ascending. */
export function rankOrder(items: readonly Ordered[]): string[] {
  return [...items].sort(compare).map((i) => i.identifier);
}

/** The items themselves in rank order. */
export function sortedByRank<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(compare);
}

export interface Position {
  /** Where `moving` lands in the list once it has moved (0-based). */
  index: number;
}

/**
 * Where `moving` goes when it is placed directly below `after` (at the top
 * when `after` is null). `order` is the caller's open tickets in rank order,
 * and may or may not contain `moving`; `after`, when given, must be in it.
 */
export function positionFor(order: readonly Ordered[], moving: string, after: string | null): Position {
  if (after === null) return { index: 0 };
  const others = order.filter((o) => o.identifier !== moving);
  const at = others.findIndex((o) => o.identifier === after);
  if (at < 0) throw new RangeError(`${after} is not in the list`);
  return { index: at + 1 };
}

/**
 * The priority a position implies, on the contract's scale (1 urgent, 2 high,
 * 3 normal, 4 low). The top quarter is High, the middle half Normal, the rest
 * Low, measured at the middle of the ticket's slot. An Urgent ticket stays
 * Urgent: that is an absolute call a person makes, and dragging the
 * reporter's own list around must never undo it.
 */
export function priorityForRank(index: number, count: number, current: number | null): number {
  if (current === 1) return 1;
  const f = (index + 0.5) / Math.max(count, 1);
  if (f <= 0.25) return 2;
  if (f <= 0.75) return 3;
  return 4;
}

/** The 1-based rank of each open ticket, by identifier. */
export function ranksOf(items: readonly Ordered[]): Map<string, number> {
  return new Map(rankOrder(items).map((id, i) => [id, i + 1]));
}
