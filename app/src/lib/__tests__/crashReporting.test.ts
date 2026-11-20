import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ApiErrorCode } from '@bevi/shared';
import type { ComponentType } from 'react';

import * as onWeb from '../crashReporting.web';

// Jest resolves as iOS, so `../crashReporting` is the native file; the web one is imported by name.
// The SDK is jest.setup.js's mock. The module reads its configuration once, when it is loaded, as a
// build does, so each case loads a fresh copy of it (and of everything it imports) under its own
// environment.

type Native = typeof import('../crashReporting');
type Scrub = typeof import('../crashScrub');
type Shared = typeof import('@bevi/shared');
interface SentryMock {
  init: jest.Mock;
  wrap: jest.Mock;
  captureException: jest.Mock;
  nativeCrash: jest.Mock;
}

// Shaped like a DSN and pointing nowhere: `.invalid` never resolves.
const DSN = 'https://publickey@o0.ingest.sentry.invalid/1';

const env = process.env as Record<string, string | undefined>;
const globals = globalThis as unknown as { __DEV__: boolean };
const savedDev = globals.__DEV__;

function load({ dsn, environment, dev = false }: { dsn?: string; environment?: string; dev?: boolean } = {}) {
  jest.resetModules();
  delete env.EXPO_PUBLIC_SENTRY_DSN;
  delete env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  if (dsn !== undefined) env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  if (environment !== undefined) env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = environment;
  globals.__DEV__ = dev;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Sentry = require('@sentry/react-native') as SentryMock;
  const crash = require('../crashReporting') as Native;
  const scrub = require('../crashScrub') as Scrub;
  // The same copy of the contract the module under test holds: `isApiError` is an `instanceof`.
  const { ApiError } = require('@bevi/shared') as Shared;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { Sentry, crash, scrub, ApiError };
}

function Root() {
  return null;
}
const RootComponent = Root as ComponentType<Record<string, unknown>>;

afterEach(() => {
  delete env.EXPO_PUBLIC_SENTRY_DSN;
  delete env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  globals.__DEV__ = savedDev;
});

