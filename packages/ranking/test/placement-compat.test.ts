// startPlacement without tiers is byte-identical to RANKING_VERSION 1.4.0 (M-21 promise, proved the
// way #137 proved Layer 1's default): the 1.4.0 machine (test/placement-1.4.0.ts, a verbatim copy)
// and the current one are driven in lockstep through generated scripts, and every state, prompt,
// done flag and result is compared as its JSON text. The count printed at the end is what the PR
// reports. Deterministic (fixed seed), so the count is reproducible.
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as cur from '../src/index.ts';
import * as old from './placement-1.4.0.ts';

type Step = cur.ComparisonAnswer | 'UNDO';
const stepArb = fc.constantFrom<Step>('NEW_BETTER', 'EXISTING_BETTER', 'TIE', 'UNDO');
const ids = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);

const scriptArb = fc
  .integer({ min: 0, max: 150 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      // Sometimes a re-rank: the Bev being placed is already in the list.
      bevId: fc.oneof({ weight: 3, arbitrary: fc.constant('new') }, { weight: 1, arbitrary: fc.constantFrom(...(n > 0 ? ids(n) : ['new'])) }),
      bucket: fc.constantFrom<cur.Bucket>('LOVED', 'FINE', 'DISLIKED'),
      steps: fc.array(stepArb, { minLength: 1, maxLength: 24 }),
    }),
  );

let compared = 0;
let differences = 0;
const same = (a: unknown, b: unknown) => {
  compared++;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) differences++;
  expect(ja).toBe(jb);
};

/** Drive both machines through one script, comparing after every transition. */
function lockstep(
  n: number,
  bevId: string,
  bucket: cur.Bucket,
  steps: readonly Step[],
  startCur: () => cur.PlacementState,
  stateIdentical: boolean,
): void {
  let a = old.startPlacement({ bevId, bucket, orderedBevIds: ids(n) });
  let b = startCur();
  const check = () => {
    if (stateIdentical) same(a, b);
    same(old.isDone(a), cur.isDone(b));
    same(old.currentPrompt(a), cur.currentPrompt(b));
    if (old.isDone(a)) same(old.placementResult(a), cur.placementResult(b));
    else {
      expect(() => old.placementResult(a)).toThrow();
      expect(() => cur.placementResult(b)).toThrow();
      compared += 2;
    }
  };
  check();
  for (const step of steps) {
    if (step === 'UNDO') {
      a = old.undo(a);
      b = cur.undo(b);
    } else if (old.isDone(a)) {
      expect(() => old.answer(a, step)).toThrow();
      expect(() => cur.answer(b, step)).toThrow();
      compared += 2;
      continue;
    } else {
      a = old.answer(a, step);
      b = cur.answer(b, step);
    }
    check();
  }
}

describe('startPlacement without tiers is byte-identical to 1.4.0', () => {
  it('states, prompts, done flags and results agree on every step of every generated script', () => {
    fc.assert(
      fc.property(scriptArb, ({ n, bevId, bucket, steps }) => {
        const list = ids(n);
        lockstep(n, bevId, bucket, steps, () => cur.startPlacement({ bevId, bucket, orderedBevIds: list }), true);
        // The same with tiers given but no Bev tiered: the plain state, field for field.
        lockstep(n, bevId, bucket, steps, () => cur.startPlacement({ bevId, bucket, orderedBevIds: list, tiers: list.map(() => null) }), true);
        // Every Bev in one tier: the same questions, flags and result (the state carries `anchored`).
        lockstep(n, bevId, bucket, steps, () => cur.startPlacement({ bevId, bucket, orderedBevIds: list, tiers: list.map(() => 1) }), false);
      }),
      { seed: 20261031, numRuns: 3000, endOnFailure: true },
    );
    expect(differences).toBe(0);
    expect(compared).toBeGreaterThan(100_000);
  });

  it('maxComparisons, removeFromBucket are unchanged', () => {
    for (let n = 0; n <= 2048; n++) same(old.maxComparisons(n), cur.maxComparisons(n));
    same(old.removeFromBucket(ids(9), 'b4'), cur.removeFromBucket(ids(9), 'b4'));
    same(old.removeFromBucket(ids(9), 'zz'), cur.removeFromBucket(ids(9), 'zz'));
  });

  afterAll(() => {
    console.log(`placement-compat: ${compared.toLocaleString('en-US')} outputs compared against 1.4.0, ${differences} differences`);
  });
});
