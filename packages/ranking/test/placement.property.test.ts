import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  answer,
  currentPrompt,
  isDone,
  maxComparisons,
  placementResult,
  startPlacement,
  undo,
  type ComparisonAnswer,
  type PlacementState,
} from '../src/index.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);
const answerArb = fc.constantFrom<ComparisonAnswer>('NEW_BETTER', 'EXISTING_BETTER', 'TIE');

/** Run to completion, drawing answers from `answers` cyclically. */
function runWith(s: PlacementState, answers: ComparisonAnswer[]): PlacementState {
  let i = 0;
  while (!isDone(s)) s = answer(s, answers[i++ % answers.length] as ComparisonAnswer);
  return s;
}

describe('placement properties', () => {
  it('finds the true index with a consistent oracle, within maxComparisons', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }).chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 0, max: n }))), ([n, t]) => {
        // The new Bev truly belongs at index t: better than list[j] for j ≥ t, worse for j < t.
        let s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: ids(n) });
        while (!isDone(s)) {
          const j = Number((currentPrompt(s)?.comparedBevId ?? '').slice(1));
          s = answer(s, t <= j ? 'NEW_BETTER' : 'EXISTING_BETTER');
        }
        const r = placementResult(s);
        expect(r.insertIndex).toBe(t);
        expect(r.comparisons.length).toBeLessThanOrEqual(maxComparisons(n));
        expect(r.expectedBucketSize).toBe(n);
      }),
    );
  });

  it('always lands in [0, n] within maxComparisons, whatever the answers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.array(answerArb, { minLength: 1, maxLength: 12 }), (n, answers) => {
        const r = placementResult(runWith(startPlacement({ bevId: 'new', bucket: 'FINE', orderedBevIds: ids(n) }), answers));
        expect(r.insertIndex).toBeGreaterThanOrEqual(0);
        expect(r.insertIndex).toBeLessThanOrEqual(n);
        expect(r.comparisons.length).toBeLessThanOrEqual(maxComparisons(n));
      }),
    );
  });

  it('logs only comparisons consistent with the final index', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.array(answerArb, { minLength: 1, maxLength: 12 }), (n, answers) => {
        const r = placementResult(runWith(startPlacement({ bevId: 'new', bucket: 'DISLIKED', orderedBevIds: ids(n) }), answers));
        for (const c of r.comparisons) {
          const other = c.winnerBevId === 'new' ? c.loserBevId : c.winnerBevId;
          const j = Number(other.slice(1));
          if (c.tie) expect(j).toBe(r.insertIndex - 1);
          else if (c.winnerBevId === 'new') expect(j).toBeGreaterThanOrEqual(r.insertIndex);
          else expect(j).toBeLessThan(r.insertIndex);
        }
      }),
    );
  });

  it('a TIE at any step inserts directly below the incumbent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.array(fc.constantFrom<ComparisonAnswer>('NEW_BETTER', 'EXISTING_BETTER'), { maxLength: 9 }), (n, before) => {
        let s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: ids(n) });
        for (const a of before) if (!isDone(s)) s = answer(s, a);
        fc.pre(!isDone(s));
        const j = Number((currentPrompt(s)?.comparedBevId ?? '').slice(1));
        expect(placementResult(answer(s, 'TIE')).insertIndex).toBe(j + 1);
      }),
    );
  });

  it('undo after k answers restores the state before answer k', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.array(answerArb, { minLength: 1, maxLength: 10 }), (n, answers) => {
        const states: PlacementState[] = [startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: ids(n) })];
        for (const a of answers) {
          const s = states[states.length - 1] as PlacementState;
          if (isDone(s)) break;
          states.push(answer(s, a));
        }
        for (let k = states.length - 1; k > 0; k--) {
          expect(undo(states[k] as PlacementState)).toEqual(states[k - 1]);
        }
      }),
    );
  });
});
