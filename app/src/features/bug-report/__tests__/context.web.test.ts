import { browserFamily, buildOf, collectContext, contextRows, osFamily, routeOf, safeAreaOf, stageOf } from '../context.web';

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

  it('cuts the query string and the fragment off a route or a path', () => {
    expect(routeOf('/bev/[id]')).toBe('/bev/[id]');
    expect(routeOf('/callback?access_token=secret')).toBe('/callback');
    expect(routeOf('/profile#access_token=secret')).toBe('/profile');
    expect(routeOf(undefined)).toBeUndefined();
  });

  it('shortens the build SHA to 7 characters, and claims no build it was not given', () => {
    expect(buildOf('E3114870c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6')).toBe('e311487');
    expect(buildOf('d007727')).toBe('d007727');
    expect(buildOf(' d007727a\n')).toBe('d007727');
    expect(buildOf('')).toBeUndefined();
    expect(buildOf(undefined)).toBeUndefined();
    expect(buildOf('abc')).toBeUndefined();
    // Something that is not a SHA is never passed off as one. (Joined at run time: the literal
    // is shaped like a secret key and trips the secret scanner on every push.)
    expect(buildOf(['sb', 'secret', 'abcdef'].join('_'))).toBeUndefined();
  });

  it('writes the safe area as top,right,bottom,left in whole px', () => {
    expect(safeAreaOf({ top: 59, right: 0, bottom: 34, left: 0 })).toBe('59,0,34,0');
    expect(safeAreaOf({ top: 58.6, right: 0.2, bottom: 33.5, left: 0 })).toBe('59,0,34,0');
    expect(safeAreaOf(undefined)).toBeUndefined();
    expect(safeAreaOf({ top: 1, right: 2, bottom: Number.NaN, left: 4 })).toBeUndefined();
    expect(safeAreaOf({ top: 1 })).toBeUndefined();
  });

  describe('collectContext', () => {
    const globals = window as unknown as Record<string, unknown>;
    const saved: Record<string, PropertyDescriptor | undefined> = {};
    const savedSha = process.env.EXPO_PUBLIC_BUILD_SHA;

    /** Stands in for the browser: jest runs this suite without one. */
    function browser(overrides: { onLine?: boolean; standalone?: boolean; media?: string[]; devicePixelRatio?: number }): void {
      const media = overrides.media ?? [];
      const set = (key: string, value: unknown): void => {
        if (!(key in saved)) saved[key] = Object.getOwnPropertyDescriptor(globals, key);
        Object.defineProperty(globals, key, { value, configurable: true, writable: true });
      };
      set('navigator', { userAgent: IPHONE_SAFARI, onLine: overrides.onLine, standalone: overrides.standalone });
      set('matchMedia', (query: string) => ({ matches: media.includes(query) }));
      set('devicePixelRatio', overrides.devicePixelRatio);
    }

    afterEach(() => {
      for (const key of Object.keys(saved)) {
        const descriptor = saved[key];
        if (descriptor) Object.defineProperty(globals, key, descriptor);
        else delete globals[key];
        delete saved[key];
      }
      if (savedSha === undefined) delete process.env.EXPO_PUBLIC_BUILD_SHA;
      else process.env.EXPO_PUBLIC_BUILD_SHA = savedSha;
    });

    it('fills every key the contract names from the browser and what the app passes in', () => {
      browser({ onLine: true, standalone: true, media: ['(display-mode: standalone)', '(prefers-reduced-motion: reduce)'], devicePixelRatio: 3 });
      process.env.EXPO_PUBLIC_BUILD_SHA = 'e3114870c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
      const environment = collectContext({
        pathname: '/bev/8f3a2b1c?from=feed#reviews',
        routePattern: '/bev/[id]',
        now: new Date('2026-11-02T12:00:00.000Z'),
        window: { width: 402, height: 874 },
        theme: 'dark',
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      });
      expect(environment).toEqual({
        route: '/bev/[id]',
        path: '/bev/8f3a2b1c',
        platform: expect.stringContaining('Safari'),
        osVersion: 'iOS',
        build: 'e311487',
        stage: expect.any(String),
        theme: 'dark',
        online: true,
        display: 'home screen',
        viewport: '402x874',
        pixelRatio: 3,
        safeArea: '59,0,34,0',
        reducedMotion: true,
        occurredAt: '2026-11-02T12:00:00.000Z',
        reproducibility: 'unknown',
      });
      // The query string, the fragment and the user-agent string are never carried.
      const sent = JSON.stringify(environment);
      expect(sent).not.toContain('from=feed');
      expect(sent).not.toContain('reviews');
      expect(sent).not.toContain('AppleWebKit');
    });

    it('keeps a false: offline, in a browser tab, motion allowed', () => {
      browser({ onLine: false, media: [], devicePixelRatio: 2.625 });
      const environment = collectContext({ pathname: '/feed', routePattern: '/feed' });
      expect(environment).toMatchObject({ online: false, display: 'browser', reducedMotion: false, pixelRatio: 2.63 });
      expect(contextRows(environment)).toEqual(
        expect.arrayContaining([
          { label: 'Connectivity', value: 'Offline' },
          { label: 'Opened from', value: 'browser' },
          { label: 'Reduced motion', value: 'Off' },
          { label: 'Pixel ratio', value: '2.63' },
        ]),
      );
    });

    it('knows the home-screen app from iOS\'s own flag when the media query says nothing', () => {
      browser({ standalone: true, media: [] });
      expect(collectContext().display).toBe('home screen');
    });

    it('uses the path as the route when it was given no pattern', () => {
      const environment = collectContext({ pathname: '/lists?tab=want' });
      expect(environment.route).toBe('/lists');
      expect(environment.path).toBe('/lists');
    });

    it('collects only the allow-listed keys, and leaves out what it cannot determine', () => {
      delete process.env.EXPO_PUBLIC_BUILD_SHA;
      const environment = collectContext({
        pathname: '/bev/[id]',
        userAgent: IPHONE_SAFARI,
        now: new Date('2026-11-02T12:00:00.000Z'),
        window: { width: 390, height: 844 },
      });
      // No browser here: nothing about connectivity, display, pixel ratio or motion is guessed.
      // `appVersion` comes from the Expo config, which jest does not load.
      expect(Object.keys(environment).sort()).toEqual(
        ['occurredAt', 'osVersion', 'path', 'platform', 'reproducibility', 'route', 'stage', 'viewport'].sort(),
      );
      expect(JSON.stringify(environment)).not.toContain('AppleWebKit');

      const bare = collectContext({ userAgent: 'something unrecognised', window: { width: 0, height: 0 }, theme: 'sepia' as 'light' });
      expect(bare.route).toBeUndefined();
      expect(bare.path).toBeUndefined();
      expect(bare.osVersion).toBeUndefined();
      expect(bare).not.toHaveProperty('build');
      expect(bare).not.toHaveProperty('theme');
      expect(bare).not.toHaveProperty('safeArea');
    });
  });

  it('previews one labelled row per captured value, in a fixed order', () => {
    const rows = contextRows({ route: '/feed', platform: 'web', occurredAt: '2026-11-02T12:00:00.000Z' });
    expect(rows.map((r) => r.label)).toEqual(['Screen', 'Platform', 'Time']);
    expect(rows[0]).toEqual({ label: 'Screen', value: '/feed' });

    const all = contextRows({
      reproducibility: 'unknown',
      occurredAt: '2026-11-02T12:00:00.000Z',
      reducedMotion: true,
      safeArea: '59,0,34,0',
      pixelRatio: 3,
      viewport: '402x874',
      online: true,
      theme: 'dark',
      stage: 'production',
      build: 'e311487',
      appVersion: '0.1.0',
      display: 'home screen',
      osVersion: 'iOS',
      platform: 'web / Safari',
      component: 'Feed',
      path: '/bev/8f3a',
      route: '/bev/[id]',
    });
    expect(all.map((r) => r.label)).toEqual([
      'Screen',
      'Path',
      'Area',
      'Platform',
      'Device OS',
      'Opened from',
      'App version',
      'Build',
      'Environment',
      'Theme',
      'Connectivity',
      'Screen size',
      'Pixel ratio',
      'Safe area',
      'Reduced motion',
      'Time',
      'Reproducibility',
    ]);
    expect(all.find((r) => r.label === 'Connectivity')!.value).toBe('Online');
    expect(all.find((r) => r.label === 'Reduced motion')!.value).toBe('On');
    expect(all.find((r) => r.label === 'Safe area')!.value).toBe('59,0,34,0');
  });
});
