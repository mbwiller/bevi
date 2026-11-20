import { CONTRACT_VERSION } from '@bevi/shared';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Dimensions, PixelRatio, Platform } from 'react-native';

import { connectionOnline } from '@/lib/connectionStore';

import { appVersionLine, buildLine, collectContext, contextRows, deviceModel, platformLine, safePathOf } from '../context';

// The iOS file (jest resolves '../context' as iOS). The web file is context.web.test.ts.

jest.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', nativeBuildVersion: '3' }));
jest.mock('expo-updates', () => ({ updateId: null, runtimeVersion: null, channel: null }));
jest.mock('@/lib/connectionStore', () => ({ connectionOnline: jest.fn(() => true) }));

const app = Application as { nativeApplicationVersion: string | null; nativeBuildVersion: string | null };
const updates = Updates as unknown as { updateId: string | null; runtimeVersion: string | null };
const constants = Constants as unknown as { platform?: { ios?: { model: string | null; platform: string } } };

const NOW = new Date('2026-11-19T10:30:00.000Z');
const INSETS = { top: 59, right: 0, bottom: 34, left: 0 };

beforeEach(() => {
  app.nativeApplicationVersion = '0.1.0';
  app.nativeBuildVersion = '3';
  updates.updateId = null;
  updates.runtimeVersion = null;
  constants.platform = { ios: { model: 'iPhone 15 Pro', platform: 'iPhone16,1' } };
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 3, fontScale: 1 });
  jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue('18.2');
  (connectionOnline as jest.Mock).mockReturnValue(true);
  delete process.env.EXPO_PUBLIC_BUILD_SHA;
});

afterEach(() => jest.restoreAllMocks());

