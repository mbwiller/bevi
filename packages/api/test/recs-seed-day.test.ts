import { afterEach, describe, expect, it, vi } from 'vitest';

import { seedDay } from '../src/recs.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('seedDay', () => {
  it('is the viewer\'s local day for a Postgres timestamp', () => {
    expect(seedDay('2026-11-20T04:59:59.123456+00:00', 'America/New_York')).toBe('2026-11-19');
  });
  it('falls back to the UTC date instead of throwing on an unknown timezone', () => {
    expect(seedDay('2026-11-20T04:59:59.123456+00:00', 'Not/AZone')).toBe('2026-11-20');
  });
  it('falls back to today\'s UTC date instead of throwing on an unreadable timestamp', () => {
    vi.useFakeTimers();
    // Still the 19th in New York: the fallback is the UTC date, not a local one.
    vi.setSystemTime(new Date('2026-11-20T03:00:00Z'));
    expect(seedDay('garbage', 'America/New_York')).toBe('2026-11-20');
    expect(seedDay('garbage', 'Not/AZone')).toBe('2026-11-20');
  });
  it('does not freeze the shuffle for an unreadable timestamp: the next day is a different day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T23:59:59Z'));
    const today = seedDay('garbage', 'America/New_York');
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'));
    expect(seedDay('garbage', 'America/New_York')).not.toBe(today);
  });
});
