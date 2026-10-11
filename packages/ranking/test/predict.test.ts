import { describe, expect, it } from 'vitest';
import {
  blendLambda,
  globalScore,
  layer1,
  layer2,
  populationStats,
  predictScore,
  userSimilarity,
  type BevFeatures,
} from '../src/index.ts';
import { buildSnapshot, syntheticSnapshot } from './snapshot-fixture.ts';

const bev = (id: string, categoryId: string, brandKey: string | null, flavorTokens: string[], priceTier: 1 | 2 | 3 | 4): BevFeatures => ({
  id, categoryId, brandKey, flavorTokens, priceTier, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false,
});

// u: a 9, b 7, c 2 · v: a 9, b 8, d 6 · w: a 3, d 4 (n = 2 → global stats)
const snap = buildSnapshot(
  [
    { userId: 'u', bevId: 'a', score: 9 },
    { userId: 'u', bevId: 'b', score: 7 },
    { userId: 'u', bevId: 'c', score: 2 },
    { userId: 'v', bevId: 'a', score: 9 },
    { userId: 'v', bevId: 'b', score: 8 },
    { userId: 'v', bevId: 'd', score: 6 },
    { userId: 'w', bevId: 'a', score: 3 },
    { userId: 'w', bevId: 'd', score: 4 },
  ],
  [
    bev('a', 'soda', 'coke', ['cola'], 1),
    bev('b', 'soda', 'coke', ['cherry', 'cola'], 1),
    bev('c', 'water', null, [], 4),
    bev('d', 'soda', 'pepsi', ['cola'], 1),
  ],
);

const su = populationStats([9, 7, 2]);
const sv = populationStats([9, 8, 6]);
const g = populationStats([9, 7, 2, 9, 8, 6, 3, 4]);
const zu = (s: number) => (s - su.mean) / su.stddev;
const zv = (s: number) => (s - sv.mean) / sv.stddev;
const zw = (s: number) => (s - g.mean) / g.stddev;

describe('layer 1 (worked example)', () => {
  it('affinity, content, global and confidence for u → d', () => {
    const l1 = layer1(snap, 'u', 'd');
    const affinity = (zu(9) + zu(7)) / (2 + 2);
    // sim(d, a) = 0.4 + 0.2·1 + 0.1 = 0.7; sim(d, b) = 0.4 + 0.2·0.5 + 0.1 = 0.6; sim(d, c) = 0 (dropped)
    const content = (0.7 * zu(9) + 0.6 * zu(7)) / (1.3 + 1);
    const global = (zv(6) + zw(4)) / (2 + 3);
    expect(l1.parts.affinity).toBeCloseTo(affinity, 12);
    expect(l1.parts.content).toBeCloseTo(content, 12);
    expect(l1.parts.global).toBeCloseTo(global, 12);
    expect(globalScore(snap, 'd')).toBeCloseTo(global, 12);
    expect(l1.z).toBeCloseTo(0.4 * affinity + 0.4 * content + 0.2 * global, 12);
    expect(l1.confidence).toBeCloseTo(0.3 * Math.min(1, (2 + 1.3) / 4), 12);
  });
});

describe('layer 2 (worked example)', () => {
  it('user similarity is significance-weighted cosine over common items', () => {
    const a = [zu(9), zu(7)];
    const b = [zv(9), zv(8)];
    const cos = (a[0]! * b[0]! + a[1]! * b[1]!) / Math.hypot(...a) / Math.hypot(...b);
    expect(userSimilarity(snap, 'u', 'v')).toBeCloseTo((cos * 2) / 5, 12);
    expect(userSimilarity(snap, 'u', 'w')).toBe(0); // one common item
    expect(userSimilarity(snap, 'u', 'u')).toBe(0);
    const l2 = layer2(snap, 'u', 'd');
    expect(l2.neighbours).toEqual(['v']);
    expect(l2.z).toBeCloseTo(zv(6), 12);
    expect(l2.support).toBeCloseTo((cos * 2) / 5, 12);
    expect(layer2(snap, 'u', 'c')).toEqual({ z: 0, support: 0, neighbours: [] });
  });
});

describe('predictScore', () => {
  it('blends with λ = 0.7·s/(s+1)·min(1, n/15) and maps back to the 0–10 scale', () => {
    const p = predictScore(snap, 'u', 'd');
    const s = p.layer2.support;
    const lambda = ((0.7 * s) / (s + 1)) * (3 / 15);
    expect(p.lambda).toBeCloseTo(lambda, 12);
    expect(blendLambda(s, 3)).toBeCloseTo(lambda, 12);
    const z = (1 - lambda) * p.layer1.z + lambda * p.layer2.z;
    expect(p.z).toBeCloseTo(z, 12);
    expect(p.score).toBeCloseTo(su.mean + su.stddev * z, 12);
    expect(p.confidence).toBeCloseTo(Math.max(p.layer1.confidence, Math.min(1, s)), 12);
  });

  it('support = 0 is pure Layer 1', () => {
    const p = predictScore(snap, 'w', 'b');
    expect(p.lambda).toBe(0);
    expect(p.z).toBe(p.layer1.z);
  });

  it('a stranger gets the global mean with zero confidence when nothing is known', () => {
    const s2 = buildSnapshot([], [bev('x', 'soda', null, [], 2)]);
    const p = predictScore(s2, 'nobody', 'x');
    expect(p).toMatchObject({ z: 0, score: 5, confidence: 0, lambda: 0 });
  });

  it('throws on a version mismatch or unknown Bev', () => {
    expect(() => predictScore({ ...snap, version: '0.0.1' }, 'u', 'd')).toThrow(/version/);
    expect(() => predictScore(snap, 'u', 'nope')).toThrow(RangeError);
  });

  it('stays in [0, 10] with confidence in [0, 1] on a synthetic snapshot', () => {
    const s = syntheticSnapshot('predict');
    for (const u of Object.keys(s.users)) {
      for (const b of Object.keys(s.bevs)) {
        const p = predictScore(s, u, b);
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(10);
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
        expect(p.lambda).toBeGreaterThanOrEqual(0);
        expect(p.lambda).toBeLessThan(0.7);
      }
    }
  });
});