describe('what an iPhone build sends by itself', () => {
  it('names the screen, the device, the OS, the app, the build, the theme, the connection and the time', () => {
    process.env.EXPO_PUBLIC_BUILD_SHA = 'E3114870c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
    updates.updateId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    updates.runtimeVersion = '0.1.0';
    const env = collectContext({ pathname: '/bev/8f3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', routePattern: '/bev/[id]', theme: 'dark', insets: INSETS, now: NOW });
    expect(env).toEqual({
      route: '/bev/[id]',
      path: '/bev/8f3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      platform: 'ios · iPhone 15 Pro',
      osVersion: 'iOS 18.2',
      appVersion: '0.1.0 (3)',
      build: `e311487 · update 1a2b3c4d · runtime 0.1.0 · contract ${CONTRACT_VERSION}`,
      stage: 'development',
      theme: 'dark',
      online: true,
      viewport: '393x852',
      pixelRatio: 3,
      safeArea: '59,0,34,0',
      occurredAt: '2026-11-19T10:30:00.000Z',
      reproducibility: 'unknown',
    });
  });

  it('is an allow-list: only keys the contract names, and every value short enough for the server (120 characters)', () => {
    updates.updateId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    updates.runtimeVersion = '0.1.0';
    process.env.EXPO_PUBLIC_BUILD_SHA = 'e311487';
    const env = collectContext({ pathname: '/feed', routePattern: '/feed', now: NOW });
    const allowed = ['route', 'component', 'platform', 'osVersion', 'appVersion', 'build', 'stage', 'theme', 'online', 'viewport', 'occurredAt', 'reproducibility', 'path', 'display', 'pixelRatio', 'safeArea', 'reducedMotion'];
    for (const [key, value] of Object.entries(env)) {
      expect(allowed).toContain(key);
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(120);
    }
  });

  it("reads expo-updates defensively: in development it has no update and no runtime, and the build is just the contract", () => {
    const env = collectContext({ now: NOW });
    expect(env.build).toBe(`contract ${CONTRACT_VERSION}`);
  });

  it('a throwing native module costs a field, never the report', () => {
    Object.defineProperty(updates, 'updateId', { configurable: true, get: () => { throw new Error('ExpoUpdates is not available'); } });
    try {
      const env = collectContext({ now: NOW });
      expect(env.build).toBe(`contract ${CONTRACT_VERSION}`);
      expect(env.platform).toBe('ios · iPhone 15 Pro');
    } finally {
      Object.defineProperty(updates, 'updateId', { configurable: true, writable: true, value: null });
    }
  });

  it('falls back to Apple\'s identifier when expo-constants has no model name, and to plain "ios" with neither', () => {
    constants.platform = { ios: { model: null, platform: 'iPhone16,1' } };
    expect(collectContext({ now: NOW }).platform).toBe('ios · iPhone16,1');
    constants.platform = undefined;
    expect(collectContext({ now: NOW }).platform).toBe('ios');
    expect(deviceModel()).toBeUndefined();
  });

  it('says offline when the connection store does', () => {
    (connectionOnline as jest.Mock).mockReturnValue(false);
    expect(collectContext({ now: NOW }).online).toBe(false);
  });

  it('never carries a query string, a fragment, the device name or an identifier of the device', () => {
    const env = collectContext({ pathname: '/settings?token=abc#frag', routePattern: '/settings?token=abc', now: NOW });
    expect(JSON.stringify(env)).not.toMatch(/token|frag|\?|#/);
    expect(Object.keys(env)).not.toContain('deviceName');
  });

  it('the preview lists what will be sent', () => {
    const rows = contextRows(collectContext({ pathname: '/feed', routePattern: '/feed', now: NOW }));
    expect(rows.find((r) => r.label === 'Device OS')?.value).toBe('iOS 18.2');
    expect(rows.find((r) => r.label === 'App version')?.value).toBe('0.1.0 (3)');
    expect(rows.find((r) => r.label === 'Connectivity')?.value).toBe('Online');
  });
});

describe('the pieces', () => {
  it('writes the app version with its build number when there is one', () => {
    expect(appVersionLine('0.1.0', '3')).toBe('0.1.0 (3)');
    expect(appVersionLine('0.1.0', undefined)).toBe('0.1.0');
    expect(appVersionLine(undefined, '3')).toBeUndefined();
  });

  it('writes the build as one line of whatever exists', () => {
    expect(buildLine({})).toBeUndefined();
    expect(buildLine({ sha: 'abc1234', contract: '3.3.0' })).toBe('abc1234 · contract 3.3.0');
    expect(buildLine({ updateId: '1a2b3c4d-5e6f', runtimeVersion: '1.0.0' })).toBe('update 1a2b3c4d · runtime 1.0.0');
  });

  it('writes the platform with the model', () => {
    expect(platformLine('iPhone 15 Pro')).toBe('ios · iPhone 15 Pro');
    expect(platformLine(undefined)).toBe('ios');
  });
});

describe('the concrete path', () => {
  it('keeps an ordinary path and a path with a Bev id', () => {
    expect(safePathOf('/feed')).toBe('/feed');
    expect(safePathOf('/bev/8f3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).toBe('/bev/8f3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
  });

  it('drops a path with a percent-encoded segment: the photo viewer holds an encoded image address, which may be signed', () => {
    expect(safePathOf('/image/https%3A%2F%2Fexample.supabase.co%2Fstorage%2Fv1%2Fobject%2Fsign%2Fx.jpg')).toBeUndefined();
  });

  it('drops a path with a long opaque segment, as the server does', () => {
    expect(safePathOf('/reset/9f8a7c6b5d4e3f2a1b0c9d8e')).toBeUndefined();
  });

  it('cuts a query string and a fragment, and refuses anything that is not an absolute path', () => {
    expect(safePathOf('/search?q=cola')).toBe('/search');
    expect(safePathOf('//evil.example/x')).toBeUndefined();
    expect(safePathOf('feed')).toBeUndefined();
    expect(safePathOf(undefined)).toBeUndefined();
  });
});
