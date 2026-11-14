import type { PickLevel } from './types';

/**
 * STUB: signatures only. The engine task replaces the bodies; the UI task codes against them.
 *
 * Which component is under a point. Web only: it reads the DOM and the React fibers behind it.
 */

/**
 * The components under the viewport point (x, y), innermost first. Each level is a component
 * defined in `app/src` whose box differs from the level before it. Elements inside
 * `[data-report-ui]` are skipped. Returns [] off the web, outside the app, or when nothing under
 * the point can be named. Never throws.
 */
export function pickAt(_x: number, _y: number): PickLevel[] {
  throw new Error('pick.ts: not implemented');
}

/**
 * The whole screen as one level: the current route's screen component, with the app column as its
 * box. Null off the web. Never throws.
 */
export function pickScreen(): PickLevel | null {
  throw new Error('pick.ts: not implemented');
}
