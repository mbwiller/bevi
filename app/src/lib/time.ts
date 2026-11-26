import { parseTimestamp } from '@bevi/ranking';

// Relative times in the design system's voice: "Just now", "5 minutes ago", "5 hours ago", a weekday
// within the last week ("Wednesday"), then a short date ("Oct 3", or "Oct 3, 2025" in another year).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** "Oct 3", with the year when it isn't `now`'s year. Local time. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(parseTimestamp(iso));
  if (Number.isNaN(d.getTime())) return '';
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/**
 * A Bev of the period's `periodStart` ('YYYY-MM-DD', the New York date it began) as its card prints it:
 * "Oct 17" for a day, "Week of Oct 12" for a week, with the year when it isn't `now`'s. It reads the
 * string itself, so no time zone can move the date.
 */
export function formatPeriodStart(periodStart: string, period: 'day' | 'week', now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return '';
  const year = Number(m[1]);
  const date = `${month} ${Number(m[3])}${year === now.getFullYear() ? '' : `, ${year}`}`;
  return period === 'day' ? date : `Week of ${date}`;
}

/** How long ago an ISO timestamp was, as a FeedPost prints it. Future times (clock skew) read "Just now". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = parseTimestamp(iso);
  if (Number.isNaN(t)) return '';
  const diff = now.getTime() - t;
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour');
  if (diff < WEEK) return WEEKDAYS[new Date(t).getDay()]!;
  return formatShortDate(iso, now);
}

/**
 * A NotificationRow's short age: "now" under a minute (and for future times), then "5m", "3h", "2d",
 * and "3w" from seven days up.
 */
export function formatShortAge(iso: string, now: Date = new Date()): string {
  const t = parseTimestamp(iso);
  if (Number.isNaN(t)) return '';
  const diff = now.getTime() - t;
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  return `${Math.floor(diff / WEEK)}w`;
}

/** The Notifications screen's sections, in order. */
export type NotificationSection = 'new' | 'today' | 'week' | 'earlier';

/** Each section's SectionHeader title (SectionHeader draws the caps). */
export const NOTIFICATION_SECTION_TITLES: Record<NotificationSection, string> = {
  new: 'New',
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
};

/**
 * Which section a notification sits under: everything unread is "New"; a read one is "Today" on
 * `now`'s local calendar day, "This week" within the last seven days (rolling, as
 * `formatRelativeTime`'s weekday branch), else "Earlier".
 */
export function notificationSection(n: { unread: boolean; createdAt: string }, now: Date = new Date()): NotificationSection {
  if (n.unread) return 'new';
  const t = parseTimestamp(n.createdAt);
  if (Number.isNaN(t)) return 'earlier';
  const d = new Date(t);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return 'today';
  return now.getTime() - t < WEEK ? 'week' : 'earlier';
}
