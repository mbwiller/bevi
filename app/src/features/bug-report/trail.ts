import type { BugBreadcrumb } from '@bevi/shared';

import { setApiListener, type ApiCall } from '@/api/observe';

import { tapTitle } from './pick';

/**
 * The trail: what the reporter did in the minutes before a note. A ring buffer in memory, started
 * only for an internal reporter, never persisted.
 *
 * What goes in: the route pattern of each screen opened, the name of each thing tapped (the
 * component and its label), each API call that failed (the method, the error code, the status,
 * the time it took) and each uncaught error's message. What never does: anything typed (there is
 * no input, keydown or value listener, and a tap on a field records the field's name, not its
 * contents), arguments, responses, stacks, ids or query strings.
 */

const MAX_CRUMBS = 40;
const MAX_MESSAGE = 200;
const MAX_TARGET = 80;
const DEFAULT_STEPS = 8;
const RECENT_MS = 60_000;

let crumbs: BugBreadcrumb[] = [];
let lastRoute: string | null = null;
let stop: (() => void) | null = null;

function push(crumb: Omit<BugBreadcrumb, 'at'>): void {
  crumbs.push({ at: new Date().toISOString(), ...crumb });
  if (crumbs.length > MAX_CRUMBS) crumbs.splice(0, crumbs.length - MAX_CRUMBS);
}

const oneLine = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** An error's message and nothing else: never its stack. */
function messageOf(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : '';
}

function recordError(reason: unknown): void {
  try {
    const message = oneLine(messageOf(reason), MAX_MESSAGE);
    if (message) push({ kind: 'error', message });
  } catch {
    // The trail never gets in the way of the error it is recording.
  }
}

function onClick(event: MouseEvent): void {
  try {
    const target = event.target as Element | null;
    const title = tapTitle(target && target.nodeType === 1 ? target : null, event.clientX, event.clientY);
    if (title) push({ kind: 'tap', target: oneLine(title, MAX_TARGET) });
  } catch {
    // A tap that cannot be named is not recorded.
  }
}

function onError(event: ErrorEvent): void {
  recordError(event.message || event.error);
}

function onRejection(event: PromiseRejectionEvent): void {
  recordError(event.reason);
}

function onApiCall(call: ApiCall): void {
  if (call.ok) return;
  const crumb: Omit<BugBreadcrumb, 'at'> = { kind: 'api', method: call.method, ms: call.ms };
  if (call.code !== undefined) crumb.code = call.code;
  if (call.status !== undefined) crumb.status = call.status;
  push(crumb);
}

/**
 * Starts recording taps (the component and its label), failed API calls and uncaught errors.
 * Idempotent. Returns a function that stops it and empties the buffer.
 */
export function startTrail(): () => void {
  if (stop) return stop;

  const web = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (web) {
    // Capture phase: a handler that stops propagation still leaves the tap in the trail.
    document.addEventListener('click', onClick, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }
  setApiListener(onApiCall);

  const stopThis = (): void => {
    if (stop !== stopThis) return;
    stop = null;
    if (web) {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    }
    setApiListener(null);
    crumbs = [];
    lastRoute = null;
  };
  stop = stopThis;
  return stopThis;
}

/** Records a navigation. `routePattern` is e.g. '/bev/[id]', never a concrete path. A repeat of the last route is ignored. */
export function recordNav(routePattern: string): void {
  const route = typeof routePattern === 'string' ? oneLine(routePattern.split('?')[0]!.split('#')[0]!, MAX_TARGET) : '';
  if (!route || route === lastRoute) return;
  lastRoute = route;
  push({ kind: 'nav', route });
}

/** The route pattern for Expo Router's `useSegments()` value: groups like '(tabs)' dropped, '/' for none. */
export function routePattern(segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${parts.join('/')}`;
}

/** The trail so far, oldest first, at most 40 entries. A copy. */
export function trailSnapshot(): BugBreadcrumb[] {
  return crumbs.map((crumb) => ({ ...crumb }));
}

/**
 * The last `max` (default 8) screens and taps of a trail as plain steps: 'Open /lists',
 * 'Tap TabBar › Add Bev'. Errors and API failures are not steps.
 */
export function recordedSteps(crumbs: readonly BugBreadcrumb[], max: number = DEFAULT_STEPS): string[] {
  const steps: string[] = [];
  for (const crumb of crumbs) {
    const step = crumb.kind === 'nav' && crumb.route ? `Open ${crumb.route}` : crumb.kind === 'tap' && crumb.target ? `Tap ${crumb.target}` : null;
    if (step && step !== steps[steps.length - 1]) steps.push(step);
  }
  return max > 0 ? steps.slice(-max) : [];
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
