import { ApiError, type BarcodeProduct, type CategoryId, type NutritionApi, type NutritionPreview } from '@bevi/shared';

const NUTRITION_FIELDS = 'product_name,serving_size,nutriments';
const PRODUCT_FIELDS = `${NUTRITION_FIELDS},brands,categories_tags`;
const NUTRIENTS = ['energy-kcal', 'fat', 'carbohydrates', 'sugars', 'proteins', 'sodium'];
// This is the one call that does not go through the supabase client, so
// `net.ts`'s deadline does not cover it; it keeps its own, slightly shorter
// one -- Open Food Facts is a third party and a slow lookup has a cheap
// fallback (upload a label photo).
const TIMEOUT_MS = 12000;
/** `bevs.name` and `bevs.brand` are both checked at 80 characters (20261009000300). */
const TEXT_MAX = 80;
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
  };
  return [result.calories, result.fatGrams, result.carbohydrateGrams, result.sugarGrams, result.proteinGrams, result.sodiumMg]
    .some((v) => v !== null) ? result : null;
}

/**
 * OFF category tags to a Bevi category, first match wins, so the order is the
 * rule: an energy drink is also tagged `en:sodas`, a sports drink
 * `en:diet-beverages`, a kombucha `en:tea-based-beverages`, and a carbonated
 * water `en:waters`. Tag ids are OFF's categories taxonomy; a product usually
 * carries its ancestors too, but not always (a sports drink can have
 * `en:dietary-drink-for-sport` without `en:sports-drinks`), so both are named
 * where it matters. Hard seltzer and cider come before beer, which a seltzer
 * can also be tagged. Where the catalog has a convention it is followed:
 * kombucha under other, lemonade under juice
 * (`data/catalog/bevs.csv`). OFF has no tag for boba.
 */
const CATEGORY_RULES: ReadonlyArray<readonly [CategoryId, readonly string[]]> = [
  ['hard_seltzer', ['en:hard-seltzers']],
  ['cider', ['en:ciders']],
  ['beer', ['en:beers']],
  ['wine', ['en:wines']],
  ['spirits_cocktails', ['en:distilled-beverages', 'en:hard-liquors', 'en:liqueurs', 'en:alcoholic-cocktails']],
  ['energy', ['en:energy-drinks']],
  ['sports', ['en:sports-drinks', 'en:dietary-drink-for-sport']],
  ['diet_soda', ['en:diet-sodas']],
  ['soda', ['en:sodas']],
  ['sparkling_water', ['en:carbonated-waters', 'en:flavored-sparkling-waters']],
  ['water', ['en:waters']],
  ['coffee', ['en:coffee-drinks', 'en:iced-coffees', 'en:coffees']],
  ['other', ['en:kombuchas']],
  ['tea', ['en:tea-based-beverages', 'en:iced-teas', 'en:teas']],
  ['smoothie', ['en:smoothies']],
  ['juice', ['en:juices-and-nectars', 'en:fruit-juices', 'en:lemonades']],
];

/**
 * A tag that says the product is alcohol. The ancestor `en:alcoholic-beverages`
 * is usually there but not always, so the guard below also reads the tag's own
 * words: `en:hard-teas`, `en:alcoholic-energy-drinks`, `en:ciders`. It errs
 * towards saying yes (an American apple cider is not alcohol): the cost of a
 * wrong yes is a category the person picks by hand, the cost of a wrong no is
 * alcohol filed as a soft drink.
 */
const ALCOHOL_TAG = /(^|[:-])(alcoholic|hard)-|(^|[:-])(ciders?|meads?|sakes?|alcopops?)$/;
const NOT_ALCOHOL_TAG = /non-alcoholic|alcohol-free/;
const saysAlcohol = (tag: unknown): boolean => typeof tag === 'string' && ALCOHOL_TAG.test(tag) && !NOT_ALCOHOL_TAG.test(tag);

