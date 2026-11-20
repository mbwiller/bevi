import type { BugReportEnvironment } from '@bevi/shared';
import Constants from 'expo-constants';
import { Dimensions, Platform } from 'react-native';

import { buildOf, routeOf, safeAreaOf, stageOf, type ContextSources } from './contextCommon';

export * from './contextCommon';

/**
 * The context the reporter sends without typing it (docs/bug-workflow.md).
 *
 * Internal reporters only: the reporter is never loaded for anyone else, and the server refuses a
 * report from anyone else. Within that, this is an ALLOW-LIST, the keys of `BugReportEnvironment`
 * and nothing more, and the server enforces the same list again: it drops any key the contract
 * does not name and redacts every string.
 *
 * What is collected describes the build, the device and the screen: the route pattern and the
 * concrete path, the platform and OS family, the app version and build, the theme, connectivity,
 * the viewport, pixel ratio and safe area, whether the app runs from the home screen, and whether
 * reduced motion is on.
 *
 * Three things are still never collected, however internal the reporter:
 *   * the raw URL with its query string. `window.location` would carry query strings and, on an
 *     auth callback, a token; the path is cut at the first `?` or `#`.
 *   * a token of any kind: no header capture, no storage dump, no session.
 *   * the full user-agent string, which is a fingerprint. The platform and the OS family are what
 *     a reproduction attempt needs.
 */

/** The OS family, from the user-agent, with no version or device identifier. */
export function osFamily(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS';
  if (/android/.test(ua)) return 'Android';
  if (/mac os x|macintosh/.test(ua)) return 'macOS';
  if (/windows/.test(ua)) return 'Windows';
  if (/cros/.test(ua)) return 'ChromeOS';
  if (/linux/.test(ua)) return 'Linux';
  return undefined;
}

/** The browser family, same rule: a name, never a version string or a build id. */
export function browserFamily(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.toLowerCase();
  // Order matters: every Chromium UA also claims Safari, and Edge claims both.
  if (/edg\//.test(ua)) return 'Edge';
  if (/firefox|fxios/.test(ua)) return 'Firefox';
  if (/crios|chrome/.test(ua)) return 'Chrome';
  if (/safari/.test(ua)) return 'Safari';
  return undefined;
}

type Browser = {
  navigator?: { userAgent?: string; onLine?: boolean; standalone?: boolean };
  matchMedia?: (query: string) => { matches: boolean };
  devicePixelRatio?: number;
};

/** The browser's globals, or an empty object where there are none. */
function browser(): Browser {
  return typeof window === 'undefined' ? {} : (window as unknown as Browser);
}

function mediaMatches(query: string): boolean | undefined {
  try {
    const { matchMedia } = browser();
    return typeof matchMedia === 'function' ? matchMedia.call(window, query).matches === true : undefined;
  } catch {
    return undefined;
  }
}

/** Builds the environment block. Every field is best effort; nothing is invented. */
export function collectContext(sources: ContextSources = {}): BugReportEnvironment {
  const { navigator: nav, devicePixelRatio } = browser();
  const userAgent = sources.userAgent ?? nav?.userAgent;
  const size = sources.window ?? safeWindowSize();
  const os = osFamily(userAgent);
  const browserName = browserFamily(userAgent);
  const path = routeOf(sources.pathname);
  const standalone = mediaMatches('(display-mode: standalone)');

  const environment: BugReportEnvironment = {
    route: routeOf(sources.routePattern) ?? path,
    path,
    platform: browserName ? `${Platform.OS} / ${browserName}` : Platform.OS,
    osVersion: os,
    appVersion: Constants.expoConfig?.version,
    // Read literally so Expo inlines it; the Vercel build sets it from the commit (vercel.json).
    build: buildOf(process.env.EXPO_PUBLIC_BUILD_SHA),
    stage: stageOf(process.env.NODE_ENV),
    theme: sources.theme === 'light' || sources.theme === 'dark' ? sources.theme : undefined,
    online: typeof nav?.onLine === 'boolean' ? nav.onLine : undefined,
    display: standalone === undefined && nav?.standalone === undefined ? undefined : standalone || nav?.standalone === true ? 'home screen' : 'browser',
    viewport: size ? `${size.width}x${size.height}` : undefined,
    pixelRatio: typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? Math.round(devicePixelRatio * 100) / 100 : undefined,
    safeArea: safeAreaOf(sources.insets),
    reducedMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
    occurredAt: (sources.now ?? new Date()).toISOString(),
    reproducibility: 'unknown',
  };

  // Drop the keys nothing could fill, so the preview shows only real values. `false` is a value.
  for (const key of Object.keys(environment) as (keyof BugReportEnvironment)[]) {
    if (environment[key] === undefined || environment[key] === '') delete environment[key];
  }
  return environment;
}

function safeWindowSize(): { width: number; height: number } | undefined {
  try {
    const { width, height } = Dimensions.get('window');
    if (!width || !height) return undefined;
    return { width: Math.round(width), height: Math.round(height) };
  } catch {
    return undefined;
  }
}

