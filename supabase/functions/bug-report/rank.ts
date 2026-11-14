// The reporter's ranked list of their own open tickets, held in Linear itself:
// the rank is the issue's manual order (`Issue.sortOrder`, lower first) and
// the priority that position implies. Pure: no Deno APIs and no network, so
// test.ts can pin every case. index.ts does the reads and the writes.
//
// Linear documents `sortOrder` as a Float where "a value between two
// neighboring issues" places an issue between them, and says Linear may
// adjust positions to avoid collisions. So a placement is one write (the
// midpoint) in the normal case, and a respacing of the caller's own open
// tickets only when the neighbours have grown too close to split.

import type { TicketState } from "./linear.ts";

/** The states a ticket is ranked in. In review, done, canceled and unknown are not. */
export const OPEN_STATES: readonly TicketState[] = ["triage", "todo", "in_progress"];

export function isOpen(state: TicketState): boolean {
  return OPEN_STATES.includes(state);
}

export interface Ordered {
  identifier: string;
  sortOrder: number;
}

/** Below this gap a midpoint no longer separates two neighbours. */
export const MIN_GAP = 1e-6;
/** The most `sortOrder` writes one placement may make when it has to respace. */
export const MAX_RESPACE_WRITES = 50;

function numberOf(identifier: string): number {
  const m = /-(\d+)$/.exec(identifier);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function compare(a: Ordered, b: Ordered): number {
  return a.sortOrder - b.sortOrder || numberOf(a.identifier) - numberOf(b.identifier);
}

/** The identifiers in rank order: ascending `sortOrder`, ties by issue number ascending. */
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
  /** The `sortOrder` to write to `moving`. */
  sortOrder: number;
  /** True when the neighbours are too close to split: respace first (`respaced`). */
  respace: boolean;
}

/**
 * Where `moving` goes when it is placed directly below `after` (at the top
 * when `after` is null). `order` is the caller's open tickets in rank order,
 * and may or may not contain `moving`; `after`, when given, must be in it.
 * Between two neighbours the midpoint, at the top one less than the first, at
 * the bottom one more than the last, and alone its current value.
 */
export function positionFor(order: readonly Ordered[], moving: string, after: string | null): Position {
  const self = order.find((o) => o.identifier === moving);
  const others = order.filter((o) => o.identifier !== moving);
  let index = 0;
  if (after !== null) {
    const at = others.findIndex((o) => o.identifier === after);
    if (at < 0) throw new RangeError(`${after} is not in the list`);
    index = at + 1;
  }
  const above = others[index - 1];
  const below = others[index];

  if (!above && !below) return { index, sortOrder: self?.sortOrder ?? 0, respace: false };
  if (!above) return { index, sortOrder: below!.sortOrder - 1, respace: false };
  if (!below) return { index, sortOrder: above.sortOrder + 1, respace: false };
  const gap = below.sortOrder - above.sortOrder;
  return { index, sortOrder: (above.sortOrder + below.sortOrder) / 2, respace: gap < MIN_GAP };
}

export interface Respacing {
  /** The new value for every other ticket, in rank order. Write the ones that changed. */
  others: Ordered[];
  /** The moving ticket's new value, written last, with its priority. */
  moving: Ordered;
}

/**
 * The full new assignment when respacing is needed. `order` is the list as it
 * will be once the move is made, with the moving ticket at `movingIndex`:
 * every ticket gets the smallest existing `sortOrder` plus its index, so the
 * list keeps its place among the team's other issues and every gap is 1.
 */
export function respaced(order: readonly Ordered[], movingIndex: number): Respacing {
  if (movingIndex < 0 || movingIndex >= order.length) throw new RangeError("movingIndex is outside the list");
  const base = Math.min(...order.map((o) => o.sortOrder));
  const all = order.map((o, i) => ({ identifier: o.identifier, sortOrder: base + i }));
  return { others: all.filter((_, i) => i !== movingIndex), moving: all[movingIndex]! };
}

/** `order` with `moving` taken out and put back at `index` (the list `respaced` expects). */
export function withMoved(order: readonly Ordered[], moving: Ordered, index: number): Ordered[] {
  const others = order.filter((o) => o.identifier !== moving.identifier);
  return [...others.slice(0, index), moving, ...others.slice(index)];
}

/**
 * The priority a position implies, in Linear's scale (1 urgent, 2 high, 3
 * medium, 4 low). The top quarter is High, the middle half Medium, the rest
 * Low, measured at the middle of the ticket's slot. An Urgent ticket stays
 * Urgent: that is an absolute call a person makes in Linear, and dragging the
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
