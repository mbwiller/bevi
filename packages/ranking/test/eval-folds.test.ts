// Each leak the evaluation folds close (eval/folds.ts) gets a fixture where the leak would change
// the prediction, plus the fold builder's equivalence with buildSnapshot().
import { describe, expect, it } from 'vitest';
import { foldSnapshot, holdOut, rowKey } from '../eval/folds.ts';
import { featuresOf, prepareDataset, type EvalBev, type EvalRanking } from '../eval/dataset.ts';
import { ARMS } from '../eval/arms.ts';
import { syntheticDataset } from '../eval/synthetic.ts';
import {
  globalScore,
  populationStats,
  predictScore,
  respaceBucket,
  storedScore,
  type BevFeatures,
  type PredictionSnapshot,
} from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';
import { buildSnapshot, syntheticSnapshot } from './snapshot-fixture.ts';

const bev = (id: string, categoryId: string, brand: string | null, name: string, priceTier: 1 | 2 | 3 | 4): EvalBev => ({
  id, name, brand, flavor: null, categoryId, priceTier, isAlcoholic: false,
});
const row = (userId: string, bevId: string, score: number, bucket: EvalRanking['bucket'] = 'FINE', position = 0): EvalRanking => ({
  userId, bevId, bucket, position, score, rankedAt: '2026-10-01T00:00:00Z',
});

// u: a 9, b 7, c 2, d 8 · v: a 9, b 8, c 3, d 6 · w: a 3, d 4, c 5
const BEVS = [bev('a', 'soda', 'coke', 'cola', 1), bev('b', 'soda', 'coke', 'cherry cola', 1), bev('c', 'water', null, 'still', 4), bev('d', 'soda', 'pepsi', 'cola', 1)];
const ROWS = [
  row('u', 'a', 9), row('u', 'b', 7), row('u', 'c', 2), row('u', 'd', 8),
  row('v', 'a', 9), row('v', 'b', 8), row('v', 'c', 3), row('v', 'd', 6),
  row('w', 'a', 3), row('w', 'd', 4), row('w', 'c', 5),
];
const catalog = prepareDataset({ bevs: BEVS, rankings: ROWS, comparisons: [] }).catalog;
const full = foldSnapshot(catalog, ROWS);
const train = holdOut(ROWS, new Set([rowKey('u', 'c')]), false);
const fold = foldSnapshot(catalog, train);

describe('fold builder', () => {
  it('matches buildSnapshot() on the training rows (the "never ranked" snapshot)', () => {
    const bevs: BevFeatures[] = BEVS.map((b) => ({ ...featuresOf(b), ratingCount: 0, mean: 0, stddev: 0 }));
    const expected = buildSnapshot(train.map((r) => ({ userId: r.userId, bevId: r.bevId, score: r.score })), bevs);
    expect({ ...fold, generatedAt: '' }).toEqual({ ...expected, generatedAt: '' });
  });

  it('matches buildSnapshot() on syntheticSnapshot data', () => {
    const s = syntheticSnapshot('fold-equiv', 12, 40);
    const bevs = Object.values(s.bevs);
    const rows = s.rankings.map((r) => row(r.userId, r.bevId, r.score));
    const cat = new Map(bevs.map((b) => [b.id, { id: b.id, categoryId: b.categoryId, brandKey: b.brandKey, flavorTokens: b.flavorTokens, priceTier: b.priceTier, isAlcoholic: b.isAlcoholic }]));
    const mine = foldSnapshot(cat, rows);
    const theirs = buildSnapshot(s.rankings, bevs);
    expect({ ...mine, generatedAt: '' }).toEqual({ ...theirs, generatedAt: '' });
  });
});

describe('leak 1: the held-out user’s stats are recomputed', () => {
  it('μ, σ, n exclude the held-out score, and a stale μ would change the prediction', () => {
    expect(fold.users.u?.stats).toEqual(populationStats([9, 7, 8]));
    expect(fold.users.u?.categoryStats.water).toBeUndefined();
    // The naive fold: drop the row but keep the user's (and everything else's) stored stats.
    const naive: PredictionSnapshot = { ...full, rankings: full.rankings.filter((r) => !(r.userId === 'u' && r.bevId === 'c')) };
    expect(naive.users.u?.stats.mean).toBeCloseTo(6.5, 12);
    const leaky = predictScore(naive, 'u', 'c').score;
    const clean = predictScore(fold, 'u', 'c').score;
    expect(Math.abs(leaky - clean)).toBeGreaterThan(0.3);
    // Leak direction: the stale mean includes the 2, pulling the prediction toward it.
    expect(leaky).toBeLessThan(clean);
  });
});

