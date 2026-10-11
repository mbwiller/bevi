// Streaks (§8.14): consecutive local days (or ISO weeks) with at least one ranking.
// Day key = the calendar date of ranking.created_at in the user's profile timezone.
// SQL twin: (created_at AT TIME ZONE profile.timezone)::date.
//
// Calendar arithmetic is done on integer day numbers (days since 1970-01-01), so nothing here
// depends on the host's timezone. Only `localDayKey` touches Intl, to convert an instant to a
// local date; the server derives day keys itself and only needs the vectors.

import { STREAK_PERIOD } from './constants.ts';
import type { StreakPeriod, StreakResult } from './types.ts';

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
/** An ISO 8601 date-time that pins its instant: ends in Z or an explicit ±HH:MM / ±HHMM offset. */
const ZONED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's days_from_civil). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [era * 400 + yoe + (m <= 2 ? 1 : 0), m, d];
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** 'YYYY-MM-DD' → days since 1970-01-01. Throws on a malformed or impossible date. */
export function dayNumber(dayKey: string): number {
  const m = DAY_KEY.exec(dayKey);
  if (!m) throw new RangeError(`invalid day key "${dayKey}" (want YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const n = daysFromCivil(y, mo, d);
  const back = civilFromDays(n);
  if (back[0] !== y || back[1] !== mo || back[2] !== d) throw new RangeError(`invalid day key "${dayKey}"`);
  return n;
}

/** Days since 1970-01-01 → 'YYYY-MM-DD'. */
export function dayKeyFromNumber(n: number): string {
  const [y, m, d] = civilFromDays(n);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** ISO weekday, Monday = 1 … Sunday = 7. 1970-01-01 was a Thursday. */
function isoWeekday(n: number): number {
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** ISO week key 'YYYY-Www' of a local day key (the ISO year is the year of that week's Thursday). */
export function isoWeekKey(dayKey: string): string {
  const n = dayNumber(dayKey);
  const thursday = n - isoWeekday(n) + 4;
  const [year] = civilFromDays(thursday);
  const week = Math.floor((thursday - daysFromCivil(year, 1, 1)) / 7) + 1;
  return `${pad(year, 4)}-W${pad(week, 2)}`;
}

/** Day number of the Monday of an ISO week 'YYYY-Www'. Throws on a malformed or non-existent week. */
function weekMonday(weekKey: string): number {
  const m = WEEK_KEY.exec(weekKey);
  if (!m) throw new RangeError(`invalid week key "${weekKey}" (want YYYY-Www)`);
  const [y, w] = [Number(m[1]), Number(m[2])];
  const jan4 = daysFromCivil(y, 1, 4);
  const monday = jan4 - (isoWeekday(jan4) - 1) + (w - 1) * 7;
  if (w < 1 || isoWeekKey(dayKeyFromNumber(monday)) !== weekKey) throw new RangeError(`invalid week key "${weekKey}"`);
  return monday;
}

/** Consecutive integer per period: day number, or week index (Mondays are ≡ 4 mod 7). */
function periodOrdinal(key: string, period: StreakPeriod): number {
  return period === 'day' ? dayNumber(key) : (weekMonday(key) - 4) / 7;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar date ('YYYY-MM-DD') of an instant in an IANA timezone. DST is handled by the zone
 * conversion; a ranking at 23:59 local belongs to that local day. Throws on an unparseable
 * timestamp or an unknown timezone. Intl-based: used by the app and tests, not by SQL.
 * The timestamp must carry `Z` or an explicit offset: a bare local time would be parsed in the
 * host's timezone, which must never leak into a streak.
 */
export function localDayKey(isoTimestamp: string, timeZone: string): string {
  if (!ZONED_TIMESTAMP.test(isoTimestamp)) {
    throw new RangeError(`timestamp "${isoTimestamp}" must be ISO 8601 with Z or an explicit UTC offset`);
  }
  const ms = Date.parse(isoTimestamp);
  if (Number.isNaN(ms)) throw new RangeError(`invalid timestamp "${isoTimestamp}"`);
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${pad(get('year'), 4)}-${pad(get('month'), 2)}-${pad(get('day'), 2)}`;
}

/** The streak key of an instant: the local day key, or its ISO week for period 'week' (default STREAK_PERIOD). */
export function localPeriodKey(isoTimestamp: string, timeZone: string, period: StreakPeriod = STREAK_PERIOD): string {
  const day = localDayKey(isoTimestamp, timeZone);
  return period === 'day' ? day : isoWeekKey(day);
}

/**
 * Current and longest streak from the set of period keys with ≥ 1 ranking (duplicates count once).
 *
 * - current: walk back from `todayKey`. If today is in the set, start there; else if the previous
 *   period is (alive, not extended yet), start there; else 0. Count consecutive periods.
 * - longest: the longest consecutive run anywhere.
 *
 * Keys after `todayKey` are ignored (the result is "as of today"; such keys only arise from a
 * timezone change and the SQL twin, which updates incrementally, never sees them).
 * `lastKey` = the latest key on or before today, or null.
 */
export function computeStreak(periodKeys: readonly string[], todayKey: string, period: StreakPeriod = STREAK_PERIOD): StreakResult {
  const today = periodOrdinal(todayKey, period);
  const byOrdinal = new Map<number, string>();
  for (const key of periodKeys) {
    const o = periodOrdinal(key, period);
    if (o <= today) byOrdinal.set(o, key);
  }
  const ordinals = [...byOrdinal.keys()].sort((a, b) => a - b);
  if (ordinals.length === 0) return { current: 0, longest: 0, lastKey: null };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < ordinals.length; i++) {
    run = (ordinals[i] as number) === (ordinals[i - 1] as number) + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let start = byOrdinal.has(today) ? today : byOrdinal.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (start !== null && byOrdinal.has(start)) {
    current++;
    start--;
  }
  const last = ordinals[ordinals.length - 1] as number;
  return { current, longest, lastKey: byOrdinal.get(last) ?? null };
}