describe('with no DSN', () => {
  it.each([undefined, '', '   '])('does nothing at all (DSN %p)', (dsn) => {
    const { Sentry, crash } = load({ dsn });
    expect(() => crash.initCrashReporting()).not.toThrow();
    expect(crash.crashReportingEnabled()).toBe(false);
    expect(crash.wrapRoot(RootComponent)).toBe(RootComponent);
    crash.captureError(new Error('boom'), { source: 'query' });
    crash.sendTestError();
    crash.crashNatively();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.wrap).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.nativeCrash).not.toHaveBeenCalled();
  });

  it('does nothing before it is initialised either', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    expect(crash.crashReportingEnabled()).toBe(false);
    expect(crash.wrapRoot(RootComponent)).toBe(RootComponent);
    crash.captureError(new Error('boom'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('with a DSN, in a release build', () => {
  it('initialises the SDK once, with identity, tracing and replay off and the scrubbers on', () => {
    const { Sentry, crash, scrub } = load({ dsn: ` ${DSN} ` });
    crash.initCrashReporting();
    crash.initCrashReporting();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = Sentry.init.mock.calls[0][0] as Record<string, unknown>;
    expect(options).toEqual({
      dsn: DSN,
      enabled: true,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoPerformanceTracing: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      enableNetworkBreadcrumbs: false,
      beforeBreadcrumb: scrub.scrubBreadcrumb,
      beforeSend: scrub.scrubEvent,
    });
    // The SDK turns each of these on when the key holds a number, 0 included: they must be absent.
    for (const key of ['tracesSampleRate', 'tracesSampler', 'profilesSampleRate', 'replaysSessionSampleRate', 'replaysOnErrorSampleRate', '_experiments']) {
      expect(options).not.toHaveProperty(key);
    }
    // Left to the SDK, which reads them from the binary the symbols were uploaded for.
    for (const key of ['release', 'dist', 'environment', 'initialScope']) expect(options).not.toHaveProperty(key);
    expect(crash.crashReportingEnabled()).toBe(true);
  });

  it('files reports under the environment the build names', () => {
    const { Sentry, crash } = load({ dsn: DSN, environment: ' preview ' });
    crash.initCrashReporting();
    expect(Sentry.init.mock.calls[0][0]).toMatchObject({ environment: 'preview' });
  });

  it('wraps the root component', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    function Wrapped() {
      return null;
    }
    Sentry.wrap.mockReturnValue(Wrapped);
    expect(crash.wrapRoot(RootComponent)).toBe(Wrapped);
    expect(Sentry.wrap).toHaveBeenCalledWith(RootComponent);
  });

  it('files a caught error with where it was caught, and nothing about who', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    crash.captureError(new Error('boom'), { source: 'query', extra: { read: 'bevs' } });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { source: 'query' }, extra: { read: 'bevs' } });
  });

  it('never sets a user or a scope: the module calls nothing of the SDK but these four', () => {
    const source = readFileSync(resolve(__dirname, '../crashReporting.ts'), 'utf8');
    const calls = [...source.matchAll(/\b(?:sentry|sdk)\.(\w+)\(/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(['captureException', 'init', 'nativeCrash', 'wrap']);
    expect(source).not.toMatch(/setUser\s*\(|initialScope\s*:/);
  });

  it('starting must never be the reason the app does not: a throwing SDK leaves it off', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    Sentry.init.mockImplementation(() => {
      throw new Error('native module missing');
    });
    expect(() => crash.initCrashReporting()).not.toThrow();
    expect(crash.crashReportingEnabled()).toBe(false);
    expect(crash.wrapRoot(RootComponent)).toBe(RootComponent);
  });

  it('a throwing wrap or capture is swallowed', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    Sentry.wrap.mockImplementation(() => {
      throw new Error('no');
    });
    Sentry.captureException.mockImplementation(() => {
      throw new Error('no');
    });
    expect(crash.wrapRoot(RootComponent)).toBe(RootComponent);
    expect(() => crash.captureError(new Error('boom'))).not.toThrow();
  });
});

describe('with a DSN, in a development build', () => {
  it('initialises the SDK disabled, and stays inert', () => {
    const { Sentry, crash } = load({ dsn: DSN, dev: true });
    crash.initCrashReporting();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init.mock.calls[0][0]).toMatchObject({ dsn: DSN, enabled: false, sendDefaultPii: false });
    expect(crash.crashReportingEnabled()).toBe(false);
    expect(crash.wrapRoot(RootComponent)).toBe(RootComponent);
    crash.captureError(new Error('boom'));
    crash.sendTestError();
    crash.crashNatively();
    expect(Sentry.wrap).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.nativeCrash).not.toHaveBeenCalled();
  });
});

describe('captureError', () => {
  const EXPECTED: ApiErrorCode[] = ['network', 'unauthorized', 'validation', 'not_found', 'rate_limited', 'conflict', 'age_restricted'];

  it.each(EXPECTED)('does not report an expected ApiError (%s)', (code) => {
    const { Sentry, crash, ApiError } = load({ dsn: DSN });
    crash.initCrashReporting();
    crash.captureError(new ApiError(code, 'expected'), { source: 'query' });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports an ApiError the contract has no name for, with its code and without its detail', () => {
    const { Sentry, crash, ApiError } = load({ dsn: DSN });
    crash.initCrashReporting();
    const error = new ApiError('unknown', 'add_comment returned no row', { body: 'what the person typed' });
    crash.captureError(error, { source: 'mutation' });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { source: 'mutation', api_code: 'unknown' }, extra: undefined });
    expect(JSON.stringify(Sentry.captureException.mock.calls[0][1])).not.toContain('what the person typed');
  });

  it('reports anything that is not an ApiError', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    const error = new TypeError('undefined is not a function');
    crash.captureError(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: {}, extra: undefined });
  });
});

describe('the end-to-end proof', () => {
  it('files a JavaScript error named so it can be found, and crashes natively on request', () => {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    crash.sendTestError();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = Sentry.captureException.mock.calls[0] as [Error, unknown];
    expect(error.message).toBe('Bevi crash reporting test: JavaScript error');
    expect(hint).toEqual({ tags: { source: 'crash-test' } });
    expect(Sentry.nativeCrash).not.toHaveBeenCalled();
    crash.crashNatively();
    expect(Sentry.nativeCrash).toHaveBeenCalledTimes(1);
  });
});

