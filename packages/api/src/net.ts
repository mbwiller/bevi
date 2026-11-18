// Request deadlines (DEVELOPMENT-ARJUN-IOS.md, IA-5).
//
// A browser tab on wifi forgives a hanging request; a phone on a subway
// platform does not. iOS keeps a socket open long after the radio has stopped
// delivering anything, so without a deadline a dropped cellular connection
// shows up as a spinner that never ends. Every supabase-js call goes through
// the `global.fetch` this module wraps (supabase-js hands the custom fetch to
// postgrest, storage, auth and functions alike), so one wrapper covers the
// whole package.
//
// What the app sees: `ApiError('network')`. See `timeoutError()` below for how
// that is guaranteed through three different supabase-js error shapes. That is
// the signal Matt's native offline state is derived from (IM-4) -- on Hermes
// `navigator.onLine` reports "online" forever, so the deadline, not the
// browser's network event, is what tells the app it is offline.

/**
 * Deadline for an ordinary PostgREST/RPC/auth round trip.
 *
 * A healthy call against the hosted project is 100-600 ms; a cold cellular
 * connection adds DNS + TLS, which on a weak LTE signal runs to 2-3 s. 15 s is
 * an order of magnitude past that, so it never cuts off a request that is
 * merely slow, while still being inside the window where a person is waiting
 * rather than convinced the app is broken. It is also comfortably below
 * NSURLSession's own 60 s default, which means our `ApiError('network')` is
 * what surfaces, not an opaque platform error a minute later.
 *
 * This budget covers PostgREST and auth round trips only. Anything that moves
 * bytes or waits on a third party gets its own, longer budget below: an object
 * upload (`UPLOAD_TIMEOUT_MS`) and an Edge Function call
 * (`FUNCTION_TIMEOUT_MS`). `deadlineMsFor` is where a URL is sorted into one
 * of the three.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Deadline for a Storage object upload (`media.ts`, `bugs.ts` evidence).
 *
 * Uploads are bytes on the wire, not a round trip: `MAX_UPLOAD_BYTES` is 10 MB
 * (`media.ts`), and a weak LTE uplink can be well under 1 Mbit/s, so a legal
 * upload can genuinely take over a minute. 15 s here would fail photos that
 * were going to succeed. 2 minutes covers the 10 MB ceiling at roughly
 * 0.7 Mbit/s and still ends a hung upload rather than leaving it forever.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Deadline for an Edge Function call (`/functions/v1/...`).
 *
 * An Edge Function is not a round trip: it is however long the work inside it
 * takes, and one of ours is deliberately slow. `bugs.report()` invokes
 * `bug-report`, which downloads every evidence object it was given with the
 * service role (`supabase/functions/bug-report/index.ts`, `readEvidence`) and
 * re-uploads each one to the founders' board before it answers -- up to
 * `MAX_EVIDENCE` (3) objects of `MAX_EVIDENCE_BYTES` (10 MB) each, sequentially,
 * plus a third-party API we do not control. 15 s would turn a slow board into
 * `ApiError('network')` *after* the ticket had already been filed, which is a
 * misleading error, not a safe one. These calls were unbounded before this
 * module existed and the bug reporter has been live on the web since #234, so
 * a short budget here is a regression in shipped code, not a new guard.
 *
 * 150 s is Supabase's own wall-clock ceiling for an Edge Function invocation.
 * Matching it means the platform's limit is what ends a genuinely stuck
 * function -- our deadline only catches the case the platform cannot, a
 * connection that dies with the request in flight -- while never cutting off a
 * function that was still going to answer.
 */
export const FUNCTION_TIMEOUT_MS = 150_000;

/** The Storage REST path prefix; every object route sits under it. */
const STORAGE_OBJECT_PATH = '/storage/v1/object';

/** The Edge Functions path prefix (`/functions/v1/<name>`). */
const FUNCTIONS_PATH = '/functions/v1';

// Routes under `/storage/v1/object/<here>` that are a round trip rather than
// bytes on the wire, so they belong on `REQUEST_TIMEOUT_MS`: `list/<bucket>`,
// `sign/...` and `upload/sign/...` (minting a signed URL), `info/...`, `move`
// and `copy`, plus the `public/` and `authenticated/` download prefixes. A
// hung storage *list* spinning for two minutes was the bug here; everything
// else under `/object/` is addressed as `<bucket>/<path>`.
const STORAGE_ROUND_TRIP_ROUTES = new Set(['list', 'sign', 'info', 'move', 'copy', 'public', 'authenticated']);

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  // A `Request` or a `URL`. Read the property instead of using `instanceof`:
  // on Hermes the `URL` global is installed by Expo's runtime over whatever
  // React Native defined, so identity checks against it are not worth
  // trusting, and `String(url)` is the same string either way.
  const url = (input as { url?: unknown; href?: unknown } | null)?.url ?? (input as { href?: unknown } | null)?.href;
  return typeof url === 'string' ? url : String(input);
}

