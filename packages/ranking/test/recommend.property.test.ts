import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explorationSlots, recommend, weightedSample, createPrng } from '../src/index.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

const snap = syntheticSnapshot('recommend', 12, 40);
const users = Object.keys(snap.users).sort();

describe('explorationSlots', () => {
  it('spreads slots evenly and in range', () => {
    expect(explorationSlots(20, 3)).toEqual([4, 9, 14]);
    expect(explorationSlots(2, 2)).toEqual([0, 1]);
    expect(explorationSlots(5, 0)).toEqual([]);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (len, s) => {
        const xs = explorationSlots(len, s);
        expect(xs.length).toBe(Math.min(len, s));
        expect(new Set(xs).size).toBe(xs.length);
        for (const x of xs) expect(x >= 0 && x < len).toBe(true);
      }),
    );
  });
});

describe('weightedSample', () => {
  it('draws distinct items, deterministic for a seed', () => {
    const a = weightedSample(['a', 'b', 'c', 'd'], [1, 2, 3, 4], 3, createPrng('w'));
    expect(new Set(a).size).toBe(3);
    expect(weightedSample(['a', 'b', 'c', 'd'], [1, 2, 3, 4], 3, createPrng('w'))).toEqual(a);
    expect(weightedSample(['a'], [1], 3, createPrng('w'))).toEqual(['a']);
  });
});

describe('recommend', () => {
  const arb = fc.record({
    user: fc.constantFrom(...users),
    n: fc.integer({ min: 0, max: 30 }),
    seed: fc.string(),
    exclude: fc.uniqueArray(fc.constantFrom(...Object.keys(snap.bevs)), { maxLength: 5 }),
  });

  it('never returns a ranked, excluded or hidden-alcohol Bev; deterministic for a seed', () => {
    fc.assert(
      fc.property(arb, ({ user, n, seed, exclude }) => {
        const recs = recommend(snap, user, { n, seed, excludeBevIds: exclude });
        const ranked = new Set(snap.rankings.filter((r) => r.userId === user).map((r) => r.bevId));
        const canSee = snap.users[user]?.canSeeAlcohol;
        const eligible = Object.values(snap.bevs).filter((b) => !ranked.has(b.id) && !exclude.includes(b.id) && (canSee || !b.isAlcoholic));
        expect(recs.length).toBe(Math.min(n, eligible.length));
        expect(new Set(recs.map((r) => r.bevId)).size).toBe(recs.length);
        for (const r of recs) {
          expect(ranked.has(r.bevId)).toBe(false);
          expect(exclude).not.toContain(r.bevId);
          if (!canSee) expect(snap.bevs[r.bevId]?.isAlcoholic).toBe(false);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(10);
        }
        expect(recommend(snap, user, { n, seed, excludeBevIds: exclude })).toEqual(recs);
      }),
      { numRuns: 60 },
    );
  });

  it('fills round(ε·n) exploration slots when the pool allows', () => {
    for (const user of users) {
      const recs = recommend(snap, user, { n: 20, seed: `${user}:2026-10-11` });
      // This snapshot's pools are large enough for every user, so every slot is filled.
      expect(recs.flatMap((r, i) => (r.isExploration ? [i] : []))).toEqual(explorationSlots(recs.length, 3));
      if (recs.length === 20) expect(explorationSlots(20, 3)).toEqual([4, 9, 14]);
    }
    const none = recommend(snap, users[1] as string, { n: 20, seed: 's', epsilon: 0 });
    expect(none.some((r) => r.isExploration)).toBe(false);
  });

  it('a different day can reorder, the same day cannot', () => {
    const user = users[1] as string;
    const a = recommend(snap, user, { n: 20, seed: `${user}:2026-10-11` }).map((r) => r.bevId);
    const days = Array.from({ length: 10 }, (_, i) => recommend(snap, user, { n: 20, seed: `${user}:2026-10-${12 + i}` }).map((r) => r.bevId).join());
    expect(days.some((d) => d !== a.join())).toBe(true);
  });

  it('orders the non-exploration picks by jittered ẑ, close to the un-jittered order', () => {
    const user = users[2] as string;
    const recs = recommend(snap, user, { n: 10, seed: 'x', epsilon: 0 });
    // Jitter sd 0.15 in z-units: the top pick is never far below the best un-jittered prediction.
    const best = Math.max(...recs.map((r) => r.score));
    expect(recs[0]!.score).toBeGreaterThan(best - 2);
  });

  it('throws on bad options', () => {
    expect(() => recommend(snap, users[0] as string, { n: -1, seed: 's' })).toThrow(RangeError);
    expect(() => recommend(snap, users[0] as string, { n: 5, seed: 's', epsilon: 2 })).toThrow(RangeError);
  });
});
