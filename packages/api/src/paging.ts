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
// package is bundled into the (web-only) app, not just run under Node.
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
