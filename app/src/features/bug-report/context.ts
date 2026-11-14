import type { BugReportEnvironment } from '@bevi/shared';
import Constants from 'expo-constants';
import { Dimensions, Platform } from 'react-native';

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

/**
 * Which build this is. Expo inlines `NODE_ENV`; the Vercel deploy sets nothing
 * else the client can read, so a dev server is 'development' and anything
 * exported is 'production'. Honest about what it knows: it never claims
 * 'staging' when nothing told it so.
 */
export function stageOf(nodeEnv: string | undefined): string {
  return nodeEnv === 'production' ? 'production' : 'development';
}

/** A route or a path with any query string and fragment cut off. */
export function routeOf(pathname: string | undefined): string | undefined {
  if (!pathname) return undefined;
  const clean = pathname.split('?')[0]?.split('#')[0];
  return clean || undefined;
}

/** The deploy's short git SHA, from what the build inlined; undefined for a build that was given none. */
export function buildOf(sha: string | undefined): string | undefined {
  const clean = (sha ?? '').trim();
  return /^[0-9a-f]{7,40}$/i.test(clean) ? clean.slice(0, 7).toLowerCase() : undefined;
}

/** 'top,right,bottom,left' in whole CSS px, as the contract writes the safe area. */
export function safeAreaOf(insets: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>> | undefined): string | undefined {
  if (!insets) return undefined;
  const sides = [insets.top, insets.right, insets.bottom, insets.left];
  if (!sides.every((side): side is number => typeof side === 'number' && Number.isFinite(side))) return undefined;
  return sides.map((side) => Math.round(side)).join(',');
}

export interface ContextSources {
  /** The concrete path on show, e.g. '/bev/8f3a…'. Sent as `path`, cut at the first `?` or `#`. */
  pathname?: string;
  /** The route pattern on show, e.g. '/bev/[id]'. Sent as `route`; without it `route` is the path. */
  routePattern?: string;
  userAgent?: string;
  /** Injected so a test can pin it. */
  now?: Date;
  window?: { width: number; height: number };
  /** The colour scheme the app is rendering in (`useTheme().scheme`). */
  theme?: 'light' | 'dark';
  /** The safe-area insets (`useSafeAreaInsets()`). */
  insets?: { top: number; right: number; bottom: number; left: number };
}

/** One labelled line of the "Automatically included" preview. */
export interface ContextRow {
  label: string;
  value: string;
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

const LABELS: Record<keyof BugReportEnvironment, string> = {
  route: 'Screen',
  path: 'Path',
  component: 'Area',
  platform: 'Platform',
  osVersion: 'Device OS',
  display: 'Opened from',
  appVersion: 'App version',
  build: 'Build',
  stage: 'Environment',
  theme: 'Theme',
  online: 'Connectivity',
  viewport: 'Screen size',
  pixelRatio: 'Pixel ratio',
  safeArea: 'Safe area',
  reducedMotion: 'Reduced motion',
  occurredAt: 'Time',
  reproducibility: 'Reproducibility',
};

/** The preview's order: where, on what, which build, how it was set up, when. */
const ORDER: readonly (keyof BugReportEnvironment)[] = [
  'route',
  'path',
  'component',
  'platform',
  'osVersion',
  'display',
  'appVersion',
  'build',
  'stage',
  'theme',
  'online',
  'viewport',
  'pixelRatio',
  'safeArea',
  'reducedMotion',
  'occurredAt',
  'reproducibility',
];

/** The two booleans read as words in the preview, as they do in the ticket. */
function rowValue(environment: BugReportEnvironment, key: keyof BugReportEnvironment): string {
  if (key === 'online') return environment.online ? 'Online' : 'Offline';
  if (key === 'reducedMotion') return environment.reducedMotion ? 'On' : 'Off';
  return String(environment[key]);
}

/** The preview rows, in a fixed order, so the reporter sees exactly what will be sent. */
export function contextRows(environment: BugReportEnvironment): ContextRow[] {
  return ORDER.filter((key) => environment[key] !== undefined && environment[key] !== '').map((key) => ({
    label: LABELS[key],
    value: rowValue(environment, key),
  }));
}
