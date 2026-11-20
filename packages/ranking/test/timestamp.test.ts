import { describe, expect, it } from 'vitest';

import { localDayKey, parseTimestamp } from '../src/index.ts';

const T = Date.UTC(2026, 10, 19, 23, 59, 1, 123);

describe('parseTimestamp', () => {
  it.each([
    ['2026-11-19T23:59:01.123456+00:00', T],
    ['2026-11-19T23:59:01.123456789Z', T],
    ['2026-11-19T23:59:01.123Z', T],
    ['2026-11-19T23:59:01.12Z', T - 3],
    ['2026-11-19T23:59:01Z', T - 123],
    ['2026-11-19 23:59:01.123456+00', T],
    ['2026-11-19T18:59:01.123456-05:00', T],
    ['2026-11-20T05:29:01.123456+0530', T],
    ['2026-11-19T23:59:01.123456z', T],
  ])('%s', (input, ms) => expect(parseTimestamp(input)).toBe(ms));

  it('is NaN, never a throw, for what is not a timestamp', () => {
    expect(parseTimestamp('')).toBeNaN();
    expect(parseTimestamp('yesterday')).toBeNaN();
  });
});

describe('localDayKey with six-digit fractions', () => {
  it('reads the local date', () => {
    expect(localDayKey('2026-11-19T23:59:01.123456+00:00', 'America/New_York')).toBe('2026-11-19');
    expect(localDayKey('2026-11-20T04:59:59.999999+00:00', 'America/New_York')).toBe('2026-11-19');
    expect(localDayKey('2026-11-20T05:00:00.000001+00:00', 'America/New_York')).toBe('2026-11-20');
  });
});
