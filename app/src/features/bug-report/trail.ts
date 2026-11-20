import type { BugBreadcrumb } from '@bevi/shared';

import { setApiListener, type ApiCall } from '@/api/observe';

import { apiCrumb, cleanRoute, hadRecentFailure, MAX_CRUMBS, MAX_MESSAGE, messageOf, oneLine, routePattern } from './trailCommon';

export { hadRecentFailure, routePattern };

/**
 * What the reporter keeps of what happened: the iOS file (trail.web.ts is the web one, which also
 * records steps from DOM clicks).
 *
 * A ring buffer of the last 40 things, in memory only and only for an internal reporter: the route
 * pattern of each screen opened (from Expo Router's segments, never a concrete path or a query
 * string), each API call that failed (the method, the error code, the status, the time it took)
 * and each uncaught JavaScript error's message. Never a tap, anything typed, an argument, a
 * response or a stack.
 *
 * There is no step recording on iOS yet (stage 2 of the native reporter, DEVELOPMENT-MATT-IOS.md,
 * IM-10): `startStepRecording` throws, which the engine turns into "Recording isn't available
 * here.", and `stopStepRecording` has nothing to return.
 */

type Handler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => Handler | undefined;
  setGlobalHandler?: (handler: Handler) => void;
}

let crumbs: BugBreadcrumb[] = [];
let lastRoute: string | null = null;
let stop: (() => void) | null = null;

function push(crumb: Omit<BugBreadcrumb, 'at'>): void {
  crumbs.push({ at: new Date().toISOString(), ...crumb });
  if (crumbs.length > MAX_CRUMBS) crumbs.splice(0, crumbs.length - MAX_CRUMBS);
}

function recordError(reason: unknown): void {
  try {
    const message = oneLine(messageOf(reason), MAX_MESSAGE);
    if (message) push({ kind: 'error', message });
  } catch {
    // The trail never gets in the way of the error it is recording.
  }
}

function onApiCall(call: ApiCall): void {
  const crumb = apiCrumb(call);
  if (crumb) push(crumb);
}

/**
 * Starts recording screens opened, failed API calls and uncaught errors. Idempotent. Returns a
 * function that stops it and empties the buffer.
 *
 * An uncaught error is heard by wrapping React Native's global handler, passing every error on to
 * whoever was there first (the crash reporter's, the red box's). On stopping, the original is put
 * back only if nothing has replaced ours since.
 */
export function startTrail(): () => void {
  if (stop) return stop;

  setApiListener(onApiCall);

  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const previous = utils?.getGlobalHandler?.();
  const heard: Handler = (error, isFatal) => {
    recordError(error);
    previous?.(error, isFatal);
  };
  let wrapped = false;
  try {
    if (utils?.setGlobalHandler && previous) {
      utils.setGlobalHandler(heard);
      wrapped = true;
    }
  } catch {
    wrapped = false;
  }

  const stopThis = (): void => {
    if (stop !== stopThis) return;
    stop = null;
    setApiListener(null);
    try {
      if (wrapped && previous && utils?.getGlobalHandler?.() === heard) utils.setGlobalHandler?.(previous);
    } catch {
      // Nothing to put back.
    }
    crumbs = [];
    lastRoute = null;
  };
  stop = stopThis;
  return stopThis;
}

/** Records a navigation. `routePattern` is e.g. '/bev/[id]', never a concrete path. A repeat of the last route is ignored. */
export function recordNav(pattern: string): void {
  const route = cleanRoute(pattern);
  if (!route || route === lastRoute) return;
  lastRoute = route;
  push({ kind: 'nav', route });
}

/** The trail so far, oldest first, at most 40 entries. A copy. */
export function trailSnapshot(): BugBreadcrumb[] {
  return crumbs.map((crumb) => ({ ...crumb }));
}

/** Step recording is not on iOS yet. */
export function startStepRecording(_startRoute: string, _onStep?: (steps: string[]) => void): void {
  throw new Error('step recording is not available on iOS yet');
}

/** There is never a recording to stop. */
export function stopStepRecording(): string[] {
  return [];
}
