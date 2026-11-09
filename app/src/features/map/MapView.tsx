import type { VenueFilters } from '@bevi/shared';

import { MapPlaceholder } from './MapPlaceholder';

export interface MapViewProps {
  /** The search results panel covers the map: it takes no gestures, keys or focus, and the full-screen map closes. */
  passive: boolean;
  /** The map's filters, as the Search feature holds them (features/search/mapFilters.ts). */
  filters?: VenueFilters;
  /** The filter row changed them. */
  onFiltersChange?: (filters: VenueFilters) => void;
  /**
   * The Search tab is the screen on display. While it isn't (a Bev page pushed from the VenueSheet),
   * the full-screen map steps aside and comes back as it was on return. Default true.
   */
  active?: boolean;
}

/**
 * The Search tab's map area off the web. Bevi ships only as a web app (MapView.web.tsx is the live
 * Google map), so this is what jest renders: the placeholder, and nothing that loads Google.
 */
export function MapView(_props: MapViewProps) {
  return <MapPlaceholder />;
}
