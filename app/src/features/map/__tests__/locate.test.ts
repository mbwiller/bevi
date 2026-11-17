// "Show where I am" (M-16 part 2): every outcome of one geolocation request, with a fake Geolocation.

import { NYC_BOUNDS } from '@bevi/shared';

import { insideNyc, locate, LOCATE_TIMEOUT_MS } from '../locate';

function geo(impl: (ok: PositionCallback, fail: PositionErrorCallback, opts?: PositionOptions) => void): Geolocation {
  return { getCurrentPosition: jest.fn(impl) } as unknown as Geolocation;
}
const at = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } }) as GeolocationPosition;
const error = (code: number) => ({ code, message: 'x' }) as GeolocationPositionError;

it('knows the five-borough box, edges included', () => {
  expect(insideNyc({ lat: 40.7712, lng: -73.9561 })).toBe(true);
  expect(insideNyc({ lat: NYC_BOUNDS.south, lng: NYC_BOUNDS.west })).toBe(true);
  expect(insideNyc({ lat: 42.36, lng: -71.06 })).toBe(false);
  expect(insideNyc({ lat: 40.75, lng: -74.3 })).toBe(false);
});

it('inside New York City: the position, asked for once with a timeout', async () => {
  const g = geo((ok) => ok(at(40.7712, -73.9561)));
  await expect(locate(g)).resolves.toEqual({ kind: 'inside', position: { lat: 40.7712, lng: -73.9561 } });
  const opts = (g.getCurrentPosition as jest.Mock).mock.calls[0][2];
  expect(opts).toMatchObject({ timeout: LOCATE_TIMEOUT_MS, enableHighAccuracy: false });
});

it('outside New York City', async () => {
  await expect(locate(geo((ok) => ok(at(42.36, -71.06))))).resolves.toEqual({ kind: 'outside' });
});

it('permission denied', async () => {
  await expect(locate(geo((_ok, fail) => fail(error(1))))).resolves.toEqual({ kind: 'denied' });
});

it('no fix, no geolocation, or a browser that throws: unavailable', async () => {
  await expect(locate(geo((_ok, fail) => fail(error(2))))).resolves.toEqual({ kind: 'unavailable' });
  await expect(locate(geo((_ok, fail) => fail(error(3))))).resolves.toEqual({ kind: 'unavailable' });
  await expect(locate(undefined)).resolves.toEqual({ kind: 'unavailable' });
  await expect(
    locate(
      geo(() => {
        throw new Error('insecure origin');
      }),
    ),
  ).resolves.toEqual({ kind: 'unavailable' });
});

it('a browser that never answers (an ignored prompt): unavailable after the timeout', async () => {
  jest.useFakeTimers();
  try {
    const result = locate(geo(() => {}), 1_000);
    jest.advanceTimersByTime(2_000);
    await expect(result).resolves.toEqual({ kind: 'unavailable' });
  } finally {
    jest.useRealTimers();
  }
});
