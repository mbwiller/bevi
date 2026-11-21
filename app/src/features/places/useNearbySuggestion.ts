import type { VenueMatch } from '@bevi/shared';

import { useVenueSearch } from '@/api/hooks';

import { SUGGEST_WITHIN_M } from './copy';
import { usePosition } from './usePosition';

/**
 * The venue the user is most likely standing in, or null: the nearest one, when it is within
 * `SUGGEST_WITHIN_M`. It is offered, never applied, and it is asked for only when the position
 * needs no permission prompt (`usePosition`'s `quiet`): nobody tapped anything to get here, so a
 * browser dialog would be an interruption. The first time someone opens the picker they are
 * prompted there, and from then on this works.
 *
 * It reads the same query the picker's "Nearby" list does, so opening the picker afterwards is
 * instant.
 */
export function useNearbySuggestion(active: boolean): VenueMatch | null {
  const position = usePosition(active, true);
  const near = position.kind === 'ok' ? position.position : null;
  const nearby = useVenueSearch('', near, active && near !== null);
  const first = near ? nearby.data?.[0] : undefined;
  return first && first.distanceMeters !== null && first.distanceMeters <= SUGGEST_WITHIN_M ? first : null;
}