describe('the web file', () => {
  it('does nothing, whatever the environment says', () => {
    env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    globals.__DEV__ = false;
    expect(() => onWeb.initCrashReporting()).not.toThrow();
    expect(onWeb.crashReportingEnabled()).toBe(false);
    expect(onWeb.wrapRoot(RootComponent)).toBe(RootComponent);
    expect(onWeb.captureError(new Error('boom'), { source: 'query' })).toBeUndefined();
    expect(onWeb.sendTestError()).toBeUndefined();
    expect(onWeb.crashNatively()).toBeUndefined();
  });

  it('has the same exports as the native file', () => {
    const { crash } = load();
    expect(Object.keys(onWeb).sort()).toEqual(Object.keys(crash).sort());
  });

  it('imports no SDK, so none can reach the web bundle', () => {
    const source = readFileSync(resolve(__dirname, '../crashReporting.web.ts'), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);
    expect(imports).toEqual(['react']);
    expect(source).toMatch(/^import type \{ ComponentType \} from 'react';$/m);
  });
});

describe('the SDK itself, given these options', () => {
  // The installed SDK's own rule for what it switches on (its default integrations), asked directly.
  // Its modules start a timer when loaded, so the clock is faked while they are.
  type Integrations = { getDefaultIntegrations: (options: object) => { name: string }[] };
  const OFF = ['ReactNativeTracing', 'AppStart', 'NativeFrames', 'StallTracking', 'UserInteraction', 'AppRegistry', 'TimeToDisplay', 'MobileReplay', 'HermesProfiling', 'Screenshot', 'ViewHierarchy', 'HttpClient'];

  function names(extra: object): string[] {
    const { Sentry, crash } = load({ dsn: DSN });
    crash.initCrashReporting();
    const passed = Sentry.init.mock.calls[0][0] as object;
    jest.useFakeTimers();
    try {
      const { getDefaultIntegrations } = jest.requireActual<Integrations>('@sentry/react-native/dist/js/integrations/default');
      return getDefaultIntegrations({ enableNative: true, ...passed, ...extra }).map((i) => i.name);
    } finally {
      jest.useRealTimers();
    }
  }

  it('catches errors and crashes, and switches on no tracing, replay, profiling, screenshot or request capture', () => {
    const on = names({});
    expect(on).toEqual(expect.arrayContaining(['ReactNativeErrorHandlers', 'Breadcrumbs', 'Release', 'DeviceContext']));
    expect(on.filter((name) => OFF.includes(name))).toEqual([]);
  });

  it('would switch tracing and replay on for a sample rate of 0, which is why none is passed', () => {
    const on = names({ tracesSampleRate: 0, enableAutoPerformanceTracing: true, replaysOnErrorSampleRate: 0 });
    expect(on).toEqual(expect.arrayContaining(['ReactNativeTracing', 'MobileReplay']));
  });
});

describe("the SDK's own names", () => {
  it('everything the mock stands in for exists in the installed SDK', () => {
    // The type declarations the app compiles against, read as text: loading the real SDK under jest
    // would start its native bridge. A rename in an SDK upgrade fails here, not on a phone.
    const types = (file: string) => readFileSync(require.resolve(`@sentry/react-native/dist/js/${file}`), 'utf8');
    const index = types('index.d.ts');
    expect(index).toMatch(/export \{[^}]*\binit\b[^}]*\bwrap\b[^}]*\bnativeCrash\b[^}]*\} from '\.\/sdk'/);
    expect(index).toMatch(/export \{[^}]*\bcaptureException\b[^}]*\} from '@sentry\/core'/);
    const options = types('options.d.ts');
    for (const name of ['sendDefaultPii', 'attachScreenshot', 'attachViewHierarchy', 'enableAutoPerformanceTracing', 'enableUserInteractionTracing', 'enableCaptureFailedRequests']) {
      expect(options).toMatch(new RegExp(`\\b${name}\\?: boolean;`));
    }
  });
});