/** The Bevi category a product's OFF tags name, or null: an unmapped product is left for the person to file. */
function categoryFor(tags: unknown, name: string | null): CategoryId | null {
  if (!Array.isArray(tags)) return null;
  const has = (tag: string) => tags.includes(tag);
  const match = CATEGORY_RULES.find(([, any]) => any.some(has))?.[0] ?? null;
  // Alcohol that is in none of the alcoholic categories (a hard tea, a mead) has no
  // Bevi category to map to. Falling through would file it as the soft drink
  // it is also tagged as, in front of people who cannot see alcohol.
  const alcoholic = match === 'beer' || match === 'wine' || match === 'spirits_cocktails' || match === 'hard_seltzer' || match === 'cider';
  if (tags.some(saysAlcohol) && !alcoholic) return null;
  if (match === 'soda' && has('en:diet-beverages')) return 'diet_soda';
  // Many sparkling waters are only tagged `en:waters`; the name says which.
  if (match === 'water' && name && /sparkling|seltzer|carbonated/i.test(name) && !/non[- ]?carbonated/i.test(name)) return 'sparkling_water';
  return match;
}

/**
 * A provider string as a Bev field: control characters and runs of whitespace
 * collapsed to one space, cut to the column's length, and a shouted one
 * ("THIRST QUENCHER") put in title case. Mixed case is the provider's own
 * spelling ("LaCroix", "GT's") and is kept. Letters are Unicode letters: a
 * product database is not all ASCII ("ÉVIAN").
 */
const INVISIBLE = /[\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Format characters first (zero-width, direction overrides): invisible in a form field, and a
  // direction override reorders the text around it. U+200D stays, an emoji sequence needs it.
  const clean = value.replace(INVISIBLE, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  if (!clean) return null;
  const shouted = clean === clean.toUpperCase() && clean !== clean.toLowerCase() && (clean.match(/\p{L}/gu)?.length ?? 0) > 3;
  // A word starts after anything that is not a letter, a digit or an apostrophe ("GT'S" is one word, "7UP" too).
  const cased = shouted ? clean.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{Ll})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase()) : clean;
  // By code point, as Postgres counts: a UTF-16 slice could leave half an emoji.
  return Array.from(cased).slice(0, TEXT_MAX).join('').trim();
}

/** The product an OFF response describes, or null when it lists nothing a new Bev could use. */
export function parseProduct(barcode: string, data: unknown): BarcodeProduct | null {
  if (!data || typeof data !== 'object') return null;
  const product = (data as { product?: unknown }).product;
  if (!product || typeof product !== 'object') return null;
  const p = product as Record<string, unknown>;
  const name = text(p.product_name);
  // `brands` is one comma-separated string, usually the label's brand first.
  const brand = typeof p.brands === 'string' ? p.brands.split(',').map(text).find((b) => b !== null) ?? null : null;
  const categoryId = categoryFor(p.categories_tags, name);
  const nutrition = parseNutrition(barcode, data);
  return name || brand || categoryId || nutrition ? { barcode, name, brand, categoryId, nutrition } : null;
}

/** The OFF response for a barcode, asking only for `fields`, or null when OFF has no such product. */
async function fetchProduct(barcode: string, fields: string, signal?: AbortSignal): Promise<unknown> {
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(barcode)) throw new ApiError('validation', 'Enter an 8, 12 or 13 digit barcode.');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, TIMEOUT_MS);
  try {
    // Browser clients identify themselves using a query parameter, not a forbidden User-Agent header.
    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}&user_agent=Bevi/1.0%20(https%3A%2F%2Fgithub.com%2Fmbwiller%2Fbevi)`;
    const response = await fetch(url, { signal: abort.signal });
    if (response.status === 404) return null;
    if (response.status === 429) throw new ApiError('rate_limited', 'Too many lookups. Wait a minute or upload a label photo.');
    if (!response.ok) throw new Error(`Lookup returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError('network', 'Nutrition lookup unavailable. Try again or upload a label photo.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export function createNutritionApi(): NutritionApi {
  return {
    async lookupBarcode(barcode, signal) {
      return parseNutrition(barcode, await fetchProduct(barcode, NUTRITION_FIELDS, signal));
    },
    async lookupProduct(barcode, signal) {
      return parseProduct(barcode, await fetchProduct(barcode, PRODUCT_FIELDS, signal));
    },
  };
}
