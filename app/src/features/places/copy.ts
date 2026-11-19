// How a place reads wherever one is shown (BEV-22): the picker's rows, the note step, the Bev'd
// sheet, a post's place line and the Map tab say the same thing the same way.

import type { Venue } from '@bevi/shared';

export const ADD_LOCATION = 'Add location';
export const CHANGE_LOCATION = 'Change location';
export const REMOVE_LOCATION = 'Remove location';
export const PICKER_TITLE = 'Where did you get it?';
export const PICKER_PLACEHOLDER = 'Search a shop, cafe or bar';
export const NEARBY = 'Nearby';
export const RESULTS = 'Places';
export const MORE_PLACES = 'More places';
export const NO_MATCH = 'No places match';
export const PICKER_HINT = 'Search for the shop, cafe or bar where you got it.';
export const LOCATION_OFF = "Location is off for Bevi, so places aren't sorted by distance.";
export const MORE_FAILED = "Couldn't search more places right now.";
export const MORE_LIMITED = 'Too many searches. Try again in a little while.';
export const MORE_EMPTY = 'Nothing else found.';

export const searchMoreLabel = (query: string) => `Search more places for “${query}”`;

const FEET_PER_METER = 3.28084;
const FEET_PER_MILE = 5280;
/** Under a tenth of a mile a distance reads in feet. */
const FEET_UNTIL = FEET_PER_MILE / 10;

/**
 * "150 ft", "0.3 mi", "12 mi": feet to the nearest 50 under a tenth of a mile, then miles to one
 * decimal, whole from ten. Bevi's venues are in New York, so not metres.
 */
export function distanceLabel(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  const feet = meters * FEET_PER_METER;
  if (feet < FEET_UNTIL) return `${Math.max(50, Math.round(feet / 50) * 50)} ft`;
  const miles = feet / FEET_PER_MILE;
  return `${miles >= 10 ? Math.round(miles) : miles.toFixed(1)} mi`;
}

/** The line under a place's name: its address, else its neighbourhood, else its borough. */
export function placeDetail(venue: Pick<Venue, 'address' | 'neighborhood' | 'borough'>): string | null {
  return venue.address || venue.neighborhood || venue.borough || null;
}

/** "425 Main Street · 150 ft": what there is of the detail and the distance. */
export function placeSubtitle(
  venue: Pick<Venue, 'address' | 'neighborhood' | 'borough'>,
  meters?: number | null,
): string {
  return [placeDetail(venue), distanceLabel(meters)].filter(Boolean).join(' · ');
}

/** A suggestion is offered only for a venue this close: nearer than the next shop along. */
export const SUGGEST_WITHIN_M = 120;

/** A venue's name cut to fit a Sheet option's trailing detail. */
export function shortPlaceName(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

// ---------------------------------------------------------------------------
// The Map tab
// ---------------------------------------------------------------------------

export const MAP_TITLE = 'Map';
export const MAP_EMPTY_TITLE = 'No places yet';
export const MAP_EMPTY_BODY = "Add where you got a Bev and it shows up here, next to your friends'.";
export const MAP_EMPTY_FRIENDS = "The people you follow haven't added a place yet.";
export const MAP_EMPTY_ACTION = "Go to Bev'd";
export const MAP_UNAVAILABLE_NOTE = "The map can't load right now, so here are the places as a list.";
export const PLACE_GONE = "Nothing to show here any more.";

export const bevCount = (n: number): string => `${n} ${n === 1 ? 'Bev' : 'Bevs'}`;

/**
 * "Add where you got them: 12 of your Bevs have no location." Null when every one has a place, or
 * there are none to place.
 */
export function backfillLine(summary: { rankedCount: number; locatedCount: number } | undefined): string | null {
  if (!summary) return null;
  const missing = summary.rankedCount - summary.locatedCount;
  if (missing <= 0) return null;
  return missing === 1 ? '1 of your Bevs has no location yet.' : `${missing} of your Bevs have no location yet.`;
}

/** What a pin's row says under the name: "3 Bevs · 425 Main Street", with "1 yours" when shared. */
export function pinSubtitle(pin: {
  bevCount: number;
  mineCount: number;
  venue: Pick<Venue, 'address' | 'neighborhood' | 'borough'>;
}): string {
  const shared = pin.mineCount > 0 && pin.mineCount < pin.bevCount ? `${pin.mineCount} yours` : null;
  return [bevCount(pin.bevCount), shared, placeDetail(pin.venue)].filter(Boolean).join(' · ');
}
