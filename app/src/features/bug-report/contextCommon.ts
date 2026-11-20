import type { BugReportEnvironment } from '@bevi/shared';

/**
 * The parts of the automatic context that do not depend on the platform (context.ts is the iOS
 * file, context.web.ts the web one): how a route, a build and the safe area are written, what the
 * "sent with it" preview lists, and the allow-list's labels and order.
 */

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

/**
 * The concrete path, or nothing when it could carry a secret. The server drops a path with a query
 * string, a fragment or a long opaque segment (`safePath`, supabase/functions/bug-report/redact.ts);
 * this is the same rule, plus anything percent-encoded: the photo viewer's route holds an encoded
 * image address (`/image/[url]`), which may be a signed one, and a signed address has no business
 * in a ticket. The route pattern ('/image/[url]') is still sent.
 */
export function safePathOf(pathname: string | undefined): string | undefined {
  const path = routeOf(pathname);
  if (!path || !path.startsWith('/') || path.startsWith('//')) return undefined;
  if (path.includes('%')) return undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const opaque = /^[A-Za-z0-9_-]{24,}$/;
  return path.split('/').every((segment) => !opaque.test(segment) || uuid.test(segment)) ? path : undefined;
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
