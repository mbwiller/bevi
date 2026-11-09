import { NYC_BOUNDS } from '@bevi/shared';

import { keys } from '../keys';
import { inViewParams, normaliseVenueFilters, roundBounds } from '../venueViewport';

const UES = { south: 40.765432, west: -73.968765, north: 40.783219, east: -73.937781 };

describe('roundBounds', () => {
  it('rounds outward to 4 dp, so the request covers the whole screen', () => {
    expect(roundBounds(UES)).toEqual({ south: 40.7654, west: -73.9688, north: 40.7833, east: -73.9377 });
  });

  it('leaves values already on the grid alone (no binary-noise drift)', () => {
    const b = { south: 40.7762, west: -73.9495, north: 40.7843, east: -73.9353 };
    expect(roundBounds(b)).toEqual(b);
  });

  it('clamps to NYC_BOUNDS as the server does', () => {
    expect(roundBounds({ south: 40, west: -75, north: 41.5, east: -73 })).toEqual({ ...NYC_BOUNDS });
  });
});

describe('normaliseVenueFilters', () => {
  it('drops empty multi-selects (empty = any) and sorts the rest', () => {
    expect(normaliseVenueFilters(undefined)).toEqual({});
    expect(normaliseVenueFilters({ categoryIds: [], kinds: ['craft', 'chain', 'craft'], priceTiers: [3, 1] })).toEqual({
      kinds: ['chain', 'craft'],
      priceTiers: [1, 3],
    });
    expect(normaliseVenueFilters({ openNow: true, neighborhoods: ['Yorkville'] })).toEqual({ openNow: true, neighborhoods: ['Yorkville'] });
  });
});

describe('inViewParams and its key', () => {
  it('floors the zoom and shares a cache entry across jitter', () => {
    const a = inViewParams({ bounds: UES, zoom: 14.6 }, { kinds: ['craft', 'chain'] });
    expect(a.zoom).toBe(14);
    const nudged = inViewParams(
      { bounds: { south: 40.76541, west: -73.96871, north: 40.78329, east: -73.93771 }, zoom: 14.1 },
      { kinds: ['chain', 'craft'], categoryIds: [] },
    );
    expect(keys.venues.inView(nudged)).toEqual(keys.venues.inView(a));
    expect(keys.venues.inView(inViewParams({ bounds: UES, zoom: 15 }))).not.toEqual(keys.venues.inView(a));
    expect(keys.venues.inView(a).slice(0, 2)).toEqual(keys.venues.all);
  });
});
