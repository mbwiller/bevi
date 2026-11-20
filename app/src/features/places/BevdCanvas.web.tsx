import type { BevdCanvasProps } from './bevdCanvasTypes';
import { BevdPlaceList } from './BevdPlaceList';

export type { BevdCanvasProps } from './bevdCanvasTypes';

/**
 * The Map tab's surface on the web: the places as a list, where a row opens the same sheet a pin
 * does. BevdCanvas.tsx is the map, which is native only.
 */
export function BevdCanvas({ pins, selectedId, onSelect }: BevdCanvasProps) {
  return <BevdPlaceList pins={pins} selectedId={selectedId} onSelect={onSelect} />;
}
