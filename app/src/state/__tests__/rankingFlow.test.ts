import { maxAnchoredComparisons, maxComparisons, placementPhase } from '@bevi/ranking';

import { nextCandidates, selectDone, selectPrompt, useRankingFlow } from '../rankingFlow';

const flow = () => useRankingFlow.getState();
const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

beforeEach(() => flow().reset());

it('places a Bev with binary search and reports the result @bevi/ranking computes', () => {
  // Hidden true position: between 'b' and 'c' (index 2).
  flow().start('new', 'LOVED', LIST, 'new');
  expect(selectPrompt(flow())).toEqual({ comparedBevId: 'd', step: 1, maxSteps: maxComparisons(7) });
  const truth = 2;
  while (!selectDone(flow())) {
    const p = selectPrompt(flow())!;
    flow().answer(LIST.indexOf(p.comparedBevId) >= truth ? 'NEW_BETTER' : 'EXISTING_BETTER');
  }
  expect(flow().result()).toEqual({
    bevId: 'new',
    bucket: 'LOVED',
    insertIndex: 2,
    expectedBucketSize: 7,
    comparisons: [
      { winnerBevId: 'new', loserBevId: 'd', tie: false },
      { winnerBevId: 'b', loserBevId: 'new', tie: false },
      { winnerBevId: 'new', loserBevId: 'c', tie: false },
    ],
  });
});

it('undo pops one answer and is a no-op with none', () => {
  flow().start('new', 'FINE', LIST, 'new');
  flow().undo();
  expect(flow().placement!.history).toHaveLength(0);
  flow().answer('NEW_BETTER');
  expect(selectPrompt(flow())!.comparedBevId).toBe('b');
  flow().undo();
  expect(selectPrompt(flow())).toEqual({ comparedBevId: 'd', step: 1, maxSteps: 3 });
  expect(flow().result()).toBeNull();
});

it('a tie ends placement directly below the incumbent', () => {
  flow().start('new', 'LOVED', LIST, 'new');
  flow().tie();
  expect(selectDone(flow())).toBe(true);
  expect(flow().result()).toMatchObject({ insertIndex: 4, comparisons: [{ winnerBevId: 'd', loserBevId: 'new', tie: true }] });
  // Answering after done does nothing.
  flow().answer('NEW_BETTER');
  expect(flow().placement!.history).toHaveLength(1);
});

it('an empty bucket is done at once with insertIndex 0 and no comparisons', () => {
  flow().start('new', 'DISLIKED', [], 'new');
  expect(selectDone(flow())).toBe(true);
  expect(selectPrompt(flow())).toBeNull();
  expect(flow().result()).toEqual({ bevId: 'new', bucket: 'DISLIKED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });
});

it('re-rank excludes the Bev itself from the searched list (expectedBucketSize)', () => {
  flow().start('c', 'LOVED', LIST, 'rerank');
  expect(flow().mode).toBe('rerank');
  expect(flow().placement!.list).toEqual(['a', 'b', 'd', 'e', 'f', 'g']);
  flow().answer('NEW_BETTER');
  flow().answer('NEW_BETTER');
  flow().answer('NEW_BETTER');
  expect(flow().result()).toMatchObject({ insertIndex: 0, expectedBucketSize: 6 });
});

it('restart keeps the Bev, bucket and note but starts placement over on the new list', () => {
  flow().start('new', 'LOVED', ['a', 'b'], 'new');
  flow().setNote('crisp');
  flow().answer('NEW_BETTER');
  flow().restart(['a', 'b', 'c'], 'rerank');
  expect(flow().placement).toMatchObject({ bevId: 'new', bucket: 'LOVED', list: ['a', 'b', 'c'], history: [] });
  expect(flow().note).toBe('crisp');
  expect(flow().mode).toBe('rerank');
});

it('caps the note at 140 characters', () => {
  flow().setNote('x'.repeat(200));
  expect(flow().note).toHaveLength(140);
});

it('names the two possible next incumbents for prefetching', () => {
  flow().start('new', 'LOVED', LIST, 'new');
  expect(nextCandidates(flow().placement)).toEqual(['b', 'f']);
  flow().tie();
  expect(nextCandidates(flow().placement)).toEqual([]);
});

describe('anchored placement (tiers from loadPlacementList)', () => {
  // 'c' and 'f' share the new Bev's leaf (tier 1); 'a' only its root (tier 2).
  const TIERS = [2, null, 1, null, null, 1, null];

  it('asks the anchors first, then the gap, and reports a plain-shaped result', () => {
    flow().start('new', 'LOVED', LIST, 'new', TIERS);
    expect(placementPhase(flow().placement!)).toBe('ANCHORS');
    // Two anchors (positions 2 and 5): the first question is the later one, 'f'.
    expect(selectPrompt(flow())).toEqual({ comparedBevId: 'f', step: 1, maxSteps: maxAnchoredComparisons(7, [2, 5]) });
    flow().answer('NEW_BETTER');
    expect(selectPrompt(flow())!.comparedBevId).toBe('c');
    flow().answer('EXISTING_BETTER');
    // Between the anchors: the gap 'd', 'e'.
    expect(placementPhase(flow().placement!)).toBe('GAP');
    expect(['d', 'e']).toContain(selectPrompt(flow())!.comparedBevId);
    while (!selectDone(flow())) flow().answer('NEW_BETTER');
    expect(flow().result()).toMatchObject({ insertIndex: 3, expectedBucketSize: 7 });
  });

  it('undo crosses back from the gap into the anchors', () => {
    flow().start('new', 'LOVED', LIST, 'new', TIERS);
    flow().answer('NEW_BETTER');
    flow().answer('EXISTING_BETTER');
    expect(placementPhase(flow().placement!)).toBe('GAP');
    flow().undo();
    expect(placementPhase(flow().placement!)).toBe('ANCHORS');
    expect(selectPrompt(flow())!.comparedBevId).toBe('c');
  });

  it('tiers that do not line up with the list fall back to the plain search', () => {
    flow().start('new', 'LOVED', LIST, 'new', [1, 1]);
    expect(placementPhase(flow().placement!)).toBe('PLAIN');
    expect(selectPrompt(flow())).toEqual({ comparedBevId: 'd', step: 1, maxSteps: maxComparisons(7) });
  });

  it('restart re-anchors on the fresh list and its tiers', () => {
    flow().start('new', 'LOVED', LIST, 'new', TIERS);
    flow().answer('NEW_BETTER');
    flow().restart(['a', 'b', 'c'], undefined, [null, 1, null]);
    expect(flow().placement).toMatchObject({ list: ['a', 'b', 'c'], history: [] });
    expect(selectPrompt(flow())!.comparedBevId).toBe('b');
    flow().restart(['a', 'b', 'c']);
    expect(placementPhase(flow().placement!)).toBe('PLAIN');
  });

  it('a re-rank ignores the Bev\'s own tier: the anchors are the others', () => {
    // 'c' is being moved; its own tier 1 must not make it (or anything else) an anchor.
    flow().start('c', 'LOVED', LIST, 'rerank', [null, 2, 1, null, 2, null, null]);
    expect(flow().placement!.list).toEqual(['a', 'b', 'd', 'e', 'f', 'g']);
    expect(flow().placement!.anchored!.positions).toEqual([1, 3]);
  });
});
