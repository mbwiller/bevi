import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NutritionPreview } from '@bevi/shared';
import { isApiError } from '@bevi/shared';
import { createNutritionApi, parseNutrition, parseProduct } from '../src/nutrition';
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

// The products below are Open Food Facts responses as served on 2026-11-20,
// cut down to the fields the lookup asks for.
describe('barcode product, for filling in a new Bev', () => {
  const tags = (...ids: string[]) => ['en:beverages-and-beverages-preparations', 'en:beverages', ...ids];
  const product = (p: Record<string, unknown>) => parseProduct('012345678901', { product: p });

  it('returns the name, the first brand, the mapped category and the nutrition together', () => {
    expect(product({
      product_name: ' Coca Cola ', brands: 'Coca-Cola, Coca-Cola Original Taste', serving_size: '355 ml',
      categories_tags: tags('en:non-alcoholic-beverages', 'en:carbonated-drinks', 'en:soft-drinks', 'en:sodas', 'en:colas', 'en:sweetened-beverages'),
      nutriments: { 'energy-kcal_serving': 140, sugars_serving: 39 },
    })).toEqual({
      barcode: '012345678901', name: 'Coca Cola', brand: 'Coca-Cola', categoryId: 'soda',
      nutrition: expect.objectContaining({ productName: 'Coca Cola', calories: 140, sugarGrams: 39, basis: 'Per serving (355 ml)' }),
    });
  });
  it('still returns a product that lists no nutrition', () => {
    expect(product({ product_name: 'Budweiser 12 Pack Bottles', brands: 'Budweiser', categories_tags: [] }))
      .toEqual({ barcode: '012345678901', name: 'Budweiser 12 Pack Bottles', brand: 'Budweiser', categoryId: null, nutrition: null });
  });
  it.each([null, {}, { product: null }, { product: {} }, { product: { product_name: '  ', brands: '', categories_tags: ['en:beverages'] } }])(
    'is null when nothing usable is listed: %j',
    (data) => expect(parseProduct('012345678901', data)).toBeNull(),
  );
  it.each<[string, string[], string | null]>([
    // An energy drink is a soda to OFF as well; a sports drink is a diet beverage; a kombucha is a tea.
    ['Energy Drink', tags('en:soft-drinks', 'en:sodas', 'en:functional-drinks', 'en:energy-drinks'), 'energy'],
    ['Thirst Quencher', tags('en:artificially-sweetened-beverages', 'en:diet-beverages', 'en:dietary-drink-for-sport'), 'sports'],
    ['Gingerade Kombucha', tags('en:fermented-drinks', 'en:tea-based-beverages', 'en:kombuchas'), 'other'],
    ['Diet Cola', tags('en:sodas', 'en:colas', 'en:diet-beverages'), 'diet_soda'],
    ['Diet Cola', tags('en:sodas', 'en:diet-sodas'), 'diet_soda'],
    ['Sparkling Water', tags('en:carbonated-drinks', 'en:waters', 'en:carbonated-waters'), 'sparkling_water'],
    ['Naturally Essenced Passionfruit Sparkling Water', tags('en:waters'), 'sparkling_water'],
    ['Spring Water', tags('en:waters', 'en:spring-waters'), 'water'],
    ['Cold Brew', tags('en:coffee-drinks', 'en:iced-coffees'), 'coffee'],
    ['Green Tea', tags('en:tea-based-beverages', 'en:iced-teas'), 'tea'],
    ['Orange Juice', tags('en:plant-based-beverages', 'en:juices-and-nectars', 'en:fruit-juices'), 'juice'],
    ['Mango Smoothie', tags('en:plant-based-beverages', 'en:smoothies'), 'smoothie'],
    ['Lager', tags('en:alcoholic-beverages', 'en:beers'), 'beer'],
    ['Hard Seltzer', tags('en:alcoholic-beverages', 'en:hard-seltzers'), 'beer'],
    ['Pinot Noir', tags('en:alcoholic-beverages', 'en:wines'), 'wine'],
    ['Bourbon', tags('en:alcoholic-beverages', 'en:distilled-beverages', 'en:hard-liquors'), 'spirits_cocktails'],
    ['Oat Drink', tags('en:plant-based-beverages'), null],
  ])('files %s under the category its tags name: %j -> %s', (name, categories_tags, categoryId) => {
    expect(product({ product_name: name, categories_tags })?.categoryId ?? null).toBe(categoryId);
  });
  it('never files alcohol under a soft-drink category it is also tagged as', () => {
    expect(product({ product_name: 'Hard Iced Tea', categories_tags: tags('en:alcoholic-beverages', 'en:tea-based-beverages', 'en:iced-teas') }))
      .toMatchObject({ name: 'Hard Iced Tea', categoryId: null });
    expect(product({ product_name: 'Dry Cider', categories_tags: tags('en:alcoholic-beverages', 'en:ciders') })).toMatchObject({ categoryId: null });
  });
  it('reads alcohol from the tag itself when the alcoholic-beverages ancestor is missing', () => {
    expect(product({ product_name: 'Hard Iced Tea', categories_tags: tags('en:hard-teas', 'en:iced-teas') })).toMatchObject({ categoryId: null });
    expect(product({ product_name: 'Spiked Energy', categories_tags: tags('en:alcoholic-energy-drinks', 'en:energy-drinks') }))
      .toMatchObject({ categoryId: null });
    expect(product({ product_name: 'Dry Cider', categories_tags: tags('en:ciders', 'en:fruit-juices') })).toMatchObject({ categoryId: null });
    // Without the ancestor an alcoholic category still maps, and a soft drink's own "non-alcoholic" tag is not alcohol.
    expect(product({ product_name: 'Hard Seltzer', categories_tags: tags('en:hard-seltzers') })).toMatchObject({ categoryId: 'beer' });
    expect(product({ product_name: 'Cola', categories_tags: tags('en:non-alcoholic-beverages', 'en:sodas') })).toMatchObject({ categoryId: 'soda' });
    expect(product({ product_name: 'Iced Tea', categories_tags: tags('en:alcohol-free-drinks', 'en:iced-teas') })).toMatchObject({ categoryId: 'tea' });
  });
  it('drops zero-width and direction-override characters, and a name that is only those is no name', () => {
    expect(product({ product_name: 'Co\u200Bla\u202E Zero', brands: '\u200B' })).toMatchObject({ name: 'Cola Zero', brand: null });
    expect(product({ product_name: '\u200B\u2060', brands: 'Acme' })).toMatchObject({ name: null, brand: 'Acme' });
  });
  it('puts a shouted name or brand in title case and keeps the provider\'s own mixed case', () => {
    expect(product({ product_name: 'ORIGINAL  ROCKSTAR ENERGY DRINK', brands: 'GATORADE' })).toMatchObject({ name: 'Original Rockstar Energy Drink', brand: 'Gatorade' });
    expect(product({ product_name: "GT'S SYNERGY (RAW)", brands: 'La Croix, LaCroix' })).toMatchObject({ name: "Gt's Synergy (Raw)", brand: 'La Croix' });
    expect(product({ product_name: 'LaCroix Pamplemousse', brands: 'V8' })).toMatchObject({ name: 'LaCroix Pamplemousse', brand: 'V8' });
  });
  it('title-cases beyond ASCII and after punctuation, not only after a space', () => {
    expect(product({ product_name: 'ÉVIAN NATURAL WATER', brands: 'S.PELLEGRINO' })).toMatchObject({ name: 'Évian Natural Water', brand: 'S.Pellegrino' });
    expect(product({ product_name: 'MONSTER ENERGY+JUICE "ZERO"', brands: '7UP ZERO' })).toMatchObject({ name: 'Monster Energy+Juice "Zero"', brand: '7up Zero' });
  });
  it('cuts a name to the length a Bev name allows, by character and never through an emoji', () => {
    expect(product({ product_name: 'x'.repeat(200) })?.name).toHaveLength(80);
    const name = product({ product_name: 'x'.repeat(79) + '🥤🥤' })!.name!;
    expect(Array.from(name)).toHaveLength(80);
    expect(name.endsWith('🥤')).toBe(true);
  });
  it('drops control characters and takes the first brand that is not empty', () => {
    expect(product({ product_name: 'Pepsi\u0000Max\n Cherry', brands: ' , Pepsi, PepsiCo' })).toMatchObject({ name: 'Pepsi Max Cherry', brand: 'Pepsi' });
    expect(product({ brands: ' , ' })).toBeNull();
  });
  it('does not read "non-carbonated" as sparkling', () => {
    expect(product({ product_name: 'Non-Carbonated Spring Water', categories_tags: tags('en:waters') })?.categoryId).toBe('water');
  });
  it('ignores fields of the wrong type instead of failing the lookup', () => {
    expect(product({ product_name: 42, brands: ['Pepsi'], categories_tags: 'en:sodas', nutriments: { sugars_100g: 11 } }))
      .toMatchObject({ name: null, brand: null, categoryId: null, nutrition: { sugarGrams: 11 } });
  });
});

