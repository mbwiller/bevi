// Invariants of anchored placement (LaTeX Theorem thm:anchored, M-21), in the style of placement.property.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  answer,
  currentPrompt,
  isDone,
  maxComparisons,
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);
const pos = (id: string) => Number(id.slice(1));
const answerArb = fc.constantFrom<ComparisonAnswer>('NEW_BETTER', 'EXISTING_BETTER', 'TIE');
const noTieArb = fc.constantFrom<ComparisonAnswer>('NEW_BETTER', 'EXISTING_BETTER');
const tierArb = fc.constantFrom<PlacementTier>(1, 2, 3, null);

/** A list of n Bevs with tiers: mixed, sparse (mostly null), all one tier, or none. */
const caseArb = fc.integer({ min: 1, max: 200 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    tiers: fc.oneof(
      { weight: 4, arbitrary: fc.array(tierArb, { minLength: n, maxLength: n }) },
      { weight: 2, arbitrary: fc.array(fc.oneof({ weight: 6, arbitrary: fc.constant<PlacementTier>(null) }, { weight: 1, arbitrary: tierArb }), { minLength: n, maxLength: n }) },
      { weight: 1, arbitrary: fc.constantFrom<PlacementTier>(1, 2, 3).map((t) => Array.from({ length: n }, () => t)) },
      { weight: 1, arbitrary: fc.constant(Array.from({ length: n }, (): PlacementTier => null)) },
    ),
  }),
);

/** The anchor positions the way the paper defines them: the smallest tier present. */
function anchorSet(tiers: readonly PlacementTier[]): Set<number> {
  const present = tiers.filter((t): t is number => t !== null);
  if (present.length === 0) return new Set();
  const best = Math.min(...present);
  return new Set(tiers.flatMap((t, i) => (t === best ? [i] : [])));
}

const begin = (n: number, tiers: readonly PlacementTier[]) => startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: ids(n), tiers });

/** Run to completion, drawing answers cyclically; returns every state. */
function trajectory(s: PlacementState, answers: readonly ComparisonAnswer[]): PlacementState[] {
  const states = [s];
  let i = 0;
  while (!isDone(s)) {
    s = answer(s, answers[i++ % answers.length] as ComparisonAnswer);
    states.push(s);
  }
  return states;
}

