// The FakeApi's venues against its own fixtures (fixtures.ts, A-08). The
// conformance suite cannot assert any of this: it must pass against prod,
// which has no venues until the import runs. These are the cases pgTAP pins
// on the SQL side (supabase/tests/27_venues_read.test.sql), so the two
// implementations answer them the same way.
import { NYC_BOUNDS, type VenueFilters } from '@bevi/shared';

import { FakeApi } from '../FakeApi';
import { ME, MINOR } from '../people';

/** A Sunday, 12:00 in New York. */
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
const make = () => new FakeApi({ storage: null, latency: 0, now: () => FIXED_NOW });

const CITY = { south: NYC_BOUNDS.south, north: NYC_BOUNDS.north, west: NYC_BOUNDS.west, east: NYC_BOUNDS.east };

async function pinIds(api: FakeApi, filters?: VenueFilters): Promise<string[]> {
  return (await api.venues.inView({ bounds: CITY, zoom: 15, filters })).map((p) => p.venue.id);
}

async function asAdult(): Promise<FakeApi> {
  const api = make();
  await api.signIn({ username: ME.handle, password: ME.password });
  return api;
}

function asMinor(): FakeApi {
  const api = make();
  api.signInAs(MINOR.handle);
  return api;
}

describe('venues (FakeApi fixtures)', () => {
  it('a venue whose only Bev is alcoholic is a pin for an adult and nothing at all for a minor', async () => {
    const adult = await asAdult();
    expect(await pinIds(adult)).toContain('venue-6');
    expect((await adult.venues.get('venue-6')).bevs.length).toBe(1);
    expect(await adult.venues.neighborhoods()).toContain('Carnegie Hill');

    const minor = asMinor();
    expect(await pinIds(minor)).not.toContain('venue-6');
    await expect(minor.venues.get('venue-6')).rejects.toMatchObject({ code: 'not_found' });
    expect(await minor.venues.neighborhoods()).not.toContain('Carnegie Hill');
  });

  it('a hidden venue has no pin and is not_found, though it has an assortment', async () => {
    const api = await asAdult();
    expect(await pinIds(api)).not.toContain('venue-5');
    await expect(api.venues.get('venue-5')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a venue with no assortment has no pin (D-13) and is not_found', async () => {
    const api = await asAdult();
    expect(await pinIds(api)).not.toContain('venue-4');
    await expect(api.venues.get('venue-4')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('an empty filter array is no filter, not "match nothing"', async () => {
    const api = await asAdult();
    const all = await pinIds(api);
    expect(all.length).toBeGreaterThan(0);
    expect(await pinIds(api, { kinds: [], neighborhoods: [], categoryIds: [], priceTiers: [] })).toEqual(all);
  });

  it('hoursKnown is true exactly when openNow is not null', async () => {
    const api = await asAdult();
    for (const pin of await api.venues.inView({ bounds: CITY, zoom: 15 })) {
      expect(pin.venue.hoursKnown).toBe(pin.openNow !== null);
    }
  });
});
