// The glyph for a kind of place (BEV-22): the same one on a picker row, a row of the Map tab's list
// and a pin on the map.

import { PLACE_TYPES, type PlaceType } from '@bevi/shared';

import type { IconName } from '@/components/Icon';

/**
 * A cup for a cafe, a can for a shop, a glass for a bar, a wine glass for a shop that sells
 * alcohol. A restaurant is a shop front, the nearest thing the icon set has to one; a place
 * nothing has typed is a plain pin.
 */
export const PLACE_ICON: Record<PlaceType, IconName> = {
  cafe: 'coffee',
  store: 'cup-soda',
  bar: 'martini',
  liquor: 'wine',
  restaurant: 'store',
  other: 'map-pin',
};

/** The glyph for a place type, or the plain pin for none (a result that is not a venue yet may have one too). */
export function placeIcon(placeType: PlaceType | null | undefined): IconName {
  return placeType && PLACE_TYPES.includes(placeType) ? PLACE_ICON[placeType] : 'map-pin';
}

/** How a screen reader names the type, for where the glyph is the only thing that says it. */
export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  cafe: 'cafe',
  store: 'shop',
  bar: 'bar',
  liquor: 'liquor shop',
  restaurant: 'restaurant',
  other: 'place',
};
