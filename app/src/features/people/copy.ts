import type { Profile } from '@bevi/shared';

/** How many of the people behind "Followed by …" are named; `follows.suggested` lists at most this many. */
export const FOLLOWED_BY_NAMED = 2;

/** A person as the People screen names them: the display name, or `@handle` without one. */
export function personName(p: Pick<Profile, 'displayName' | 'handle'>): string {
  return p.displayName.trim() || `@${p.handle}`;
}

const others = (n: number) => `${n} ${n === 1 ? 'other' : 'others'}`;

/**
 * A suggested person's context line (UserRow's `context`), from `SuggestedProfile.followedBy` and
 * `followedByCount`: "Followed by Sam", "Followed by Sam and Arjun", "Followed by Sam, Arjun and 3
 * others". Undefined when nobody you follow follows them, so the row has no third line.
 */
export function followedByContext(
  followedBy: readonly Pick<Profile, 'displayName' | 'handle'>[],
  followedByCount: number,
): string | undefined {
  const names = followedBy.slice(0, FOLLOWED_BY_NAMED).map(personName);
  const total = Math.max(followedByCount, names.length);
  if (total === 0) return undefined;
  const rest = total - names.length;
  // The contract always names someone when the count is above 0; this only guards a bad row.
  if (names.length === 0) return `Followed by ${total} ${total === 1 ? 'person' : 'people'} you follow`;
  if (names.length === 1) return rest > 0 ? `Followed by ${names[0]} and ${others(rest)}` : `Followed by ${names[0]}`;
  return rest > 0 ? `Followed by ${names[0]}, ${names[1]} and ${others(rest)}` : `Followed by ${names[0]} and ${names[1]}`;
}
