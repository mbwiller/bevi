import type { BugBreadcrumb } from '@bevi/shared';

import { setApiListener, type ApiCall } from '@/api/observe';

import { tapTitle } from './pick';
import { isPickModeOn } from './pickMode';

/**
 * Two records of what the reporter did, both in memory only and both only for an internal
 * reporter.
 *
 * The trail is passive: a ring buffer of the last 40 things that happened. It keeps the route
 * pattern of each screen opened, each API call that failed (the method, the error code, the
 * status, the time it took) and each uncaught error's message. It does not keep taps: what a
 * tester tapped in the course of a day is not a ticket's business.
 *
 * Steps are explicit: they exist only between the reporter pressing "Record steps" and stopping.
 * In between, each screen opened and each thing tapped in the app is a step ('Open /bev/[id]',
 * 'Tap SegmentedTabs › Want to Try'), and those taps also go in the trail, so the ticket's recent
 * activity shows the reproduction. A tap on the reporter's own UI is never a step, and nothing is
 * recorded while select mode is on (that tap selects, it does not press).
 *
 * What neither ever holds: anything typed (there is no input, keydown or value listener, and a
 * tap on a field records the field's name, not its contents), arguments, responses, stacks, ids
 * or query strings.
 */

const MAX_CRUMBS = 40;
const MAX_STEPS = 30;
const MAX_MESSAGE = 200;
const MAX_TARGET = 80;
const RECENT_MS = 60_000;

let crumbs: BugBreadcrumb[] = [];
let lastRoute: string | null = null;
let stop: (() => void) | null = null;

interface Recording {
  steps: string[];
  /** The screen the recording is on now, so opening it again is not a step. */
  route: string;
  onStep?: (steps: string[]) => void;
}

let recording: Recording | null = null;

const onWeb = (): boolean => typeof document !== 'undefined' && typeof window !== 'undefined';

function push(crumb: Omit<BugBreadcrumb, 'at'>): void {
  crumbs.push({ at: new Date().toISOString(), ...crumb });
  if (crumbs.length > MAX_CRUMBS) crumbs.splice(0, crumbs.length - MAX_CRUMBS);
}

const oneLine = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** A route pattern with nothing after a `?` or a `#`, on one line. */
const cleanRoute = (route: unknown): string => (typeof route === 'string' ? oneLine(route.split('?')[0]!.split('#')[0]!, MAX_TARGET) : '');

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
 * Starts recording screens opened, failed API calls and uncaught errors. Taps are not part of it:
 * they are recorded only during a step recording. Idempotent. Returns a function that stops it,
 * discards a step recording in progress and empties the buffer.
 */
export function startTrail(): () => void {
  if (stop) return stop;

  const web = onWeb();
  if (web) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }
  setApiListener(onApiCall);

  const stopThis = (): void => {
    if (stop !== stopThis) return;
    stop = null;
    if (web) {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    }
    setApiListener(null);
    endRecording();
    crumbs = [];
    lastRoute = null;
  };
  stop = stopThis;
  return stopThis;
}

/** Records a navigation. `routePattern` is e.g. '/bev/[id]', never a concrete path. A repeat of the last route is ignored. */
export function recordNav(routePattern: string): void {
  const route = cleanRoute(routePattern);
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

/** The route pattern for Expo Router's `useSegments()` value: groups like '(tabs)' dropped, '/' for none. */
export function routePattern(segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));
  return `/${parts.join('/')}`;
}

/** The trail so far, oldest first, at most 40 entries. A copy. */
export function trailSnapshot(): BugBreadcrumb[] {
  return crumbs.map((crumb) => ({ ...crumb }));
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

/**
 * A click anywhere, heard before the app hears it. `tapTitle` answers nothing for the reporter's
 * own UI. A click that selects (select mode is on, or was until this very click turned it off,
 * which leaves the click prevented) is not a step.
 */
function onRecordedClick(event: MouseEvent): void {
  try {
    if (!recording || isPickModeOn() || event.defaultPrevented) return;
    const target = event.target as Element | null;
    const title = tapTitle(target && target.nodeType === 1 ? target : null, event.clientX, event.clientY);
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
  if (recording && onWeb()) document.removeEventListener('click', onRecordedClick, true);
  recording = null;
  return steps;
}

/**
 * Starts recording steps. The first step is `Start on <startRoute>`; from then until
 * `stopStepRecording`, every screen change ('Open /lists') and every tap outside the reporter's
 * own UI ('Tap SegmentedTabs › Want to Try') is a step, at most 30, consecutive repeats collapsed.
 * `onStep` is called with a copy of the steps so far after each one, the first included. Starting
 * again discards a recording in progress. Nothing typed is ever a step.
 */
export function startStepRecording(startRoute: string, onStep?: (steps: string[]) => void): void {
  endRecording();
  const route = cleanRoute(startRoute) || '/';
  recording = { steps: [], route, onStep: typeof onStep === 'function' ? onStep : undefined };
  // Capture phase: a handler that stops the click from bubbling still leaves the tap in the steps.
  if (onWeb()) document.addEventListener('click', onRecordedClick, true);
  addStep(`Start on ${route}`);
}

/** Stops recording and returns the steps (a copy). [] when no recording was running. */
export function stopStepRecording(): string[] {
  return endRecording();
}

/** Whether a step recording is running. */
export function isRecordingSteps(): boolean {
  return recording !== null;
}
