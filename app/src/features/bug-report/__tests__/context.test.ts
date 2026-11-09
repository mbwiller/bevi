import { browserFamily, collectContext, contextRows, osFamily, routeOf, stageOf } from '../context';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe('the automatically included context', () => {
  it('names the OS family without a version or a device identifier', () => {
    expect(osFamily(IPHONE_SAFARI)).toBe('iOS');
    expect(osFamily(ANDROID_CHROME)).toBe('Android');
    expect(osFamily(undefined)).toBeUndefined();
    // The iPhone's UA carries "iPhone OS 18_1" and "iPhone"; neither survives.
    expect(osFamily(IPHONE_SAFARI)).not.toMatch(/18/);
  });

  it('names the browser family, resolving the UAs that claim to be Safari', () => {
    expect(browserFamily(IPHONE_SAFARI)).toBe('Safari');
    expect(browserFamily(ANDROID_CHROME)).toBe('Chrome');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130.0.0.0')).toBe('Edge');
  });

  it('only claims production for a production build, never invents staging', () => {
    expect(stageOf('production')).toBe('production');
    expect(stageOf('development')).toBe('development');
    expect(stageOf(undefined)).toBe('development');
  });

  it('keeps the route pattern and drops the query string and fragment', () => {
    expect(routeOf('/bev/[id]')).toBe('/bev/[id]');
    expect(routeOf('/callback?access_token=secret')).toBe('/callback');
    expect(routeOf('/profile#access_token=secret')).toBe('/profile');
    expect(routeOf(undefined)).toBeUndefined();
  });

  it('collects only the allow-listed fields, and no user content', () => {
    const environment = collectContext({
      pathname: '/bev/[id]',
      userAgent: IPHONE_SAFARI,
      now: new Date('2026-11-02T12:00:00.000Z'),
      window: { width: 390, height: 844 },
    });
    expect(environment).toMatchObject({
      route: '/bev/[id]',
      platform: expect.stringContaining('Safari'),
      osVersion: 'iOS',
      stage: expect.any(String),
      viewport: '390x844',
      occurredAt: '2026-11-02T12:00:00.000Z',
      reproducibility: 'unknown',
    });
    // The allow-list, and nothing else. `appVersion` comes from the Expo
    // config, which jest does not load, so it is absent here and present in a
    // real build -- the point of the assertion is that no OTHER key appears.
    expect(Object.keys(environment).sort()).toEqual(
      ['occurredAt', 'osVersion', 'platform', 'reproducibility', 'route', 'stage', 'viewport'].sort(),
    );
    // The whole user-agent string is a fingerprint; it is never carried.
    expect(JSON.stringify(environment)).not.toContain('AppleWebKit');
  });

  it('leaves out what it cannot determine instead of guessing', () => {
    const environment = collectContext({ userAgent: 'something unrecognised', window: { width: 0, height: 0 } });
    expect(environment.route).toBeUndefined();
    expect(environment.osVersion).toBeUndefined();
    expect(environment).not.toHaveProperty('build');
  });

  it('previews one labelled row per captured value, in a fixed order', () => {
    const rows = contextRows({ route: '/feed', platform: 'web', occurredAt: '2026-11-02T12:00:00.000Z' });
    expect(rows.map((r) => r.label)).toEqual(['Screen', 'Platform', 'Time']);
    expect(rows[0]).toEqual({ label: 'Screen', value: '/feed' });
  });
});
