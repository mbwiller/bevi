// What an upload's payload can be, and how to measure and normalise it.
//
// `UploadMediaInput.file` was `Blob` only (contract < 2.15.0), which is what a
// browser's canvas/file input produces. React Native's `Blob` is a different
// object: it carries a reference into the native blob registry, not bytes the
// JS runtime can hand to supabase-js, and uploading one commonly stores a
// 0-byte object with no error at all. So native callers pass `ArrayBuffer` or
// `Uint8Array` instead, and these two helpers let the shared code path accept
// all three shapes.

export type UploadPayload = Blob | ArrayBuffer | Uint8Array;

// `instanceof` alone is wrong across realms (a worker, a RN bridge, a jsdom
// window), and a mislabelled buffer would silently take the Blob branch.
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
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
 * A `Blob` goes through untouched — that is the web path and it already works.
 * A typed array becomes an `ArrayBuffer` holding exactly its own bytes: a view
 * is often a window onto a larger buffer (base64 decoders and
 * `expo-file-system` both return one), and passing `.buffer` would upload the
 * whole backing store.
 */
export function toUploadBody(file: UploadPayload): Blob | ArrayBuffer {
  if (isArrayBuffer(file)) return file;
  if (ArrayBuffer.isView(file)) {
    return (file.buffer as ArrayBuffer).slice(file.byteOffset, file.byteOffset + file.byteLength);
  }
  return file;
}
