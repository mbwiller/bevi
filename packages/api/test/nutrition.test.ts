import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNutritionApi, parseNutrition } from '../src/nutrition';

afterEach(() => vi.unstubAllGlobals());
describe('barcode nutrition', () => {
  it('preserves zero and unknown nutrients, converts normalized sodium grams to mg', () => {
    const result = parseNutrition('012345678901', { product: { product_name: 'Water', nutriments: { 'energy-kcal_100g': 0, sodium_100g: 0.004, sugars_100g: -1 } } });
    expect(result).toMatchObject({ calories: 0, sugarGrams: null, proteinGrams: null, sodiumMg: 4, basis: 'Per 100 g / 100 ml (as listed)' });
  });
  it('uses a labeled serving consistently without mixing in per-100 values', () => {
    const result = parseNutrition('012345678901', { product: { serving_size: '355 ml', nutriments: { 'energy-kcal_serving': 150, sugars_100g: 11, sugars_serving: 39, fat_100g: 0 } } });
    expect(result).toMatchObject({ calories: 150, sugarGrams: 39, fatGrams: null, basis: 'Per serving (355 ml)' });
  });
  it.each([null, {}, { product: {} }, { product: { nutriments: {} } }, { product: { nutriments: { sugars_100g: '12' } } }])('handles missing or malformed nutrition: %j', (data) => {
    expect(parseNutrition('012345678901', data)).toBeNull();
  });
  it('rejects invalid barcodes without sending a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createNutritionApi().lookupBarcode('https://example.com')).rejects.toMatchObject({ code: 'validation' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns null for a product not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    expect(await createNutritionApi().lookupBarcode('012345678901')).toBeNull();
  });
  it('reports provider errors separately from missing products', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, ok: false }));
    await expect(createNutritionApi().lookupBarcode('012345678901')).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
