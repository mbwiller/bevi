// Invariants of Layer 1's edges mode (bevSimilarity: 'edges', M-27 (a)).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { layer1, predictScore, recommend, SIM_MIN, type BevEdge, type PredictionSnapshot } from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';
import { syntheticEdges } from '../eval/synthetic.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

const base = syntheticSnapshot('edges-props', 12, 30);
const users = [...Object.keys(base.users).sort(), 'nobody'];
const bevs = Object.keys(base.bevs).sort();
const EDGES = { bevSimilarity: 'edges' } as const;
const withEdges = (edges: BevEdge[]): PredictionSnapshot => ({ ...base, edges });

/** Random edge sets: distinct unordered pairs of snapshot Bevs, weights in [0, 1]. */
const arbEdges = fc
  .uniqueArray(
    fc.record({ i: fc.integer({ min: 0, max: bevs.length - 1 }), j: fc.integer({ min: 0, max: bevs.length - 1 }), w: fc.double({ min: 0, max: 1, noNaN: true }) }),
    { selector: (e) => (e.i < e.j ? `${e.i}:${e.j}` : `${e.j}:${e.i}`), maxLength: 120 },
  )
  .map((xs) => xs.filter((e) => e.i !== e.j).map((e) => ({ a: bevs[e.i] as string, b: bevs[e.j] as string, w: e.w })));

/** The content term written out from the definition: Σ w·z / (Σ w + 1) over pairs with w ≥ SIM_MIN. */
function contentByHand(snap: PredictionSnapshot, edges: readonly BevEdge[], u: string, b: string): { content: number; mass: number } {
  const zu = snapshotContext(snap).z.get(u) ?? new Map<string, number>();
  const w = new Map<string, number>();
  for (const e of edges) {
    if (e.a === b) w.set(e.b, e.w);
    if (e.b === b) w.set(e.a, e.w);
  }
  let num = 0;
  let mass = 0;
  for (const [other, z] of zu) {
    if (other === b || !snap.bevs[other]) continue;
    const x = w.get(other) ?? 0;
    if (x < SIM_MIN) continue;
    num += x * z;
    mass += x;
  }
  return { content: num / (mass + 1), mass };
}

