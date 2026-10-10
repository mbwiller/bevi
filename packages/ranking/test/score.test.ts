import { describe, expect, it } from 'vitest';
import {
  bucketForScore,
  insertIntoBucket,
  respaceBucket,
  scoreFromPosition,
  storedScore,
  storedScoreCents,
} from '../src/index.ts';

describe('scoreFromPosition: DEVELOPMENT-MATT §8.2 worked examples, 7 / 4 bands', () => {
  it('puts a lone Bev at its band midpoint', () => {
    expect(scoreFromPosition(0, 1, 'LOVED')).toBe(8.5);
    expect(scoreFromPosition(0, 1, 'FINE')).toBe(5.5);
    expect(scoreFromPosition(0, 1, 'DISLIKED')).toBe(2);
  });

  it('spaces Loved n = 3 evenly inside the band', () => {
    expect([0, 1, 2].map((i) => scoreFromPosition(i, 3, 'LOVED'))).toEqual([9.25, 8.5, 7.75]);
  });

  it('gives the top of a 50-Bev Loved bucket 9.94', () => {
    expect(storedScore(0, 50, 'LOVED')).toBe(9.94);
  });

  it('rejects positions outside the bucket', () => {
    expect(() => scoreFromPosition(0, 0, 'LOVED')).toThrow(RangeError);
    expect(() => scoreFromPosition(3, 3, 'LOVED')).toThrow(RangeError);
    expect(() => scoreFromPosition(-1, 3, 'LOVED')).toThrow(RangeError);
    expect(() => scoreFromPosition(0.5, 3, 'LOVED')).toThrow(RangeError);
  });
});

describe('storedScore', () => {
  it('rounds exact half cents up', () => {
    expect(storedScore(0, 7, 'LOVED')).toBe(9.63); // 9.625
    expect(storedScore(0, 7, 'FINE')).toBe(6.63); // 6.625
    expect(storedScore(0, 39, 'LOVED')).toBe(9.93); // 9.925, which a double can't hold exactly
  });

  it('keeps FINE and DISLIKED below their top edge in huge buckets', () => {
    expect(storedScore(0, 598, 'FINE')).toBe(6.99);
    expect(storedScore(0, 599, 'FINE')).toBe(6.99); // 6.995 would round up to 7.00
    expect(storedScore(0, 799, 'DISLIKED')).toBe(3.99); // 3.995
    expect(storedScore(0, 599, 'LOVED')).toBe(10); // LOVED includes 10
  });

  it('returns integer hundredths from storedScoreCents', () => {
    expect(storedScoreCents(0, 1, 'LOVED')).toBe(850);
    expect(storedScoreCents(2, 3, 'DISLIKED')).toBe(100);
  });
});

describe('bucketForScore', () => {
  it('uses 7 and 4 as the band edges', () => {
    expect(bucketForScore(10)).toBe('LOVED');
    expect(bucketForScore(7)).toBe('LOVED');
    expect(bucketForScore(6.99)).toBe('FINE');
    expect(bucketForScore(4)).toBe('FINE');
    expect(bucketForScore(3.99)).toBe('DISLIKED');
    expect(bucketForScore(0)).toBe('DISLIKED');
  });
});

describe('respaceBucket', () => {
  it('returns positions and stored scores, best first', () => {
    expect(respaceBucket(['a', 'b', 'c'], 'LOVED')).toEqual([
      { bevId: 'a', position: 0, score: 9.25 },
      { bevId: 'b', position: 1, score: 8.5 },
      { bevId: 'c', position: 2, score: 7.75 },
    ]);
    expect(respaceBucket([], 'FINE')).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    expect(() => respaceBucket(['a', 'a'], 'FINE')).toThrow(RangeError);
  });
});

describe('insertIntoBucket', () => {
  it('inserts at the index, 0 = best', () => {
    expect(insertIntoBucket(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(insertIntoBucket(['a', 'b'], 'x', 2)).toEqual(['a', 'b', 'x']);
  });

  it('rejects a Bev already in the bucket or an out-of-range index', () => {
    expect(() => insertIntoBucket(['a'], 'a', 0)).toThrow(RangeError);
    expect(() => insertIntoBucket(['a'], 'x', 2)).toThrow(RangeError);
  });
});
