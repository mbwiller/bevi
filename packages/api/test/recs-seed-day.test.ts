import { describe, expect, it } from 'vitest';

import { seedDay } from '../src/recs.ts';

describe('seedDay', () => {
  it('is the viewer\'s local day for a Postgres timestamp', () => {
    expect(seedDay('2026-11-20T04:59:59.123456+00:00', 'America/New_York')).toBe('2026-11-19');
  });
  it('falls back to the UTC date instead of throwing on an unknown timezone', () => {
    expect(seedDay('2026-11-20T04:59:59.123456+00:00', 'Not/AZone')).toBe('2026-11-20');
  });
  it('falls back instead of throwing on an unreadable timestamp', () => {
    expect(seedDay('garbage', 'America/New_York')).toBe('1970-01-01');
  });
});
