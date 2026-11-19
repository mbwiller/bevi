import { describe, expect, it, vi } from 'vitest';
import { clampLimit, decodeCursor, DEFAULT_LIMIT, encodeCursor, MAX_LIMIT, toPage } from '../src/paging.ts';

describe('clampLimit', () => {
  it('defaults when undefined, zero, negative or non-finite', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-5)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_LIMIT);
  });

  it('caps at MAX_LIMIT and truncates fractional values', () => {
    expect(clampLimit(1000)).toBe(MAX_LIMIT);
    expect(clampLimit(5.9)).toBe(5);
  });
});

describe('cursor round trip', () => {
  it('encodes and decodes an arbitrary JSON-safe value, including unicode', () => {
    const value = { offset: 40, note: 'ümlaut 🎉' };
    expect(decodeCursor(encodeCursor(value))).toEqual(value);
  });

  it('treats a missing or malformed cursor as "start over", not an error', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor('not-valid-base64url-json')).toBeUndefined();
  });

  // IA-5: a runtime without `atob`/`btoa` (a Hermes build with no engine
  // base64) must still page, and must produce the same cursors as one with
  // them -- a cursor encoded by the web build is decoded by the app.
  it('round trips without atob/btoa, byte for byte the same', () => {
    const value = { offset: 40, note: 'ümlaut 🎉', id: 'a-b_c' };
    const withGlobals = encodeCursor(value);
    try {
      vi.stubGlobal('atob', undefined);
      vi.stubGlobal('btoa', undefined);
      expect(encodeCursor(value)).toBe(withGlobals);
      expect(decodeCursor(withGlobals)).toEqual(value);
      expect(decodeCursor('not-valid-base64url-json')).toBeUndefined();
      // Every tail length, since the padding branches differ.
      for (const note of ['a', 'ab', 'abc', 'abcd']) {
        expect(decodeCursor(encodeCursor({ note }))).toEqual({ note });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('toPage', () => {
  it('has no nextCursor when the page is short (last page)', () => {
    const page = toPage([1, 2], 5, (last) => ({ offset: last }));
    expect(page.nextCursor).toBeNull();
  });

  it('has a nextCursor when the page is full', () => {
    const page = toPage([1, 2, 3], 3, (last) => ({ offset: last }));
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor)).toEqual({ offset: 3 });
  });
});
