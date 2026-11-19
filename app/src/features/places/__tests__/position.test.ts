import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentPosition, positionPermission, POSITION_TIMEOUT_MS } from '../position';
import { currentPosition as webPosition } from '../position.web';

it('off the web there is no provider yet: no position, and no claim about permission', async () => {
  await expect(currentPosition()).resolves.toEqual({ kind: 'unavailable' });
  await expect(positionPermission()).resolves.toBe('unknown');
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
