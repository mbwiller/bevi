import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EDGE_MIN_WEIGHT,
  edgeWeight,
  embeddingSimilarity,
  profileSimilarity,
  topEdges,
  treeSimilarity,
  type EdgeComponents,
  type FlavorProfile,
  type Taxonomy,
} from '../src/index.ts';

/** A random forest: node i's parent is null or an earlier node, so it is acyclic. */
const taxonomyArb = fc
  .array(fc.option(fc.nat(), { nil: null, freq: 3 }), { minLength: 1, maxLength: 25 })
  .map((parents) => {
    const t: Record<string, string | null> = {};
    parents.forEach((p, i) => {
      t[`c${i}`] = i === 0 || p === null ? null : `c${p % i}`;
    });
    return t as Taxonomy;
  });
const withPair = taxonomyArb.chain((t) => {
  const ids = [...Object.keys(t), 'unlisted'];
  return fc.tuple(fc.constant(t), fc.constantFrom(...ids), fc.constantFrom(...ids));
});

const levelArb = fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3);
const profileArb: fc.Arbitrary<FlavorProfile> = fc.record({
  base: fc.constantFrom('cola', 'citrus', 'coffee', 'matcha', 'mineral'),
  carbonated: fc.boolean(),
  caffeine: levelArb,
  sweetness: levelArb,
  dairy: fc.boolean(),
  alcohol: fc.boolean(),
});

const vecArb = (n: number) => fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: n, maxLength: n });
const vecPairArb = fc.integer({ min: 1, max: 16 }).chain((n) => fc.tuple(vecArb(n), vecArb(n)));
const nonZero = (v: number[]) => v.some((x) => Math.abs(x) >= 1e-3);

const unitArb = fc.double({ min: 0, max: 1, noNaN: true });
const componentsArb: fc.Arbitrary<Required<EdgeComponents>> = fc.record({ tree: unitArb, content: unitArb, emb: unitArb, profile: unitArb, cop: unitArb });

describe('treeSimilarity properties', () => {
  it('is symmetric, in [0, 1], and 1 exactly when the categories are equal', () => {
    fc.assert(
      fc.property(withPair, ([t, a, b]) => {
        const s = treeSimilarity(a, b, t);
        expect(s).toBe(treeSimilarity(b, a, t));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(s === 1).toBe(a === b);
      }),
    );
  });

  it('a category is at least as close to its parent as to its grandparent', () => {
    fc.assert(
      fc.property(withPair, ([t, a]) => {
        const parent = t[a] ?? null;
        const grand = parent === null ? null : (t[parent] ?? null);
        if (parent === null || grand === null) return;
        expect(treeSimilarity(a, parent, t)).toBeGreaterThan(treeSimilarity(a, grand, t));
      }),
    );
  });
});

describe('profileSimilarity properties', () => {
  /** Eq. 17 with every term scaled by 300, so it is an integer. */
  const reference300 = (a: FlavorProfile, b: FlavorProfile) =>
    120 * Number(a.base === b.base) +
    45 * Number(a.carbonated === b.carbonated) +
    30 * Number(a.dairy === b.dairy) +
    15 * Number(a.alcohol === b.alcohol) +
    15 * (3 - Math.abs(a.caffeine - b.caffeine)) +
    15 * (3 - Math.abs(a.sweetness - b.sweetness));

  it('is symmetric, in [0, 1], 1 on identical profiles, and equals the exact integer form N / 300', () => {
    fc.assert(
      fc.property(profileArb, profileArb, (a, b) => {
        const s = profileSimilarity(a, b);
        expect(s).toBe(profileSimilarity(b, a));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(s).toBe(reference300(a, b) / 300);
        expect(profileSimilarity(a, { ...a })).toBe(1);
      }),
    );
  });

  it('agrees with the decimal form of eq. 17', () => {
    fc.assert(
      fc.property(profileArb, profileArb, (a, b) => {
        const decimal =
          0.4 * Number(a.base === b.base) +
          0.15 * Number(a.carbonated === b.carbonated) +
          0.1 * Number(a.dairy === b.dairy) +
          0.05 * Number(a.alcohol === b.alcohol) +
          0.15 * (1 - Math.abs(a.caffeine - b.caffeine) / 3) +
          0.15 * (1 - Math.abs(a.sweetness - b.sweetness) / 3);
        expect(profileSimilarity(a, b)).toBeCloseTo(decimal, 12);
      }),
    );
  });
});

