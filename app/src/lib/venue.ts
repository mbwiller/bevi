// How a venue reads on the Search tab's map (M-16): the callout's accessible name, the List view's
// rows and the VenueSheet share these, so every surface says the same thing.

import type { Venue, VenueKind } from '@bevi/shared';

export const KIND_LABEL: Record<VenueKind, string> = { chain: 'Chain', craft: 'Craft' };

/** The Retailer filter's options. */
export const KIND_PLURAL: Record<VenueKind, string> = { chain: 'Chains', craft: 'Craft' };

export const VENUE_KINDS: readonly VenueKind[] = ['chain', 'craft'];

/** Open now is best-effort (A-08): null means the hours couldn't be read, never "closed". */
export function openLabel(openNow: boolean | null): string {
  return openNow == null ? 'Hours unknown' : openNow ? 'Open now' : 'Closed';
}

export function bevCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'Bev' : 'Bevs'}`;
}

/** "Craft · Yorkville", or with the borough for the VenueSheet: "Craft · Yorkville · Manhattan". */
export function venueMeta(venue: Pick<Venue, 'kind' | 'neighborhood' | 'borough'>, withBorough = false): string {
  return [KIND_LABEL[venue.kind], venue.neighborhood, withBorough ? venue.borough : null].filter(Boolean).join(' · ');
}

/**
 * A venue's website as a link, or null. Only http(s) URLs: the value comes from OpenStreetMap, so
 * anything else (a `javascript:` URL, a bare word) is never opened. The label is the host and path,
 * without the scheme or a trailing slash.
 */
export function websiteLink(url: string | null): { href: string; label: string } | null {
  if (!url) return null;
  const href = url.trim();
  if (!/^https?:\/\/[^\s/]+/i.test(href)) return null;
  const label = href.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  return { href, label };
}
