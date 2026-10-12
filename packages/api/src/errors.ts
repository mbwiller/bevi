// Maps whatever supabase-js throws (PostgrestError from `.rpc()`/`.from()`,
// AuthError from `supabase.auth.*`, or a raw fetch failure) to the shared
// `ApiError`. Nothing else in this package should let a raw error escape —
// every method body wraps its supabase-js calls through `mapError`.
import { ApiError, type ApiErrorCode, type ValidationErrorDetail } from '@bevi/shared';

// The exception name every security-definer RPC raises (see
// DEVELOPMENT-ARJUN.md §5.1 and the migrations under supabase/migrations/).
// Checked against `error.message` first since it's more specific than the
// bare SQLSTATE in `error.code` -- several BEVI_* names share a SQLSTATE
// (e.g. everything mapped to `conflict` is '23505').
const BEVI_CODE_MAP: Record<string, ApiErrorCode> = {
  BEVI_UNAUTHORIZED: 'unauthorized',
  BEVI_NOT_FOUND: 'not_found',
  BEVI_ALREADY_RANKED: 'conflict',
  BEVI_DUPLICATE_BEV: 'conflict',
  BEVI_HANDLE_TAKEN: 'conflict',
  BEVI_STALE_BUCKET: 'conflict',
  BEVI_BAD_INDEX: 'validation',
  BEVI_VALIDATION: 'validation',
  BEVI_RATE_LIMITED: 'rate_limited',
  BEVI_AGE_RESTRICTED: 'age_restricted',
};

// Fallback when the message doesn't carry a BEVI_* name (a plain
// constraint violation, a PostgREST-level error, or an SQLSTATE this
// package doesn't special-case).
const SQLSTATE_CODE_MAP: Record<string, ApiErrorCode> = {
  '42501': 'unauthorized',
  '23505': 'conflict',
  '22023': 'validation',
  '23514': 'validation', // check constraint violation, e.g. bev_reports.reason

  P0001: 'rate_limited',
  P0002: 'not_found',
  PGRST116: 'not_found', // PostgREST's own "no rows for .single()"
};

// Validation errors raise with `detail = '<field name>'` (a bare string,
// e.g. 'inviteCode', 'handle', 'note') -- see every `BEVI_VALIDATION`/
// `BEVI_BAD_INDEX` raise across the migrations. Wrap it into the shape
// `ValidationErrorDetail` promises.
function validationDetail(details: unknown): ValidationErrorDetail | undefined {
  if (typeof details === 'string' && details.length > 0) {
    return { field: details };
  }
  return undefined;
}

interface PostgrestLikeError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

function isPostgrestLikeError(e: unknown): e is PostgrestLikeError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string' &&
    ('code' in e || 'details' in e || 'hint' in e) &&
    // A real PostgrestError never has `.status`; gotrue's AuthError always
    // does. Both can have a `.code`, so this is the actual discriminator.
    !('status' in e)
  );
}

function findBeviCode(message: string): ApiErrorCode | undefined {
  for (const name of Object.keys(BEVI_CODE_MAP)) {
    if (message.includes(name)) return BEVI_CODE_MAP[name];
  }
  return undefined;
}

function mapPostgrestError(e: PostgrestLikeError): ApiError {
  const beviCode = findBeviCode(e.message);
  if (beviCode) {
    const detail = beviCode === 'validation' ? validationDetail(e.details) : e.details ?? undefined;
    return new ApiError(beviCode, e.message, detail);
  }

  const code = e.code ?? '';
  const sqlstateCode = SQLSTATE_CODE_MAP[code];
  if (sqlstateCode) {
    const detail = sqlstateCode === 'validation' ? validationDetail(e.details) : e.details ?? undefined;
    return new ApiError(sqlstateCode, e.message, detail);
  }

  return new ApiError('unknown', e.message, e.details ?? undefined);
}

// supabase-js `AuthError` (gotrue-js). Newer versions carry a structured
// `.code` (e.g. 'invalid_credentials', 'user_already_exists'); older ones
// only have `.message`, so this also does substring matching as a
// fallback. If the `handle_new_user` trigger's raised message ever makes
// it through GoTrue verbatim, the BEVI_* lookup above catches it too --
// unverified without a live stack, see packages/api/README gap note.
interface AuthErrorLike {
  name?: string;
  message: string;
  code?: string | null;
  status?: number;
}

