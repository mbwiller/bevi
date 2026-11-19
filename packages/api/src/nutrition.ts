import { ApiError, type NutritionApi, type NutritionPreview } from '@bevi/shared';

const FIELDS = 'product_name,serving_size,nutriments';
const NUTRIENTS = ['energy-kcal', 'fat', 'carbohydrates', 'sugars', 'proteins', 'sodium'];
// This is the one call that does not go through the supabase client, so
// `net.ts`'s deadline does not cover it; it keeps its own, slightly shorter
// one -- Open Food Facts is a third party and a slow lookup has a cheap
// fallback (upload a label photo).
const TIMEOUT_MS = 12000;
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;

/** OFF normalized nutrient fields use grams, including sodium. Never turn missing values into 0. */
export function parseNutrition(barcode: string, data: unknown): NutritionPreview | null {
  if (!data || typeof data !== 'object') return null;
  const product = (data as { product?: unknown }).product;
  if (!product || typeof product !== 'object') return null;
  const p = product as Record<string, unknown>;
  if (!p.nutriments || typeof p.nutriments !== 'object') return null;
  const n = p.nutriments as Record<string, unknown>;
  const serving = typeof p.serving_size === 'string' && p.serving_size.trim() && NUTRIENTS.some((key) => number(n[key + '_serving']) !== null);
  const suffix = serving ? '_serving' : '_100g';
  const get = (key: string) => number(n[key + suffix]);
  const sodium = get('sodium');
  const result: NutritionPreview = {
    barcode,
    productName: typeof p.product_name === 'string' && p.product_name.trim() ? p.product_name.trim().slice(0, 256) : 'Scanned Bev',
    basis: serving ? `Per serving (${String(p.serving_size).trim().slice(0, 220)})` : 'Per 100 g / 100 ml (as listed)',
    calories: get('energy-kcal'), fatGrams: get('fat'), carbohydrateGrams: get('carbohydrates'),
    sugarGrams: get('sugars'), proteinGrams: get('proteins'), sodiumMg: sodium === null ? null : number(sodium * 1000),
    sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
    source: 'openfoodfacts',
  };
  return [result.calories, result.fatGrams, result.carbohydrateGrams, result.sugarGrams, result.proteinGrams, result.sodiumMg]
    .some((v) => v !== null) ? result : null;
}

export function createNutritionApi(): NutritionApi {
  return {
    async lookupBarcode(barcode, signal) {
      if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)) throw new ApiError('validation', 'Enter an 8, 12 or 13 digit barcode.');
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timeout = setTimeout(cancel, TIMEOUT_MS);
      try {
        // Browser clients identify themselves using a query parameter, not a forbidden User-Agent header.
        const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${FIELDS}&user_agent=Bevi/1.0%20(https%3A%2F%2Fgithub.com%2Fmbwiller%2Fbevi)`;
        const response = await fetch(url, { signal: abort.signal });
        if (response.status === 404) return null;
        if (response.status === 429) throw new ApiError('rate_limited', 'Too many lookups. Wait a minute or upload a label photo.');
        if (!response.ok) throw new Error(`Lookup returned ${response.status}`);
        return parseNutrition(barcode, await response.json());
      } catch (error) {
        if (signal?.aborted || error instanceof ApiError) throw error;
        throw new ApiError('network', 'Nutrition lookup unavailable. Try again or upload a label photo.');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