describe("layer1 with bevSimilarity: 'edges'", () => {
  it('matches the definition: stored w, 0 without an edge, SIM_MIN applied, the rest of Layer 1 unchanged', () => {
    fc.assert(
      fc.property(arbEdges, fc.constantFrom(...users), fc.constantFrom(...bevs), (edges, u, b) => {
        const snap = withEdges(edges);
        const l1 = layer1(snap, u, b, EDGES);
        const ref = layer1(base, u, b);
        const hand = contentByHand(snap, edges, u, b);
        expect(l1.parts.content).toBeCloseTo(hand.content, 12);
        expect(l1.parts.affinity).toBe(ref.parts.affinity);
        expect(l1.parts.global).toBe(ref.parts.global);
        expect(l1.confidence).toBeGreaterThanOrEqual(0);
        expect(l1.confidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('is invariant under edge orientation and row order', () => {
    fc.assert(
      fc.property(arbEdges, fc.array(fc.boolean(), { minLength: 120, maxLength: 120 }), fc.constantFrom(...users), (edges, flips, u) => {
        const flipped = edges.map((e, k) => (flips[k] ? { a: e.b, b: e.a, w: e.w } : e)).reverse();
        const s1 = withEdges(edges);
        const s2 = withEdges(flipped);
        for (const b of bevs) expect(layer1(s2, u, b, EDGES)).toEqual(layer1(s1, u, b, EDGES));
      }),
      { numRuns: 100 },
    );
  });

  it('only edges incident to the candidate matter', () => {
    fc.assert(
      fc.property(arbEdges, arbEdges, fc.constantFrom(...users), fc.constantFrom(...bevs), (edges, noise, u, b) => {
        const mine = edges.filter((e) => e.a === b || e.b === b);
        const keys = new Set(mine.map((e) => [e.a, e.b].sort().join('\u0000')));
        const others = noise.filter((e) => e.a !== b && e.b !== b && !keys.has([e.a, e.b].sort().join('\u0000')));
        expect(layer1(withEdges([...mine, ...others]), u, b, EDGES)).toEqual(layer1(withEdges(mine), u, b, EDGES));
      }),
      { numRuns: 200 },
    );
  });

  it('confidence is monotone in the edges: adding an edge never lowers conf1', () => {
    fc.assert(
      fc.property(arbEdges, fc.constantFrom(...users), fc.constantFrom(...bevs), fc.constantFrom(...bevs), fc.double({ min: 0, max: 1, noNaN: true }), (edges, u, b, other, w) => {
        fc.pre(other !== b);
        const rest = edges.filter((e) => !((e.a === b && e.b === other) || (e.a === other && e.b === b)));
        const before = layer1(withEdges(rest), u, b, EDGES).confidence;
        const after = layer1(withEdges([...rest, { a: b, b: other, w }]), u, b, EDGES).confidence;
        expect(after).toBeGreaterThanOrEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('an empty edge list gives content 0 and the category-only mass', () => {
    const snap = withEdges([]);
    for (const u of users) {
      for (const b of bevs) {
        const l1 = layer1(snap, u, b, EDGES);
        expect(l1.parts.content).toBe(0);
        const ref = layer1(base, u, b);
        expect(l1.confidence).toBeLessThanOrEqual(ref.confidence + 1e-12);
      }
    }
  });

  it('|content| is a shrunk weighted mean: at most max |z| of the user’s Bevs', () => {
    fc.assert(
      fc.property(arbEdges, fc.constantFrom(...users), fc.constantFrom(...bevs), (edges, u, b) => {
        const zs = [...(snapshotContext(base).z.get(u) ?? new Map<string, number>()).values()].map(Math.abs);
        expect(Math.abs(layer1(withEdges(edges), u, b, EDGES).parts.content)).toBeLessThanOrEqual(Math.max(0, ...zs) + 1e-12);
      }),
      { numRuns: 200 },
    );
  });
});

describe("predictScore and recommend with bevSimilarity: 'edges'", () => {
  const snap = withEdges(syntheticEdges(Object.values(base.bevs)));

  it('scores stay in [0, 10] with confidence in [0, 1]', () => {
    for (const u of users) {
      for (const b of bevs) {
        const p = predictScore(snap, u, b, EDGES);
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(10);
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('recommend: deterministic for a seed, never a ranked Bev, and edges mode changes predictions only', () => {
    fc.assert(
      fc.property(fc.constantFrom(...users), fc.integer({ min: 0, max: 30 }), fc.string(), (u, n, seed) => {
        const a = recommend(snap, u, { n, seed, ...EDGES });
        expect(recommend(snap, u, { n, seed, ...EDGES })).toEqual(a);
        const ranked = new Set(snapshotContext(snap).z.get(u)?.keys() ?? []);
        for (const r of a) {
          expect(ranked.has(r.bevId)).toBe(false);
          const p = predictScore(snap, u, r.bevId, EDGES);
          expect(r.score).toBe(p.score);
          expect(r.confidence).toBe(p.confidence);
        }
        expect(a.length).toBe(recommend(snap, u, { n, seed }).length);
        expect(a.filter((r) => r.isExploration).length).toBe(recommend(snap, u, { n, seed }).filter((r) => r.isExploration).length);
      }),
      { numRuns: 100 },
    );
  });

  it('one snapshot serves both modes without leaking between them (the lookup is cached separately)', () => {
    const s = withEdges(syntheticEdges(Object.values(base.bevs)));
    const before = bevs.map((b) => predictScore(s, users[0] as string, b));
    bevs.forEach((b) => predictScore(s, users[0] as string, b, EDGES));
    expect(bevs.map((b) => predictScore(s, users[0] as string, b))).toEqual(before);
    expect(before).toEqual(bevs.map((b) => predictScore(base, users[0] as string, b)));
  });
});