function isAuthErrorLike(e: unknown): e is AuthErrorLike {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string' &&
    ((e as { name?: unknown }).name === 'AuthError' || 'status' in e)
  );
}

const AUTH_CODE_MAP: Record<string, ApiErrorCode> = {
  invalid_credentials: 'unauthorized',
  user_already_exists: 'conflict',
  user_not_found: 'unauthorized',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  weak_password: 'validation',
  validation_failed: 'validation',
};

function mapAuthError(e: AuthErrorLike): ApiError {
  const beviCode = findBeviCode(e.message);
  if (beviCode) return new ApiError(beviCode, e.message);

  if (e.code && AUTH_CODE_MAP[e.code]) {
    return new ApiError(AUTH_CODE_MAP[e.code], e.message);
  }

  const msg = e.message.toLowerCase();
  if (msg.includes('invalid login credentials')) return new ApiError('unauthorized', e.message);
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return new ApiError('conflict', e.message);
  }
  if (msg.includes('rate limit')) return new ApiError('rate_limited', e.message);

  if (typeof e.status === 'number' && e.status === 0) {
    return new ApiError('network', e.message);
  }

  return new ApiError('unknown', e.message);
}

// `@supabase/storage-js` `StorageError`/`StorageApiError`/`StorageUnknownError`
// (thrown by `client.storage.from(bucket).upload()` etc, see `media.ts`).
// This is NOT a `PostgrestError` (no `details`/`hint`, and it does carry
// `status`, so `isPostgrestLikeError` correctly skips it) but it WOULD be
// wrongly caught by `isAuthErrorLike` below -- that guard's fallback is
// just `'status' in e`, which every `StorageError` satisfies too (see the
// vendored `@supabase/storage-js` `errors.ts`: `status`/`statusCode` are
// assigned in the base `StorageError` constructor). So this check has to
// run before `isAuthErrorLike` in `mapError`.
interface StorageErrorLike {
  name?: string;
  message: string;
  status?: number;
  statusCode?: string;
}

function isStorageErrorLike(e: unknown): e is StorageErrorLike {
  if (typeof e !== 'object' || e === null || !('message' in e) || !('name' in e)) return false;
  const name = (e as { name: unknown }).name;
  const message = (e as { message: unknown }).message;
  return typeof message === 'string' && typeof name === 'string' && name.startsWith('Storage');
}

// HTTP status -> ApiErrorCode. Storage doesn't raise BEVI_*/SQLSTATE like
// the RPCs do; this maps the HTTP status the Storage API itself returns
// (see https://supabase.com/docs/guides/storage/debugging/error-codes).
const STORAGE_STATUS_CODE_MAP: Record<number, ApiErrorCode> = {
  400: 'validation', // e.g. mime type/path rejected by bucket config
  403: 'unauthorized', // RLS denied the insert
  404: 'not_found',
  409: 'conflict', // ResourceAlreadyExists
  413: 'validation', // payload too large (bucket's file_size_limit)
  429: 'rate_limited',
};

function mapStorageError(e: StorageErrorLike): ApiError {
  const code = typeof e.status === 'number' ? STORAGE_STATUS_CODE_MAP[e.status] : undefined;
  return new ApiError(code ?? 'unknown', e.message);
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = String((e as { message: unknown }).message).toLowerCase();
    return msg.includes('fetch failed') || msg.includes('network') || msg.includes('failed to fetch');
  }
  return false;
}

/** Never lets a raw supabase-js error escape a `BeviApi` method. */
export function mapError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (isNetworkError(e)) {
    const message = e instanceof Error ? e.message : 'network error';
    return new ApiError('network', message);
  }
  if (isPostgrestLikeError(e)) return mapPostgrestError(e);
  // Must run before isAuthErrorLike -- see isStorageErrorLike's comment.
  if (isStorageErrorLike(e)) return mapStorageError(e);
  if (isAuthErrorLike(e)) return mapAuthError(e);
  if (e instanceof Error) return new ApiError('unknown', e.message);
  return new ApiError('unknown', typeof e === 'string' ? e : 'Unknown error');
}

/** Throws the mapped `ApiError` -- `catch (e) { throw asApiError(e); }`. */
export function asApiError(e: unknown): ApiError {
  return mapError(e);
}

export { ApiError, isApiError } from '@bevi/shared';
