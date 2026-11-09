import type { VenueFilters } from '@bevi/shared';

import { MapPlaceholder } from './MapPlaceholder';

export interface MapViewProps {
  /** The search results panel covers the map: it takes no gestures, keys or focus. */
  passive: boolean;
  /** `venues.inView` filters (part 2's filter row). */
  filters?: VenueFilters;
}

/**
 * The Search tab's map area off the web. Bevi ships only as a web app (MapView.web.tsx is the live
 * Google map), so this is what jest renders: the placeholder, and nothing that loads Google.
 */
export function MapView(_props: MapViewProps) {
  return <MapPlaceholder />;
}
