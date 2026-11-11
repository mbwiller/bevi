// recommend() with the 1.8.0 options omitted, explicitly 'none' / 'category', or set to 'community'
// over a snapshot without bevGraph, is byte-identical to 1.7.0 (the promise of the options, proved the
// way placement-compat proves anchored placement's): test/recommend-1.7.0.ts is a verbatim copy of
// the 1.7.0 source, and both run on generated inputs, compared as JSON text. The default runs also
// carry a bevGraph that is present, absent, null or malformed, which the default must never read.
// The count printed at the end is what the PR reports. Deterministic (fixed seed).
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as cur from '../src/index.ts';
import * as old from './recommend-1.7.0.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

const SNAPS = ['compat-a', 'compat-b', 'recommend'].map((seed) => syntheticSnapshot(seed, 12, 40));

type GraphVariant = 'absent' | 'null' | 'valid' | 'malformed';
function withGraph(s: cur.PredictionSnapshot, v: GraphVariant): cur.PredictionSnapshot {
  if (v === 'absent') return s;
  if (v === 'null') return { ...s, bevGraph: null };
  const ids = Object.keys(s.bevs);
  if (v === 'valid') return { ...s, bevGraph: Object.fromEntries(ids.map((b, i) => [b, { community: `F${i % 3}`, pagerank: 0.02, bridge: (i % 4) / 4 }])) };
  return { ...s, bevGraph: { [ids[0] as string]: { community: '', pagerank: -1, bridge: 7 } } } as unknown as cur.PredictionSnapshot;
}

// Each variant must equal 1.7.0 for the given bevGraph variants.
const VARIANTS: Array<{ opts: Partial<cur.RecommendOptions>; graphs: GraphVariant[] }> = [
  { opts: {}, graphs: ['absent', 'null', 'valid', 'malformed'] },
  { opts: { diversity: 'none' }, graphs: ['absent', 'valid', 'malformed'] },
  { opts: { exploration: 'category' }, graphs: ['absent', 'valid', 'malformed'] },
  { opts: { diversity: 'none', exploration: 'category' }, graphs: ['absent', 'null', 'valid', 'malformed'] },
  { opts: { diversity: 'community' }, graphs: ['absent', 'null'] },
  { opts: { exploration: 'community' }, graphs: ['absent', 'null'] },
  { opts: { diversity: 'community', exploration: 'community' }, graphs: ['absent', 'null'] },
];

let compared = 0;
let differences = 0;

describe('recommend() is byte-identical to 1.7.0 unless a community option runs on a provided bevGraph', () => {
  it('generated users, lengths, seeds, ε, exclusions and Layer options', () => {
    fc.assert(
      fc.property(
        fc.record({
          snap: fc.integer({ min: 0, max: SNAPS.length - 1 }),
          userIdx: fc.integer({ min: 0, max: 13 }),
          n: fc.integer({ min: 0, max: 45 }),
          seed: fc.string({ maxLength: 12 }),
          epsilon: fc.option(fc.constantFrom(0, 0.1, 0.15, 0.3, 0.5, 1), { nil: undefined }),
          exclude: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 6 }),
          userSimilarity: fc.option(fc.constantFrom<cur.UserSimilarityKind>('cosine', 'pearson'), { nil: undefined }),
        }),
        ({ snap, userIdx, n, seed, epsilon, exclude, userSimilarity }) => {
          const s = SNAPS[snap] as cur.PredictionSnapshot;
          const users = [...Object.keys(s.users).sort(), 'nobody'];
          const user = users[userIdx % users.length] as string;
          const base: cur.RecommendOptions = { n, seed, excludeBevIds: exclude.map((i) => `bev-${String(i).padStart(2, '0')}`) };
          if (epsilon !== undefined) base.epsilon = epsilon;
          if (userSimilarity !== undefined) base.userSimilarity = userSimilarity;
          const ref = JSON.stringify(old.recommend(s, user, base));
          for (const { opts, graphs } of VARIANTS) {
            for (const g of graphs) {
              const got = JSON.stringify(cur.recommend(withGraph(s, g), user, { ...base, ...opts }));
              compared++;
              if (got !== ref) differences++;
              expect(got).toBe(ref);
            }
          }
        },
      ),
      { numRuns: 300, seed: 20261110 },
    );
  });

  afterAll(() => {
    console.log(`recommend-compat: ${compared} recommend() lists compared against 1.7.0, ${differences} differences`);
  });
});
