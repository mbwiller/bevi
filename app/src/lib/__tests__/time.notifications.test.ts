import { formatShortAge, notificationSection } from '../time';

// Local-time dates so the calendar-day checks hold in any time zone.
const NOW = new Date(2026, 9, 11, 12, 0, 0); // Sunday, Oct 11 2026, noon
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatShortAge', () => {
  it('says "now" under a minute, and for future times', () => {
    expect(formatShortAge(before(0), NOW)).toBe('now');
    expect(formatShortAge(before(59_000), NOW)).toBe('now');
    expect(formatShortAge(before(-5 * MIN), NOW)).toBe('now');
  });

  it('counts minutes, hours, days, then weeks from seven days', () => {
    expect(formatShortAge(before(MIN), NOW)).toBe('1m');
    expect(formatShortAge(before(5 * MIN + 30_000), NOW)).toBe('5m');
    expect(formatShortAge(before(59 * MIN), NOW)).toBe('59m');
    expect(formatShortAge(before(HOUR), NOW)).toBe('1h');
    expect(formatShortAge(before(3 * HOUR), NOW)).toBe('3h');
    expect(formatShortAge(before(23 * HOUR + 59 * MIN), NOW)).toBe('23h');
    expect(formatShortAge(before(DAY), NOW)).toBe('1d');
    expect(formatShortAge(before(2 * DAY), NOW)).toBe('2d');
    expect(formatShortAge(before(7 * DAY - MIN), NOW)).toBe('6d');
    expect(formatShortAge(before(7 * DAY), NOW)).toBe('1w');
    expect(formatShortAge(before(21 * DAY + HOUR), NOW)).toBe('3w');
  });

  it('returns an empty string for an invalid timestamp', () => {
    expect(formatShortAge('not a date', NOW)).toBe('');
  });
});

describe('notificationSection', () => {
  const read = (createdAt: string) => ({ unread: false, createdAt });

  it('puts everything unread under New, however old', () => {
    expect(notificationSection({ unread: true, createdAt: before(MIN) }, NOW)).toBe('new');
    expect(notificationSection({ unread: true, createdAt: before(30 * DAY) }, NOW)).toBe('new');
  });

  it('puts a read row from the same local calendar day under Today', () => {
    expect(notificationSection(read(before(MIN)), NOW)).toBe('today');
    expect(notificationSection(read(new Date(2026, 9, 11, 0, 1).toISOString()), NOW)).toBe('today');
  });

  it('puts yesterday and the rest of the last seven days under This week', () => {
    expect(notificationSection(read(new Date(2026, 9, 10, 23, 59).toISOString()), NOW)).toBe('week');
    expect(notificationSection(read(before(6 * DAY)), NOW)).toBe('week');
    expect(notificationSection(read(before(7 * DAY - MIN)), NOW)).toBe('week');
  });

  it('puts anything seven days old or more under Earlier', () => {
    expect(notificationSection(read(before(7 * DAY)), NOW)).toBe('earlier');
    expect(notificationSection(read(before(40 * DAY)), NOW)).toBe('earlier');
    expect(notificationSection(read('not a date'), NOW)).toBe('earlier');
  });
});
