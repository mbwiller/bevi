// A tolerant parser for the timestamps the backend sends. Postgres writes
// 2026-11-19T23:59:01.123456+00:00 (six fraction digits, a colon offset), a shape ECMAScript only
// guarantees to a millisecond (three digits); an engine is free to reject the rest, and a rejected
// timestamp must not take a screen down. This shapes the string into the one every engine parses,
// then lets Date.parse decide. It changes no instant: digits past the millisecond are dropped.

const FRACTION = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** Milliseconds since the epoch of a backend timestamp, or NaN when it is not one. */
export function parseTimestamp(value: string): number {
  const m = FRACTION.exec(value.trim());
  if (!m) return Date.parse(value);
  const [, date, time, fraction, zone] = m;
  let offset = zone ?? '';
  if (/^[+-]\d{2}$/.test(offset)) offset += ':00';
  else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const ms = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
  return Date.parse(`${date}T${time}${ms}${offset.toUpperCase()}`);
}
