// Anchored placement (LaTeX §10.1, M-21): table tests from the paper's figure and D-04 §3's pairs.
import { describe, expect, it } from 'vitest';
import {
  answer,
  currentPrompt,
  isDone,
  maxAnchoredComparisons,
  maxComparisons,
  PLACEMENT_TIER,
  placementPhase,
  placementResult,
  placementTier,
  placementTiers,
  startPlacement,
  undo,
  type ComparisonAnswer,
  type PlacementBevKind,
  type PlacementState,
  type PlacementTier,
} from '../src/index.ts';

/** The paper's figure: L = ℓ0 … ℓ7 with anchors a1 = ℓ1, a2 = ℓ4, a3 = ℓ6. */
const L = Array.from({ length: 8 }, (_, i) => `l${i}`);
const FIG_TIERS: PlacementTier[] = [null, 1, null, null, 1, null, 1, null];
const start = (tiers: PlacementTier[] = FIG_TIERS, orderedBevIds: string[] = L, bevId = 'new') =>
  startPlacement({ bevId, bucket: 'LOVED', orderedBevIds, tiers });

/** Answer a script, returning the compared Bev of every question asked. */
function run(s: PlacementState, script: Array<ComparisonAnswer | 'UNDO'>): { state: PlacementState; asked: string[] } {
  const asked: string[] = [];
  for (const step of script) {
    if (step === 'UNDO') s = undo(s);
    else {
      asked.push(currentPrompt(s)?.comparedBevId ?? '?');
      s = answer(s, step);
    }
  }
  return { state: s, asked };
}

describe('maxAnchoredComparisons', () => {
  it('is ceil(log2(k + 1)) + ceil(log2(g_max + 1))', () => {
    const table: Array<[number, number[], number]> = [
      [8, [1, 4, 6], 2 + 2], // k = 3 → 2; gaps 1, 2, 1, 1 → widest 2 → 2
      [8, [0], 1 + 3], // one anchor at the top; gap of 7 below it
      [8, [7], 1 + 3],
      [8, [0, 1, 2, 3, 4, 5, 6, 7], maxComparisons(8)], // every Bev an anchor: plain
      [1, [0], 1],
      [100, [50], 1 + maxComparisons(50)],
    ];
    for (const [n, positions, k] of table) expect(maxAnchoredComparisons(n, positions)).toBe(k);
  });

  it('rejects positions that are not strictly ascending integers in [0, n)', () => {
    expect(() => maxAnchoredComparisons(8, [4, 1])).toThrow(RangeError);
    expect(() => maxAnchoredComparisons(8, [1, 1])).toThrow(RangeError);
    expect(() => maxAnchoredComparisons(8, [8])).toThrow(RangeError);
    expect(() => maxAnchoredComparisons(8, [-1])).toThrow(RangeError);
    expect(() => maxAnchoredComparisons(8, [1.5])).toThrow(RangeError);
    expect(() => maxAnchoredComparisons(-1, [])).toThrow(RangeError);
    expect(maxAnchoredComparisons(0, [])).toBe(0);
  });
});

