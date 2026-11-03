/**
 * The `opening_hours` subset we are willing to claim we understand (A-08).
 *
 * WHY THIS LIVES IN `shared/` rather than next to one of its callers: three
 * places have to agree on what `Venue.hoursKnown` promises and what
 * `VenuePin.openNow` means. The importer sets the column
 * (`scripts/venues/import-core.ts`), the FakeApi answers `openNow` for the app
 * (`app/src/testing/fakeApi`), and `venue_open_at` answers it for real
 * (`20261102000400`). The first two can share this file; SQL cannot, so it
 * carries its own copy of exactly this grammar, pinned by pgTAP against the
 * same cases the tests here use. Two definitions is the floor; three was not.
 *
 * The board (TASKS.md A-08) suggested the `opening_hours` npm parser. This is
 * deliberately not that: `scripts/` takes no dependencies, and more
 * importantly "Open now is best-effort" (A-08) is satisfied by being honest
 * about what we do not understand. If the parser is ever adopted it has to
 * replace this file AND `venue_open_at` together, or the column will say
 * "known" while the evaluator disagrees.
 *
 * ACCEPTED: one or more `<days> HH:MM-HH:MM` rules joined by `;`, where days
 * are a weekday, an ASCENDING weekday range, or a comma list of either;
 * `24:00` is allowed as a closing time only; the close is strictly after the
 * open; and across rules the day sets are DISJOINT.
 *
 * Each exclusion is a case where a naive reading would be WRONG rather than
 * unknown, which is the whole point:
 *
 *   * `;` is an OVERRIDE separator in the spec, not "and also". In
 *     `Mo-Su 11:00-22:00; We 11:00-15:00` the Wednesday rule REPLACES the
 *     general one, so OR-ing the rules claims open at 20:00 on a Wednesday.
 *     Disjoint day sets are exactly the case where override and union agree.
 *   * An OVERNIGHT range (`Mo-Su 18:00-02:00`) needs wrap-around handling, and
 *     bars and pubs are imported, so it is the normal case for some venues.
 *   * A BACKWARDS day range (`Fr-Mo`) wraps the week.
 *
 * Everything else outside the grammar -- `24/7`, `PH off`, month ranges,
 * `sunrise`, open-ended `07:00+` -- is unknown too, so the UI says "Hours
 * unknown" instead of guessing.
 */

/** Monday = 0, matching `venue_open_at`'s `weekday_index` and isodow - 1. */
const DAY_INDEX: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };

const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const DAY_PART = `${DAY}(?:-${DAY})?`;
const DAYS = `${DAY_PART}(?:,${DAY_PART})*`;
const TIME = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
const CLOSE = `(?:${TIME}|24:00)`;
const RULE = new RegExp(`^(${DAYS}) (${TIME})-(${CLOSE})$`);

export interface HoursRule {
  /** Day indices the rule covers, Monday = 0. */
  days: number[];
  /** Minutes from midnight. `close` may be 1440, for 24:00. */
  open: number;
  close: number;
}

const minutes = (hhmm: string): number => {
  const parts = hhmm.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
};

/** `Mo-We,Fr` -> [0, 1, 2, 4]; null if a range runs backwards or a day repeats. */
function dayList(spec: string): number[] | null {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [from, to] = part.split('-');
    const a = from === undefined ? undefined : DAY_INDEX[from];
    if (a === undefined) return null;
    if (to === undefined) {
      out.push(a);
      continue;
    }
    const b = DAY_INDEX[to];
    if (b === undefined || b <= a) return null;
    for (let d = a; d <= b; d += 1) out.push(d);
  }
  return new Set(out).size === out.length ? out : null;
}

/** The parsed rules, or null when the string is outside the grammar above. */
export function parseHours(hoursOsm: string | null): HoursRule[] | null {
  if (hoursOsm === null) return null;
  const trimmed = hoursOsm.trim();
  if (trimmed === '') return null;

  const rules: HoursRule[] = [];
  const claimed = new Set<number>();
  for (const raw of trimmed.split(';')) {
    const m = RULE.exec(raw.trim());
    if (m === null) return null;
    const days = m[1] === undefined ? null : dayList(m[1]);
    if (days === null) return null;
    for (const d of days) {
      if (claimed.has(d)) return null;
      claimed.add(d);
    }
    const open = minutes(m[2] as string);
    const close = m[3] === '24:00' ? 24 * 60 : minutes(m[3] as string);
    if (close <= open) return null;
    rules.push({ days, open, close });
  }
  return rules;
}

/** What `Venue.hoursKnown` promises: this string is one we can evaluate. */
export function hoursKnown(hoursOsm: string | null): boolean {
  return parseHours(hoursOsm) !== null;
}

/**
 * Whether the venue is open at `at`, or null when the string is not one we
 * understand. New York time, because the venues are in New York by
 * construction (decision 36) -- the same choice `venue_open_at` makes.
 */
export function openAt(hoursOsm: string | null, at: Date): boolean | null {
  const rules = parseHours(hoursOsm);
  if (rules === null) return null;

  // `en-GB` gives a 24-hour clock and a stable `Mon`-style weekday.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';

  const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dow = WEEKDAY[get('weekday')];
  if (dow === undefined) return null;
  // 24:00 arrives as hour "24" in some ICU versions at exactly midnight.
  const minute = (Number(get('hour')) % 24) * 60 + Number(get('minute'));

  return rules.some((r) => r.days.includes(dow) && minute >= r.open && minute < r.close);
}
