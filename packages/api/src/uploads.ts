// What an upload's payload can be, and how to measure and normalise it.
//
// `UploadMediaInput.file` was `Blob` only (contract < 2.15.0), which is what a
// browser's canvas/file input produces. React Native's `Blob` is a different
// object: it carries a reference into the native blob registry, not bytes the
// JS runtime can hand to supabase-js, and uploading one commonly stores a
// 0-byte object with no error at all. So native callers pass `ArrayBuffer` or
// `Uint8Array` instead, and these two helpers let the shared code path accept
// all three shapes -- and refuse, loudly, the one shape that would upload
// nothing.

import { ApiError, type UploadPayload } from '@bevi/shared';

// The union lives in the contract (`shared/src/api.ts`) so this module and
// `UploadMediaInput.file` cannot drift apart; re-exported here because this is
// where the payload is handled.
export type { UploadPayload };

// `instanceof` alone is wrong across realms (a worker, a RN bridge, a jsdom
// window), and a mislabelled buffer would silently take the Blob branch.
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/**
 * Whether we are running inside React Native.
 *
 * Deliberately NOT `typeof document === 'undefined'`: that is true in Node
 * too, so under vitest — and in any other non-browser JS host — it would
 * reject the perfectly good, byte-backed `Blob`s those runtimes produce. The
 * question here is not "is there a DOM" but "is this the one runtime whose
 * `Blob` is a native handle rather than bytes", and only an RN marker answers
 * it: `navigator.product === 'ReactNative'` is RN's long-standing flag, and
 * `HermesInternal` exists only inside the Hermes engine RN ships with. Either
 * is enough; checking both covers a JSC build and a stripped `navigator`.
 */
function isReactNative(): boolean {
  const g = globalThis as unknown as { navigator?: { product?: unknown }; HermesInternal?: unknown };
  return g.navigator?.product === 'ReactNative' || g.HermesInternal != null;
}

/**
 * The payload's length in bytes. `Blob` has `.size`; `ArrayBuffer` and typed
 * arrays have `.byteLength` — this is the one number all three shapes have.
 *
 * Returns 0 for anything whose length cannot be read, which leaves the
 * server-side `file_size_limit` on the bucket as the backstop rather than
 * rejecting a payload we simply failed to measure.
 */
export function uploadByteLength(file: unknown): number {
  if (isArrayBuffer(file)) return file.byteLength;
  if (ArrayBuffer.isView(file)) return file.byteLength;
  const size = (file as { size?: unknown } | null | undefined)?.size;
  return typeof size === 'number' ? size : 0;
}

/**
 * What to hand supabase-js Storage.
 *
 * A typed array becomes an `ArrayBuffer` holding exactly its own bytes: a view
 * is often a window onto a larger buffer (base64 decoders and
 * `expo-file-system` both return one), and passing `.buffer` would upload the
 * whole backing store. An `ArrayBuffer` is already what Storage wants.
 *
 * A `Blob` goes through untouched on the web — that is the path that already
 * works — but is **rejected** under React Native, because nothing else in this
 * code path can catch it: an RN `Blob` is a `Blob`, carries a plausible
 * `.size`, so it satisfies the type, passes `uploadByteLength()` and the size
 * limit, and then stores 0 bytes behind a 200. The app's most natural native
 * call, `await fetch(uri).then((r) => r.blob())` on an `expo-image-picker`
 * result, produces exactly that. Failing loudly here costs one clear error
 * during bring-up; not failing costs a blank photo nobody can explain.
 *
 * @throws ApiError('validation') for a `Blob` payload off the web.
 */
export function toUploadBody(file: UploadPayload): Blob | ArrayBuffer {
  if (isArrayBuffer(file)) return file;
  if (ArrayBuffer.isView(file)) {
    return (file.buffer as ArrayBuffer).slice(file.byteOffset, file.byteOffset + file.byteLength);
  }
  if (isReactNative()) {
    throw new ApiError(
      'validation',
      "This platform cannot upload a Blob: React Native's Blob holds a native handle, not bytes, and would store an empty file. Read the image into an ArrayBuffer or Uint8Array (e.g. expo-file-system) and pass that.",
      { field: 'file' }
    );
  }
  return file;
}
