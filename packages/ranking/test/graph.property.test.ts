import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  attributeSimilarity,
  blendUserSimilarity,
  categoryAffinity,
  CF_K,
  CF_MIN_COMMON,
  layer2,
  neighbourReliability,
  pearsonCorrelation,
  pearsonSimilarity,
  predictScore,
  sharedAttributeCount,
  significanceWeight,
  TASTE_MIN_SHARED_ATTRS,
  TASTE_SIM_FLOOR,
  tasteCatalog,
  tasteVector,
  topUserNeighbours,
  type TasteBev,
  type TasteVector,
} from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

// z-scores on the grid real ones live on (stored scores are cents, σ ≥ 1): k/100 for |k| ≤ 500.
const zArb = fc.integer({ min: -500, max: 500 }).map((k) => k / 100);
const constArb = fc.integer({ min: -300, max: 300 }).map((k) => k / 100);
const vecArb = (min: number, max: number) => fc.integer({ min, max }).chain((n) => fc.tuple(fc.array(zArb, { minLength: n, maxLength: n }), fc.array(zArb, { minLength: n, maxLength: n })));
const pairArb = vecArb(0, 12);

const BEVS = Array.from({ length: 12 }, (_, i) => `b${String(i).padStart(2, '0')}`);
const usersZArb = fc.dictionary(fc.constantFrom(...BEVS), zArb, { maxKeys: BEVS.length });

// A small catalog with every attribute kind, some attributes covering one Bev (dropped).
const CATALOG_BEVS: TasteBev[] = BEVS.map((id, i) => ({
  id,
  categoryId: ['soda', 'soda', 'water', 'energy', 'coffee', 'tea'][i % 6] as string,
  brand: i === 11 ? 'Only Once' : ([null, 'Coke', 'Pepsi', 'Coke', 'Two Bevs', null][i % 6] as string | null),
  flavorBase: ['cola', 'citrus', null, 'cola', 'coffee', 'herbal'][(i * 5) % 6] as string | null,
}));
// Two Bevs no generated user ranks, sharing attributes nothing else carries: adding one of them to
// both users is a co-rated Bev with no other way to reach its attributes.
CATALOG_BEVS.push({ id: 'x0', categoryId: 'solo', brand: 'Solo', flavorBase: 'solo' }, { id: 'x1', categoryId: 'solo', brand: 'Solo', flavorBase: 'solo' });
const catalog = tasteCatalog(CATALOG_BEVS);
if (catalog.coverage.get('brand:only once') !== 1 || catalog.attributes.get('b11')?.some((a) => a.startsWith('brand:'))) {
  throw new Error('the property catalog must keep one single-Bev attribute to exercise the coverage rule');
}

const ATTRS = ['brand:a', 'brand:b', 'flavor:x', 'flavor:y', 'category:c', 'category:d'];
const tasteArb: fc.Arbitrary<TasteVector> = fc.dictionary(fc.constantFrom(...ATTRS), zArb, { maxKeys: ATTRS.length });
const nonZero = (t: TasteVector) => Object.values(t).some((x) => x !== 0);
const isConstant = (a: readonly number[]) => a.every((x) => x === a[0]);

describe('pearsonCorrelation properties', () => {
  it('is in [−1, 1], exactly symmetric, and negating one side negates it exactly', () => {
    fc.assert(
      fc.property(pairArb, ([a, b]) => {
        const r = pearsonCorrelation(a, b);
        expect(r).toBeGreaterThanOrEqual(-1);
        expect(r).toBeLessThanOrEqual(1);
        expect(pearsonCorrelation(b, a)).toBe(r);
        expect(pearsonCorrelation(a.map((x) => -x), b)).toBe(r === 0 ? 0 : -r);
      }),
    );
  });

  it('is 0 below 2 entries or on a constant side, and exactly 1 with itself otherwise', () => {
    fc.assert(
      fc.property(pairArb, ([a, b]) => {
        if (a.length < 2 || isConstant(a) || isConstant(b)) expect(pearsonCorrelation(a, b)).toBe(0);
        if (a.length >= 2 && !isConstant(a)) expect(pearsonCorrelation(a, [...a])).toBe(1);
      }),
    );
  });

  it('is invariant under adding a constant to one side, and under positive scaling', () => {
    fc.assert(
      fc.property(pairArb, constArb, fc.integer({ min: 1, max: 400 }), ([a, b], c, k) => {
        const r = pearsonCorrelation(a, b);
        expect(pearsonCorrelation(a.map((x) => x + c), b)).toBeCloseTo(r, 9);
        expect(pearsonCorrelation(a, b.map((y) => (k / 100) * y))).toBeCloseTo(r, 9);
      }),
    );
  });

  it('agrees with the textbook two-pass formula', () => {
    fc.assert(
      fc.property(vecArb(2, 12), ([a, b]) => {
        if (isConstant(a) || isConstant(b)) return;
        const ma = a.reduce((s, x) => s + x, 0) / a.length;
        const mb = b.reduce((s, x) => s + x, 0) / b.length;
        let sab = 0;
        let saa = 0;
        let sbb = 0;
        a.forEach((x, i) => {
          sab += (x - ma) * ((b[i] as number) - mb);
          saa += (x - ma) ** 2;
          sbb += ((b[i] as number) - mb) ** 2;
        });
        expect(pearsonCorrelation(a, b)).toBeCloseTo(sab / Math.sqrt(saa * sbb), 9);
      }),
    );
  });
});

