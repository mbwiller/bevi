// Content similarity between two Bevs (§8.8), from catalog features only.

import { FLAVOR_SIZE_PATTERN, FLAVOR_STOPWORDS, PRICE_TIER_SPAN, SIM_WEIGHTS } from './constants.ts';
import type { BevFeatures } from './types.ts';

const STOP = new Set(FLAVOR_STOPWORDS);

/** Brand key for equality: lowercase, trimmed, inner whitespace collapsed; null when empty. */
export function normaliseBrand(brand: string | null | undefined): string | null {
  const key = (brand ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  return key === '' ? null : key;
}

/**
 * Lowercase words of flavor + name minus the stoplist (`original`, `classic`, `drink`, `can`,
 * `bottle`, …) and size tokens ("12oz", "500ml", "2"). Words are runs of letters/digits/'.'
 * (apostrophes dropped: "dr pepper's" → "dr", "peppers"). Unique, sorted.
 */
export function flavorTokens(name: string, flavor: string | null | undefined): string[] {
  const text = `${flavor ?? ''} ${name}`.toLowerCase().replace(/['’]/g, '');
  const words = text.split(/[^\p{L}\p{N}.]+/u).map((w) => w.replace(/^\.+|\.+$/g, ''));
  const out = new Set<string>();
  for (const w of words) if (w !== '' && !STOP.has(w) && !FLAVOR_SIZE_PATTERN.test(w)) out.add(w);
  return [...out].sort();
}

/** |A ∩ B| / |A ∪ B|; 0 when both are empty. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * sim(b, b') = 0.40·[same category] + 0.30·[same brand, normalised, non-empty]
 *            + 0.20·jaccard(flavorTokens) + 0.10·(1 − |tier − tier'| / 3).
 * In [0, 1] and symmetric. Callers drop pairs below SIM_MIN.
 */
export function contentSimilarity(a: BevFeatures, b: BevFeatures): number {
  const brandA = normaliseBrand(a.brandKey);
  const sameBrand = brandA !== null && brandA === normaliseBrand(b.brandKey);
  return (
    SIM_WEIGHTS.category * (a.categoryId === b.categoryId ? 1 : 0) +
    SIM_WEIGHTS.brand * (sameBrand ? 1 : 0) +
    SIM_WEIGHTS.flavor * jaccard(a.flavorTokens, b.flavorTokens) +
    SIM_WEIGHTS.tier * (1 - Math.abs(a.priceTier - b.priceTier) / PRICE_TIER_SPAN)
  );
}
