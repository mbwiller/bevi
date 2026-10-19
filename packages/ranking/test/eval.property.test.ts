import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseExport, prepareDataset, toExport, type EvalRanking } from '../eval/dataset.ts';
import { foldSnapshot, holdOut, rowKey } from '../eval/folds.ts';
import { averageRanks, ndcgAtK, pairCredit, pairedBootstrap, spearman } from '../eval/metrics.ts';
import { syntheticDataset } from '../eval/synthetic.ts';
import { populationStats, respaceBucket, BUCKET_ORDER } from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';

const distinct = fc.uniqueArray(fc.integer({ min: -1000, max: 1000 }), { minLength: 3, maxLength: 25 });

describe('metric invariants', () => {
  it('concordance credit is antisymmetric', () => {
    fc.assert(fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (a, b) => pairCredit(a, b) + pairCredit(b, a) === 1));
  });

  it('average ranks sum to n(n+1)/2', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 30 }), (xs) => {
        const s = averageRanks(xs).reduce((a, b) => a + b, 0);
        expect(s).toBeCloseTo((xs.length * (xs.length + 1)) / 2, 9);
      }),
    );
  });

  it('Spearman is in [−1, 1], 1 on itself, −1 on its reverse, invariant under monotone maps', () => {
    fc.assert(
      fc.property(distinct, fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 25, maxLength: 25 }), (actual, noise) => {
        const pred = actual.map((x, i) => x + (noise[i] as number));
        const r = spearman(pred, actual) as number;
        expect(r).toBeGreaterThanOrEqual(-1 - 1e-12);
        expect(r).toBeLessThanOrEqual(1 + 1e-12);
        expect(spearman(actual, actual)).toBeCloseTo(1, 12);
        expect(spearman(actual.map((x) => -x), actual)).toBeCloseTo(-1, 12);
        expect(spearman(pred.map((x) => Math.exp(x / 500) * 3 + 1), actual)).toBeCloseTo(r, 12);
      }),
    );
  });

  it('NDCG is in [0, 1], 1 for the ideal order, invariant under strictly increasing maps', () => {
    const items = fc.array(fc.record({ pred: fc.integer({ min: -20, max: 20 }), gain: fc.constantFrom(0, 1, 3) }), { minLength: 2, maxLength: 30 });
    fc.assert(
      fc.property(items, fc.integer({ min: 1, max: 15 }), (xs, k) => {
        const v = ndcgAtK(xs, k);
        if (v === null) return;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
        expect(ndcgAtK(xs.map((x) => ({ pred: x.gain, gain: x.gain })), k)).toBeCloseTo(1, 12);
        expect(ndcgAtK(xs.map((x) => ({ pred: 2 * x.pred + 7, gain: x.gain })), k)).toBeCloseTo(v, 12);
      }),
    );
  });

  it('bootstrap intervals are ordered and deterministic', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }), fc.string(), (xs, seed) => {
        const stat = (s: readonly number[]) => [s.reduce((a, b) => a + b, 0) / s.length];
        const a = pairedBootstrap(xs, stat, { iterations: 50, seed });
        expect(a.lo[0] as number).toBeLessThanOrEqual(a.hi[0] as number);
        expect(pairedBootstrap(xs, stat, { iterations: 50, seed })).toEqual(a);
      }),
      { numRuns: 30 },
    );
  });
});

describe('fold invariants (random held-out sets on synthetic data)', () => {
  const ds = syntheticDataset('fold-props', 16, 40);
  const prepared = prepareDataset(ds);
  const rows = prepared.rankings;
  it('no held-out row survives; every statistic matches the training rows; re-spacing is the counterfactual', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: rows.length - 1 }), { minLength: 1, maxLength: 12 }), fc.boolean(), (idx, respace) => {
        const held = new Set(idx.map((i) => rowKey((rows[i] as EvalRanking).userId, (rows[i] as EvalRanking).bevId)));
        const train = holdOut(rows, held, respace);
        const snap = foldSnapshot(prepared.catalog, train);
        expect(train.length).toBe(rows.length - held.size);
        for (const r of snap.rankings) expect(held.has(rowKey(r.userId, r.bevId))).toBe(false);
        const ctx = snapshotContext(snap);
        for (const [u, s] of Object.entries(snap.users)) {
          expect(s.stats).toEqual(populationStats(train.filter((r) => r.userId === u).map((r) => r.score)));
        }
        for (const [b, f] of Object.entries(snap.bevs)) {
          const scores = train.filter((r) => r.bevId === b).map((r) => r.score);
          expect(f.ratingCount).toBe(scores.length);
          expect((ctx.raters.get(b) ?? []).length).toBe(scores.length);
        }
        if (respace) {
          const touched = new Set(idx.map((i) => (rows[i] as EvalRanking).userId));
          for (const u of touched) {
            for (const bucket of BUCKET_ORDER) {
              const before = rows.filter((r) => r.userId === u && r.bucket === bucket && !held.has(rowKey(u, r.bevId))).sort((a, b) => a.position - b.position);
              const after = train.filter((r) => r.userId === u && r.bucket === bucket).sort((a, b) => a.position - b.position);
              expect(after.map((r) => [r.bevId, r.position, r.score])).toEqual(respaceBucket(before.map((r) => r.bevId), bucket).map((r) => [r.bevId, r.position, r.score]));
            }
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('export format', () => {
  it('round-trips through toExport / JSON / parseExport', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.integer({ min: 3, max: 10 }), fc.integer({ min: 5, max: 25 }), (seed, users, bevs) => {
        const ds = syntheticDataset(seed, users, bevs);
        expect(parseExport(JSON.parse(JSON.stringify(toExport(ds))))).toEqual(ds);
      }),
      { numRuns: 15 },
    );
  });
});
