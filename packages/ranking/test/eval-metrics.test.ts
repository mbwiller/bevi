import { describe, expect, it } from 'vitest';
import { averageRanks, ndcgAtK, pairCredit, pairedBootstrap, quantile, spearman } from '../eval/metrics.ts';
import { cosineSimilarity } from '../src/index.ts';
import { pearsonSimilarity } from '../eval/similarity-arms.ts';

describe('pairwise concordance credit', () => {
  it('1 / 0.5 / 0', () => {
    expect(pairCredit(7.2, 6.1)).toBe(1);
    expect(pairCredit(6.1, 6.1)).toBe(0.5);
    expect(pairCredit(5, 6.1)).toBe(0);
  });
});

describe('Spearman', () => {
  it('average ranks for ties', () => {
    expect(averageRanks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
  it('worked examples', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([4, 3, 2, 1], [10, 20, 30, 40])).toBeCloseTo(-1, 12);
    // pred ranks [1, 2.5, 2.5, 4], actual [1, 2, 3, 4]: ρ = 4.5 / sqrt(4.5 · 5) = 0.9487
    expect(spearman([1, 5, 5, 9], [1, 2, 3, 4])).toBeCloseTo(4.5 / Math.sqrt(4.5 * 5), 12);
  });
  it('null when the labels make it undefined; 0 for a constant predictor', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(spearman([7, 7, 7], [1, 2, 3])).toBe(0);
  });
});

describe('NDCG@10 (gain Loved 3, Fine 1, Disliked 0)', () => {
  it('worked example', () => {
    // Predicted order: Fine, Loved, Disliked. DCG = 1/log2(2) + 3/log2(3); IDCG = 3 + 1/log2(3).
    const v = ndcgAtK([{ pred: 9, gain: 1 }, { pred: 8, gain: 3 }, { pred: 1, gain: 0 }]);
    expect(v).toBeCloseTo((1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3)), 12);
    expect(ndcgAtK([{ pred: 9, gain: 3 }, { pred: 8, gain: 1 }, { pred: 1, gain: 0 }])).toBe(1);
  });
  it('a constant predictor scores the mean NDCG over all orderings (tie-aware)', () => {
    const gains = [3, 1, 0, 3];
    const perms = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    const all = perms(gains).map((p) => ndcgAtK(p.map((g, i) => ({ pred: -i, gain: g }))) as number);
    const expected = all.reduce((s, x) => s + x, 0) / all.length;
    expect(ndcgAtK(gains.map((g) => ({ pred: 5, gain: g })))).toBeCloseTo(expected, 12);
  });
  it('cuts at k and is null when undefined', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ pred: -i, gain: i === 11 ? 3 : 0 }));
    expect(ndcgAtK(items, 10)).toBe(0);
    expect(ndcgAtK([{ pred: 1, gain: 3 }])).toBeNull();
    expect(ndcgAtK([{ pred: 1, gain: 0 }, { pred: 2, gain: 0 }])).toBeNull();
  });
});

describe('paired bootstrap', () => {
  it('type-7 quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
  it('is deterministic for a seed and pairs the statistics', () => {
    const units = [1, 2, 3, 4, 5, 6, 7, 8];
    const stat = (s: readonly number[]) => {
      const m = s.reduce((a, b) => a + b, 0) / s.length;
      return [m, m + 1, m + 1 - m];
    };
    const a = pairedBootstrap(units, stat, { iterations: 200, seed: 's' });
    expect(pairedBootstrap(units, stat, { iterations: 200, seed: 's' })).toEqual(a);
    expect(a.point[0]).toBe(4.5);
    expect(a.lo[0]).toBeLessThan(4.5);
    expect(a.hi[0]).toBeGreaterThan(4.5);
    // The difference of two paired statistics has a degenerate interval.
    expect(a.lo[2]).toBeCloseTo(1, 12);
    expect(a.hi[2]).toBeCloseTo(1, 12);
  });
});

describe('cosine vs Pearson over the common subset (the layer2.ts re-centring issue)', () => {
  it('two users whose shared Bevs all sit above their own means look similar under cosine, opposite under Pearson', () => {
    const u = [0.5, 1.5];
    const v = [1.5, 0.5];
    expect(cosineSimilarity(u, v)).toBeCloseTo(0.6, 12);
    expect(pearsonSimilarity(u, v)).toBeCloseTo(-1, 12);
    expect(pearsonSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearsonSimilarity([1, 1, 1], [2, 4, 6])).toBe(0);
  });
});
