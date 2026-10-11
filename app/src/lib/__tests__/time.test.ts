import { formatRelativeTime, formatShortDate } from '../time';

// Local-time dates so the weekday and date checks hold in any time zone.
const NOW = new Date(2026, 9, 11, 12, 0, 0); // Sunday, Oct 11 2026, noon
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

it('says "Just now" under a minute, and for future times', () => {
  expect(formatRelativeTime(before(30_000), NOW)).toBe('Just now');
  expect(formatRelativeTime(before(-5 * MIN), NOW)).toBe('Just now');
});

it('counts minutes and hours in words', () => {
  expect(formatRelativeTime(before(MIN), NOW)).toBe('1 minute ago');
  expect(formatRelativeTime(before(45 * MIN), NOW)).toBe('45 minutes ago');
  expect(formatRelativeTime(before(HOUR), NOW)).toBe('1 hour ago');
  expect(formatRelativeTime(before(5 * HOUR + 59 * MIN), NOW)).toBe('5 hours ago');
});

it('names the weekday within the last week', () => {
  expect(formatRelativeTime(before(DAY), NOW)).toBe('Saturday');
  expect(formatRelativeTime(new Date(2026, 9, 7, 9, 0).toISOString(), NOW)).toBe('Wednesday');
});

it('falls back to a short date, with the year only when it differs', () => {
  expect(formatRelativeTime(new Date(2026, 9, 3, 18, 0).toISOString(), NOW)).toBe('Oct 3');
  expect(formatRelativeTime(new Date(2025, 11, 24, 8, 0).toISOString(), NOW)).toBe('Dec 24, 2025');
  expect(formatShortDate(new Date(2026, 0, 1).toISOString(), NOW)).toBe('Jan 1');
});

it('returns an empty string for an invalid timestamp', () => {
  expect(formatRelativeTime('not a date', NOW)).toBe('');
  expect(formatShortDate('', NOW)).toBe('');
});