function methodOf(input: unknown, init?: { method?: string } | null): string {
  const method = init?.method ?? (input as { method?: unknown } | null)?.method;
  return typeof method === 'string' ? method.toUpperCase() : 'GET';
}

/**
 * Whether a storage URL is an object *upload* -- bytes going up, the only
 * storage call that can legitimately run for minutes.
 *
 * `POST <bucket>/<path>` is an upload, `PUT` is an update or an upload to a
 * signed URL, and `x-upsert` rides on the POST. A read, a delete and the
 * round-trip routes above are all ordinary requests, so they keep the 15 s
 * budget: before this check, a hung `POST /object/list/<bucket>` sat there for
 * two minutes.
 */
function isObjectUpload(url: string, method: string): boolean {
  if (method !== 'POST' && method !== 'PUT') return false;
  const rest = url.slice(url.indexOf(STORAGE_OBJECT_PATH) + STORAGE_OBJECT_PATH.length + 1);
  const route = rest.split(/[/?#]/)[0];
  // `upload/sign/<bucket>/<path>`: the PUT carries the bytes, the POST only
  // mints the URL.
  if (route === 'upload') return method === 'PUT';
  return !STORAGE_ROUND_TRIP_ROUTES.has(route);
}

export function deadlineMsFor(input: unknown, init?: { method?: string } | null): number {
  const url = urlOf(input);
  if (url.includes(FUNCTIONS_PATH)) return FUNCTION_TIMEOUT_MS;
  if (url.includes(STORAGE_OBJECT_PATH) && isObjectUpload(url, methodOf(input, init))) return UPLOAD_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

// The error a blown deadline throws. It has to come back as
// `ApiError('network')` through all three supabase-js layers, and each wraps a
// rejected fetch differently:
//
//   * postgrest-js catches it and returns `{ error: { message:
//     '<name>: <message>', code: '' } }` -- a plain object, not an Error;
//   * storage-js rethrows it as a `StorageUnknownError` carrying the message;
//   * auth-js turns it into an `AuthRetryableFetchError` with `status` 0.
//
// `errors.ts`'s `isNetworkError` runs before every other branch of `mapError`
// and matches either a `TypeError` or a message containing 'network'. Using a
// `TypeError` whose message also contains the word "network" therefore lands
// on `ApiError('network')` whichever layer the call went through -- and
// matches what a real connection failure throws in both Node and the browser.
// Changing this message means re-checking `isNetworkError` in `errors.ts`.
function timeoutError(ms: number): TypeError {
  return new TypeError(`Network request timed out after ${ms} ms`);
}

/**
 * What a caller that had already aborted gets back.
 *
 * `signal.reason` is what a real `fetch` rejects with on an aborted signal (a
 * `DOMException` named 'AbortError' in Node and the browser). Hermes's
 * `AbortController` may not set it, and `DOMException` is not guaranteed there
 * either, so fall back to a plainly named `Error` rather than construct one.
 */
function callerAbortError(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Wraps a fetch so every request carries an `AbortController` deadline.
 *
 * The caller's own `signal` (supabase-js's `.abortSignal()`, the app's cancel
 * on unmount) still works: an abort from either side aborts the request, and
 * only a deadline abort is rewritten into the network error -- a caller
 * cancelling on purpose keeps seeing its own abort. A caller whose signal is
 * already aborted gets that abort without a request being made at all.
 *
 * The deadline covers the request up to the response headers, not the reading
 * of the body. Every response this package reads is small JSON or a storage
 * ack, so a body that stalls after headers is not a case worth the extra
 * machinery.
 */
export function withDeadline(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const caller = init?.signal ?? undefined;
    // A caller that has already cancelled gets no request at all: the base
    // fetch would only reject on the aborted signal, so skipping it saves the
    // round trip and the timer both.
    if (caller?.aborted) throw callerAbortError(caller);

    const ms = deadlineMsFor(input, init);
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    caller?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (e) {
      if (timedOut && !caller?.aborted) throw timeoutError(ms);
      throw e;
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    }
  };
}
