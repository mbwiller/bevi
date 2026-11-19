import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ApiErrorCode, type NutritionApi, type NutritionPreview } from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';
import { mapNutrition } from './mappers';

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

// --------------------------------------------------------------------------
// Reading a label from a photo: the `nutrition-ocr` Edge Function (BEV-13).
//
// The reader needs a model and a service-role read of the private label
// object, so none of it can live in the client: `scanLabel` uploads nothing
// and decodes nothing, it hands the function an `assetId` the caller already
// owns (`media.upload({ kind: 'label' })`) and maps its answer.
// --------------------------------------------------------------------------

/** `supabase/functions/nutrition-ocr`, `verify_jwt = true`. */
const OCR_FUNCTION = 'nutrition-ocr';

/**
 * The function's error codes, mapped to the contract's. It answers with
 * `{ error: { code, message, field? } }` -- a nested object, unlike
 * `bug-report`'s flat `{ error: '<code>' }` -- and its codes are already the
 * contract's names, so this table is about refusing to pass through a name
 * the contract does not define, not about translating them.
 */
const OCR_ERROR_CODES: Record<string, ApiErrorCode> = {
  validation: 'validation',
  unauthorized: 'unauthorized',
  rate_limited: 'rate_limited',
  network: 'network',
  unknown: 'unknown',
};

/**
 * The fallback when the body is unreadable or carries a code this package
 * does not know: the HTTP status the function answered with.
 *
 * 404 is the interesting one -- a backend whose functions predate BEV-13 has
 * no `nutrition-ocr` to route to, which is exactly the contract's "'unknown'
 * -- the server predates this capability", and the message says so rather
 * than blaming the photo.
 */
const OCR_STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'unauthorized',
  404: 'unknown',
  429: 'rate_limited',
  502: 'network',
  503: 'unknown',
  504: 'network',
};

/** What the person reads when the function sent no message of its own. */
const OCR_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  validation: 'That label photo could not be read. Try a straight-on photo of the nutrition panel.',
  unauthorized: 'Sign in again to read a nutrition label.',
  rate_limited: 'Too many label reads. Wait a minute and try again.',
  network: 'The label reader is unavailable. Try again, or enter the values yourself.',
  unknown: 'Reading a nutrition label is not available yet.',
};

interface OcrErrorBody {
  error?: { code?: string; message?: string; field?: string } | null;
}

/**
 * supabase-js's `FunctionsHttpError` keeps the function's own body on the
 * attached `Response`, so the real code is only reachable asynchronously --
 * the same reason `bugs.ts` reads it this way. Null when there is no response
 * to read (a `FunctionsFetchError`, which carries the fetch failure itself).
 */
async function readOcrError(error: unknown): Promise<{ status: number; body: OcrErrorBody | null } | null> {
  const response = (error as { context?: Response } | null)?.context;
  if (!response || typeof response.json !== 'function') return null;
  let body: OcrErrorBody | null = null;
  try {
    body = (await response.json()) as OcrErrorBody;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** The function's error, as the contract's. Never a guess: an unreadable failure stays 'unknown'. */
async function mapOcrError(error: unknown): Promise<ApiError> {
  const answer = await readOcrError(error);
  if (answer) {
    const reported = answer.body?.error ?? null;
    const code = (reported?.code ? OCR_ERROR_CODES[reported.code] : undefined) ?? OCR_STATUS_CODES[answer.status];
    if (code) {
      const message = reported?.message?.trim() || OCR_MESSAGES[code] || 'That nutrition label could not be read.';
      // The contract promises `detail.field = 'labelAssetId'` for a rejected
      // asset, and that is the only field this call sends.
      if (code === 'validation') return new ApiError(code, message, { field: reported?.field ?? 'labelAssetId' });
      return new ApiError(code, message, reported?.code ?? undefined);
    }
  }
  // `FunctionsFetchError` wraps the underlying fetch failure in `context` and
  // its own message says nothing `errors.ts` would recognise as the network,
  // so map what it wrapped -- a blown `FUNCTION_TIMEOUT_MS` deadline
  // (`net.ts`) has to reach the app as `ApiError('network')`.
  const context = (error as { context?: unknown } | null)?.context;
  return mapError(context instanceof Error ? context : error);
}

/**
 * What a cancelled `scanLabel` throws: the caller's own abort reason, not an
 * `ApiError`. Same convention as `lookupBarcode` below and `net.ts`'s
 * deadline wrapper -- a screen that cancelled on unmount is not a failure to
 * show anyone. `signal.reason` is what a real abort carries; Hermes may not
 * set it, hence the fallback.
 */
function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function createNutritionApi(client: SupabaseClient): NutritionApi {
  return {
    async scanLabel(labelAssetId, signal) {
      const assetId = typeof labelAssetId === 'string' ? labelAssetId.trim() : '';
      // Nothing is invoked until the input is at least the right shape; who
      // owns the asset is the function's to decide, not this package's.
      if (!assetId) throw new ApiError('validation', 'Upload a photo of the label first.', { field: 'labelAssetId' });
      if (signal?.aborted) throw abortReason(signal);
      await requireUserId(client);
      if (signal?.aborted) throw abortReason(signal);

      const { data, error } = await client.functions.invoke<{ nutrition?: unknown }>(OCR_FUNCTION, {
        body: { labelAssetId: assetId },
        signal,
      });
      // `functions.invoke` never rejects: an aborted fetch comes back here as
      // a `FunctionsFetchError`, so the cancel has to be checked before the
      // error is mapped or it would surface as a server failure.
      if (error) {
        if (signal?.aborted) throw abortReason(signal);
        throw await mapOcrError(error);
      }
      // `{ nutrition: null }` is the function's answer for a photo with no
      // panel it could read, and the contract's null for "no nutrition on
      // this label". `source` comes back `'label-ocr'`; passing it as the
      // fallback keeps a function that forgot the key from being read as a
      // barcode match.
      return mapNutrition(data?.nutrition, 'label-ocr');
    },
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
