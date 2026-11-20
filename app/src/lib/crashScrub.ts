import { isApiError } from '@bevi/shared';

/**
 * What crash reporting (crashReporting.ts) may never send, and which errors it does not send at all.
 * Pure functions with no SDK import, so the rules can be tested as data.
 *
 * Two things can carry a credential out of the app: a header (`Authorization`, `apikey`, a cookie)
 * and a URL (a signed photo URL has its signature in the query string; an auth redirect has tokens
 * in the fragment). Both can reach a report inside a breadcrumb (every fetch is one), inside an
 * error message (a failed request often quotes its URL) or inside whatever a call site attaches.
 * So every string that leaves is scrubbed, wherever it sits:
 *
 * - a URL loses its query string and its fragment;
 * - a JWT, a `Bearer …` value and a Supabase key (`sb_publishable_…`, `sb_secret_…`) are replaced;
 * - a value under a key that names a credential is replaced whatever it holds;
 * - a key that only ever holds a query string or a fragment is dropped.
 */

export const REDACTED = '[redacted]';

/** Header, parameter and field names whose value is a credential, whatever it looks like. */
const SECRET_KEY = /authorization|cookie|token|api[-_]?key|passw(or)?d|secret|signature|credential/i;
/** Keys that hold a URL's query string or fragment by themselves (the native layer's `http.query`). */
const QUERY_KEY = /^(http\.)?(query|query_string|fragment|search|hash)$/i;
/** Keys whose value is one URL, absolute or not. */
const URL_KEY = /^(url|uri|href|to|from|http\.url|referrer)$/i;

const ABSOLUTE_URL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(\.[A-Za-z0-9_-]*)?/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SUPABASE_KEY = /\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g;
const SECRET_PAIR = /\b((?:access_|refresh_|id_)?token|api[-_]?key|password|signature|sig)=[^&\s"'<>]+/gi;

/** One URL without its query string and fragment: `/photo.jpg?token=abc#x` → `/photo.jpg`. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Free text (a message, a console line) with every URL's query string and every token removed. */
export function scrubText(text: string): string {
  return text
    .replace(ABSOLUTE_URL, '$1')
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SUPABASE_KEY, REDACTED)
    .replace(SECRET_PAIR, `$1=${REDACTED}`);
}

/** Nested data is followed this deep; anything deeper is dropped rather than sent unread. */
const MAX_DEPTH = 8;

/**
 * A copy of any value with the rules above applied to every string and every key in it. Never
 * changes its argument: the SDK hands over objects the app may still hold.
 */
export function scrubValue(value: unknown, key?: string, depth = 0): unknown {
  if (typeof value === 'string') return key !== undefined && URL_KEY.test(key) ? scrubText(stripQuery(value)) : scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, key, depth + 1));
  // Only plain data is followed. An Error (console.error is often handed one, and its message can
  // quote a URL) becomes its scrubbed name and message; a Date is kept; any other instance is
  // replaced by what it is, because what it holds cannot be read here.
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`);
  if (value instanceof Date) return value;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return Object.prototype.toString.call(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (QUERY_KEY.test(k)) continue;
    out[k] = SECRET_KEY.test(k) ? REDACTED : scrubValue(v, k, depth + 1);
  }
  return out;
}

/** The parts of a breadcrumb that hold text. Structural fields (type, level, timestamp) pass through. */
interface BreadcrumbLike {
  message?: string;
  data?: Record<string, unknown>;
}

/** `beforeBreadcrumb`: the same breadcrumb with its message and data scrubbed. */
export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T {
  const next: BreadcrumbLike = { ...breadcrumb };
  if (typeof breadcrumb.message === 'string') next.message = scrubText(breadcrumb.message);
  if (breadcrumb.data) next.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
  return next as T;
}

/** The parts of an event that hold text or data from the app. Everything else passes through. */
interface EventLike {
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: BreadcrumbLike[];
  request?: object;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

/**
 * `beforeSend`: the same event with its message, exception messages, breadcrumbs, request, extra,
 * contexts and tags scrubbed. Breadcrumbs are scrubbed again here because the native layer adds its
 * own to an event after `beforeBreadcrumb` has run, and those never passed through it.
 */
export function scrubEvent<T extends EventLike>(event: T): T {
  const next: EventLike = { ...event };
  if (typeof event.message === 'string') next.message = scrubText(event.message);
  if (event.exception?.values) {
    next.exception = {
      ...event.exception,
      values: event.exception.values.map((v) => (typeof v.value === 'string' ? { ...v, value: scrubText(v.value) } : v)),
    };
  }
  if (event.breadcrumbs) next.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.request) next.request = scrubValue(event.request) as object;
  if (event.extra) next.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) next.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.tags) next.tags = scrubValue(event.tags) as Record<string, unknown>;
  return next as T;
}

/**
 * Whether an error is one the app expects and already explains to the person (errorCopy.ts), so it
 * is not a defect to report: every `ApiError` the contract gives a meaning to. Offline, signed out,
 * a form that did not validate, something that is gone, too many tries, a list that changed
 * underneath, a Bev the account may not see. What is left is unexpected: an `ApiError` with the
 * code `unknown` (the server, or `@bevi/api`, met something it has no name for) and anything that
 * is not an `ApiError` at all (a bug in the app).
 */
export function isExpectedError(error: unknown): boolean {
  return isApiError(error) && error.code !== 'unknown';
}
