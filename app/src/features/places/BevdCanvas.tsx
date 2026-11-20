import type { BevdPin } from '@bevi/shared';

import { BevdPlaceList } from './BevdPlaceList';

export interface BevdCanvasProps {
  pins: readonly BevdPin[];
  selectedId: string | null;
  onSelect: (venueId: string) => void;
  /** Deselects (a tap on the map itself). */
  onClear: () => void;
}

/**
 * The Map tab's surface: the places as a list. The native map needs a map library, which is a
 * native dependency and so its own change (DEVELOPMENT-MATT-IOS.md); until it lands, everything
 * the map would show is here, and a row opens the same sheet a pin does. The web build keeps
 * this list.
 */
export function BevdCanvas({ pins, selectedId, onSelect }: BevdCanvasProps) {
  return <BevdPlaceList pins={pins} selectedId={selectedId} onSelect={onSelect} />;
}
