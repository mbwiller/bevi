// Invariants of recommend() under the 1.8.0 community options, over random taste families (some Bevs
// with no entry) on the synthetic snapshots.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explorationSlots, globalScore, recommend, type BevGraphStats, type PredictionSnapshot, type RecommendOptions } from '../src/index.ts';
import { bevGraphLookup, communityKeyOf } from '../src/context.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

const SNAPS = [syntheticSnapshot('recommend', 12, 40), syntheticSnapshot('families', 10, 30)];
const MODES: Array<Pick<RecommendOptions, 'diversity' | 'exploration'>> = [
  {},
  { diversity: 'community' },
  { exploration: 'community' },
  { diversity: 'community', exploration: 'community' },
];

const graphEntry = fc.option(
  fc.record({ community: fc.constantFrom('A', 'B', 'C', 'D', 'E'), pagerank: fc.constantFrom(0, 0.01, 0.2), bridge: fc.constantFrom(0, 0.25, 0.5, 0.75, 0.99, 1) }),
  { nil: undefined, freq: 6 },
);

const inputArb = fc
  .integer({ min: 0, max: SNAPS.length - 1 })
  .chain((si) => {
    const s = SNAPS[si] as PredictionSnapshot;
    const bevIds = Object.keys(s.bevs).sort();
    return fc.record({
      si: fc.constant(si),
      entries: fc.array(graphEntry, { minLength: bevIds.length, maxLength: bevIds.length }),
      user: fc.constantFrom(...Object.keys(s.users).sort(), 'nobody'),
      n: fc.integer({ min: 0, max: 35 }),
      seed: fc.string({ maxLength: 8 }),
      epsilon: fc.constantFrom(0, 0.15, 0.3, 0.6, 1),
      exclude: fc.uniqueArray(fc.constantFrom(...bevIds), { maxLength: 5 }),
    });
  })
  .map(({ si, entries, ...rest }) => {
    const s = SNAPS[si] as PredictionSnapshot;
    const bevIds = Object.keys(s.bevs).sort();
    const bevGraph: Record<string, BevGraphStats> = {};
    bevIds.forEach((b, i) => {
      const e = entries[i];
      if (e) bevGraph[b] = e;
    });
    return { snap: { ...s, bevGraph } as PredictionSnapshot, plain: s, ...rest };
  });

describe('recommend() with community options: invariants', () => {
  it('min(n, |candidates|) distinct items, none ranked, excluded or hidden alcohol; deterministic', () => {
    fc.assert(
      fc.property(inputArb, ({ snap, user, n, seed, epsilon, exclude }) => {
        const ranked = new Set(snap.rankings.filter((r) => r.userId === user).map((r) => r.bevId));
        const canSee = snap.users[user]?.canSeeAlcohol ?? false;
        const eligible = Object.values(snap.bevs).filter((b) => !ranked.has(b.id) && !exclude.includes(b.id) && (canSee || !b.isAlcoholic));
        for (const mode of MODES) {
          const opts = { n, seed, epsilon, excludeBevIds: exclude, ...mode };
          const recs = recommend(snap, user, opts);
          expect(recs.length).toBe(Math.min(n, eligible.length));
          expect(new Set(recs.map((r) => r.bevId)).size).toBe(recs.length);
          for (const r of recs) {
            expect(ranked.has(r.bevId)).toBe(false);
            expect(exclude).not.toContain(r.bevId);
            if (!canSee) expect(snap.bevs[r.bevId]?.isAlcoholic).toBe(false);
          }
          expect(recommend(snap, user, opts)).toEqual(recs);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("diversity 'community' vs 'none': same candidate set, same exploration positions and picks; same first normal pick", () => {
    fc.assert(
      fc.property(inputArb, ({ snap, user, n, seed, epsilon, exclude }) => {
        for (const exploration of ['category', 'community'] as const) {
          const o = { n, seed, epsilon, excludeBevIds: exclude, exploration };
          const a = recommend(snap, user, { ...o, diversity: 'none' });
          const b = recommend(snap, user, { ...o, diversity: 'community' });
          expect(b.map((r) => r.isExploration)).toEqual(a.map((r) => r.isExploration));
          expect(b.filter((r) => r.isExploration)).toEqual(a.filter((r) => r.isExploration));
          // Both lists are drawn from the same candidates: the 'community' normal picks are a subset
          // of the candidates that are not exploration picks, as the 'none' ones are.
          const ranked = new Set(snap.rankings.filter((r) => r.userId === user).map((r) => r.bevId));
          for (const r of b) expect(ranked.has(r.bevId) || exclude.includes(r.bevId)).toBe(false);
          const firstNormal = (xs: typeof a) => xs.find((r) => !r.isExploration);
          expect(firstNormal(b)).toEqual(firstNormal(a));
          // Every returned Bev carries the same score and reason in both lists (the order alone moves).
          const byId = new Map(a.map((r) => [r.bevId, r]));
          for (const r of b) if (byId.has(r.bevId)) expect(r).toEqual(byId.get(r.bevId));
        }
      }),
      { numRuns: 60 },
    );
  });

  it("'community' over all-singleton families equals 'none'; absent bevGraph equals the default", () => {
    fc.assert(
      fc.property(inputArb, ({ snap, plain, user, n, seed, epsilon, exclude }) => {
        const o = { n, seed, epsilon, excludeBevIds: exclude };
        const singles = { ...plain, bevGraph: Object.fromEntries(Object.keys(plain.bevs).map((b) => [b, { community: `solo:${b}`, pagerank: 0, bridge: 0.5 }])) };
        expect(recommend(singles, user, { ...o, diversity: 'community' })).toEqual(recommend(plain, user, o));
        for (const mode of MODES) expect(recommend(plain, user, { ...o, ...mode })).toEqual(recommend(plain, user, o));
        void snap;
      }),
      { numRuns: 60 },
    );
  });

  it("exploration 'community': picks come from uncharted families whenever the uncharted pool is non-empty", () => {
    fc.assert(
      fc.property(inputArb, ({ snap, user, n, seed, epsilon, exclude }) => {
        const recs = recommend(snap, user, { n, seed, epsilon, excludeBevIds: exclude, exploration: 'community' });
        const g = bevGraphLookup(snap) as NonNullable<ReturnType<typeof bevGraphLookup>>;
        const ranked = new Set(snap.rankings.filter((r) => r.userId === user).map((r) => r.bevId));
        const charted = new Set([...ranked].map((b) => communityKeyOf(g, b)));
        const canSee = snap.users[user]?.canSeeAlcohol ?? false;
        const uncharted = Object.values(snap.bevs).filter(
          (b) => !ranked.has(b.id) && !exclude.includes(b.id) && (canSee || !b.isAlcoholic) && globalScore(snap, b.id) >= 0 && !charted.has(communityKeyOf(g, b.id)),
        );
        const picks = recs.filter((r) => r.isExploration);
        const slots = explorationSlots(recs.length, Math.round(epsilon * n));
        if (uncharted.length > 0) {
          expect(picks.length).toBe(Math.min(slots.length, uncharted.length));
          for (const p of picks) expect(charted.has(communityKeyOf(g, p.bevId))).toBe(false);
        }
        expect(recs.flatMap((r, i) => (r.isExploration ? [i] : []))).toEqual(slots.slice(0, picks.length));
      }),
      { numRuns: 80 },
    );
  });
});
