import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createNutritionApi, parseNutrition } from '../src/nutrition';
import { createBevsApi } from '../src/bevs';
import type { SnapshotCache } from '../src/snapshot';

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

it('rejects provider amounts outside the database bounds, including converted sodium', () => {
  const result = parseNutrition('012345678901', { product: { nutriments: {
    'energy-kcal_100g': 0, fat_100g: 1_000_001, sodium_100g: Number.MAX_VALUE,
    carbohydrates_100g: Infinity, sugars_100g: NaN,
  } } });
  expect(result).toMatchObject({ calories: 0, fatGrams: null, sodiumMg: null, carbohydrateGrams: null, sugarGrams: null });
  expect(parseNutrition('012345678901', { product: { nutriments: { sodium_100g: 1001 } } })).toBeNull();
});
it('uses a labeled serving when calories are missing but another serving nutrient exists', () => {
  expect(parseNutrition('012345678901', { product: { serving_size: '250 ml', nutriments: { sugars_serving: 12, sugars_100g: 4.8 } } }))
    .toMatchObject({ basis: 'Per serving (250 ml)', calories: null, sugarGrams: 12 });
});

it('retries Bev creation without nutrition if the nutrition RPC is not deployed yet', async () => {
  const nutrition = {
    barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
    calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
    sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901',
  };
  const id = '00000000-0000-4000-8000-00000000b001';
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const bevRow = {
    id, name: 'Test water', brand: null, flavor: null, category_id: 'water', photo_path: null,
    nutrition_label_path: null, price_tier: 2, price_estimated: false, status: 'pending_photo',
    is_starter: false, created_at: '2026-11-16T00:00:00.000Z', created_by_id: null,
    created_by_handle: null, rating_count: 0, avg_score: null, score_stddev: null, bayes_score: null,
  };
  const rpc = (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    const result = name === 'create_bev_with_nutrition'
      ? { data: null, error: { code: 'PGRST202', message: 'function not found' } }
      : name === 'create_bev' ? { data: { id }, error: null } : { data: bevRow, error: null };
    const promise = Promise.resolve(result);
    return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
  };
  const from = (table: string) => {
    const result = { data: table === 'follows' ? [] : null, error: null };
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    query.in = () => query;
    query.maybeSingle = async () => result;
    query.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return query;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc,
    from,
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  } as unknown as SupabaseClient;
  const snapshots: SnapshotCache = { get: async () => { throw new Error('not needed'); }, invalidate: () => undefined };
  const api = createBevsApi(client, snapshots);

  const created = await api.create({ name: 'Test water', categoryId: 'water', priceTier: 2, priceEstimated: false, photoAssetId: 'asset', nutrition });

  expect(created.id).toBe(id);
  expect(created.nutrition).toBeNull();
  expect(rpcCalls.map((call) => call.name)).toEqual(['create_bev_with_nutrition', 'create_bev', 'get_bev']);
  expect(rpcCalls[0]?.args).toMatchObject({ p_nutrition: nutrition });
  expect(rpcCalls[1]?.args).not.toHaveProperty('p_nutrition');
});
