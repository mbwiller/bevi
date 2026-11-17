// Invariants of Layer 2's stored mode (userSimilarity: 'stored', Stage 4).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CF_K, layer2, neighbourReliability, predictScore, recommend, userSimilarity, type BevFeatures, type PredictionSnapshot, type UserNeighbour } from '../src/index.ts';
import { nOf, snapshotContext } from '../src/context.ts';
import { buildSnapshot } from './snapshot-fixture.ts';

const STORED = { userSimilarity: 'stored' } as const;
const USERS = Array.from({ length: 14 }, (_, i) => `p${String(i).padStart(2, '0')}`);
const GHOSTS = ['ghost-a', 'ghost-b'];
const BEVS = ['b0', 'b1', 'b2', 'b3', 'b4'];
const bevFeatures = BEVS.map(
  (id, i): BevFeatures => ({ id, categoryId: i < 3 ? 'soda' : 'water', brandKey: i % 2 === 0 ? 'x' : null, flavorTokens: ['cola'], priceTier: 1, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false }),
);

/** Random small snapshots: up to 14 users over 5 Bevs, so a Bev can have more than CF_K raters. */
const arbRankings = fc
  .uniqueArray(fc.record({ u: fc.integer({ min: 0, max: USERS.length - 1 }), b: fc.integer({ min: 0, max: BEVS.length - 1 }), s: fc.integer({ min: 0, max: 1000 }) }), {
    selector: (r) => `${r.u}:${r.b}`,
    minLength: 1,
    maxLength: 60,
  })
  .map((rs) => rs.map((r) => ({ userId: USERS[r.u] as string, bevId: BEVS[r.b] as string, score: r.s / 100 })));

/**
 * Random stored lists: for some users, distinct neighbours (other users or ghosts), sim in [-1, 1]
 * on the 4-dp grid of `user_neighbors.sim numeric(5,4)`. (An arbitrary double would include
 * subnormals such as 4e-323, whose product with z underflows to 0 in every mode; the column cannot
 * hold one.)
 */
const CANDIDATES = [...USERS, ...GHOSTS];
const arbList = fc.uniqueArray(
  fc.record({ v: fc.integer({ min: 0, max: CANDIDATES.length - 1 }), sim: fc.integer({ min: -10000, max: 10000 }).map((k) => k / 10000), common: fc.nat({ max: 12 }) }),
  { selector: (r) => r.v, maxLength: 16 },
);
const arbLists = fc.array(arbList, { minLength: USERS.length, maxLength: USERS.length }).chain((lists) =>
  fc.array(fc.boolean(), { minLength: USERS.length, maxLength: USERS.length }).map((keep) => {
    const out: Record<string, UserNeighbour[]> = {};
    lists.forEach((l, i) => {
      if (!keep[i]) return;
      const u = USERS[i] as string;
      out[u] = l.filter((r) => CANDIDATES[r.v] !== u).map((r) => ({ userId: CANDIDATES[r.v] as string, sim: r.sim, common: r.common }));
    });
    return out;
  }),
);

const build = (rankings: PredictionSnapshot['rankings']): PredictionSnapshot => buildSnapshot(rankings, bevFeatures);

/** Layer 2 in stored mode written out from the definition, for a user with a non-empty list. */
function byHand(snap: PredictionSnapshot, list: readonly UserNeighbour[], u: string, b: string) {
  const ctx = snapshotContext(snap);
  const used = list
    .map((r) => ({ userId: r.userId, sim: r.sim * Math.min(1, nOf(ctx, r.userId) / 15), z: ctx.z.get(r.userId)?.get(b) }))
    .filter((r): r is { userId: string; sim: number; z: number } => r.z !== undefined && r.sim > 0)
    .sort((x, y) => y.sim - x.sim || (x.userId < y.userId ? -1 : 1))
    .slice(0, CF_K);
  const support = used.reduce((t, r) => t + r.sim, 0);
  return { used, support, z: support > 0 ? used.reduce((t, r) => t + r.sim * r.z, 0) / support : 0 };
}

