import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NutritionPreview } from '@bevi/shared';
import { isApiError } from '@bevi/shared';
import { createNutritionApi, parseNutrition } from '../src/nutrition';
import { createBevsApi } from '../src/bevs';
import { mapNutrition } from '../src/mappers';
import type { SnapshotCache } from '../src/snapshot';

/** `lookupBarcode` never touches the client; `scanLabel`'s own tests build a real stub. */
const noClient = {} as unknown as SupabaseClient;

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
    await expect(createNutritionApi(noClient).lookupBarcode('https://example.com')).rejects.toMatchObject({ code: 'validation' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns null for a product not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    expect(await createNutritionApi(noClient).lookupBarcode('012345678901')).toBeNull();
  });
  it('reports provider errors separately from missing products', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, ok: false }));
    await expect(createNutritionApi(noClient).lookupBarcode('012345678901')).rejects.toMatchObject({ code: 'rate_limited' });
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
      else {
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
    expect(calls[1]?.args).toMatchObject({ p_nutrition: OFF_SNAPSHOT });
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
// Reading back a snapshot written before contract 2.16.0 added `source`.
// Those rows are stored jsonb and nothing rewrites them, so the mapping
// boundary is the only place that can make them legal `NutritionPreview`s.
// --------------------------------------------------------------------------

describe('mapNutrition', () => {
  // Exactly the jsonb a Bev created before 2.16.0 holds: an Open Food Facts
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

  it('takes the fallback source the caller passes instead', () => {
    expect(mapNutrition(stored, 'label-ocr')).toMatchObject({ source: 'label-ocr' });
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
  const snapshots: SnapshotCache = { get: async () => { throw new Error('not needed'); }, invalidate: () => undefined };

  const bev = await createBevsApi(client, snapshots).get(id);
  expect(bev.nutrition).toEqual(OFF_SNAPSHOT);
});

// --------------------------------------------------------------------------
// scanLabel: the `nutrition-ocr` Edge Function's client half. What matters
// here and needs no live stack -- nothing is invoked until the input is the
// right shape, the function's own error codes become the contract's, a cancel
// stays a cancel rather than becoming a server failure, and a photo with no
// readable panel is null and not an error.
//
// The reading itself (the model, the service-role object read, the panel
// parsing) is the function's, and its tests are Deno's.
// --------------------------------------------------------------------------

const USER = { id: '00000000-0000-4000-8000-00000000000a' };
const ASSET = `${USER.id}/0d0f0a1b-5c4d-4e1f-8a2b-00000000000f.jpg`;

interface Invocation {
  name: string;
  init?: { body?: Record<string, unknown>; signal?: AbortSignal };
}

/** A `FunctionsHttpError` as supabase-js builds it: the function's body hangs off `context`. */
function httpError(status: number, body: unknown): unknown {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  };
}

/** A `FunctionsFetchError`: the request never got an answer, and `context` is the failure. */
function fetchError(cause: Error): unknown {
  return { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: cause };
}

function ocrClient(
  outcome: { data?: unknown; error?: unknown } = {},
  invokes: Invocation[] = [],
  user: { id: string } | null = USER,
): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: user ? null : { name: 'AuthError', message: 'no session', status: 401 } }),
    },
    functions: {
      // `functions.invoke` resolves with `{ data, error }` and never rejects,
      // an aborted request included (see FunctionsClient.invoke).
      invoke: async (name: string, init?: Invocation['init']) => {
        invokes.push({ name, init });
        return { data: outcome.data ?? null, error: outcome.error ?? null };
      },
    },
  } as unknown as SupabaseClient;
}

