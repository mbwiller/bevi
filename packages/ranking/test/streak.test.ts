import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeStreak, dayKeyFromNumber, dayNumber, isoWeekKey, localDayKey, localPeriodKey } from '../src/index.ts';

describe('localDayKey', () => {
  it.each([
    ['2026-10-11T06:59:00Z', 'America/Los_Angeles', '2026-10-10'], // 23:59 PDT
    ['2026-10-11T07:00:00Z', 'America/Los_Angeles', '2026-10-11'], // 00:00 PDT
    ['2026-03-08T07:59:00Z', 'America/Los_Angeles', '2026-03-07'], // 23:59 PST, the night clocks spring forward
    ['2026-03-09T06:59:00Z', 'America/Los_Angeles', '2026-03-08'], // 23:59 PDT on the 23-hour day
    ['2026-11-02T07:59:00Z', 'America/Los_Angeles', '2026-11-01'], // 23:59 PST on the 25-hour day
    ['2026-10-10T23:59:59Z', 'UTC', '2026-10-10'],
    ['2026-10-10T18:29:00Z', 'Asia/Kolkata', '2026-10-10'], // 23:59 IST
    ['2026-10-10T18:30:00Z', 'Asia/Kolkata', '2026-10-11'],
    ['2026-10-10T23:59:00-07:00', 'America/Los_Angeles', '2026-10-10'],
  ])('%s in %s → %s', (iso, tz, key) => {
    expect(localDayKey(iso, tz)).toBe(key);
  });

  it('rejects bad input', () => {
    expect(() => localDayKey('not a date', 'UTC')).toThrow(RangeError);
    expect(() => localDayKey('2026-10-10T00:00:00Z', 'Mars/Olympus')).toThrow();
  });

  it('gives week keys for period week', () => {
    expect(localPeriodKey('2026-10-11T06:59:00Z', 'America/Los_Angeles', 'week')).toBe('2026-W41');
  });
});

describe('isoWeekKey', () => {
  it.each([
    ['2026-01-01', '2026-W01'], // Thursday
    ['2027-01-01', '2026-W53'], // Friday: belongs to 2026's last week
    ['2024-12-30', '2025-W01'], // Monday
    ['2021-01-03', '2020-W53'],
    ['2026-10-11', '2026-W41'], // Sunday
    ['2026-10-12', '2026-W42'], // Monday
  ])('%s → %s', (day, week) => {
    expect(isoWeekKey(day)).toBe(week);
  });
});

describe('dayNumber', () => {
  it('round-trips and rejects impossible dates', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2026-10-11') - dayNumber('2026-10-10')).toBe(1);
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2);
    expect(() => dayNumber('2026-02-29')).toThrow(RangeError);
    expect(() => dayNumber('2026-10-1')).toThrow(RangeError);
    fc.assert(fc.property(fc.integer({ min: -100_000, max: 100_000 }), (n) => dayNumber(dayKeyFromNumber(n)) === n));
  });
});

describe('computeStreak', () => {
  it.each([
    { name: 'no rankings', keys: [], today: '2026-10-11', want: { current: 0, longest: 0, lastKey: null } },
    { name: 'today only', keys: ['2026-10-11'], today: '2026-10-11', want: { current: 1, longest: 1, lastKey: '2026-10-11' } },
    { name: 'alive from yesterday', keys: ['2026-10-08', '2026-10-09', '2026-10-10'], today: '2026-10-11', want: { current: 3, longest: 3, lastKey: '2026-10-10' } },
    { name: 'broken', keys: ['2026-10-08', '2026-10-09'], today: '2026-10-11', want: { current: 0, longest: 2, lastKey: '2026-10-09' } },
    { name: 'duplicates count once', keys: ['2026-10-11', '2026-10-11', '2026-10-10'], today: '2026-10-11', want: { current: 2, longest: 2, lastKey: '2026-10-11' } },
    { name: 'longest earlier', keys: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-11'], today: '2026-10-11', want: { current: 1, longest: 4, lastKey: '2026-10-11' } },
    { name: 'across a month end', keys: ['2026-09-30', '2026-10-01'], today: '2026-10-01', want: { current: 2, longest: 2, lastKey: '2026-10-01' } },
    { name: 'future keys ignored', keys: ['2026-10-12', '2026-10-11'], today: '2026-10-11', want: { current: 1, longest: 1, lastKey: '2026-10-11' } },
  ])('$name', ({ keys, today, want }) => {
    expect(computeStreak(keys, today)).toEqual(want);
  });

  it('counts ISO weeks for period week, across a year boundary', () => {
    expect(computeStreak(['2026-W52', '2026-W53', '2027-W01'], '2027-W02', 'week')).toEqual({ current: 3, longest: 3, lastKey: '2027-W01' });
    expect(computeStreak(['2025-W52', '2026-W01'], '2026-W01', 'week')).toEqual({ current: 2, longest: 2, lastKey: '2026-W01' });
    expect(() => computeStreak(['2025-W53'], '2026-W01', 'week')).toThrow(RangeError);
  });

  const keySet = fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 40 });

  it('adding a day never lowers current or longest', () => {
    fc.assert(
      fc.property(keySet, fc.integer({ min: 0, max: 60 }), (days, extra) => {
        const base = 20000;
        const today = dayKeyFromNumber(base + 60);
        const keys = days.map((d) => dayKeyFromNumber(base + d));
        const a = computeStreak(keys, today);
        const b = computeStreak([...keys, dayKeyFromNumber(base + extra)], today);
        return b.current >= a.current && b.longest >= a.longest && a.current <= a.longest && a.current >= 0;
      }),
    );
  });

  it('a full run ending today has current = longest = its length', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), (len) => {
        const today = 20500;
        const keys = Array.from({ length: len }, (_, i) => dayKeyFromNumber(today - i));
        const r = computeStreak(keys, dayKeyFromNumber(today));
        return r.current === len && r.longest === len;
      }),
    );
  });
});
