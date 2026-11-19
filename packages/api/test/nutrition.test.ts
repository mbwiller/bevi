import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NutritionPreview } from '@bevi/shared';
import { isApiError } from '@bevi/shared';
import { createNutritionApi, parseNutrition } from '../src/nutrition';
import { createBevsApi } from '../src/bevs';
import { mapNutrition } from '../src/mappers';
import type { SnapshotCache } from '../src/snapshot';

/** `lookupBarcode` never touches the client; `scanLabel`'s own tests build a real stub. */

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

// --------------------------------------------------------------------------
// bevs.create picks the RPC by what the snapshot's `source` is, and steps down
// one rung at a time on PGRST202 ("no such function"). The staged rollout is
// the whole point: the SQL lands by hand after the deploy, so every rung has
// to be exercised here.
// --------------------------------------------------------------------------

const OFF_SNAPSHOT: NutritionPreview = {
  barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
  calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
  sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901', source: 'openfoodfacts',
};

const OCR_SNAPSHOT: NutritionPreview = {
  barcode: null, productName: 'Mountain Dew', basis: 'Per serving (12 fl oz (355 mL))',
  calories: 170, fatGrams: 0, carbohydrateGrams: 46, sugarGrams: 46,
  proteinGrams: null, sodiumMg: 60, sourceUrl: null, source: 'label-ocr',
};

