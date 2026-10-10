// Seeded randomness. The package never calls Math.random(): every random choice takes a seed,
// so the app, the mock and the Edge Function produce the same output for the same input.

/** 32-bit FNV-1a over the string's UTF-16 code units. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPrng(seed: string): () => number {
  return mulberry32(hashString(seed));
}

/** Integer in [0, maxExclusive). */
export function randomInt(rand: () => number, maxExclusive: number): number {
  return Math.floor(rand() * maxExclusive);
}
