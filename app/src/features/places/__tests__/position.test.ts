import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as Location from 'expo-location';

import { currentPosition, positionPermission, POSITION_TIMEOUT_MS } from '../position';
import { POSITION_FALLBACK_AGE_MS, POSITION_MAX_AGE_MS, POSITION_QUICK_MS } from '../positionTypes';
import { currentPosition as webPosition } from '../position.web';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

describe('the iPhone provider', () => {
  const has = jest.mocked(Location.getForegroundPermissionsAsync);
  const ask = jest.mocked(Location.requestForegroundPermissionsAsync);
  const last = jest.mocked(Location.getLastKnownPositionAsync);
  const now = jest.mocked(Location.getCurrentPositionAsync);
  const status = (value: string) => ({ status: value }) as Location.LocationPermissionResponse;
  const at = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } }) as Location.LocationObject;

  beforeEach(() => {
    jest.resetAllMocks();
    has.mockResolvedValue(status('granted'));
    last.mockResolvedValue(null);
  });

  it('says what asking would do without asking: prompt until answered, denied after a refusal', async () => {
    has.mockResolvedValueOnce(status('undetermined')).mockResolvedValueOnce(status('denied')).mockResolvedValueOnce(status('granted'));
    await expect(positionPermission()).resolves.toBe('prompt');
    await expect(positionPermission()).resolves.toBe('denied');
    await expect(positionPermission()).resolves.toBe('granted');
    expect(ask).not.toHaveBeenCalled();

    has.mockRejectedValueOnce(new Error('no module'));
    await expect(positionPermission()).resolves.toBe('unknown');
  });

  it('asks the first time, and a refusal is denied with no fix requested', async () => {
    has.mockResolvedValue(status('undetermined'));
    ask.mockResolvedValue(status('denied'));
    await expect(currentPosition()).resolves.toEqual({ kind: 'denied' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(now).not.toHaveBeenCalled();
  });

  it('never asks again once refused', async () => {
    has.mockResolvedValue(status('denied'));
    await expect(currentPosition()).resolves.toEqual({ kind: 'denied' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('allowed: a fix is a position, and a recent one is reused without waking the GPS', async () => {
    now.mockResolvedValue(at(40.7616, -73.9497));
    await expect(currentPosition()).resolves.toEqual({ kind: 'ok', position: { lat: 40.7616, lng: -73.9497 } });

    last.mockResolvedValue(at(40.77, -73.95));
    now.mockClear();
    await expect(currentPosition()).resolves.toEqual({ kind: 'ok', position: { lat: 40.77, lng: -73.95 } });
    expect(now).not.toHaveBeenCalled();
  });

  it('no fix to be had, or Location Services off, is unavailable', async () => {
    now.mockRejectedValue(new Error('Location services are disabled'));
    await expect(currentPosition()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('a fix that never comes is given up on at the timeout', async () => {
    jest.useFakeTimers();
    try {
      now.mockReturnValue(new Promise(() => {}));
      const pending = currentPosition();
      await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS + 10);
      await expect(pending).resolves.toEqual({ kind: 'unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });

  describe('with a fix from a few minutes ago in hand', () => {
    const older = at(40.7616, -73.9497);
    beforeEach(() => {
      // Nothing from the last minute; something from the last five.
      last.mockImplementation(async (options) => ((options?.maxAge ?? 0) > POSITION_MAX_AGE_MS ? older : null));
    });

    it('a new fix that comes quickly wins', async () => {
      now.mockResolvedValue(at(40.77, -73.95));
      await expect(currentPosition()).resolves.toEqual({ kind: 'ok', position: { lat: 40.77, lng: -73.95 } });
      expect(last).toHaveBeenLastCalledWith({ maxAge: POSITION_FALLBACK_AGE_MS });
    });

    it('a slow one is given a short wait, then the older fix stands in', async () => {
      jest.useFakeTimers();
      try {
        now.mockReturnValue(new Promise(() => {}));
        const pending = currentPosition();
        await jest.advanceTimersByTimeAsync(POSITION_QUICK_MS + 10);
        await expect(pending).resolves.toEqual({ kind: 'ok', position: { lat: 40.7616, lng: -73.9497 } });
      } finally {
        jest.useRealTimers();
      }
    });

    it('as it does when no new fix can be had at all', async () => {
      now.mockRejectedValue(new Error('kCLErrorLocationUnknown'));
      await expect(currentPosition()).resolves.toEqual({ kind: 'ok', position: { lat: 40.7616, lng: -73.9497 } });
    });
  });
});

describe('the browser provider', () => {
  const geo = (run: (ok: PositionCallback, bad: PositionErrorCallback) => void) =>
    ({ getCurrentPosition: (ok: PositionCallback, bad: PositionErrorCallback) => run(ok, bad) }) as unknown as Geolocation;

  it('a fix is a position', async () => {
    const result = await webPosition(geo((ok) => ok({ coords: { latitude: 40.7616, longitude: -73.9497 } } as GeolocationPosition)));
    expect(result).toEqual({ kind: 'ok', position: { lat: 40.7616, lng: -73.9497 } });
  });

  it('a refusal is denied; any other failure is unavailable', async () => {
    const error = (code: number) => ({ code, PERMISSION_DENIED: 1 }) as GeolocationPositionError;
    await expect(webPosition(geo((_ok, bad) => bad(error(1))))).resolves.toEqual({ kind: 'denied' });
    await expect(webPosition(geo((_ok, bad) => bad(error(3))))).resolves.toEqual({ kind: 'unavailable' });
  });

  it('a browser that never answers is given up on a little after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const pending = webPosition(geo(() => {}));
      jest.advanceTimersByTime(POSITION_TIMEOUT_MS + 600);
      await expect(pending).resolves.toEqual({ kind: 'unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });
});

// On the web, Metro resolves './X' to X.web.ts(x) when one exists. So a `.web` file that imports a
// VALUE from its own base name imports itself: it type-checks, passes jest (which resolves the
// native file), and then overflows the stack in a browser. Types are erased, so `import type` and
// `export type` are fine. This is the check that would have caught it.
it('no .web file here imports a value from its own base name', () => {
  const dir = join(__dirname, '..');
  const offenders: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.web\.tsx?$/.test(f))) {
    const base = file.replace(/\.web\.tsx?$/, '');
    const source = readFileSync(join(dir, file), 'utf8');
    const statements = source.match(/^(?:import|export)\s[^;]*?from\s+'\.\/[^']+';/gms) ?? [];
    for (const statement of statements) {
      if (!statement.includes(`'./${base}'`)) continue;
      if (/^(?:import|export)\s+type\s/.test(statement)) continue;
      offenders.push(`${file}: ${statement.replace(/\s+/g, ' ')}`);
    }
  }
  expect(offenders).toEqual([]);
});
