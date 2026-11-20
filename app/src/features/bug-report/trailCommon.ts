import type { BugBreadcrumb } from '@bevi/shared';

import type { ApiCall } from '@/api/observe';

/**
 * The parts of the trail that do not depend on the platform (trail.ts is the iOS file, trail.web.ts
 * the web one): the caps, how a route, a message and a failed API call become a breadcrumb, how a
 * route pattern is made from Expo Router's segments, and what counts as a recent failure.
 */

export const MAX_CRUMBS = 40;
export const MAX_MESSAGE = 200;
export const MAX_TARGET = 80;
const RECENT_MS = 60_000;

export const oneLine = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** A route pattern with nothing after a `?` or a `#`, on one line. */
export const cleanRoute = (route: unknown): string => (typeof route === 'string' ? oneLine(route.split('?')[0]!.split('#')[0]!, MAX_TARGET) : '');

/** An error's message and nothing else: never its stack. */
export function messageOf(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : '';
}

/** A failed API call as a breadcrumb: the method, the error code, the status, the time it took; nothing it was given or answered. */
export function apiCrumb(call: ApiCall): Omit<BugBreadcrumb, 'at'> | null {
  if (call.ok) return null;
  const crumb: Omit<BugBreadcrumb, 'at'> = { kind: 'api', method: call.method, ms: call.ms };
  if (call.code !== undefined) crumb.code = call.code;
  if (call.status !== undefined) crumb.status = call.status;
  return crumb;
}

/** The route pattern for Expo Router's `useSegments()` value: groups like '(tabs)' dropped, '/' for none. */
export function routePattern(segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${parts.join('/')}`;
}

/** Whether the trail holds a failed API call or an uncaught error within `withinMs` (default 60 000) of `now`. */
export function hadRecentFailure(crumbs: readonly BugBreadcrumb[], withinMs: number = RECENT_MS, now: Date = new Date()): boolean {
  const end = now.getTime();
  return crumbs.some((crumb) => {
    if (crumb.kind !== 'api' && crumb.kind !== 'error') return false;
    const at = Date.parse(crumb.at);
    return Number.isFinite(at) && end - at <= withinMs && at - end <= withinMs;
  });
}