describe('pearsonSimilarity and the significance weight', () => {
  it('is exactly symmetric, counts the common Bevs, and |sim| = |r|·min(1, common/5) ≤ |r| ≤ 1', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, (zu, zv) => {
        const p = pearsonSimilarity(zu, zv);
        expect(pearsonSimilarity(zv, zu)).toEqual(p);
        expect(p.common).toBe(Object.keys(zu).filter((b) => b in zv).length);
        expect(Math.abs(p.r)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.sim)).toBeLessThanOrEqual(Math.abs(p.r));
        expect(p.sim).toBe(p.r * significanceWeight(p.common));
        if (p.common < CF_MIN_COMMON) expect(p).toMatchObject({ r: 0, sim: 0 });
      }),
    );
  });

  it('is invariant under adding a constant to every z of one user', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, constArb, (zu, zv, c) => {
        const shifted = Object.fromEntries(Object.entries(zu).map(([b, z]) => [b, z + c]));
        const p = pearsonSimilarity(zu, zv);
        const q = pearsonSimilarity(shifted, zv);
        expect(q.common).toBe(p.common);
        expect(q.r).toBeCloseTo(p.r, 9);
        expect(q.sim).toBeCloseTo(p.sim, 9);
      }),
    );
  });

  it('the shrinkage is non-decreasing in |common|, in [0, 1], and reaches 1 at 5', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (m, n) => {
        const [lo, hi] = m <= n ? [m, n] : [n, m];
        expect(significanceWeight(lo)).toBeLessThanOrEqual(significanceWeight(hi));
        expect(significanceWeight(lo)).toBeGreaterThanOrEqual(0);
        expect(significanceWeight(hi)).toBeLessThanOrEqual(1);
        expect(significanceWeight(hi) === 1).toBe(hi >= 5);
      }),
    );
  });

  it('two perfectly correlated users get no less similar as they co-rate more Bevs', () => {
    fc.assert(
      fc.property(fc.uniqueArray(zArb, { minLength: 2, maxLength: BEVS.length }), fc.integer({ min: 1, max: 300 }), constArb, (xs, k, c) => {
        let last = 0;
        for (let n = 1; n <= xs.length; n++) {
          const zu = Object.fromEntries(xs.slice(0, n).map((x, i) => [BEVS[i] as string, x]));
          const zv = Object.fromEntries(xs.slice(0, n).map((x, i) => [BEVS[i] as string, (k / 100) * x + c]));
          const s = pearsonSimilarity(zu, zv).sim;
          expect(s).toBeGreaterThanOrEqual(last - 1e-12);
          expect(s).toBeCloseTo(n < 2 ? 0 : significanceWeight(n), 9);
          last = s;
        }
      }),
    );
  });
});

describe('taste vectors', () => {
  it('are shrunk means: |t[a]| ≤ max|z|·n/(n + 2), keys are the kept attributes, row order is irrelevant', () => {
    fc.assert(
      fc.property(usersZArb, (z) => {
        const t = tasteVector(z, catalog);
        const kept = new Set(Object.keys(z).flatMap((b) => catalog.attributes.get(b) ?? []));
        expect(new Set(Object.keys(t))).toEqual(kept);
        const maxAbs = Math.max(0, ...Object.values(z).map(Math.abs));
        for (const [a, v] of Object.entries(t)) {
          const n = Object.keys(z).filter((b) => (catalog.attributes.get(b) ?? []).includes(a)).length;
          expect(Math.abs(v)).toBeLessThanOrEqual((maxAbs * n) / (n + 2) + 1e-12);
        }
        expect(tasteVector(Object.fromEntries(Object.entries(z).reverse()), catalog)).toEqual(t);
      }),
    );
  });

  it('category entries are categoryAffinity of the z-scores in that category', () => {
    fc.assert(
      fc.property(usersZArb, (z) => {
        const t = tasteVector(z, catalog);
        for (const a of Object.keys(t).filter((k) => k.startsWith('category:'))) {
          const zs = Object.keys(z)
            .sort()
            .filter((b) => (catalog.attributes.get(b) ?? []).includes(a))
            .map((b) => z[b] as number);
          expect(t[a]).toBe(categoryAffinity(zs));
        }
      }),
    );
  });
});