describe("layer2 with userSimilarity: 'stored'", () => {
  it('(a) adding the field never changes the default output', () => {
    fc.assert(
      fc.property(arbRankings, arbLists, (rankings, lists) => {
        const plain = build(rankings);
        const field = { ...plain, userNeighbours: lists };
        for (const u of [...USERS, 'nobody']) {
          for (const b of BEVS) {
            expect(layer2(field, u, b)).toEqual(layer2(plain, u, b));
            expect(predictScore(field, u, b)).toEqual(predictScore(plain, u, b));
            expect(predictScore(field, u, b, { userSimilarity: 'pearson' })).toEqual(predictScore(plain, u, b, { userSimilarity: 'pearson' }));
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('matches the definition; (b) ẑ2 within the used neighbours’ z; (c) 0 ≤ support ≤ min(CF_K, Σ sim′); (d) neighbours ⊆ listed ∩ raters, at most CF_K', () => {
    fc.assert(
      fc.property(arbRankings, arbLists, (rankings, lists) => {
        const snap = { ...build(rankings), userNeighbours: lists };
        const ctx = snapshotContext(snap);
        for (const u of USERS) {
          const list = lists[u] ?? [];
          for (const b of BEVS) {
            const l2 = layer2(snap, u, b, STORED);
            if (list.length === 0) {
              expect(l2).toEqual(layer2(snap, u, b)); // the fallback
              continue;
            }
            const hand = byHand(snap, list, u, b);
            expect(l2.neighbours).toEqual(hand.used.map((r) => r.userId));
            expect(l2.support).toBeCloseTo(hand.support, 12);
            expect(l2.z).toBeCloseTo(hand.z, 12);
            // (b)
            if (l2.neighbours.length > 0) {
              const zs = l2.neighbours.map((v) => ctx.z.get(v)?.get(b) as number);
              expect(l2.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-12);
              expect(l2.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-12);
            } else {
              expect(l2).toEqual({ z: 0, support: 0, neighbours: [] });
            }
            // (c)
            const positive = list.map((r) => userSimilarity(snap, u, r.userId, STORED)).filter((s) => s > 0);
            expect(l2.support).toBeGreaterThanOrEqual(0);
            expect(l2.support).toBeLessThanOrEqual(Math.min(CF_K, positive.reduce((t, s) => t + s, 0)) + 1e-12);
            // (d)
            const listed = new Set(list.map((r) => r.userId));
            const raters = new Set((ctx.raters.get(b) ?? []).map((r) => r.userId));
            expect(l2.neighbours.length).toBeLessThanOrEqual(CF_K);
            for (const v of l2.neighbours) {
              expect(listed.has(v)).toBe(true);
              expect(raters.has(v)).toBe(true);
              expect(v).not.toBe(u);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('(e) raising n_v of a listed neighbour never lowers sim′ for sim ≥ 0, and never shrinks |sim′|', () => {
    fc.assert(
      fc.property(
        arbRankings,
        fc.constantFrom(...USERS),
        fc.constantFrom(...CANDIDATES),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.nat({ max: 40 }),
        fc.nat({ max: 40 }),
        (rankings, u, v, sim, n1, dn) => {
          fc.pre(u !== v);
          const base = build(rankings);
          const withN = (n: number): PredictionSnapshot => ({
            ...base,
            users: { ...base.users, [v]: { id: v, stats: { n, mean: 5, stddev: 2 }, categoryStats: {}, canSeeAlcohol: true } },
            userNeighbours: { [u]: [{ userId: v, sim, common: 2 }] },
          });
          const lo = userSimilarity(withN(n1), u, v, STORED);
          const hi = userSimilarity(withN(n1 + dn), u, v, STORED);
          expect(lo).toBe(sim * neighbourReliability(n1));
          expect(Math.abs(hi)).toBeGreaterThanOrEqual(Math.abs(lo));
          if (sim >= 0) expect(hi).toBeGreaterThanOrEqual(lo);
          expect(Math.abs(hi)).toBeLessThanOrEqual(Math.abs(sim));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('(f) the result does not depend on the order of the rows in a list', () => {
    fc.assert(
      fc.property(arbRankings, arbLists, fc.integer({ min: 0, max: 1000 }), (rankings, lists, seed) => {
        const plain = build(rankings);
        const shuffled: Record<string, UserNeighbour[]> = {};
        for (const [u, l] of Object.entries(lists)) {
          const k = l.length === 0 ? 0 : seed % l.length;
          shuffled[u] = [...l.slice(k), ...l.slice(0, k)].reverse();
        }
        const s1 = { ...plain, userNeighbours: lists };
        const s2 = { ...build(rankings), userNeighbours: shuffled };
        for (const u of USERS) for (const b of BEVS) expect(layer2(s2, u, b, STORED)).toEqual(layer2(s1, u, b, STORED));
      }),
      { numRuns: 150 },
    );
  });

  it('scores stay in [0, 10] with confidence in [0, 1]; recommend is deterministic and changes predictions only', () => {
    fc.assert(
      fc.property(arbRankings, arbLists, fc.constantFrom(...USERS), fc.string(), (rankings, lists, u, seed) => {
        const snap = { ...build(rankings), userNeighbours: lists };
        for (const b of BEVS) {
          const p = predictScore(snap, u, b, STORED);
          expect(p.score).toBeGreaterThanOrEqual(0);
          expect(p.score).toBeLessThanOrEqual(10);
          expect(p.confidence).toBeGreaterThanOrEqual(0);
          expect(p.confidence).toBeLessThanOrEqual(1);
        }
        const rec = recommend(snap, u, { n: 3, seed, ...STORED });
        expect(recommend(snap, u, { n: 3, seed, ...STORED })).toEqual(rec);
        for (const r of rec) expect(r.score).toBe(predictScore(snap, u, r.bevId, STORED).score);
        expect(rec.length).toBe(recommend(snap, u, { n: 3, seed }).length);
      }),
      { numRuns: 100 },
    );
  });
});
