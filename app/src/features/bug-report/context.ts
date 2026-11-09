import type { BugReportEnvironment } from '@bevi/shared';
import Constants from 'expo-constants';
import { Dimensions, Platform } from 'react-native';

/**
 * The context the reporter sends without typing it (docs/bug-workflow.md).
 *
 * This is an ALLOW-LIST, and deliberately a short one. Everything here is
 * either about the build or about which screen was open — never about the
 * person, what they typed, what they were looking at, or who they are. There
 * is no breadcrumb log, no header capture, no storage dump and no session
 * token: the server redacts as a backstop, but the first line of defence is
 * not collecting it.
 *
 * Two deliberate omissions:
 *   * the raw URL. The app is web-only, so `window.location` would carry
 *     query strings and, on an auth callback, a token. The route pattern
 *     ('/bev/[id]') says what screen it was without any of that.
 *   * the full user-agent string, which is a fingerprint. The platform and
 *     the OS family are what a reproduction attempt needs.
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

/** The route pattern of the screen the reporter was on, with no query string. */
export function routeOf(pathname: string | undefined): string | undefined {
  if (!pathname) return undefined;
  const clean = pathname.split('?')[0]?.split('#')[0];
  return clean || undefined;
}

export interface ContextSources {
  pathname?: string;
  userAgent?: string;
  /** Injected so a test can pin it. */
  now?: Date;
  window?: { width: number; height: number };
}

/** One labelled line of the "Automatically included" preview. */
export interface ContextRow {
  label: string;
  value: string;
}

/** Builds the environment block. Every field is best effort; nothing is invented. */
export function collectContext(sources: ContextSources = {}): BugReportEnvironment {
  const userAgent =
    sources.userAgent ??
    (typeof navigator === 'undefined' ? undefined : (navigator as { userAgent?: string }).userAgent);
  const size = sources.window ?? safeWindowSize();
  const os = osFamily(userAgent);
  const browser = browserFamily(userAgent);

  const environment: BugReportEnvironment = {
    route: routeOf(sources.pathname),
    platform: browser ? `${Platform.OS} / ${browser}` : Platform.OS,
    osVersion: os,
    appVersion: Constants.expoConfig?.version,
    stage: stageOf(process.env.NODE_ENV),
    viewport: size ? `${size.width}x${size.height}` : undefined,
    occurredAt: (sources.now ?? new Date()).toISOString(),
    reproducibility: 'unknown',
  };

  // Drop the keys nothing could fill, so the preview shows only real values.
  for (const key of Object.keys(environment) as (keyof BugReportEnvironment)[]) {
    if (!environment[key]) delete environment[key];
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
  component: 'Area',
  platform: 'Platform',
  osVersion: 'Device OS',
  appVersion: 'App version',
  build: 'Build',
  stage: 'Environment',
  theme: 'Theme',
  online: 'Connectivity',
  viewport: 'Screen size',
  occurredAt: 'Time',
  reproducibility: 'Reproducibility',
};

/** The preview rows, in a fixed order, so the reporter sees exactly what will be sent. */
export function contextRows(environment: BugReportEnvironment): ContextRow[] {
  const order: (keyof BugReportEnvironment)[] = [
    'route',
    'component',
    'platform',
    'osVersion',
    'appVersion',
    'build',
    'stage',
    'theme',
    'online',
    'viewport',
    'occurredAt',
    'reproducibility',
  ];
  return order
    .filter((key) => environment[key] !== undefined && environment[key] !== '')
    .map((key) => ({
      label: LABELS[key],
      // `online` is the one boolean; the preview says it in words, as the ticket does.
      value: key === 'online' ? (environment.online ? 'Online' : 'Offline') : String(environment[key]),
    }));
}