describe('attributeSimilarity and sharedAttributeCount properties', () => {
  it('cosine is in [−1, 1], exactly symmetric, odd in either side, and exactly 1 with itself', () => {
    fc.assert(
      fc.property(tasteArb, tasteArb, (a, b) => {
        const s = attributeSimilarity(a, b);
        expect(s).toBeGreaterThanOrEqual(-1);
        expect(s).toBeLessThanOrEqual(1);
        expect(attributeSimilarity(b, a)).toBe(s);
        const neg = Object.fromEntries(Object.entries(a).map(([k, x]) => [k, -x]));
        expect(attributeSimilarity(neg, b)).toBe(s === 0 ? 0 : -s);
        expect(attributeSimilarity(a, { ...a })).toBe(nonZero(a) ? 1 : 0);
      }),
    );
  });

  it('cosine ignores positive scaling', () => {
    fc.assert(
      fc.property(tasteArb, tasteArb, fc.integer({ min: 1, max: 400 }), (a, b, k) => {
        const scaled = Object.fromEntries(Object.entries(a).map(([key, x]) => [key, (k / 100) * x]));
        expect(attributeSimilarity(scaled, b)).toBeCloseTo(attributeSimilarity(a, b), 9);
      }),
    );
  });

  const pairOf = (zu: Record<string, number>, zv: Record<string, number>) => ({ zu, zv, tu: tasteVector(zu, catalog), tv: tasteVector(zv, catalog) });
  /** Brute force: brand/flavour a with |t| ≥ 0.2 on both sides and some b ∈ R(u), b′ ∈ R(v) carrying a, b ≠ b′. */
  const reference = (zu: Record<string, number>, zv: Record<string, number>) => {
    const p = pairOf(zu, zv);
    const carriers = (z: Record<string, number>, a: string) => Object.keys(z).filter((b) => (catalog.attributes.get(b) ?? []).includes(a));
    return Object.keys(p.tu).filter((a) => {
      if (a.startsWith('category:') || !(a in p.tv)) return false;
      if (Math.abs(p.tu[a] as number) < 0.2 || Math.abs(p.tv[a] as number) < 0.2) return false;
      return carriers(zu, a).some((b) => carriers(zv, a).some((b2) => b !== b2));
    }).length;
  };

  it('the shared count matches the brute-force definition and is symmetric', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, (zu, zv) => {
        const n = sharedAttributeCount(pairOf(zu, zv), catalog);
        expect(n).toBe(reference(zu, zv));
        expect(sharedAttributeCount(pairOf(zv, zu), catalog)).toBe(n);
      }),
    );
  });

  it('adding a co-rated Bev never creates a bridge on its own', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, zArb, zArb, (zu, zv, x, y) => {
        // x0's attributes are carried by no Bev either user ranked, so x0 alone is their only path.
        const before = sharedAttributeCount(pairOf(zu, zv), catalog);
        expect(sharedAttributeCount(pairOf({ ...zu, x0: x }, { ...zv, x0: y }), catalog)).toBe(before);
      }),
    );
  });

  it('two users whose only ranking is the same Bev share no bridge and are not neighbours', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BEVS, 'x0'), zArb, zArb, (b, x, y) => {
        const p = pairOf({ [b]: x }, { [b]: y });
        expect(sharedAttributeCount(p, catalog)).toBe(0);
        expect(blendUserSimilarity(p, catalog).sim).toBe(0);
      }),
    );
  });
});