describe('nutrition.scanLabel', () => {
  it('returns the snapshot the function read, and tells it only the asset id', async () => {
    const invokes: Invocation[] = [];
    const api = createNutritionApi(ocrClient({ data: { nutrition: OCR_SNAPSHOT } }, invokes));
    expect(await api.scanLabel(ASSET)).toEqual(OCR_SNAPSHOT);
    expect(invokes).toHaveLength(1);
    expect(invokes[0]?.name).toBe('nutrition-ocr');
    expect(invokes[0]?.init?.body).toEqual({ labelAssetId: ASSET });
  });

  it('marks a snapshot the function did not label as a label read, not a barcode match', async () => {
    const { source: _s, ...sourceless } = OCR_SNAPSHOT;
    const api = createNutritionApi(ocrClient({ data: { nutrition: sourceless } }));
    expect(await api.scanLabel(ASSET)).toEqual(OCR_SNAPSHOT);
  });

  it('answers null for a photo with no panel it could read', async () => {
    expect(await createNutritionApi(ocrClient({ data: { nutrition: null } })).scanLabel(ASSET)).toBeNull();
    expect(await createNutritionApi(ocrClient({ data: {} })).scanLabel(ASSET)).toBeNull();
  });

  it('refuses an empty asset id without invoking the function', async () => {
    const invokes: Invocation[] = [];
    await expect(createNutritionApi(ocrClient({}, invokes)).scanLabel('  '))
      .rejects.toMatchObject({ code: 'validation', detail: { field: 'labelAssetId' } });
    expect(invokes).toHaveLength(0);
  });

  it('refuses to invoke the function when nobody is signed in', async () => {
    const invokes: Invocation[] = [];
    await expect(createNutritionApi(ocrClient({}, invokes, null)).scanLabel(ASSET))
      .rejects.toMatchObject({ code: 'unauthorized' });
    expect(invokes).toHaveLength(0);
  });

  it.each([
    [400, 'validation', 'validation'],
    [401, 'unauthorized', 'unauthorized'],
    [429, 'rate_limited', 'rate_limited'],
    [502, 'network', 'network'],
    [503, 'unknown', 'unknown'],
  ] as const)('maps the function error %i %s to %s, keeping its message', async (status, reported, expected) => {
    const body = { error: { code: reported, message: 'the reader said so' } };
    const api = createNutritionApi(ocrClient({ error: httpError(status, body) }));
    await expect(api.scanLabel(ASSET)).rejects.toMatchObject({ code: expected, message: 'the reader said so' });
  });

  it('names the field on a validation error, whether or not the function did', async () => {
    const named = ocrClient({ error: httpError(400, { error: { code: 'validation', message: 'not yours', field: 'labelAssetId' } }) });
    await expect(createNutritionApi(named).scanLabel(ASSET))
      .rejects.toMatchObject({ code: 'validation', detail: { field: 'labelAssetId' } });
    const unnamed = ocrClient({ error: httpError(400, { error: { code: 'validation', message: 'not yours' } }) });
    await expect(createNutritionApi(unnamed).scanLabel(ASSET))
      .rejects.toMatchObject({ code: 'validation', detail: { field: 'labelAssetId' } });
  });

  // A backend whose functions predate this work has no route to answer, and
  // the contract's word for that is 'unknown' -- never a null, which the app
  // would show as "no nutrition on this label".
  it('reads a 404 as a server that cannot do this yet', async () => {
    const api = createNutritionApi(ocrClient({ error: httpError(404, { error: { code: 'not_found' } }) }));
    await expect(api.scanLabel(ASSET)).rejects.toMatchObject({ code: 'unknown', message: /not available yet/ });
  });

  it('falls back on the status when the body is not the shape the function promises', async () => {
    const noBody = { name: 'FunctionsHttpError', message: 'boom', context: new Response('<html>502</html>', { status: 502 }) };
    await expect(createNutritionApi(ocrClient({ error: noBody })).scanLabel(ASSET)).rejects.toMatchObject({ code: 'network' });
    const oddCode = ocrClient({ error: httpError(429, { error: { code: 'too_many_reads' } }) });
    await expect(createNutritionApi(oddCode).scanLabel(ASSET)).rejects.toMatchObject({ code: 'rate_limited' });
  });

  // net.ts's FUNCTION_TIMEOUT_MS rejects with a TypeError, which functions-js
  // wraps; the app reads 'network' as "you are offline", so it has to survive
  // the wrapper.
  it('reports a request that never got an answer as the network', async () => {
    const timedOut = fetchError(new TypeError('Network request timed out after 150000 ms'));
    await expect(createNutritionApi(ocrClient({ error: timedOut })).scanLabel(ASSET)).rejects.toMatchObject({ code: 'network' });
    const failed = fetchError(new TypeError('fetch failed'));
    await expect(createNutritionApi(ocrClient({ error: failed })).scanLabel(ASSET)).rejects.toMatchObject({ code: 'network' });
  });

  it('hands the caller signal to the function call', async () => {
    const invokes: Invocation[] = [];
    const controller = new AbortController();
    await createNutritionApi(ocrClient({ data: { nutrition: OCR_SNAPSHOT } }, invokes)).scanLabel(ASSET, controller.signal);
    expect(invokes[0]?.init?.signal).toBe(controller.signal);
  });

  it('makes no call at all for a read that was cancelled before it started', async () => {
    const invokes: Invocation[] = [];
    const controller = new AbortController();
    controller.abort();
    await expect(createNutritionApi(ocrClient({ data: { nutrition: OCR_SNAPSHOT } }, invokes)).scanLabel(ASSET, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(invokes).toHaveLength(0);
  });

  it('surfaces a cancel in flight as the abort, never as an ApiError', async () => {
    const controller = new AbortController();
    const client = {
      auth: { getUser: async () => ({ data: { user: USER }, error: null }) },
      functions: {
        invoke: async () => {
          // What the app does on unmount, mid-request.
          controller.abort();
          return { data: null, error: fetchError(Object.assign(new Error('Aborted'), { name: 'AbortError' })) };
        },
      },
    } as unknown as SupabaseClient;
    const thrown = await createNutritionApi(client).scanLabel(ASSET, controller.signal).then(() => null, (e: unknown) => e);
    expect(isApiError(thrown)).toBe(false);
    expect((thrown as { name?: string }).name).toBe('AbortError');
  });
});
