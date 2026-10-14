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
  it('maps ranked and reranked to RANKING', () => {
    expect(feedKindFromDb('ranked')).toBe('RANKING');
    expect(feedKindFromDb('reranked')).toBe('RANKING');
  });

  it('throws on the kinds A-01 removed -- feed_events can no longer hold them', () => {
    expect(() => feedKindFromDb('want_to_try')).toThrow();
    expect(() => feedKindFromDb('followed')).toThrow();
  });
});