describe('nutrition.lookupProduct', () => {
  it('asks the provider once, for the product fields and the nutrition', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ product: { product_name: 'Pepsi', brands: 'Pepsi', categories_tags: ['en:sodas'] } }) });
    vi.stubGlobal('fetch', fetch);
    expect(await createNutritionApi().lookupProduct('012000001291')).toEqual({ barcode: '012000001291', name: 'Pepsi', brand: 'Pepsi', categoryId: 'soda', nutrition: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/v2/product/012000001291.json');
    expect(url.searchParams.get('fields')!.split(',')).toEqual(expect.arrayContaining(['product_name', 'brands', 'categories_tags', 'serving_size', 'nutriments']));
  });
  it('leaves lookupBarcode asking for exactly what it asked for before', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ product: { product_name: 'Pepsi', nutriments: { sugars_100g: 11 } } }) });
    vi.stubGlobal('fetch', fetch);
    expect(await createNutritionApi().lookupBarcode('012000001291')).toMatchObject({ productName: 'Pepsi', sugarGrams: 11 });
    expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get('fields')).toBe('product_name,serving_size,nutriments');
  });
  it('rejects an invalid barcode without sending a request, and reads a missing product as null', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 404 }); vi.stubGlobal('fetch', fetch);
    await expect(createNutritionApi().lookupProduct('12345')).rejects.toMatchObject({ code: 'validation' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await createNutritionApi().lookupProduct('012345678901')).toBeNull();
  });
  it('keeps a rate limit and an outage apart from a missing product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, ok: false }));
    await expect(createNutritionApi().lookupProduct('012345678901')).rejects.toMatchObject({ code: 'rate_limited' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(createNutritionApi().lookupProduct('012345678901')).rejects.toMatchObject({ code: 'network' });
  });
  it('stops the request when the caller aborts', async () => {
    const fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = createNutritionApi().lookupProduct('012345678901', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
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
      else if (name === 'get_bev_nutrition') result = { data: stored, error: null };
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
    expect(names).toEqual(['create_bev', 'get_bev', 'get_bev_nutrition']);
    expect(calls[0]?.args).not.toHaveProperty('p_nutrition');
  });

  it.each([['an Open Food Facts', OFF_SNAPSHOT], ['a label-ocr', OCR_SNAPSHOT]] as const)(
    'sends %s snapshot through create_bev_with_nutrition_v2', async (_label, nutrition) => {
      const { created, names, calls } = await create(nutrition, []);
      expect(names).toEqual(['create_bev_with_nutrition_v2', 'get_bev', 'get_bev_nutrition']);
      expect(calls[0]?.args).toMatchObject({ p_nutrition: nutrition });
      expect(created.nutrition).toEqual(nutrition);
    });

  it('falls back to v1 for an Open Food Facts snapshot when v2 is not deployed yet', async () => {
    const { created, names, calls } = await create(OFF_SNAPSHOT, ['create_bev_with_nutrition_v2']);
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev_with_nutrition', 'get_bev', 'get_bev_nutrition']);
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
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev', 'get_bev', 'get_bev_nutrition']);
    expect(names).not.toContain('create_bev_with_nutrition');
    expect(calls[1]?.args).not.toHaveProperty('p_nutrition');
    expect(created.id).toBe(id);
    expect(created.nutrition).toBeNull();
  });

  it('drops an Open Food Facts snapshot when neither nutrition RPC is deployed', async () => {
    const { created, names, calls } = await create(OFF_SNAPSHOT, ['create_bev_with_nutrition_v2', 'create_bev_with_nutrition']);
    expect(names).toEqual(['create_bev_with_nutrition_v2', 'create_bev_with_nutrition', 'create_bev', 'get_bev', 'get_bev_nutrition']);
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

// `readNutrition` (bevs.ts) reads get_bev_nutrition, steps down to the table
// on a backend without it, and tolerates a bev_nutrition table that is not
// there yet, so Bev detail keeps rendering if the app deploys before
// `supabase db push` runs. It is the only thing protecting that window, so
// every rung is pinned here: the missing codes pass, anything else surfaces.
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

  type Result = { data: unknown; error: { code: string; message: string } | null };
  const NO_FUNCTION: Result = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
  const clientWith = (nutritionResult: Result, viaRpc: Result = NO_FUNCTION, tables: string[] = []) => {
    const rpc = (name: string) => {
      const promise = Promise.resolve(name === 'get_bev_nutrition' ? viaRpc : { data: bevRow, error: null });
      return Object.assign(promise, { single: () => promise, maybeSingle: () => promise });
    };
    const from = (table: string) => {
      tables.push(table);
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

  it('reads a label reading through get_bev_nutrition, never the table, once it exists', async () => {
    const tables: string[] = [];
    const api = createBevsApi(clientWith({ data: null, error: null }, { data: OCR_SNAPSHOT, error: null }, tables), snapshots);
    const bev = await api.get(id);
    expect(bev.nutrition).toEqual(OCR_SNAPSHOT);
    expect(tables).not.toContain('bev_nutrition');
  });

  it('steps down to the table only on a missing function', async () => {
    const tables: string[] = [];
    const api = createBevsApi(clientWith({ data: { nutrition: OFF_SNAPSHOT }, error: null }, NO_FUNCTION, tables), snapshots);
    expect((await api.get(id)).nutrition).toEqual(OFF_SNAPSHOT);
    expect(tables).toContain('bev_nutrition');
    const refused = createBevsApi(clientWith({ data: null, error: null }, { data: null, error: { code: '42501', message: 'permission denied' } }), snapshots);
    await expect(refused.get(id)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// --------------------------------------------------------------------------
// Reading back a snapshot written before contract 3.10.0 added `source`.
// Those rows are stored jsonb and nothing rewrites them, so the mapping
// boundary is the only place that can make them legal `NutritionPreview`s.
// --------------------------------------------------------------------------

describe('mapNutrition', () => {
  // Exactly the jsonb a Bev created before 3.10.0 holds: an Open Food Facts
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

  it('uses the fallback source a caller passes for a sourceless snapshot', () => {
    expect(mapNutrition(stored, 'label-ocr')).toMatchObject({ source: 'label-ocr' });
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
  // A backend from before get_bev_nutrition: the table holds the old row.
  const rpc = (name: string) => {
    const promise = Promise.resolve(name === 'get_bev_nutrition'
      ? { data: null, error: { code: 'PGRST202', message: 'function not found' } }
      : { data: bevRow, error: null });
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