describe('embeddingSimilarity properties', () => {
  it('is symmetric and in [0, 1]', () => {
    fc.assert(
      fc.property(vecPairArb, ([a, b]) => {
        const s = embeddingSimilarity(a, b);
        expect(s).toBe(embeddingSimilarity(b, a));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('is 1 for identical non-zero vectors', () => {
    fc.assert(
      fc.property(vecArb(8).filter(nonZero), (a) => {
        expect(embeddingSimilarity(a, [...a])).toBe(1);
      }),
    );
  });

  it('ignores positive scaling', () => {
    fc.assert(
      fc.property(vecPairArb, fc.double({ min: 0.01, max: 100, noNaN: true }), ([a, b], k) => {
        if (!nonZero(a) || !nonZero(b)) return;
        expect(embeddingSimilarity(a.map((x) => k * x), b)).toBeCloseTo(embeddingSimilarity(a, b), 9);
      }),
    );
  });
});

describe('edgeWeight properties', () => {
  it('is in [0, 1] and γ = 0 makes cop irrelevant', () => {
    fc.assert(
      fc.property(componentsArb, (c) => {
        const w = edgeWeight(c);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
        expect(edgeWeight({ ...c, cop: 0 })).toBe(w);
      }),
    );
  });

  it('is non-decreasing in every component', () => {
    const keyArb = fc.constantFrom('tree', 'content', 'emb', 'profile', 'cop' as const);
    fc.assert(
      fc.property(componentsArb, keyArb, unitArb, (c, key, v) => {
        const lo = Math.min(c[key], v);
        const hi = Math.max(c[key], v);
        expect(edgeWeight({ ...c, [key]: lo })).toBeLessThanOrEqual(edgeWeight({ ...c, [key]: hi }));
      }),
    );
  });

  it('is 1 when every term is 1, and symmetric pairs weigh the same', () => {
    expect(edgeWeight({ tree: 1, content: 1, emb: 1, profile: 1 })).toBe(1);
    fc.assert(
      fc.property(withPair, profileArb, profileArb, vecPairArb, unitArb, ([t, ca, cb], pa, pb, [ea, eb], content) => {
        const ab = edgeWeight({ tree: treeSimilarity(ca, cb, t), content, emb: embeddingSimilarity(ea, eb), profile: profileSimilarity(pa, pb) });
        const ba = edgeWeight({ tree: treeSimilarity(cb, ca, t), content, emb: embeddingSimilarity(eb, ea), profile: profileSimilarity(pb, pa) });
        expect(ab).toBe(ba);
      }),
    );
  });
});

describe('topEdges properties', () => {
  const candidatesArb = fc.uniqueArray(
    fc.record({ bevId: fc.stringMatching(/^[a-z0-9]{1,4}$/), w: fc.constantFrom(0, 0.1, 0.29, 0.3, 0.31, 0.5, 0.5, 0.75, 0.9, 1) }),
    { selector: (c) => c.bevId, maxLength: 40 },
  );

  it('returns the heaviest edges with w ≥ min, ordered by (w desc, bevId asc), at most k', () => {
    fc.assert(
      fc.property(candidatesArb, fc.integer({ min: 0, max: 30 }), (cands, k) => {
        const got = topEdges(cands, k);
        expect(got.length).toBe(Math.min(k, cands.filter((c) => c.w >= EDGE_MIN_WEIGHT).length));
        for (const c of got) expect(c.w).toBeGreaterThanOrEqual(EDGE_MIN_WEIGHT);
        for (let i = 1; i < got.length; i++) {
          const p = got[i - 1]!;
          const c = got[i]!;
          expect(p.w > c.w || (p.w === c.w && p.bevId < c.bevId)).toBe(true);
        }
        // Nothing left out outranks anything kept.
        const kept = new Set(got.map((c) => c.bevId));
        const last = got[got.length - 1];
        for (const c of cands) {
          if (kept.has(c.bevId) || c.w < EDGE_MIN_WEIGHT || last === undefined) continue;
          expect(c.w < last.w || (c.w === last.w && c.bevId > last.bevId)).toBe(true);
        }
      }),
    );
  });

  it('does not depend on the input order', () => {
    fc.assert(
      fc.property(candidatesArb, fc.integer({ min: 0, max: 30 }), (cands, k) => {
        expect(topEdges([...cands].reverse(), k)).toEqual(topEdges(cands, k));
      }),
    );
  });
});
