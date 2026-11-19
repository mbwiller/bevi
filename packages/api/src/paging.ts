// Cursor helpers shared by every `list*`/`search` method. A cursor is an
// opaque base64url-encoded JSON blob of whatever keyset tuple that method's
// `order by` needs -- the app never looks inside it (DEVELOPMENT-ARJUN.md §6.2).
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(limit), MAX_LIMIT);
}

// `atob`/`btoa` only handle Latin1, so UTF-8 bytes are round-tripped through
// `TextEncoder`/`TextDecoder` first. No `Buffer` here on purpose -- this
// package is bundled into the app, not just run under Node.
//
// Hermes (IA-5, DEVELOPMENT-ARJUN-IOS.md): `TextEncoder`/`TextDecoder` need no
// shim -- Expo 57's runtime installs `TextDecoder`, and `TextEncoder` is
// already present (Expo's own fetch implementation calls `new TextEncoder()`
// unguarded). `atob`/`btoa` are a different story: nothing in React Native
// 0.86 or Expo 57 installs them, so on native they can only come from the
// engine itself, auth-js ships its own base64 codec rather than trusting them,
// and we have not yet run this on a device. A cursor that will not decode
// breaks *every* paged list, so this follows `media.ts`'s `crypto.randomUUID`
// pattern: use the global when it exists, otherwise do it in JS. Delete the
// fallbacks once a device build proves the globals are there.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const hasSecond = i + 1 < bytes.length;
    const hasThird = i + 2 < bytes.length;
    // `?? 0` for the app's `noUncheckedIndexedAccess`; the `has*` flags are
    // what actually decide whether a byte is there.
    const b0 = bytes[i] ?? 0;
    const b1 = hasSecond ? bytes[i + 1] ?? 0 : 0;
    const b2 = hasThird ? bytes[i + 2] ?? 0 : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0b11) << 4) | (b1 >> 4)];
    out += hasSecond ? BASE64_CHARS[((b1 & 0b1111) << 2) | (b2 >> 6)] : '=';
    out += hasThird ? BASE64_CHARS[b2 & 0b111111] : '=';
  }
  return out;
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const body = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((body.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (const char of body) {
    const value = BASE64_CHARS.indexOf(char);
    // Throwing matches what `atob` does with a bad character; `decodeCursor`
    // turns either into "start over".
    if (value < 0) throw new Error('Invalid base64');
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (accumulator >> bits) & 0xff;
    }
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function encodeCursor(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeCursor<T>(cursor: string | undefined | null): T | undefined {
  if (!cursor) return undefined;
  try {
    const json = new TextDecoder().decode(fromBase64Url(cursor));
    return JSON.parse(json) as T;
  } catch {
    // A malformed/forged cursor is treated as "start over", not an error --
    // there's nothing the caller can do to fix it, and starting over is safe.
    return undefined;
  }
}

/** Builds a `Page<T>`: `nextCursor` is set only when a full page came back. */
export function toPage<T>(items: T[], limit: number, nextCursorFor: (last: T) => unknown): { items: T[]; nextCursor: string | null } {
  if (items.length < limit) {
    return { items, nextCursor: null };
  }
  const last = items[items.length - 1];
  return { items, nextCursor: last === undefined ? null : encodeCursor(nextCursorFor(last)) };
}
