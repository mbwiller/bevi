import { memberSince } from '@/features/profile/copy';
import { formatRelativeTime, formatShortDate } from '../time';

// Postgres timestamps carry six fraction digits and a +00:00 offset.
const NOW = new Date('2026-11-19T12:00:00.000Z');

it('reads a Postgres timestamp for a relative time and a short date', () => {
  expect(formatRelativeTime('2026-11-19T11:54:59.123456+00:00', NOW)).toBe('5 minutes ago');
  expect(formatShortDate('2025-10-03T12:00:00.123456+00:00', NOW)).toMatch(/^Oct (2|3), 2025$/);
});

it('reads one for Member since', () => {
  expect(memberSince('2026-10-15T12:00:00.123456+00:00')).toBe('Member since Oct 2026');
});
