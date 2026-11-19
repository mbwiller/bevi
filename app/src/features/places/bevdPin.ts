// A pin on the map of where Bevs were had (BEV-22): the look, as CSS text and a label, built by
// pure functions so jest checks them without a DOM or Google. BevdCanvas.web.tsx applies them to
// the element an AdvancedMarkerElement shows.
//
// A disc with the number of Bevs had there. Filled `primary` when some are the viewer's own;
// `surface` with a `primary` ring when they are all friends'. Never colour alone: the accessible
// label says which, and the number is the same either way.

import type { BevdPin } from '@bevi/shared';

import { type, type Colors } from '@/theme';

import { bevCount } from './copy';

/** The disc, and the selected one. No token names a map pin. */
export const PIN = 34;
export const PIN_SELECTED = 42;
const RING = 2;
/** Marker stacking: the selected pin above every other, then the busier place on top. */
export const SELECTED_Z = 10_000;

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** What the disc shows: the count, capped so three digits never overflow it. */
export function pinText(pin: Pick<BevdPin, 'bevCount'>): string {
  return pin.bevCount > 99 ? '99+' : String(pin.bevCount);
}

/** "Duane Reade, 3 Bevs, 1 yours": the marker's title and accessible name. */
export function pinLabel(pin: BevdPin): string {
  const whose =
    pin.mineCount === 0 ? 'from people you follow' : pin.mineCount === pin.bevCount ? 'yours' : `${pin.mineCount} yours`;
  return `${pin.venue.name}, ${bevCount(pin.bevCount)}, ${whose}`;
}

export function pinZIndex(pin: Pick<BevdPin, 'bevCount'>, selected: boolean): number {
  return selected ? SELECTED_Z : Math.min(pin.bevCount, SELECTED_Z - 1);
}

/** The disc's inline CSS. */
export function pinCss(pin: Pick<BevdPin, 'mineCount'>, look: { colors: Colors; selected: boolean; reduced: boolean }): string {
  const { colors, selected, reduced } = look;
  const d = selected ? PIN_SELECTED : PIN;
  const mine = pin.mineCount > 0;
  const t = type.heading;
  return (
    `width:${d}px;height:${d}px;border-radius:${d / 2}px;box-sizing:border-box;` +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;' +
    `background:${mine ? colors.primary : colors.surface};color:${mine ? colors.onPrimary : colors.primary};` +
    `border:${RING}px solid ${mine ? colors.surface : colors.primary};` +
    `box-shadow:0 1px 4px ${colors.scrim};` +
    `font:${t.fontWeight} ${selected ? t.fontSize : t.fontSize - 2}px/1 ${FONT};` +
    (reduced ? '' : 'transition:width .12s,height .12s,border-radius .12s;')
  );
}

/** Everything a marker's position and look depend on, so an unchanged pin is not repainted. */
export function pinSignature(pin: BevdPin, look: { selected: boolean; reduced: boolean; scheme: string }): string {
  return [pin.venue.lat, pin.venue.lng, pin.venue.name, pin.bevCount, pin.mineCount, look.selected, look.reduced, look.scheme].join('|');
}

/** The camera for a set of pins: their bounding box, or null when there are none. */
export function pinBounds(pins: readonly Pick<BevdPin, 'venue'>[]): { south: number; west: number; north: number; east: number } | null {
  if (pins.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const { venue } of pins) {
    south = Math.min(south, venue.lat);
    north = Math.max(north, venue.lat);
    west = Math.min(west, venue.lng);
    east = Math.max(east, venue.lng);
  }
  return { south, west, north, east };
}

/** One place fills the screen at street level; several are fitted with this much room around them. */
export const SINGLE_PIN_ZOOM = 15;
export const FIT_PADDING = 56;
/** Fitting never zooms closer than this, so two shops on one block are not a rooftop view. */
export const FIT_MAX_ZOOM = 16;
