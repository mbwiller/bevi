import type { Venue } from '@bevi/shared';
import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/**
 * What a post's place line does when tapped: the Map tab, opened on that venue (`?venue=<id>`,
 * which the Map screen reads once and then forgets). Undefined for a post with no place, so the
 * line is never a control that goes nowhere.
 */
export function openPlace(router: Pick<Router, 'push'>, venue: Pick<Venue, 'id'> | null | undefined): (() => void) | undefined {
  if (!venue) return undefined;
  const { id } = venue;
  return () => router.push({ pathname: '/map', params: { venue: id } });
}
