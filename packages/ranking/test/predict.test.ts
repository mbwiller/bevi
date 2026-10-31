import { describe, expect, it } from 'vitest';
import {
  blendLambda,
  CF_K,
  effectiveBevSimilarity,
  effectiveUserSimilarity,
  neighbourReliability,
  globalScore,
  layer1,
  layer2,
  pearsonSimilarity,
  populationStats,
  predictScore,
  recommend,
  userSimilarity,
  type BevFeatures,
  type PredictionSnapshot,
  type PredictOptions,
  type UserNeighbour,
} from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';
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

describe('layer 2 with userSimilarity: "pearson" (M-28, off by default)', () => {
  it('worked example: u and v share a, b, where Pearson is ±1 by construction', () => {
    // u: z(9) > z(7); v: z(9) > z(8). Two common items, same order → r = 1; sim' = 1 · 2/5.
    expect(userSimilarity(snap, 'u', 'v', { userSimilarity: 'pearson' })).toBeCloseTo(0.4, 12);
    expect(userSimilarity(snap, 'u', 'w', { userSimilarity: 'pearson' })).toBe(0); // one common item
    expect(userSimilarity(snap, 'u', 'u', { userSimilarity: 'pearson' })).toBe(0);
    const l2 = layer2(snap, 'u', 'd', { userSimilarity: 'pearson' });
    expect(l2.neighbours).toEqual(['v']);
    expect(l2.z).toBeCloseTo(zv(6), 12);
    expect(l2.support).toBeCloseTo(0.4, 12);
    // Cosine said (cos · 2)/5 with cos < 1: the two similarities differ even here.
    expect(userSimilarity(snap, 'u', 'v')).toBeLessThan(0.4);
  });

  it('re-centring: shared Bevs above both users’ means in opposite order are a neighbour under cosine only', () => {
    // p and q each rank a low Bev (2.0) that the other didn't, so a and b sit above both means.
    const s2 = buildSnapshot(
      [
        { userId: 'p', bevId: 'a', score: 8 },
        { userId: 'p', bevId: 'b', score: 9 },
        { userId: 'p', bevId: 'c', score: 2 },
        { userId: 'q', bevId: 'a', score: 9 },
        { userId: 'q', bevId: 'b', score: 8 },
        { userId: 'q', bevId: 'd', score: 2 },
      ],
      [bev('a', 'soda', null, [], 1), bev('b', 'soda', null, [], 1), bev('c', 'soda', null, [], 1), bev('d', 'soda', null, [], 1)],
    );
    expect(userSimilarity(s2, 'p', 'q')).toBeGreaterThan(0.3);
    expect(userSimilarity(s2, 'p', 'q', { userSimilarity: 'pearson' })).toBeCloseTo(-0.4, 12);
    expect(layer2(s2, 'p', 'd').neighbours).toEqual(['q']);
    expect(layer2(s2, 'p', 'd', { userSimilarity: 'pearson' })).toEqual({ z: 0, support: 0, neighbours: [] });
  });

  it("explicit 'cosine' is the default, bit for bit, through layer2, predictScore and recommend", () => {
    const s = syntheticSnapshot('cosine-default', 14, 40);
    for (const u of Object.keys(s.users)) {
      for (const b of Object.keys(s.bevs)) {
        expect(layer2(s, u, b, { userSimilarity: 'cosine' })).toEqual(layer2(s, u, b));
        expect(predictScore(s, u, b, { userSimilarity: 'cosine' })).toEqual(predictScore(s, u, b));
        expect(predictScore(s, u, b, {})).toEqual(predictScore(s, u, b));
      }
      expect(recommend(s, u, { n: 20, seed: 'x', userSimilarity: 'cosine' })).toEqual(recommend(s, u, { n: 20, seed: 'x' }));
    }
  });

  it('pearson changes only the similarity: neighbours, ẑ2 and support follow from pearsonSimilarity', () => {
    const s = syntheticSnapshot('pearson-wiring', 14, 40);
    const ctx = snapshotContext(s);
    let differs = 0;
    for (const u of Object.keys(s.users)) {
      for (const b of Object.keys(s.bevs)) {
        const zu = ctx.z.get(u) ?? new Map<string, number>();
        const expected = (ctx.raters.get(b) ?? [])
          .filter((r) => r.userId !== u)
          .map((r) => ({ userId: r.userId, z: r.z, sim: pearsonSimilarity(zu, ctx.z.get(r.userId) ?? new Map()).sim }))
          .filter((r) => r.sim > 0)
          .sort((x, y) => y.sim - x.sim || (x.userId < y.userId ? -1 : 1))
          .slice(0, CF_K);
        const support = expected.reduce((t, r) => t + r.sim, 0);
        const l2 = layer2(s, u, b, { userSimilarity: 'pearson' });
        expect(l2.neighbours).toEqual(expected.map((r) => r.userId));
        expect(l2.support).toBeCloseTo(support, 12);
        expect(l2.z).toBeCloseTo(support > 0 ? expected.reduce((t, r) => t + r.sim * r.z, 0) / support : 0, 12);
        const p = predictScore(s, u, b, { userSimilarity: 'pearson' });
        expect(p.layer1).toEqual(predictScore(s, u, b).layer1);
        expect(p.layer2).toEqual(l2);
        if (p.score !== predictScore(s, u, b).score) differs++;
      }
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('the option never leaks between calls on one snapshot (separate caches)', () => {
    const s = syntheticSnapshot('cache', 10, 30);
    const users = Object.keys(s.users).sort();
    const before = users.map((u) => userSimilarity(s, users[0] as string, u));
    users.forEach((u) => userSimilarity(s, users[0] as string, u, { userSimilarity: 'pearson' }));
    expect(users.map((u) => userSimilarity(s, users[0] as string, u))).toEqual(before);
  });

  it('rejects an unknown similarity', () => {
    const bad = { userSimilarity: 'jaccard' } as unknown as { userSimilarity: 'cosine' };
    expect(() => layer2(snap, 'u', 'd', bad)).toThrow(RangeError);
    expect(() => predictScore(snap, 'u', 'd', bad)).toThrow(RangeError);
    expect(() => userSimilarity(snap, 'u', 'v', bad)).toThrow(RangeError);
    expect(() => recommend(snap, 'u', { n: 3, seed: 's', ...bad })).toThrow(RangeError);
  });
});

describe("layer 1 with bevSimilarity: 'edges' (M-27 (a), off by default)", () => {
  // Stored edges for the worked example: d–a 0.9 (stored in the a < d orientation), no d–b edge,
  // d–c 0.05 (below SIM_MIN), and a–b 0.8, which does not touch d.
  const edges = [
    { a: 'a', b: 'd', w: 0.9 },
    { a: 'a', b: 'b', w: 0.8 },
    { a: 'c', b: 'd', w: 0.05 },
  ];
  const withEdges = { ...snap, edges };

  it('worked example u → d: w replaces sim, a missing edge weighs 0, SIM_MIN still applies', () => {
    const l1 = layer1(withEdges, 'u', 'd', { bevSimilarity: 'edges' });
    const base = layer1(snap, 'u', 'd');
    // content = 0.9·z(a) / (0.9 + 1): b has no edge to d, c's 0.05 is below SIM_MIN = 0.1.
    expect(l1.parts.content).toBeCloseTo((0.9 * zu(9)) / (0.9 + 1), 12);
    expect(l1.parts.affinity).toBe(base.parts.affinity);
    expect(l1.parts.global).toBe(base.parts.global);
    expect(l1.z).toBeCloseTo(0.4 * l1.parts.affinity + 0.4 * l1.parts.content + 0.2 * l1.parts.global, 12);
    // conf1's mass is n_{u,soda} = 2 plus Σw = 0.9.
    expect(l1.confidence).toBeCloseTo(0.3 * Math.min(1, (2 + 0.9) / 4), 12);
  });

  it('a candidate with no stored edge to the user’s Bevs has content 0', () => {
    const l1 = layer1({ ...snap, edges: [{ a: 'a', b: 'b', w: 0.8 }] }, 'u', 'd', { bevSimilarity: 'edges' });
    expect(l1.parts.content).toBe(0);
    expect(l1.confidence).toBeCloseTo(0.3 * Math.min(1, 2 / 4), 12);
    expect(layer1({ ...snap, edges: [] }, 'u', 'd', { bevSimilarity: 'edges' }).parts.content).toBe(0);
  });

  it('falls back to the computed similarity when the snapshot has no edges field', () => {
    expect(effectiveBevSimilarity(snap, { bevSimilarity: 'edges' })).toBe('content');
    expect(effectiveBevSimilarity({ ...snap, edges: null }, { bevSimilarity: 'edges' })).toBe('content');
    expect(effectiveBevSimilarity({ ...snap, edges: [] }, { bevSimilarity: 'edges' })).toBe('edges');
    expect(effectiveBevSimilarity(withEdges, {})).toBe('content');
    expect(layer1(snap, 'u', 'd', { bevSimilarity: 'edges' })).toEqual(layer1(snap, 'u', 'd'));
    expect(predictScore(snap, 'u', 'd', { bevSimilarity: 'edges' })).toEqual(predictScore(snap, 'u', 'd'));
  });

  it('the default ignores a present edges field, bit for bit', () => {
    for (const u of ['u', 'v', 'w', 'nobody']) {
      for (const b of ['a', 'b', 'c', 'd']) {
        expect(predictScore(withEdges, u, b)).toEqual(predictScore(snap, u, b));
        expect(predictScore(withEdges, u, b, { bevSimilarity: 'content' })).toEqual(predictScore(snap, u, b));
      }
    }
  });

  it('predictScore and recommend pass the option to Layer 1; Layer 2 is untouched', () => {
    const p = predictScore(withEdges, 'u', 'd', { bevSimilarity: 'edges' });
    expect(p.layer1).toEqual(layer1(withEdges, 'u', 'd', { bevSimilarity: 'edges' }));
    expect(p.layer2).toEqual(predictScore(snap, 'u', 'd').layer2);
    const rec = recommend(withEdges, 'u', { n: 1, seed: 's', epsilon: 0, bevSimilarity: 'edges' });
    expect(rec).toEqual([{ bevId: 'd', score: p.score, confidence: p.confidence, reason: expect.any(String), isExploration: false }]);
  });

  it('rejects malformed edges in edges mode only, and an unknown mode always', () => {
    const bad: Array<[string, unknown]> = [
      ['self-edge', [{ a: 'a', b: 'a', w: 0.5 }]],
      ['pair listed twice', [{ a: 'a', b: 'd', w: 0.5 }, { a: 'd', b: 'a', w: 0.5 }]],
      ['w above 1', [{ a: 'a', b: 'd', w: 1.5 }]],
      ['w negative', [{ a: 'a', b: 'd', w: -0.1 }]],
      ['w NaN', [{ a: 'a', b: 'd', w: Number.NaN }]],
      ['w as a string', [{ a: 'a', b: 'd', w: '0.5' }]],
      ['missing id', [{ a: '', b: 'd', w: 0.5 }]],
      ['not an array', { a: 'a', b: 'd', w: 0.5 }],
    ];
    for (const [name, e] of bad) {
      const s = { ...snap, edges: e } as unknown as typeof snap;
      expect(() => layer1(s, 'u', 'd', { bevSimilarity: 'edges' }), name).toThrow(RangeError);
      expect(predictScore(s, 'u', 'd'), name).toEqual(predictScore(snap, 'u', 'd'));
    }
    const typo = { bevSimilarity: 'graph' } as unknown as { bevSimilarity: 'edges' };
    expect(() => layer1(snap, 'u', 'd', typo)).toThrow(RangeError);
    expect(() => predictScore(snap, 'u', 'd', typo)).toThrow(RangeError);
    expect(() => recommend(snap, 'u', { n: 3, seed: 's', ...typo })).toThrow(RangeError);
  });

  it('edges between Bevs outside the snapshot are ignored', () => {
    const extra = { ...snap, edges: [...edges, { a: 'd', b: 'zz-gone', w: 1 }, { a: 'zz-x', b: 'zz-y', w: 0.5 }] };
    expect(layer1(extra, 'u', 'd', { bevSimilarity: 'edges' })).toEqual(layer1(withEdges, 'u', 'd', { bevSimilarity: 'edges' }));
  });
});

describe("layer 2 with userSimilarity: 'stored' (Stage 4, off by default)", () => {
  // Stored lists for the worked example: u's neighbours are v (sim 0.7, 2 common) and w (sim 0.5,
  // 1 common: the cosine gives w 0). v has n = 3 rankings, w n = 2, so reliability 1/5 and 2/15.
  // v's own list names u, to show that only the keyed user's list is read.
  const nb = (userId: string, sim: number, common: number): UserNeighbour => ({ userId, sim, common });
  const lists = { u: [nb('v', 0.7, 2), nb('w', 0.5, 1)], v: [nb('u', 0.7, 2)] };
  const withLists = (userNeighbours: unknown): PredictionSnapshot => ({ ...snap, userNeighbours }) as PredictionSnapshot;
  const stored = withLists(lists);
  const STORED = { userSimilarity: 'stored' } as const;

  it('worked example u → d: sim_B · min(1, n_v / 15) for listed users, and |common| is not read', () => {
    const sv = 0.7 * (3 / 15);
    const sw = 0.5 * (2 / 15);
    expect(userSimilarity(stored, 'u', 'v', STORED)).toBeCloseTo(sv, 15);
    expect(userSimilarity(stored, 'u', 'w', STORED)).toBeCloseTo(sw, 15);
    expect(userSimilarity(stored, 'u', 'w')).toBe(0); // the cosine needs 2 common Bevs
    expect(neighbourReliability(3)).toBeCloseTo(1 / 5, 15);
    const l2 = layer2(stored, 'u', 'd', STORED);
    expect(l2.neighbours).toEqual(['v', 'w']);
    expect(l2.support).toBeCloseTo(sv + sw, 15);
    expect(l2.z).toBeCloseTo((sv * zv(6) + sw * zw(4)) / (sv + sw), 12);
    expect(effectiveUserSimilarity(stored, 'u', STORED)).toBe('stored');
  });

  it('a listed user who did not rank b contributes nothing, and an unlisted rater weighs 0', () => {
    // b is ranked by u and v only. u's list holds w alone: v is unlisted, so nobody is left.
    const s = withLists({ u: [nb('w', 0.5, 1)] });
    expect(layer2(snap, 'u', 'b').neighbours).toEqual(['v']); // the cosine weights v
    expect(layer2(s, 'u', 'b', STORED)).toEqual({ z: 0, support: 0, neighbours: [] });
    expect(userSimilarity(s, 'u', 'v', STORED)).toBe(0);
  });

  it('a listed user unknown to the snapshot weighs 0; a negative stored sim is excluded', () => {
    const ghost = withLists({ u: [nb('ghost', 0.9, 4), nb('v', 0.7, 2)] });
    expect(userSimilarity(ghost, 'u', 'ghost', STORED)).toBe(0);
    expect(layer2(ghost, 'u', 'd', STORED)).toEqual(layer2(withLists({ u: [nb('v', 0.7, 2)] }), 'u', 'd', STORED));
    const negative = withLists({ u: [nb('v', 0.7, 2), nb('w', -0.5, 1)] });
    expect(userSimilarity(negative, 'u', 'w', STORED)).toBeCloseTo(-0.5 * (2 / 15), 15);
    expect(layer2(negative, 'u', 'd', STORED).neighbours).toEqual(['v']);
  });

  it('n_v comes from users[v].stats.n, or from v’s rankings when v is missing from users', () => {
    const big: PredictionSnapshot = { ...stored, users: { ...snap.users, v: { ...(snap.users.v as PredictionSnapshot['users'][string]), stats: { n: 40, mean: sv.mean, stddev: sv.stddev } } } };
    expect(userSimilarity(big, 'u', 'v', STORED)).toBe(0.7);
    const { w: _w, ...noW } = snap.users;
    expect(userSimilarity({ ...stored, users: noW }, 'u', 'w', STORED)).toBeCloseTo(0.5 * (2 / 15), 15);
  });

  it('falls back to the in-snapshot cosine without the field, or when the user has no rows', () => {
    const fallbacks: Array<[string, unknown]> = [
      ['no field', undefined],
      ['null', null],
      ['empty object', {}],
      ['u has an empty list', { u: [], v: [nb('u', 0.7, 2)] }],
      ['u has no key', { v: [nb('u', 0.7, 2)] }],
    ];
    for (const [name, field] of fallbacks) {
      const s = field === undefined ? snap : withLists(field);
      expect(effectiveUserSimilarity(s, 'u', STORED), name).toBe('cosine');
      for (const b of ['a', 'b', 'c', 'd']) {
        expect(layer2(s, 'u', b, STORED), name).toEqual(layer2(snap, 'u', b));
        expect(predictScore(s, 'u', b, STORED), name).toEqual(predictScore(snap, 'u', b));
      }
    }
    // Only a stored request reads the field; the others are returned as asked.
    expect(effectiveUserSimilarity(stored, 'u')).toBe('cosine');
    expect(effectiveUserSimilarity(stored, 'u', { userSimilarity: 'pearson' })).toBe('pearson');
    expect(effectiveUserSimilarity(stored, 'w', STORED)).toBe('cosine'); // w has no list
  });

  it('the default ignores a present userNeighbours field, bit for bit', () => {
    const edges = [{ a: 'a', b: 'd', w: 0.9 }];
    const options: PredictOptions[] = [];
    for (const userSim of [undefined, 'cosine', 'pearson'] as const) {
      for (const bevSim of [undefined, 'content', 'edges'] as const) options.push({ ...(userSim ? { userSimilarity: userSim } : {}), ...(bevSim ? { bevSimilarity: bevSim } : {}) });
    }
    for (const [plain, field] of [
      [snap, stored],
      [{ ...snap, edges }, { ...stored, edges }],
    ] as Array<[PredictionSnapshot, PredictionSnapshot]>) {
      for (const u of ['u', 'v', 'w', 'nobody']) {
        for (const b of ['a', 'b', 'c', 'd']) {
          for (const o of options) {
            expect(predictScore(field, u, b, o)).toEqual(predictScore(plain, u, b, o));
            expect(layer2(field, u, b, o)).toEqual(layer2(plain, u, b, o));
            expect(userSimilarity(field, u, 'v', o)).toBe(userSimilarity(plain, u, 'v', o));
          }
        }
        expect(recommend(field, u, { n: 4, seed: 's' })).toEqual(recommend(plain, u, { n: 4, seed: 's' }));
      }
    }
  });

  it('stored without the field equals the default through layer2, predictScore and recommend', () => {
    const s = syntheticSnapshot('stored-no-field', 14, 40);
    for (const u of Object.keys(s.users)) {
      for (const b of Object.keys(s.bevs)) {
        expect(layer2(s, u, b, STORED)).toEqual(layer2(s, u, b));
        expect(predictScore(s, u, b, STORED)).toEqual(predictScore(s, u, b));
      }
      expect(recommend(s, u, { n: 20, seed: 'x', ...STORED })).toEqual(recommend(s, u, { n: 20, seed: 'x' }));
    }
  });

  it('predictScore and recommend pass the option to Layer 2; Layer 1 is untouched', () => {
    const p = predictScore(stored, 'u', 'd', STORED);
    const l2 = layer2(stored, 'u', 'd', STORED);
    expect(p.layer2).toEqual(l2);
    expect(p.layer1).toEqual(layer1(snap, 'u', 'd'));
    expect(p.lambda).toBeCloseTo(blendLambda(l2.support, 3), 15);
    expect(p.lambda).not.toBe(predictScore(snap, 'u', 'd').lambda);
    expect(p.z).toBeCloseTo((1 - p.lambda) * p.layer1.z + p.lambda * l2.z, 12);
    expect(p.confidence).toBe(Math.max(p.layer1.confidence, Math.min(1, l2.support)));
    const rec = recommend(stored, 'u', { n: 1, seed: 's', epsilon: 0, ...STORED });
    expect(rec).toEqual([{ bevId: 'd', score: p.score, confidence: p.confidence, reason: expect.any(String), isExploration: false }]);
    expect(rec[0]?.score).not.toBe(recommend(stored, 'u', { n: 1, seed: 's', epsilon: 0 })[0]?.score);
  });

  it('one snapshot serves every mode without leaking between them (separate caches)', () => {
    const s = withLists(lists);
    const before = ['a', 'b', 'c', 'd'].map((b) => predictScore(s, 'u', b));
    ['a', 'b', 'c', 'd'].forEach((b) => predictScore(s, 'u', b, STORED));
    ['a', 'b', 'c', 'd'].forEach((b) => predictScore(s, 'u', b, { userSimilarity: 'pearson' }));
    expect(['a', 'b', 'c', 'd'].map((b) => predictScore(s, 'u', b))).toEqual(before);
    expect(snapshotContext(s).userSims.get('u')).not.toEqual(snapshotContext(s).userSimsStored.get('u'));
  });

  it('rejects a malformed userNeighbours field in stored mode only', () => {
    const ok = nb('v', 0.7, 2);
    const bad: Array<[string, unknown]> = [
      ['self-row', { u: [ok, nb('u', 0.5, 3)] }],
      ['neighbour listed twice', { u: [ok, nb('v', 0.4, 2)] }],
      ['sim above 1', { u: [nb('v', 1.5, 2)] }],
      ['sim below -1', { u: [nb('v', -1.01, 2)] }],
      ['sim NaN', { u: [nb('v', Number.NaN, 2)] }],
      ['sim Infinity', { u: [nb('v', Number.POSITIVE_INFINITY, 2)] }],
      ['sim as a string', { u: [{ userId: 'v', sim: '0.7', common: 2 }] }],
      ['common negative', { u: [nb('v', 0.7, -1)] }],
      ['common not an integer', { u: [nb('v', 0.7, 1.5)] }],
      ['common missing', { u: [{ userId: 'v', sim: 0.7 }] }],
      ['empty userId', { u: [nb('', 0.7, 2)] }],
      ['userId not a string', { u: [{ userId: 7, sim: 0.7, common: 2 }] }],
      ['row not an object', { u: [null] }],
      ['list not an array', { u: ok }],
      ['a malformed list of another user', { u: [ok], v: [nb('v', 0.7, 2)] }],
      ['field is an array', [ok]],
      ['field is a string', 'u'],
      ['field is a Map', new Map([['u', [ok]]])],
    ];
    for (const [name, field] of bad) {
      const s = withLists(field);
      expect(() => layer2(s, 'u', 'd', STORED), name).toThrow(RangeError);
      expect(() => effectiveUserSimilarity(s, 'nobody', STORED), name).toThrow(RangeError);
      expect(() => predictScore(s, 'u', 'd', STORED), name).toThrow(RangeError);
      expect(() => recommend(s, 'u', { n: 2, seed: 's', ...STORED }), name).toThrow(RangeError);
      expect(predictScore(s, 'u', 'd'), name).toEqual(predictScore(snap, 'u', 'd'));
      expect(predictScore(s, 'u', 'd', { userSimilarity: 'pearson' }), name).toEqual(predictScore(snap, 'u', 'd', { userSimilarity: 'pearson' }));
    }
    const typo = { userSimilarity: 'neighbours' } as unknown as PredictOptions;
    expect(() => layer2(stored, 'u', 'd', typo)).toThrow(RangeError);
    expect(() => effectiveUserSimilarity(stored, 'u', typo)).toThrow(RangeError);
  });

  it('userSimilarity in stored mode is per user: u’s list does not make u a neighbour of v', () => {
    const one = withLists({ u: [nb('v', 0.7, 2)] });
    expect(userSimilarity(one, 'u', 'v', STORED)).toBeCloseTo(0.14, 15);
    // v has no list, so v falls back to the cosine, which is symmetric.
    expect(userSimilarity(one, 'v', 'u', STORED)).toBe(userSimilarity(snap, 'v', 'u'));
    expect(userSimilarity(one, 'u', 'u', STORED)).toBe(0);
  });
});
