// Exploration (§8.11): seeded ordering jitter and ε-slots. Deterministic for a seed.

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
