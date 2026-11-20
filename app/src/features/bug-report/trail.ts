import type { BugBreadcrumb } from '@bevi/shared';

import { setApiListener, type ApiCall } from '@/api/observe';

import { MAX_STEPS } from './limits';
import { isPickModeOn } from './pickMode';
import { titleForTarget } from './pickNative';
import { setTouchListener, type AppTouch, type TouchListener } from './touchRoot';
import { apiCrumb, cleanRoute, hadRecentFailure, MAX_CRUMBS, MAX_MESSAGE, MAX_TARGET, messageOf, oneLine, routePattern } from './trailCommon';

export { hadRecentFailure, routePattern };

/**
 * Two records of what the reporter did, both in memory only and both only for an internal
 * reporter: the iOS file (trail.web.ts is the web one, which hears taps as DOM clicks).
 *
 * The trail is passive: a ring buffer of the last 40 things that happened. It keeps the route
 * pattern of each screen opened (from Expo Router's segments, never a concrete path or a query
 * string), each API call that failed (the method, the error code, the status, the time it took)
 * and each uncaught JavaScript error's message. It does not keep taps: what a tester tapped in the
 * course of a day is not a ticket's business.
 *
 * Steps are explicit: they exist only between the reporter pressing "Record steps" and stopping.
 * In between, each screen opened and each thing tapped in the app is a step ('Open /bev/[id]',
 * 'Tap SegmentedTabs › Want to Try'), and those taps also go in the trail, so the ticket's recent
 * activity shows the reproduction. Taps are heard by the View around the app's screens
 * (ReportTouchRoot.tsx, through touchRoot.ts), which only watches: the app gets every one of them.
 * A tap on the reporter's own layer is never heard, and nothing is recorded while select mode is on
 * (that tap selects, it does not press).
 *
 * What neither ever holds: anything typed (a tap on a field records the field's name, not its
 * contents), arguments, responses, stacks, ids or query strings.
 */

type Handler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => Handler | undefined;
  setGlobalHandler?: (handler: Handler) => void;
}

let crumbs: BugBreadcrumb[] = [];
let lastRoute: string | null = null;
let stop: (() => void) | null = null;

interface Recording {
  steps: string[];
  /** The screen the recording is on now, so opening it again is not a step. */
  route: string;
  onStep?: (steps: string[]) => void;
  listener: TouchListener;
}

let recording: Recording | null = null;

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
 * Starts recording screens opened, failed API calls and uncaught errors. Taps are not part of it:
 * they are recorded only during a step recording. Idempotent. Returns a function that stops it,
 * discards a step recording in progress and empties the buffer.
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
    endRecording();
    crumbs = [];
    lastRoute = null;
  };
  stop = stopThis;
  return stopThis;
}

/** Records a navigation. `routePattern` is e.g. '/bev/[id]', never a concrete path. A repeat of the last route is ignored. */
export function recordNav(pattern: string): void {
  const route = cleanRoute(pattern);
  if (!route) return;
  if (route !== lastRoute) {
    lastRoute = route;
    push({ kind: 'nav', route });
  }
  if (recording && route !== recording.route) {
    recording.route = route;
    addStep(`Open ${route}`);
  }
}

/** The trail so far, oldest first, at most 40 entries. A copy. */
export function trailSnapshot(): BugBreadcrumb[] {
  return crumbs.map((crumb) => ({ ...crumb }));
}

// ---------------------------------------------------------------------------------------------
// Explicit step recording: steps exist only between a start and a stop the reporter pressed.
// ---------------------------------------------------------------------------------------------

/** Adds a step to the recording in progress, unless it repeats the last one or the recording is full. */
function addStep(step: string): void {
  const current = recording;
  if (!current || current.steps.length >= MAX_STEPS || current.steps[current.steps.length - 1] === step) return;
  current.steps.push(step);
  try {
    current.onStep?.([...current.steps]);
  } catch {
    // A listener that throws does not stop the recording.
  }
}

/** A tap on the app, heard as the finger lifts and before the app acts on it. A tap that selects is not a step. */
function onRecordedTap(touch: AppTouch): void {
  try {
    if (!recording || isPickModeOn()) return;
    const title = titleForTarget(touch.target);
    if (!title) return;
    const named = oneLine(title, MAX_TARGET);
    push({ kind: 'tap', target: named });
    addStep(`Tap ${named}`);
  } catch {
    // A tap that cannot be named is not a step.
  }
}

function endRecording(): string[] {
  const steps = recording ? [...recording.steps] : [];
  if (recording) setTouchListener('steps', null, recording.listener);
  recording = null;
  return steps;
}

/**
 * Starts recording steps. The first step is `Start on <startRoute>`; from then until
 * `stopStepRecording`, every screen change ('Open /lists') and every tap on the app
 * ('Tap SegmentedTabs › Want to Try') is a step, at most 30, consecutive repeats collapsed.
 * `onStep` is called with a copy of the steps so far after each one, the first included. Starting
 * again discards a recording in progress. Nothing typed is ever a step.
 */
export function startStepRecording(startRoute: string, onStep?: (steps: string[]) => void): void {
  endRecording();
  const route = cleanRoute(startRoute) || '/';
  const listener: TouchListener = { onTap: onRecordedTap };
  recording = { steps: [], route, onStep: typeof onStep === 'function' ? onStep : undefined, listener };
  setTouchListener('steps', listener);
  addStep(`Start on ${route}`);
}

/** Stops recording and returns the steps (a copy). [] when no recording was running. */
export function stopStepRecording(): string[] {
  return endRecording();
}
