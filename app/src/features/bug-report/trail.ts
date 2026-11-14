import type { BugBreadcrumb } from '@bevi/shared';

/**
 * STUB: signatures only. The engine task replaces the bodies; the UI task codes against them.
 *
 * The trail: what the reporter did in the minutes before a note. A ring buffer in memory, started
 * only for an internal reporter, never persisted.
 */

/**
 * Starts recording taps (the component and its label), failed API calls and uncaught errors.
 * Idempotent. Returns a function that stops it and empties the buffer.
 */
export function startTrail(): () => void {
  throw new Error('trail.ts: not implemented');
}

/** Records a navigation. `routePattern` is e.g. '/bev/[id]', never a concrete path. A repeat of the last route is ignored. */
export function recordNav(_routePattern: string): void {
  throw new Error('trail.ts: not implemented');
}

/** The route pattern for Expo Router's `useSegments()` value: groups like '(tabs)' dropped, '/' for none. */
export function routePattern(_segments: readonly string[]): string {
  throw new Error('trail.ts: not implemented');
}

/** The trail so far, oldest first, at most 40 entries. A copy. */
export function trailSnapshot(): BugBreadcrumb[] {
  throw new Error('trail.ts: not implemented');
}

/**
 * The last `max` (default 8) screens and taps of a trail as plain steps: 'Open /lists',
 * 'Tap TabBar › Add Bev'. Errors and API failures are not steps.
 */
export function recordedSteps(_crumbs: readonly BugBreadcrumb[], _max?: number): string[] {
  throw new Error('trail.ts: not implemented');
}

/** Whether the trail holds a failed API call or an uncaught error within `withinMs` (default 60 000) of `now`. */
export function hadRecentFailure(_crumbs: readonly BugBreadcrumb[], _withinMs?: number, _now?: Date): boolean {
  throw new Error('trail.ts: not implemented');
}