describe('placementTier / placementTiers (D-04 §3)', () => {
  const coke: PlacementBevKind = { categoryId: 'soda', leafCategoryId: 'cola' };
  const pepsi: PlacementBevKind = { categoryId: 'soda', leafCategoryId: 'cola' };
  const rootBeer: PlacementBevKind = { categoryId: 'soda', leafCategoryId: 'root_beer' };
  const unknownSoda: PlacementBevKind = { categoryId: 'soda', leafCategoryId: null };
  const dietCoke: PlacementBevKind = { categoryId: 'diet_soda', leafCategoryId: 'diet_cola' };
  const fiji: PlacementBevKind = { categoryId: 'water', leafCategoryId: null };
  const evian: PlacementBevKind = { categoryId: 'water', leafCategoryId: null };

  it('follows the taxonomy: same leaf 1, same root 2, else none', () => {
    const table: Array<[string, PlacementBevKind, PlacementBevKind, PlacementTier]> = [
      ['Coke / Pepsi: same leaf', coke, pepsi, 1],
      ['Coke / A&W: sibling leaves', coke, rootBeer, 2],
      ['Coke / a soda of unknown kind: same root, not same leaf', coke, unknownSoda, 2],
      ['a soda of unknown kind / Coke: the same the other way round', unknownSoda, coke, 2],
      ['two sodas of unknown kind: same root, not same leaf (D-04 §3: T1 = ∅)', unknownSoda, unknownSoda, 2],
      ['Fiji / Evian: same unsplit root', fiji, evian, 2],
      ['Coke / Diet Coke: different roots (cola vs diet_cola), no edge', coke, dietCoke, null],
      ['Coke / Fiji', coke, fiji, null],
    ];
    for (const [name, a, b, tier] of table) expect(placementTier(a, b), name).toBe(tier);
  });

  it('a stored edge (w ≥ EDGE_MIN_WEIGHT) across roots is tier 3; it never changes tiers 1 and 2', () => {
    expect(placementTier(coke, dietCoke, 0.7)).toBe(PLACEMENT_TIER.edge);
    expect(placementTier(coke, dietCoke, 0.3)).toBe(PLACEMENT_TIER.edge);
    expect(placementTier(coke, dietCoke, 0.29)).toBeNull();
    expect(placementTier(coke, dietCoke, 0)).toBeNull();
    expect(placementTier(coke, dietCoke, Number.NaN)).toBeNull();
    expect(placementTier(coke, rootBeer, 0.95)).toBe(PLACEMENT_TIER.sameRoot);
    expect(placementTier(coke, pepsi, 0.1)).toBe(PLACEMENT_TIER.sameLeaf);
  });

  it('maps a bucket list in order, reading weights by id', () => {
    const list = [
      { id: 'pepsi', ...pepsi },
      { id: 'fiji', ...fiji },
      { id: 'diet-coke', ...dietCoke },
      { id: 'aw', ...rootBeer },
      { id: 'mystery', ...unknownSoda },
    ];
    expect(placementTiers(coke, list)).toEqual([1, null, null, 2, 2]);
    expect(placementTiers(coke, list, new Map([['diet-coke', 0.7], ['fiji', 0.9]]))).toEqual([1, 3, 3, 2, 2]);
    expect(placementTiers(coke, [])).toEqual([]);
  });
});

describe('startPlacement with tiers', () => {
  it('anchors are the members of the smallest tier present, in list order', () => {
    expect(start().anchored).toEqual({ positions: [1, 4, 6], lo: 0, hi: 3 });
    expect(start([2, 3, 1, 2, 1, null, 3, null]).anchored).toEqual({ positions: [2, 4], lo: 0, hi: 2 });
    expect(start([2, 3, null, 2, null, null, 3, null]).anchored).toEqual({ positions: [0, 3], lo: 0, hi: 2 });
    expect(start([null, 3, null, null, null, null, 3, null]).anchored).toEqual({ positions: [1, 6], lo: 0, hi: 2 });
  });

  it('with no tiered Bev, or without tiers, the state is the plain one, field for field', () => {
    const plain = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: L });
    expect(start(L.map(() => null))).toEqual(plain);
    expect('anchored' in start(L.map(() => null))).toBe(false);
    expect(startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: [], tiers: [] })).toEqual(
      startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: [] }),
    );
  });

  it('filters the Bev itself out of both the list and the tiers (re-rank)', () => {
    const s = start([null, 1, 1, null, 1, null, 1, null], L, 'l2');
    expect(s.list).toEqual(['l0', 'l1', 'l3', 'l4', 'l5', 'l6', 'l7']);
    expect(s.anchored).toEqual({ positions: [1, 3, 5], lo: 0, hi: 3 });
  });

  it("re-rank: the Bev's own tier against itself does not decide the anchors (integrator review of 7e19458)", () => {
    // Re-ranking a mocha in [latte1, mocha, cola, latte2]: placementTiers gives the mocha tier 1 against
    // itself and the lattes tier 2. The anchors are the two lattes, not nothing.
    const mocha = { categoryId: 'coffee', leafCategoryId: 'flavored_latte' };
    const list = [
      { id: 'latte1', categoryId: 'coffee', leafCategoryId: 'latte' },
      { id: 'mocha', ...mocha },
      { id: 'cola', categoryId: 'soda', leafCategoryId: 'cola' },
      { id: 'latte2', categoryId: 'coffee', leafCategoryId: 'latte' },
    ];
    const tiers = placementTiers(mocha, list);
    expect(tiers).toEqual([2, 1, null, 2]);
    const s = startPlacement({ bevId: 'mocha', bucket: 'LOVED', orderedBevIds: list.map((b) => b.id), tiers });
    expect(s.list).toEqual(['latte1', 'cola', 'latte2']);
    expect(s.anchored).toEqual({ positions: [0, 2], lo: 0, hi: 2 });
    expect(placementPhase(s)).toBe('ANCHORS');
    expect(currentPrompt(s)?.comparedBevId).toBe('latte2');
    // With an unknown leaf the Bev is tier 2 against itself; an edge Bev at tier 3 is still the anchor.
    const unknown = { categoryId: 'coffee', leafCategoryId: null };
    const t2 = placementTiers(unknown, [{ id: 'me', ...unknown }, { id: 'x', categoryId: 'soda', leafCategoryId: null }], new Map([['x', 0.5]]));
    expect(t2).toEqual([2, 3]);
    expect(startPlacement({ bevId: 'me', bucket: 'FINE', orderedBevIds: ['me', 'x'], tiers: t2 }).anchored).toEqual({ positions: [0], lo: 0, hi: 1 });
    // Only the Bev itself tiered: no anchors, the plain state.
    expect(startPlacement({ bevId: 'me', bucket: 'FINE', orderedBevIds: ['me', 'x'], tiers: [1, null] })).toEqual(
      startPlacement({ bevId: 'me', bucket: 'FINE', orderedBevIds: ['me', 'x'] }),
    );
  });

  it('rejects tiers of the wrong length or of the wrong type', () => {
    expect(() => start([1, 2])).toThrow(RangeError);
    expect(() => start([null, Number.NaN, null, null, null, null, null, null])).toThrow(RangeError);
  });
});

