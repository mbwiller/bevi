import type { Venue } from '@bevi/shared';
import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/** Whose places the Map tab shows: the viewer's own, or those of the people they follow. */
export type MapScope = 'mine' | 'friends';

/**
 * What a post's place line does when tapped: the Map tab, opened on that venue in the view it is
 * in (`?venue=<id>&scope=<mine|friends>`, which the Map screen reads once and then forgets): the
 * viewer's own post opens You, anyone else's opens Friends. Undefined for a post with no place, so
 * the line is never a control that goes nowhere.
 */
export function openPlace(
  router: Pick<Router, 'push'>,
  venue: Pick<Venue, 'id'> | null | undefined,
  scope: MapScope,
): (() => void) | undefined {
  if (!venue) return undefined;
  const { id } = venue;
  return () => router.push({ pathname: '/map', params: { venue: id, scope } });
}
