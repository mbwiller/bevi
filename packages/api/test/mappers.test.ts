import { describe, expect, it } from 'vitest';
import { BUCKET_ORDER } from '@bevi/shared';
import { bucketFromDb, bucketToDb, feedKindFromDb } from '../src/mappers.ts';

describe('bucket <-> smallint', () => {
  it('round-trips every Bucket value through the DB encoding', () => {
    for (const bucket of BUCKET_ORDER) {
      expect(bucketFromDb(bucketToDb(bucket))).toBe(bucket);
    }
  });

  it('matches the DB documented smallint mapping (3 LOVED, 2 FINE, 1 DISLIKED)', () => {
    expect(bucketToDb('LOVED')).toBe(3);
    expect(bucketToDb('FINE')).toBe(2);
    expect(bucketToDb('DISLIKED')).toBe(1);
  });

  it('throws on a value no bucket maps to', () => {
    expect(() => bucketFromDb(0)).toThrow();
    expect(() => bucketFromDb(4)).toThrow();
  });
});

describe('feedKindFromDb', () => {
  it('maps ranked/reranked to RANKING and want_to_try to SAVED', () => {
    expect(feedKindFromDb('ranked')).toBe('RANKING');
    expect(feedKindFromDb('reranked')).toBe('RANKING');
    expect(feedKindFromDb('want_to_try')).toBe('SAVED');
  });

  it('throws on "followed" -- get_feed should never return it', () => {
    expect(() => feedKindFromDb('followed')).toThrow();
  });
});
