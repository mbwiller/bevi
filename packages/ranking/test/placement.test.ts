import { describe, expect, it } from 'vitest';
import {
  answer,
  currentPrompt,
  isDone,
  maxComparisons,
  placementResult,
  removeFromBucket,
  startPlacement,
  undo,
} from '../src/index.ts';

const loved = ['coke', 'sprite', 'pepsi', 'fanta', 'dew'];

describe('maxComparisons', () => {
  it('is ceil(log2(n + 1))', () => {
    const table: Array<[number, number]> = [[0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [7, 3], [8, 4], [100, 7], [1000, 10]];
    for (const [n, k] of table) expect(maxComparisons(n)).toBe(k);
  });
});

describe('startPlacement', () => {
  it('is done at index 0 with no comparisons when the bucket is empty', () => {
    const s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: [] });
    expect(isDone(s)).toBe(true);
    expect(currentPrompt(s)).toBeNull();
    expect(placementResult(s)).toEqual({ bevId: 'new', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
  });

  it('filters out the Bev itself, for re-ranks', () => {
    const s = startPlacement({ bevId: 'pepsi', bucket: 'LOVED', orderedBevIds: loved });
    expect(s.list).toEqual(['coke', 'sprite', 'fanta', 'dew']);
    expect(s.hi).toBe(4);
  });

  it('rejects a list with duplicates', () => {
    expect(() => startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ['a', 'a'] })).toThrow(RangeError);
  });
});

describe('answer', () => {
  it('asks about the middle Bev first and counts steps', () => {
    const s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: loved });
    expect(currentPrompt(s)).toEqual({ comparedBevId: 'pepsi', step: 1, maxSteps: 3 });
  });

  it('places a Bev better than everything at the top', () => {
    let s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: loved });
    while (!isDone(s)) s = answer(s, 'NEW_BETTER');
    const r = placementResult(s);
    expect(r.insertIndex).toBe(0);
    expect(r.expectedBucketSize).toBe(5);
    expect(r.comparisons).toEqual([
      { winnerBevId: 'new', loserBevId: 'pepsi', tie: false },
      { winnerBevId: 'new', loserBevId: 'sprite', tie: false },
      { winnerBevId: 'new', loserBevId: 'coke', tie: false },
    ]);
  });

  it('places a Bev worse than everything at the bottom', () => {
    let s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: loved });
    while (!isDone(s)) s = answer(s, 'EXISTING_BETTER');
    expect(placementResult(s).insertIndex).toBe(5);
    expect(placementResult(s).comparisons.every((c) => c.loserBevId === 'new' && !c.tie)).toBe(true);
  });

  it('treats a tie as "directly below the incumbent" and stops', () => {
    const s = answer(startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: loved }), 'TIE');
    expect(isDone(s)).toBe(true);
    expect(placementResult(s)).toMatchObject({
      insertIndex: 3,
      comparisons: [{ winnerBevId: 'pepsi', loserBevId: 'new', tie: true }],
    });
  });

  it('throws once placement is done', () => {
    const s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: [] });
    expect(() => answer(s, 'NEW_BETTER')).toThrow();
  });

  it('refuses a result before placement is done', () => {
    const s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: loved });
    expect(() => placementResult(s)).toThrow();
  });
});

describe('undo', () => {
  it('restores the state before the last answer, including after DONE', () => {
    const s0 = startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ['a'] });
    const s1 = answer(s0, 'EXISTING_BETTER');
    expect(isDone(s1)).toBe(true);
    const back = undo(s1);
    expect(back).toEqual(s0);
  });

  it('is a no-op with nothing to undo', () => {
    const s = startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ['a', 'b'] });
    expect(undo(s)).toBe(s);
  });
});

describe('removeFromBucket', () => {
  it('drops the Bev and keeps the order', () => {
    expect(removeFromBucket(loved, 'sprite')).toEqual(['coke', 'pepsi', 'fanta', 'dew']);
    expect(removeFromBucket(loved, 'missing')).toEqual(loved);
  });
});
