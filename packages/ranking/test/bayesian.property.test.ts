import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareCodePoints } from '../src/index.ts';

/** Reference: lexicographic order of the code-point arrays. */
function reference(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) as number);
  const y = Array.from(b, (c) => c.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

// Any code point, plus a pool that collides often around the code-unit / code-point disagreement.
const anyString = fc.string({ unit: 'binary', maxLength: 8 });
const nearString = fc.array(fc.constantFrom('a', 'Z', '', 'Ｃ', '�', '\u{10000}', '😀', '😁', '\u{10FFFF}'), { maxLength: 6 }).map((xs) => xs.join(''));
const str = fc.oneof(anyString, nearString);

describe('compareCodePoints properties', () => {
  it('agrees with comparing Array.from(s, c => c.codePointAt(0)) lexicographically', () => {
    fc.assert(
      fc.property(str, str, (a, b) => {
        expect(compareCodePoints(a, b)).toBe(reference(a, b));
      }),
      { numRuns: 500 },
    );
  });

  it('is antisymmetric, 0 exactly on equal strings, and transitive', () => {
    fc.assert(
      fc.property(str, str, str, (a, b, c) => {
        expect(compareCodePoints(a, b)).toBe(-compareCodePoints(b, a) || 0);
        expect(compareCodePoints(a, b) === 0).toBe(a === b);
        if (compareCodePoints(a, b) <= 0 && compareCodePoints(b, c) <= 0) expect(compareCodePoints(a, c)).toBeLessThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it('matches JS < on strings without surrogates (the BMP below U+D800, and above U+DFFF on its own)', () => {
    const bmp = fc.string({ unit: fc.integer({ min: 0, max: 0xd7ff }).map((n) => String.fromCharCode(n)), maxLength: 8 });
    fc.assert(
      fc.property(bmp, bmp, (a, b) => {
        expect(compareCodePoints(a, b)).toBe(a < b ? -1 : a > b ? 1 : 0);
      }),
    );
  });
});