describe('leak 2: every fold is a fresh snapshot (snapshotContext caches by identity)', () => {
  it('mutating a snapshot in place reuses a stale context, so folds never mutate', () => {
    const s = foldSnapshot(catalog, ROWS);
    const before = predictScore(s, 'u', 'c').score;
    (s.users.u as { stats: { mean: number } }).stats.mean = 0; // what an in-place fold would do
    expect(predictScore(s, 'u', 'c').score).toBe(before); // stale: the WeakMap still holds the old context
    const a = foldSnapshot(catalog, ROWS);
    const b = foldSnapshot(catalog, ROWS);
    expect(a).not.toBe(b);
    expect(a.users).not.toBe(b.users);
    expect(a.bevs).not.toBe(b.bevs);
    expect(a.bevs.a).not.toBe(b.bevs.a);
    expect(a.rankings).not.toBe(b.rankings);
  });

  it('holdOut and foldSnapshot never mutate their (frozen) inputs', () => {
    const ds = syntheticDataset('frozen', 10, 30);
    const deepFreeze = <T>(x: T): T => {
      if (typeof x === 'object' && x !== null) {
        Object.freeze(x);
        for (const v of Object.values(x)) deepFreeze(v);
      }
      return x;
    };
    const prepared = prepareDataset(ds);
    deepFreeze(prepared.rankings);
    deepFreeze([...prepared.catalog.values()]);
    const first = prepared.rankings[0] as EvalRanking;
    expect(() => foldSnapshot(prepared.catalog, holdOut(prepared.rankings, new Set([rowKey(first.userId, first.bevId)]), true))).not.toThrow();
  });
});

describe('leak 3: the held-out row is stripped from the Bev’s stats and raters', () => {
  it('globalScore() and the Bayesian baseline cannot see the held-out z', () => {
    expect(full.bevs.c).toMatchObject({ ratingCount: 3 });
    expect(fold.bevs.c).toMatchObject({ ratingCount: 2, mean: 4, stddev: 1 });
    const raters = snapshotContext(fold).raters.get('c') ?? [];
    expect(raters.map((r) => r.userId).sort()).toEqual(['v', 'w']);
    // A fold that recomputed the user but left the row in `rankings` (and the Bev's stats) leaks u's own z.
    const leakyRows = foldSnapshot(catalog, ROWS);
    const leaky: PredictionSnapshot = { ...leakyRows, users: { ...leakyRows.users, u: fold.users.u as PredictionSnapshot['users'][string] } };
    expect(globalScore(leaky, 'c')).not.toBeCloseTo(globalScore(fold, 'c'), 3);
    expect(globalScore(leaky, 'c')).toBeLessThan(globalScore(fold, 'c')); // u's 2 drags g_c down
    const bayes = ARMS.find((a) => a.id === 'bayes-bev')!;
    expect(bayes.predict(full, 'u', 'c').score).not.toBeCloseTo(bayes.predict(fold, 'u', 'c').score, 3);
  });

  it('global stats exclude the held-out score too', () => {
    expect(fold.global.mean).toBeCloseTo(populationStats(train.map((r) => r.score)).mean, 12);
    expect(fold.global.byCategoryMean.water).toBe(4);
  });
});

describe('leak 4: re-spacing (a held-out Bev leaves a gap in its bucket)', () => {
  // u's LOVED list was [a, b, c]; then x was inserted at index 1, giving [a, x, b, c] re-spaced over n = 4.
  const loved = respaceBucket(['a', 'x', 'b', 'c'], 'LOVED');
  const fine = respaceBucket(['d', 'e'], 'FINE');
  const uRows = [...loved, ...fine.map((r) => ({ ...r }))].map((r, i) => ({
    ...row('u', r.bevId, r.score, i < loved.length ? 'LOVED' : 'FINE', r.position),
  }));

  it('reproduces exactly the scores stored before x was ranked', () => {
    const kept = holdOut(uRows, new Set([rowKey('u', 'x')]), true);
    const before = [...respaceBucket(['a', 'b', 'c'], 'LOVED'), ...fine];
    expect(kept.map((r) => [r.bevId, r.position, r.score])).toEqual(before.map((r) => [r.bevId, r.position, r.score]));
    // Without re-spacing the gap stays: b and c keep their n = 4 scores.
    const gap = holdOut(uRows, new Set([rowKey('u', 'x')]), false);
    expect(gap.find((r) => r.bevId === 'b')?.score).toBe(storedScore(2, 4, 'LOVED'));
    expect(storedScore(1, 3, 'LOVED')).not.toBe(storedScore(2, 4, 'LOVED'));
  });

  it('changes the prediction, so the gap is a real leak', () => {
    const others = [row('v', 'a', 9), row('v', 'x', 8.5), row('v', 'b', 8), row('v', 'd', 5), row('w', 'x', 9), row('w', 'a', 8), row('w', 'e', 4)];
    const cat = new Map(['a', 'x', 'b', 'c', 'd', 'e'].map((id) => [id, featuresOf(bev(id, id < 'd' || id === 'x' ? 'soda' : 'water', null, `n${id}`, 2))]));
    const all = [...uRows, ...others];
    const respaced = foldSnapshot(cat, holdOut(all, new Set([rowKey('u', 'x')]), true));
    const gapped = foldSnapshot(cat, holdOut(all, new Set([rowKey('u', 'x')]), false));
    expect(predictScore(respaced, 'u', 'x').score).not.toBeCloseTo(predictScore(gapped, 'u', 'x').score, 4);
  });

  it('leaves users who lost nothing untouched', () => {
    const all = [...uRows, row('v', 'a', 9.01, 'LOVED', 7)];
    const kept = holdOut(all, new Set([rowKey('u', 'x')]), true);
    expect(kept.find((r) => r.userId === 'v')).toBe(all[all.length - 1]);
  });
});