describe('the two phases (paper figure: anchors ℓ1, ℓ4, ℓ6)', () => {
  it('asks the middle anchor first, then the anchors it narrows to, then the gap: ℓ4, ℓ1, ℓ3, ℓ2', () => {
    const s0 = start();
    expect(currentPrompt(s0)).toEqual({ comparedBevId: 'l4', step: 1, maxSteps: 4 });
    expect(placementPhase(s0)).toBe('ANCHORS');
    const { state, asked } = run(s0, ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']);
    expect(asked).toEqual(['l4', 'l1', 'l3', 'l2']);
    expect(isDone(state)).toBe(true);
    expect(placementResult(state)).toEqual({
      bevId: 'new',
      bucket: 'LOVED',
      insertIndex: 3,
      expectedBucketSize: 8,
      comparisons: [
        { winnerBevId: 'new', loserBevId: 'l4', tie: false },
        { winnerBevId: 'l1', loserBevId: 'new', tie: false },
        { winnerBevId: 'new', loserBevId: 'l3', tie: false },
        { winnerBevId: 'l2', loserBevId: 'new', tie: false },
      ],
    });
    expect(placementPhase(state)).toBe('GAP');
  });

  it('after Phase 1 the candidate range is the gap between the two anchors (Algorithm line 5)', () => {
    const { state } = run(start(), ['NEW_BETTER', 'EXISTING_BETTER']);
    expect(state).toMatchObject({ lo: 2, hi: 4, status: 'COMPARING', anchored: { positions: [1, 4, 6], lo: 1, hi: 1 } });
    expect(placementPhase(state)).toBe('GAP');
    expect(currentPrompt(state)?.comparedBevId).toBe('l3');
  });

  it('a tie in Phase 1 ends the whole placement at p_j + 1 (Algorithm line 3)', () => {
    const { state, asked } = run(start(), ['TIE']);
    expect(asked).toEqual(['l4']);
    expect(isDone(state)).toBe(true);
    expect(placementResult(state)).toMatchObject({ insertIndex: 5, comparisons: [{ winnerBevId: 'l4', loserBevId: 'new', tie: true }] });
    expect(placementPhase(state)).toBe('ANCHORS');
  });

  it('a tie in Phase 2 inserts directly below the incumbent', () => {
    const { state, asked } = run(start(), ['NEW_BETTER', 'EXISTING_BETTER', 'TIE']);
    expect(asked).toEqual(['l4', 'l1', 'l3']);
    expect(placementResult(state).insertIndex).toBe(4);
  });

  it('an empty gap asks no cross-tier question: adjacent anchors', () => {
    const s0 = start([null, 1, 1, null], ['a', 'b', 'c', 'd']);
    const { state, asked } = run(s0, ['NEW_BETTER', 'EXISTING_BETTER']);
    expect(asked).toEqual(['c', 'b']);
    expect(isDone(state)).toBe(true);
    expect(placementResult(state).insertIndex).toBe(2);
  });

  it('above the first anchor the gap is the top of the list; below the last, the bottom', () => {
    const top = run(start(), ['NEW_BETTER', 'NEW_BETTER']);
    expect(top.asked).toEqual(['l4', 'l1']);
    expect(top.state).toMatchObject({ lo: 0, hi: 1 });
    expect(currentPrompt(top.state)?.comparedBevId).toBe('l0');
    expect(placementResult(answer(top.state, 'NEW_BETTER')).insertIndex).toBe(0);

    const bottom = run(start(), ['EXISTING_BETTER', 'EXISTING_BETTER']);
    expect(bottom.asked).toEqual(['l4', 'l6']);
    expect(bottom.state).toMatchObject({ lo: 7, hi: 8 });
    expect(currentPrompt(bottom.state)?.comparedBevId).toBe('l7');
    expect(placementResult(answer(bottom.state, 'EXISTING_BETTER')).insertIndex).toBe(8);
  });

  it('best of all: every question is NEW_BETTER', () => {
    const { state, asked } = run(start(), ['NEW_BETTER', 'NEW_BETTER', 'NEW_BETTER']);
    expect(asked).toEqual(['l4', 'l1', 'l0']);
    expect(placementResult(state).insertIndex).toBe(0);
  });
});

describe('undo across the phase boundary', () => {
  it('restores the previous state exactly, step by step, back to the start', () => {
    const states: PlacementState[] = [start()];
    for (const a of ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER'] as const) {
      states.push(answer(states[states.length - 1] as PlacementState, a));
    }
    expect(placementPhase(states[2] as PlacementState)).toBe('GAP');
    expect(placementPhase(states[1] as PlacementState)).toBe('ANCHORS');
    for (let k = states.length - 1; k > 0; k--) expect(undo(states[k] as PlacementState)).toEqual(states[k - 1]);
  });

  it('undoing the last Phase 1 answer after Phase 2 has started reopens Phase 1', () => {
    const { state: inGap } = run(start(), ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER']);
    expect(placementPhase(inGap)).toBe('GAP');
    const back2 = undo(undo(inGap));
    expect(placementPhase(back2)).toBe('ANCHORS');
    expect(back2).toMatchObject({ lo: 0, hi: 4, anchored: { lo: 0, hi: 1 } });
    expect(currentPrompt(back2)?.comparedBevId).toBe('l1');
    // Change the answer: now above a1, so the gap is ℓ0 alone.
    const changed = answer(back2, 'NEW_BETTER');
    expect(changed).toMatchObject({ lo: 0, hi: 1, anchored: { lo: 0, hi: 0 } });
    expect(currentPrompt(changed)?.comparedBevId).toBe('l0');
    expect(placementResult(answer(changed, 'EXISTING_BETTER'))).toMatchObject({
      insertIndex: 1,
      comparisons: [
        { winnerBevId: 'new', loserBevId: 'l4', tie: false },
        { winnerBevId: 'new', loserBevId: 'l1', tie: false },
        { winnerBevId: 'l0', loserBevId: 'new', tie: false },
      ],
    });
  });

  it('undo after a Phase 1 tie reopens Phase 1 at the same question', () => {
    const tied = answer(start(), 'TIE');
    expect(isDone(tied)).toBe(true);
    expect(undo(tied)).toEqual(start());
  });
});

describe('fallback: the plain search', () => {
  /** Answer cyclically from `answers` until done, returning the compared Bev of every question. */
  const untilDone = (s: PlacementState, answers: readonly ComparisonAnswer[]) => {
    const asked: string[] = [];
    for (let i = 0; !isDone(s); i++) {
      asked.push(currentPrompt(s)?.comparedBevId ?? '?');
      s = answer(s, answers[i % answers.length] as ComparisonAnswer);
    }
    return { state: s, asked };
  };
  const plain = () => startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: L });

  it('every Bev in one tier asks the same questions and gives the same result as plain binary search', () => {
    for (const answers of [['NEW_BETTER'], ['EXISTING_BETTER'], ['NEW_BETTER', 'EXISTING_BETTER'], ['EXISTING_BETTER', 'TIE']] as ComparisonAnswer[][]) {
      const anchored = untilDone(start(L.map(() => 2)), answers);
      const reference = untilDone(plain(), answers);
      expect(anchored.asked).toEqual(reference.asked);
      expect(placementResult(anchored.state)).toEqual(placementResult(reference.state));
    }
    expect(currentPrompt(start(L.map(() => 2)))?.maxSteps).toBe(maxComparisons(8));
  });

  it('no anchors: the state itself is the plain state at every step', () => {
    let a = start(L.map(() => null));
    let p = plain();
    for (const step of ['EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER'] as const) {
      expect(a).toEqual(p);
      expect(placementPhase(a)).toBe('PLAIN');
      a = answer(a, step);
      p = answer(p, step);
    }
    expect(a).toEqual(p);
    expect(isDone(a)).toBe(true);
  });
});
