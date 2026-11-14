import type { PickLevel } from './types';

/**
 * STUB: signatures only. The engine task replaces the bodies; the UI task codes against them.
 *
 * Select mode: while it is on, a tap on the app selects the component under it instead of
 * pressing it. Web only.
 */

export interface PickModeHandlers {
  /** The components under the pointer or finger now, innermost first; [] when nothing can be named. */
  onHover: (levels: PickLevel[]) => void;
  /** The reporter tapped something that can be named. Select mode stays on until `stop` is called. */
  onPick: (levels: PickLevel[]) => void;
  /** Escape was pressed. */
  onCancel: () => void;
}

/**
 * Turns select mode on and returns the function that turns it off. While it is on:
 *   - a tap or click on the app never reaches the control under it: nothing is pressed, focused,
 *     navigated or submitted;
 *   - scrolling still works, and a scroll gesture is not a tap;
 *   - anything inside `[data-report-ui]` behaves normally (the reporter's own Cancel button);
 *   - the trail records nothing.
 * Off the web it does nothing and returns a no-op. Never throws.
 */
export function startPickMode(_handlers: PickModeHandlers): () => void {
  throw new Error('pickMode.ts: not implemented');
}

/** Whether select mode is on. */
export function isPickModeOn(): boolean {
  throw new Error('pickMode.ts: not implemented');
}