describe('blendUserSimilarity properties', () => {
  const pair = (zu: Record<string, number>, zv: Record<string, number>) => ({ zu, zv, tu: tasteVector(zu, catalog), tv: tasteVector(zv, catalog) });

  it('is exactly symmetric, in [−1, 1], and lies between its two terms (convex, so nothing is counted twice)', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, (zu, zv) => {
        const b = blendUserSimilarity(pair(zu, zv), catalog);
        expect(blendUserSimilarity(pair(zv, zu), catalog)).toEqual(b);
        expect(Math.abs(b.sim)).toBeLessThanOrEqual(1);
        expect(b.sim).toBeGreaterThanOrEqual(Math.min(b.pearsonSim, b.attributeSim) - 1e-12);
        expect(b.sim).toBeLessThanOrEqual(Math.max(b.pearsonSim, b.attributeSim) + 1e-12);
        expect(b.method).toBe(b.common >= CF_MIN_COMMON ? 'blend' : 'attr');
      }),
    );
  });

  it('reduces to each term at the weight extremes, and is the gated attribute term below 2 common Bevs', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, (zu, zv) => {
        const p = pair(zu, zv);
        const one = blendUserSimilarity(p, catalog, { alpha: 1 });
        const zero = blendUserSimilarity(p, catalog, { alpha: 0 });
        expect(zero.sim).toBe(zero.attributeSim);
        if (one.common >= CF_MIN_COMMON) expect(one.sim).toBe(one.pearsonSim);
        else {
          expect(one.sim).toBe(one.attributeSim);
          expect(one.attributeSim).toBe(one.sharedAttrs >= TASTE_MIN_SHARED_ATTRS ? one.attribute : 0);
        }
      }),
    );
  });

  it('is monotone in α between its two terms', () => {
    fc.assert(
      fc.property(usersZArb, usersZArb, fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (zu, zv, i, j) => {
        const p = pair(zu, zv);
        const [lo, hi] = i <= j ? [i / 100, j / 100] : [j / 100, i / 100];
        const a = blendUserSimilarity(p, catalog, { alpha: lo });
        const b = blendUserSimilarity(p, catalog, { alpha: hi });
        // Moving weight toward Pearson moves sim toward the Pearson term.
        if (a.pearsonSim >= a.attributeSim) expect(b.sim).toBeGreaterThanOrEqual(a.sim - 1e-12);
        else expect(b.sim).toBeLessThanOrEqual(a.sim + 1e-12);
      }),
    );
  });
});

describe('topUserNeighbours and neighbourReliability properties', () => {
  const candidatesArb = fc.uniqueArray(
    fc.record({ userId: fc.stringMatching(/^[a-z0-9]{1,4}$/), sim: fc.constantFrom(-1, -0.2, 0, 0.05, 0.1, 0.1, 0.3, 0.5, 0.5, 0.9, 1) }),
    { selector: (c) => c.userId, maxLength: 40 },
  );

  it('keeps the most similar with sim ≥ 0.1, ordered (sim desc, userId asc), at most k, whatever the input order', () => {
    fc.assert(
      fc.property(candidatesArb, fc.integer({ min: 0, max: 30 }), (cands, k) => {
        const got = topUserNeighbours(cands, k);
        expect(got.length).toBe(Math.min(k, cands.filter((c) => c.sim >= TASTE_SIM_FLOOR).length));
        for (let i = 1; i < got.length; i++) {
          const p = got[i - 1]!;
          const c = got[i]!;
          expect(p.sim > c.sim || (p.sim === c.sim && p.userId < c.userId)).toBe(true);
        }
        const kept = new Set(got.map((c) => c.userId));
        const last = got[got.length - 1];
        for (const c of cands) {
          if (kept.has(c.userId) || c.sim < TASTE_SIM_FLOOR || last === undefined) continue;
          expect(c.sim < last.sim || (c.sim === last.sim && c.userId > last.userId)).toBe(true);
        }
        expect(topUserNeighbours([...cands].reverse(), k)).toEqual(got);
      }),
    );
  });

  it('reliability is in [0, 1] and non-decreasing in n_v', () => {
    fc.assert(
      fc.property(fc.nat(500), fc.nat(500), (m, n) => {
        const [lo, hi] = m <= n ? [m, n] : [n, m];
        expect(neighbourReliability(lo)).toBeLessThanOrEqual(neighbourReliability(hi));
        expect(neighbourReliability(lo)).toBeGreaterThanOrEqual(0);
        expect(neighbourReliability(hi)).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('Layer 2 with Pearson keeps §8.9’s guarantees', () => {
  const snap = syntheticSnapshot('pearson-props', 16, 40);
  const users = Object.keys(snap.users).sort();
  const bevs = Object.keys(snap.bevs).sort();
  const ctx = snapshotContext(snap);

  it('ẑ2 is a convex combination of the neighbours’ z, support ≤ K, and the prediction stays in [0, 10]', () => {
    fc.assert(
      fc.property(fc.constantFrom(...users), fc.constantFrom(...bevs), (u, b) => {
        const l2 = layer2(snap, u, b, { userSimilarity: 'pearson' });
        expect(l2.neighbours.length).toBeLessThanOrEqual(CF_K);
        expect(l2.support).toBeGreaterThanOrEqual(0);
        expect(l2.support).toBeLessThanOrEqual(CF_K);
        const zs = (ctx.raters.get(b) ?? []).filter((r) => l2.neighbours.includes(r.userId)).map((r) => r.z);
        if (zs.length > 0) {
          expect(l2.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-12);
          expect(l2.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-12);
        } else expect(l2).toEqual({ z: 0, support: 0, neighbours: [] });
        const p = predictScore(snap, u, b, { userSimilarity: 'pearson' });
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(10);
        expect(p.lambda).toBeLessThan(0.7);
      }),
    );
  });
});
