import { MIN_SPAN_DEG, SPAN_PADDING, pinText, pinsKey, regionFor } from '../mapCamera';

const pin = (id: string, lat: number, lng: number) => ({ venue: { id, lat, lng } }) as Parameters<typeof regionFor>[0][number];

describe('regionFor', () => {
  it('is nothing without pins', () => {
    expect(regionFor([])).toBeNull();
  });

  it('one place is centred at about street level', () => {
    expect(regionFor([pin('a', 40.7616, -73.9497)])).toEqual({
      latitude: 40.7616,
      longitude: -73.9497,
      latitudeDelta: MIN_SPAN_DEG,
      longitudeDelta: MIN_SPAN_DEG,
    });
  });

  it('several places are all in view, with room around the outermost', () => {
    const region = regionFor([pin('a', 40.76, -73.95), pin('b', 40.78, -73.99), pin('c', 40.77, -73.96)])!;
    expect(region.latitude).toBeCloseTo(40.77, 6);
    expect(region.longitude).toBeCloseTo(-73.97, 6);
    expect(region.latitudeDelta).toBeCloseTo(0.02 * SPAN_PADDING, 6);
    expect(region.longitudeDelta).toBeCloseTo(0.04 * SPAN_PADDING, 6);
  });

  it('two shops on one block are not a rooftop view', () => {
    const region = regionFor([pin('a', 40.7616, -73.9497), pin('b', 40.7617, -73.9498)])!;
    expect(region.latitudeDelta).toBe(MIN_SPAN_DEG);
    expect(region.longitudeDelta).toBe(MIN_SPAN_DEG);
  });

  it('New York and Dublin are one view, and a span never exceeds the map', () => {
    const atlantic = regionFor([pin('nyc', 40.76, -73.95), pin('dub', 53.34, -6.26)])!;
    expect(atlantic.latitudeDelta).toBeGreaterThan(53.34 - 40.76);
    expect(atlantic.longitudeDelta).toBeGreaterThan(73.95 - 6.26);
    const world = regionFor([pin('a', -80, -179), pin('b', 80, 179)])!;
    expect(world.latitudeDelta).toBeLessThanOrEqual(150);
    expect(world.longitudeDelta).toBeLessThanOrEqual(340);
  });
});

it('pinsKey changes with the set of places and not with their order', () => {
  const a = pin('a', 1, 1);
  const b = pin('b', 2, 2);
  expect(pinsKey([a, b])).toBe(pinsKey([b, a]));
  expect(pinsKey([a])).not.toBe(pinsKey([a, b]));
});

it('pinText is the count, capped at 99+', () => {
  expect(pinText({ bevCount: 1 })).toBe('1');
  expect(pinText({ bevCount: 99 })).toBe('99');
  expect(pinText({ bevCount: 100 })).toBe('99+');
});
