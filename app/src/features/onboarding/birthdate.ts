/**
 * Birthdate entry for onboarding (§6.2): one text field typed as digits and shown as YYYY-MM-DD,
 * which works the same on web and iOS Safari (the numeric keypad has no dash, so the dashes are
 * inserted as you type).
 */

const ADULT_AGE = 21;
const MIN_YEAR = 1900;

/** Keeps the digits (at most 8) and inserts the dashes: "1990051" → "1990-05-1". */
export function maskBirthdate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

export type BirthdateProblem = 'incomplete' | 'invalid' | 'future';

/** null when `value` is a real past date (YYYY-MM-DD) from 1900 on, as `setBirthDate` requires. */
export function birthdateProblem(value: string, today: Date = new Date()): BirthdateProblem | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return 'incomplete';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < MIN_YEAR || date.toISOString().slice(0, 10) !== value) return 'invalid';
  if (value > localIsoDate(today)) return 'future';
  return null;
}

/**
 * Whether someone born on `value` is under 21 today. Only for the onboarding note: the server
 * computes `canSeeAlcohol`, and the app hides categories from that.
 */
export function isUnder21(value: string, today: Date = new Date()): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const birthdayThisYear = `${today.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const age = today.getFullYear() - y - (localIsoDate(today) < birthdayThisYear ? 1 : 0);
  return age < ADULT_AGE;
}

function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The device's IANA timezone, sent silently with the profile (§3). */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
