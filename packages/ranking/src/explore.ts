// Exploration (§8.11): seeded ordering jitter and ε-slots, and the community-diversity reordering
// of 1.8.0 (LaTeX §7). Deterministic for a seed.

import { DIVERSITY_PENALTY } from './constants.ts';

/** One N(0, sd) draw via Box–Muller, consuming two PRNG values. */
export function gaussian(rand: () => number, sd: number): number {
  const u1 = 1 - rand(); // (0, 1], so log is finite
  const u2 = rand();
  return sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * 0-based list positions for `slots` exploration picks in a list of `length`:
 * floor((k + 1)·(length + 1) / (slots + 1)) − 1 for k = 0 … slots − 1. Evenly spaced, distinct
 * and in range whenever slots ≤ length. For length 20 and 3 slots this gives 4, 9, 14: the doc
 * (§8.11) says "4, 9, 15", which no even-spacing rule reproduces, so 14 is the faithful reading.
 */
export function explorationSlots(length: number, slots: number): number[] {
  const s = Math.max(0, Math.min(slots, length));
  return Array.from({ length: s }, (_, k) => Math.floor(((k + 1) * (length + 1)) / (s + 1)) - 1);
}

/**
 * Up to `count` distinct items, each draw proportional to its weight among those left (weights
 * must be > 0). Items are drawn in the order given, so pass them in a stable order.
 */
export function weightedSample<T>(items: readonly T[], weights: readonly number[], count: number, rand: () => number): T[] {
  const left = items.map((item, i) => ({ item, w: weights[i] as number }));
  const out: T[] = [];
  while (out.length < count && left.length > 0) {
    let total = 0;
    for (const x of left) total += x.w;
    let r = rand() * total;
    let idx = left.length - 1;
    for (let i = 0; i < left.length; i++) {
      r -= (left[i] as { w: number }).w;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    out.push((left[idx] as { item: T }).item);
    left.splice(idx, 1);
  }
  return out;
}

/**
 * Community diversity (`diversity: 'community'`, LaTeX §7): the first `count` items of the greedy
 * list that repeatedly takes, among the items left, the one maximising
 *   adjusted = z − penalty · (items already taken from its community),
 * ties to the smaller id (JavaScript `<`, the order `recommend` breaks ties in). `z` is the jittered
 * ẑ; only the order changes, never a value. With penalty 0, or when every item is its own community,
 * this is exactly the first `count` of the items sorted by z descending, then id: `recommend`'s
 * 'none' order.
 *
 * Implementation: one sort by (z desc, id asc), then the items queued per community in that order.
 * Within one community every item carries the same penalty, so the best item left in a community is
 * its queue's head, and each step only compares the heads: O(N log N + count · C) for N items in C
 * communities, with no re-sort per pick. `penalty` must be a finite number ≥ 0.
 */
export function diversifyByCommunity<T extends { id: string; z: number; community: string }>(items: readonly T[], count: number, penalty: number = DIVERSITY_PENALTY): T[] {
  if (!(Number.isFinite(penalty) && penalty >= 0)) throw new RangeError(`penalty must be a finite number ≥ 0, got ${penalty}`);
  const sorted = [...items].sort((a, b) => b.z - a.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const queues = new Map<string, { items: T[]; next: number; taken: number }>();
  for (const it of sorted) {
    const q = queues.get(it.community);
    if (q) q.items.push(it);
    else queues.set(it.community, { items: [it], next: 0, taken: 0 });
  }
  const out: T[] = [];
  const want = Math.min(Math.max(0, count), sorted.length);
  while (out.length < want) {
    let best: { items: T[]; next: number; taken: number } | undefined;
    let bestHead: T | undefined;
    let bestAdj = -Infinity;
    for (const q of queues.values()) {
      if (q.next >= q.items.length) continue;
      const head = q.items[q.next] as T;
      const adj = head.z - penalty * q.taken;
      if (bestHead === undefined || adj > bestAdj || (adj === bestAdj && head.id < bestHead.id)) {
        best = q;
        bestHead = head;
        bestAdj = adj;
      }
    }
    const q = best as { items: T[]; next: number; taken: number };
    out.push(bestHead as T);
    q.next++;
    q.taken++;
  }
  return out;
}
