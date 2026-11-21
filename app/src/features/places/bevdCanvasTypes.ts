// What BevdCanvas.tsx and BevdCanvas.web.tsx share. A file of its own because neither of those can
// import the other: on the web './BevdCanvas' resolves to BevdCanvas.web.tsx.

import type { BevdPin } from '@bevi/shared';

export interface BevdCanvasProps {
  pins: readonly BevdPin[];
  selectedId: string | null;
  onSelect: (venueId: string) => void;
  /** Deselects (a tap on the map itself). */
  onClear: () => void;
}
