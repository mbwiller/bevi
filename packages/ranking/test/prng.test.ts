import { describe, expect, it } from 'vitest';
import { createPrng, hashString, randomInt } from '../src/index.ts';

describe('prng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = createPrng('user-1:2026-10-09');
    const b = createPrng('user-1:2026-10-09');
    const c = createPrng('user-2:2026-10-09');
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(xs);
  });

  it('stays in [0, 1)', () => {
    const r = createPrng('range');
    for (let i = 0; i < 10_000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('keeps the algorithm fixed (the app and the Edge Function must agree)', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('bevi')).toMatchInlineSnapshot(`2206604465`);
    const r = createPrng('bevi');
    expect([r(), r(), r()]).toMatchInlineSnapshot(`
      [
        0.8183717974461615,
        0.13195161474868655,
        0.2519150988664478,
      ]
    `);
  });

  it('draws integers below the bound', () => {
    const r = createPrng('ints');
    for (let i = 0; i < 1000; i++) {
      const k = randomInt(r, 7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
  });
});
