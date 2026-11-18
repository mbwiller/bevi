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

/** The Storage REST path prefix; object uploads and downloads both sit under it. */
const STORAGE_OBJECT_PATH = '/storage/v1/object';

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  // A `Request` or a `URL`. Read the property instead of using `instanceof`:
  // on Hermes the `URL` global is installed by Expo's runtime over whatever
  // React Native defined, so identity checks against it are not worth
  // trusting, and `String(url)` is the same string either way.
  const url = (input as { url?: unknown; href?: unknown } | null)?.url ?? (input as { href?: unknown } | null)?.href;
  return typeof url === 'string' ? url : String(input);
}

export function deadlineMsFor(input: unknown): number {
  return urlOf(input).includes(STORAGE_OBJECT_PATH) ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
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
 * Wraps a fetch so every request carries an `AbortController` deadline.
 *
 * The caller's own `signal` (supabase-js's `.abortSignal()`, the app's cancel
 * on unmount) still works: an abort from either side aborts the request, and
 * only a deadline abort is rewritten into the network error -- a caller
 * cancelling on purpose keeps seeing its own abort.
 *
 * The deadline covers the request up to the response headers, not the reading
 * of the body. Every response this package reads is small JSON or a storage
 * ack, so a body that stalls after headers is not a case worth the extra
 * machinery.
 */
export function withDeadline(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const ms = deadlineMsFor(input);
    const controller = new AbortController();
    const caller = init?.signal ?? undefined;
    const onCallerAbort = () => controller.abort();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    if (caller) {
      if (caller.aborted) controller.abort();
      else caller.addEventListener('abort', onCallerAbort, { once: true });
    }

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
