import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BANDS,
  bucketForScore,
  insertIntoBucket,
  respaceBucket,
  scoreFromPosition,
  storedScoreCents,
  type Bucket,
} from '../src/index.ts';

const bucketArb = fc.constantFrom<Bucket>('LOVED', 'FINE', 'DISLIKED');

/** Independent reference: round 100·score half up using exact rational arithmetic. */
function referenceCents(index: number, n: number, bucket: Bucket): number {
  const [lo, hi] = BANDS[bucket];
  const d = BigInt(n + 1);
  const num = 100n * (BigInt(hi) * d - BigInt(hi - lo) * BigInt(index + 1));
  let c = num / d;
  if (2n * (num - c * d) >= d) c += 1n;
  const max = BigInt(bucket === 'LOVED' ? hi * 100 : hi * 100 - 1);
  return Number(c > max ? max : c);
}

describe('score properties', () => {
  it('unrounded scores are strictly decreasing and strictly inside the band', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), bucketArb, (n, bucket) => {
        const [lo, hi] = BANDS[bucket];
        let prev = Infinity;
        for (let i = 0; i < n; i++) {
          const s = scoreFromPosition(i, n, bucket);
          expect(s).toBeLessThan(prev);
          expect(s).toBeGreaterThan(lo);
          expect(s).toBeLessThan(hi);
          prev = s;
        }
      }),
      { numRuns: 60 },
    );
  });

  it('stored cents match exact rounding, never increase, and stay in the bucket', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), bucketArb, (n, bucket) => {
        let prev = Infinity;
        for (let i = 0; i < n; i++) {
          const c = storedScoreCents(i, n, bucket);
          expect(c).toBe(referenceCents(i, n, bucket));
          expect(c).toBeLessThanOrEqual(prev);
          expect(bucketForScore(c / 100)).toBe(bucket);
          prev = c;
        }
      }),
      { numRuns: 60 },
    );
  });

  it('stored scores are strictly decreasing while the spacing is at least a cent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 298 }), bucketArb, (n, bucket) => {
        const cents = respaceBucket(Array.from({ length: n }, (_, i) => `b${i}`), bucket).map((r) => Math.round(r.score * 100));
        for (let i = 1; i < cents.length; i++) expect(cents[i]).toBeLessThan(cents[i - 1] as number);
      }),
    );
  });

  it('inserting a Bev keeps every other Bev in the same relative order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.nat(), bucketArb, (n, k, bucket) => {
        const ids = Array.from({ length: n }, (_, i) => `b${i}`);
        const at = k % (n + 1);
        const respaced = respaceBucket(insertIntoBucket(ids, 'new', at), bucket);
        expect(respaced.filter((r) => r.bevId !== 'new').map((r) => r.bevId)).toEqual(ids);
        expect(respaced[at]?.bevId).toBe('new');
      }),
    );
  });
});
