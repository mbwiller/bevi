import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  categoryAffinity,
  effectiveCategoryStats,
  effectiveGlobalStats,
  effectiveUserStats,
  GLOBAL_FALLBACK,
  populationStats,
  userStats,
  zScore,
} from '../src/index.ts';

describe('populationStats', () => {
  it('divides by n (stddev_pop)', () => {
    expect(populationStats([])).toEqual({ n: 0, mean: 0, stddev: 0 });
    expect(populationStats([5])).toEqual({ n: 1, mean: 5, stddev: 0 });
    const s = populationStats([1, 2, 3, 4]);
    expect(s.mean).toBe(2.5);
    expect(s.stddev).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(populationStats([7.75, 7.75, 7.75]).stddev).toBe(0);
  });

  it('matches a naive two-pass implementation', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }).map((c) => c / 100), { minLength: 1, maxLength: 200 }), (xs) => {
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
        const s = populationStats(xs);
        expect(s.mean).toBeCloseTo(mean, 9);
        expect(s.stddev).toBeCloseTo(sd, 9);
      }),
    );
  });
});

describe('effective stats', () => {
  const global = { n: 40, mean: 6.1, stddev: 2.2 };

  it('uses the user once they have 3 rankings, else the global stats', () => {
    expect(effectiveUserStats({ n: 3, mean: 7, stddev: 1.5 }, global)).toEqual({ mean: 7, stddev: 1.5 });
    expect(effectiveUserStats({ n: 2, mean: 9, stddev: 0.2 }, global)).toEqual({ mean: 6.1, stddev: 2.2 });
  });

  it('floors stddev at 1.0', () => {
    expect(effectiveUserStats({ n: 5, mean: 8, stddev: 0.3 }, global)).toEqual({ mean: 8, stddev: 1 });
    expect(effectiveGlobalStats({ n: 4, mean: 5, stddev: 0.5 })).toEqual({ mean: 5, stddev: 1 });
  });

  it('falls back to GLOBAL_FALLBACK only with zero rankings in the system', () => {
    expect(effectiveGlobalStats({ n: 0, mean: 0, stddev: 0 })).toEqual(GLOBAL_FALLBACK);
    expect(effectiveUserStats({ n: 0, mean: 0, stddev: 0 }, { n: 0, mean: 0, stddev: 0 })).toEqual(GLOBAL_FALLBACK);
  });

  it('falls back from category stats to the user\'s overall stats below 3', () => {
    const user = { mean: 6, stddev: 2 };
    expect(effectiveCategoryStats({ n: 2, mean: 9, stddev: 0.1 }, user)).toBe(user);
    expect(effectiveCategoryStats({ n: 3, mean: 9, stddev: 0.1 }, user)).toEqual({ mean: 9, stddev: 1 });
  });
});

describe('zScore and categoryAffinity', () => {
  it('normalises against the given stats', () => {
    expect(zScore(8, { mean: 6, stddev: 2 })).toBe(1);
    expect(() => zScore(8, { mean: 6, stddev: 0 })).toThrow(RangeError);
  });

  it('shrinks the mean z toward 0 with K_AFF = 2', () => {
    expect(categoryAffinity([])).toBe(0);
    expect(categoryAffinity([1, 1])).toBe(0.5);
    expect(categoryAffinity([2, -1, 1])).toBe(0.4);
  });

  it('gives a user\'s own z-scores mean 0 when their stats are their own', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }).map((c) => c / 100), { minLength: 3, maxLength: 100 }), (xs) => {
        const s = populationStats(xs);
        fc.pre(s.stddev > 1);
        const eff = effectiveUserStats(s, { n: 0, mean: 0, stddev: 0 });
        const meanZ = xs.reduce((a, x) => a + zScore(x, eff), 0) / xs.length;
        expect(meanZ).toBeCloseTo(0, 9);
      }),
    );
  });
});

describe('userStats', () => {
  it('groups by category', () => {
    const u = userStats([
      { bevId: 'coke', categoryId: 'soda', score: 9 },
      { bevId: 'sprite', categoryId: 'soda', score: 7 },
      { bevId: 'lacroix', categoryId: 'sparkling_water', score: 3 },
    ]);
    expect(u.overall).toEqual({ n: 3, mean: 19 / 3, stddev: populationStats([9, 7, 3]).stddev });
    expect(u.byCategory).toEqual({
      soda: { n: 2, mean: 8, stddev: 1 },
      sparkling_water: { n: 1, mean: 3, stddev: 0 },
    });
  });
});