describe('bevs.create', () => {
  const id = '00000000-0000-4000-8000-00000000b001';
  const bevRow = {
    id, name: 'Test water', brand: null, flavor: null, category_id: 'water', photo_path: null,
    nutrition_label_path: null, price_tier: 2, price_estimated: false, status: 'pending_photo',
    is_starter: false, created_at: '2026-11-16T00:00:00.000Z', created_by_id: null,
    created_by_handle: null, rating_count: 0, avg_score: null, score_stddev: null, bayes_score: null,
  };
  /** The only keys `create_bev_with_nutrition` (v1) accepts. `source` is not one. */
  const V1_KEYS = ['barcode', 'productName', 'basis', 'sourceUrl', 'calories', 'fatGrams',
    'carbohydrateGrams', 'sugarGrams', 'proteinGrams', 'sodiumMg'];

  const snapshots: SnapshotCache = { get: async () => { throw new Error('not needed'); }, invalidate: () => undefined };

  /**
   * `missing` names the RPCs this backend does not have yet; they answer
   * PGRST202, exactly as PostgREST does for an unknown function. Whatever
   * `p_nutrition` the RPC that succeeded was given is what `get_bev`'s
   * `bev_nutrition` read then returns, so a dropped snapshot is visible on the
   * created Bev and not just in the call log.
   */
  async function create(nutrition: NutritionPreview | undefined, missing: string[]) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let stored: unknown = null;
    const rpc = (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      let result: { data: unknown; error: { code: string; message: string } | null };
      if (name === 'get_bev') result = { data: bevRow, error: null };
      else if (missing.includes(name)) result = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
      else if (name === 'create_bev_with_nutrition' && args.p_nutrition
               && Object.keys(args.p_nutrition as object).some((k) => !V1_KEYS.includes(k))) {
        // v1's own guard (20261115214237): any key outside its ten raises
        // BEVI_VALIDATION, which is NOT PGRST202, so the ladder stops here.
        result = { data: null, error: { code: '22023', message: 'BEVI_VALIDATION' } };
      } else {
        stored = args.p_nutrition ?? null;
        result = { data: { id }, error: null };
      }
      const promise = Promise.resolve(result);
      return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
    };
    const from = (table: string) => {
      const result = table === 'bev_nutrition'
        ? { data: stored ? { nutrition: stored } : null, error: null }
        : { data: table === 'follows' ? [] : null, error: null };
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
    const created = await createBevsApi(client, snapshots).create({
      name: 'Test water', categoryId: 'water', priceTier: 2, priceEstimated: false, photoAssetId: 'asset', nutrition,
    });
    return { created, calls, names: calls.map((call) => call.name) };
  }

  it('asks for plain create_bev when there is no snapshot', async () => {
    const { names, calls } = await create(undefined, []);
    expect(names).toEqual(['create_bev', 'get_bev']);
    expect(calls[0]?.args).not.toHaveProperty('p_nutrition');
  });

  it.each([['an Open Food Facts', OFF_SNAPSHOT], ['a label-ocr', OCR_SNAPSHOT]] as const)(
    'sends %s snapshot through create_bev_with_nutrition_v2', async (_label, nutrition) => {
      const { created, names, calls } = await create(nutrition, []);
      expect(names).toEqual(['create_bev_with_nutrition_v2', 'get_bev']);
      expect(calls[0]?.args).toMatchObject({ p_nutrition: nutrition });
      expect(created.nutrition).toEqual(nutrition);
    });

  it('falls back to v1 for an Open Food Facts snapshot when v2 is not deployed yet', async () => {
    const { created, names, calls } = await create(OFF_SNAPSHOT, ['create_bev_with_nutrition_v2']);
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev_with_nutrition', 'get_bev']);
    // Without `source`: v1 predates it and rejects any key outside its ten,
    // which would stop the ladder and fail the creation outright.
    expect(calls[1]?.args.p_nutrition).not.toHaveProperty('source');
    const { source: _dropped, ...withoutSource } = OFF_SNAPSHOT;
    expect(calls[1]?.args).toMatchObject({ p_nutrition: withoutSource });
    expect(created.nutrition).toEqual(OFF_SNAPSHOT);
  });

  // v1 requires a barcode, so offering it a label read would fail the whole
  // creation instead of degrading. Creating the Bev and saying the nutrition
  // was not saved is the behaviour the app already handles.
  it('never offers a label-ocr snapshot to v1, and creates the Bev without it', async () => {
    const { created, names, calls } = await create(OCR_SNAPSHOT, ['create_bev_with_nutrition_v2']);
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev', 'get_bev']);
    expect(names).not.toContain('create_bev_with_nutrition');
    expect(calls[1]?.args).not.toHaveProperty('p_nutrition');
    expect(created.id).toBe(id);
    expect(created.nutrition).toBeNull();
  });

  it('drops an Open Food Facts snapshot when neither nutrition RPC is deployed', async () => {
    const { created, names, calls } = await create(OFF_SNAPSHOT, ['create_bev_with_nutrition_v2', 'create_bev_with_nutrition']);
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev_with_nutrition', 'create_bev', 'get_bev']);
    expect(calls[2]?.args).not.toHaveProperty('p_nutrition');
    expect(created.id).toBe(id);
    expect(created.nutrition).toBeNull();
  });

  it('surfaces a creation failure that is not a missing function instead of retrying', async () => {
    const calls: string[] = [];
    const rpc = (name: string) => {
      calls.push(name);
      const promise = Promise.resolve({ data: null, error: { code: '23505', message: 'BEVI_DUPLICATE_BEV' } });
      return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    } as unknown as SupabaseClient;
    await expect(createBevsApi(client, snapshots).create({
      name: 'Test water', categoryId: 'water', priceTier: 2, priceEstimated: false, photoAssetId: 'asset', nutrition: OCR_SNAPSHOT,
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(calls).toEqual(['create_bev_with_nutrition_v2']);
  });
});

// bevs.ts:154 tolerates a bev_nutrition table that is not there yet, so Bev
// detail keeps rendering if the app deploys before `supabase db push` runs.
// It is the only thing protecting that window, so both halves are pinned here:
// the two "no such table" codes pass, anything else still surfaces.
describe('bevs.get before the nutrition migration is pushed', () => {
  const id = '00000000-0000-4000-8000-00000000b002';
  const bevRow = {
    id, name: 'Test water', brand: null, flavor: null, category_id: 'water', photo_path: null,
    nutrition_label_path: null, price_tier: 2, price_estimated: false, status: 'active',
    is_starter: false, created_at: '2026-11-16T00:00:00.000Z', created_by_id: null,
    created_by_handle: null, rating_count: 0, avg_score: null, score_stddev: null, bayes_score: null,
  };
  /** The only keys `create_bev_with_nutrition` (v1) accepts. `source` is not one. */
  const V1_KEYS = ['barcode', 'productName', 'basis', 'sourceUrl', 'calories', 'fatGrams',
    'carbohydrateGrams', 'sugarGrams', 'proteinGrams', 'sodiumMg'];

  const snapshots: SnapshotCache = { get: async () => { throw new Error('not needed'); }, invalidate: () => undefined };

  const clientWith = (nutritionResult: { data: unknown; error: { code: string; message: string } | null }) => {
    const rpc = () => {
      const promise = Promise.resolve({ data: bevRow, error: null });
      return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
    };
    const from = (table: string) => {
      const result = table === 'bev_nutrition' ? nutritionResult : { data: table === 'follows' ? [] : null, error: null };
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.in = () => query;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      return query;
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc,
      from,
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    } as unknown as SupabaseClient;
  };

  it.each(['PGRST205', '42P01'])('renders Bev detail with no nutrition when the table is absent (%s)', async (code) => {
    const api = createBevsApi(clientWith({ data: null, error: { code, message: 'relation "bev_nutrition" does not exist' } }), snapshots);
    const bev = await api.get(id);
    expect(bev.id).toBe(id);
    expect(bev.nutrition).toBeNull();
  });

  it('still surfaces a nutrition read failure that is not a missing table', async () => {
    const api = createBevsApi(clientWith({ data: null, error: { code: '42501', message: 'permission denied for table bev_nutrition' } }), snapshots);
    await expect(api.get(id)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// --------------------------------------------------------------------------
// Reading back a snapshot written before contract 3.1.0 added `source`.
// Those rows are stored jsonb and nothing rewrites them, so the mapping
// boundary is the only place that can make them legal `NutritionPreview`s.
// --------------------------------------------------------------------------

describe('mapNutrition', () => {
  // Exactly the jsonb a Bev created before 3.1.0 holds: an Open Food Facts
  // match, with no `source` key at all.
  const stored = {
    barcode: '012345678901', productName: 'Test water', basis: 'Per serving (355 ml)',
    calories: 0, fatGrams: null, carbohydrateGrams: 0, sugarGrams: 0, proteinGrams: null,
    sodiumMg: 4, sourceUrl: 'https://world.openfoodfacts.org/product/012345678901',
  };

  it('defaults a sourceless snapshot to openfoodfacts', () => {
    expect(mapNutrition(stored)).toEqual({ ...stored, source: 'openfoodfacts' });
  });

  it('leaves a snapshot that names its source alone', () => {
    expect(mapNutrition(OCR_SNAPSHOT)).toEqual(OCR_SNAPSHOT);
    expect(mapNutrition(OFF_SNAPSHOT)).toEqual(OFF_SNAPSHOT);
  });

  it('fills a barcode and a source URL that were never written', () => {
    const { barcode: _b, sourceUrl: _u, ...withoutEither } = stored;
    expect(mapNutrition(withoutEither)).toMatchObject({ barcode: null, sourceUrl: null, source: 'openfoodfacts' });
  });

  it('answers null for a Bev with no snapshot', () => {
    expect(mapNutrition(null)).toBeNull();
    expect(mapNutrition(undefined)).toBeNull();
  });
});

it('reads an older stored snapshot back off bevs.get as an Open Food Facts one', async () => {
  const id = '00000000-0000-4000-8000-00000000b003';
  const stored = { ...OFF_SNAPSHOT } as Record<string, unknown>;
  delete stored.source;
  const bevRow = {
    id, name: 'Test water', brand: null, flavor: null, category_id: 'water', photo_path: null,
    nutrition_label_path: null, price_tier: 2, price_estimated: false, status: 'active',
    is_starter: false, created_at: '2026-11-16T00:00:00.000Z', created_by_id: null,
    created_by_handle: null, rating_count: 0, avg_score: null, score_stddev: null, bayes_score: null,
  };
  const rpc = () => {
    const promise = Promise.resolve({ data: bevRow, error: null });
    return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
  };
  const from = (table: string) => {
    const result = table === 'bev_nutrition'
      ? { data: { nutrition: stored }, error: null }
      : { data: table === 'follows' ? [] : null, error: null };
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
  /** The only keys `create_bev_with_nutrition` (v1) accepts. `source` is not one. */
  const V1_KEYS = ['barcode', 'productName', 'basis', 'sourceUrl', 'calories', 'fatGrams',
    'carbohydrateGrams', 'sugarGrams', 'proteinGrams', 'sodiumMg'];

  const snapshots: SnapshotCache = { get: async () => { throw new Error('not needed'); }, invalidate: () => undefined };

  const bev = await createBevsApi(client, snapshots).get(id);
  expect(bev.nutrition).toEqual(OFF_SNAPSHOT);
});