describe('anchored placement properties', () => {
  it('the index is in [0, n] and the log is consistent with it (Prop. 2.5 on the pre-insert list), whatever the answers', () => {
    fc.assert(
      fc.property(caseArb, fc.array(answerArb, { minLength: 1, maxLength: 12 }), ({ n, tiers }, answers) => {
        const states = trajectory(begin(n, tiers), answers);
        const r = placementResult(states[states.length - 1] as PlacementState);
        expect(r.insertIndex).toBeGreaterThanOrEqual(0);
        expect(r.insertIndex).toBeLessThanOrEqual(n);
        expect(r.expectedBucketSize).toBe(n);
        for (const c of r.comparisons) {
          const j = pos(c.winnerBevId === 'new' ? c.loserBevId : c.winnerBevId);
          if (c.tie) expect(j).toBe(r.insertIndex - 1);
          else if (c.winnerBevId === 'new') expect(j).toBeGreaterThanOrEqual(r.insertIndex);
          else expect(j).toBeLessThan(r.insertIndex);
        }
        // The candidate range only shrinks and always holds the final index.
        for (const s of states) {
          expect(s.lo).toBeLessThanOrEqual(r.insertIndex);
          expect(s.hi).toBeGreaterThanOrEqual(r.insertIndex);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('every Phase 1 question is an anchor, and no Phase 2 question is; the first question is an anchor when one exists', () => {
    fc.assert(
      fc.property(caseArb, fc.array(answerArb, { minLength: 1, maxLength: 12 }), ({ n, tiers }, answers) => {
        const anchors = anchorSet(tiers);
        const states = trajectory(begin(n, tiers), answers);
        let seenGap = false;
        for (const s of states) {
          if (isDone(s)) break;
          const phase = placementPhase(s);
          const j = pos(currentPrompt(s)?.comparedBevId ?? 'b-1');
          if (anchors.size === 0) expect(phase).toBe('PLAIN');
          else if (phase === 'ANCHORS') {
            expect(seenGap).toBe(false); // Phase 1 comes first, never again after Phase 2
            expect(anchors.has(j)).toBe(true);
          } else {
            expect(phase).toBe('GAP');
            seenGap = true;
            expect(anchors.has(j)).toBe(false);
          }
        }
        if (anchors.size > 0) expect(anchors.has(pos(currentPrompt(states[0] as PlacementState)?.comparedBevId ?? 'b-1'))).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('asks at most ceil(log2(k + 1)) Phase 1 questions and ceil(log2(g + 1)) Phase 2 questions, within maxSteps', () => {
    fc.assert(
      fc.property(caseArb, fc.array(noTieArb, { minLength: 1, maxLength: 12 }), ({ n, tiers }, answers) => {
        const k = anchorSet(tiers).size;
        const s0 = begin(n, tiers);
        const states = trajectory(s0, answers);
        const final = states[states.length - 1] as PlacementState;
        const phase1 = final.history.filter((h) => h.anchored !== undefined && h.anchored.lo < h.anchored.hi);
        const phase2 = final.history.filter((h) => h.anchored === undefined || h.anchored.lo === h.anchored.hi);
        if (k === 0) {
          expect(phase1.length).toBe(0);
          expect(phase2.length).toBeLessThanOrEqual(maxComparisons(n));
        } else {
          expect(phase1.length).toBeLessThanOrEqual(maxComparisons(k));
          // g is the gap Phase 2 started on: the range captured by its first step (0 if it never ran).
          const g = phase2.length === 0 ? 0 : (phase2[0] as { hi: number; lo: number }).hi - (phase2[0] as { lo: number }).lo;
          expect(phase2.length).toBeLessThanOrEqual(maxComparisons(g));
        }
        expect(final.history.length).toBeLessThanOrEqual(currentPrompt(s0)?.maxSteps ?? 0);
      }),
      { numRuns: 400 },
    );
  });

  it('a consistent oracle with true slot t gives exactly t', () => {
    fc.assert(
      fc.property(caseArb.chain((c) => fc.tuple(fc.constant(c), fc.integer({ min: 0, max: c.n }))), ([{ n, tiers }, t]) => {
        let s = begin(n, tiers);
        while (!isDone(s)) {
          const j = pos(currentPrompt(s)?.comparedBevId ?? 'b-1');
          s = answer(s, t <= j ? 'NEW_BETTER' : 'EXISTING_BETTER');
        }
        expect(placementResult(s).insertIndex).toBe(t);
      }),
      { numRuns: 400 },
    );
  });

  it('undo restores the previous state and redo restores the next, across the phase boundary, back to the start', () => {
    fc.assert(
      fc.property(caseArb, fc.array(answerArb, { minLength: 1, maxLength: 12 }), ({ n, tiers }, answers) => {
        const states: PlacementState[] = [begin(n, tiers)];
        const taken: ComparisonAnswer[] = [];
        for (const a of answers) {
          const s = states[states.length - 1] as PlacementState;
          if (isDone(s)) break;
          states.push(answer(s, a));
          taken.push(a);
        }
        for (let k = states.length - 1; k > 0; k--) {
          const back = undo(states[k] as PlacementState);
          expect(back).toEqual(states[k - 1]);
          expect(answer(back, taken[k - 1] as ComparisonAnswer)).toEqual(states[k]);
        }
        let s = states[states.length - 1] as PlacementState;
        for (let k = 0; k < taken.length; k++) s = undo(s);
        expect(s).toEqual(states[0]);
        expect(undo(s)).toBe(s);
      }),
      { numRuns: 400 },
    );
  });

  it('with no anchors the states are the plain ones; with every Bev an anchor the questions and the result are', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.constantFrom<PlacementTier>(1, 2, 3),
        fc.array(answerArb, { minLength: 1, maxLength: 12 }),
        (n, t, answers) => {
          const plain = trajectory(startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ids(n) }), answers);
          const none = trajectory(startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ids(n), tiers: ids(n).map(() => null) }), answers);
          expect(none).toEqual(plain);
          const all = trajectory(startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ids(n), tiers: ids(n).map(() => t) }), answers);
          expect(all.length).toBe(plain.length);
          for (let i = 0; i < plain.length; i++) {
            expect(currentPrompt(all[i] as PlacementState)).toEqual(currentPrompt(plain[i] as PlacementState));
          }
          expect(placementResult(all[all.length - 1] as PlacementState)).toEqual(placementResult(plain[plain.length - 1] as PlacementState));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('placementTiers properties', () => {
  const kindArb: fc.Arbitrary<PlacementBevKind> = fc.record({
    categoryId: fc.constantFrom('soda', 'diet_soda', 'water', 'coffee'),
    leafCategoryId: fc.oneof(fc.constant<string | null>(null), fc.constantFrom('cola', 'root_beer', 'diet_cola', 'cold_brew', 'mocha')),
  });
  const weightArb = fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined });

  it('tier 1 means equal known leaves; tier ≤ 2 means the same root; tier 3 means an edge across roots; the taxonomy ignores weights', () => {
    fc.assert(
      fc.property(kindArb, kindArb, weightArb, (a, b, w) => {
        const t = placementTier(a, b, w);
        const sameRoot = a.categoryId === b.categoryId;
        // The generator can put one leaf id under two roots; a real taxonomy cannot, and the root decides.
        const sameLeaf = sameRoot && a.leafCategoryId !== null && a.leafCategoryId === b.leafCategoryId;
        expect(t === 1).toBe(sameLeaf);
        expect(t !== null && t <= 2).toBe(sameRoot);
        expect(t === 3).toBe(!sameRoot && w !== undefined && w >= 0.3);
        if (sameRoot) expect(t).toBe(placementTier(a, b));
        // A weight can only turn "no tier" into tier 3, never move a taxonomy tier.
        const bare = placementTier(a, b);
        expect(bare === null || bare === t).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('the taxonomy tiers are symmetric; a list is mapped entry by entry', () => {
    fc.assert(
      fc.property(kindArb, fc.array(kindArb, { maxLength: 20 }), (a, list) => {
        const withIds = list.map((k, i) => ({ id: `b${i}`, ...k }));
        const tiers = placementTiers(a, withIds);
        expect(tiers).toHaveLength(list.length);
        tiers.forEach((t, i) => {
          expect(t).toBe(placementTier(a, list[i] as PlacementBevKind));
          expect(t).toBe(placementTier(list[i] as PlacementBevKind, a));
          expect(t === 3).toBe(false);
        });
      }),
      { numRuns: 300 },
    );
  });
});
