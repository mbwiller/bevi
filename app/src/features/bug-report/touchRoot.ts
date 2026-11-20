import { create } from 'zustand';

/**
 * How the reporter hears touches on the app, on iOS (the web listens on `document` instead:
 * pickMode.web.ts, trail.web.ts).
 *
 * React Native has no place to listen for every touch, so the root layout wraps the app's screens
 * in `ReportTouchRoot` (ReportTouchRoot.tsx), an ordinary View, and the reporter says here what it
 * wants from it: select mode asks for taps and keeps them from the app, a step recording asks to
 * be told of taps the app still gets. With neither asking, the View has no handlers at all.
 *
 * Like commands.ts this is deliberately tiny and imports nothing of the reporter: the layout
 * imports it for every account, and the reporter itself is loaded for internal accounts only.
 */

/** A touch on the app. `target` is whatever React Native's event named as its target: the view the finger is on. */
export interface AppTouch {
  target: unknown;
  /** Where in the window, in points. */
  x: number;
  y: number;
}

export interface TouchListener {
  /** A finger landed. */
  onDown?: (touch: AppTouch) => void;
  /** The finger went too far to be a tap, or the touch was taken away (a scroll began). */
  onDrift?: () => void;
  /** A finger lifted where it landed: a tap. `target` is what it landed on. */
  onTap: (touch: AppTouch) => void;
}

interface TouchRootState {
  /** Select mode: taps are heard and kept from the app. */
  select: TouchListener | null;
  /** A step recording: taps are heard, and the app gets them as usual. */
  steps: TouchListener | null;
}

export const useTouchRoot = create<TouchRootState>(() => ({ select: null, steps: null }));

/** Sets or clears one of the two listeners. Clearing one that is not the current one does nothing. */
export function setTouchListener(kind: keyof TouchRootState, listener: TouchListener | null, replacing?: TouchListener): void {
  if (listener === null && replacing !== undefined && useTouchRoot.getState()[kind] !== replacing) return;
  useTouchRoot.setState(kind === 'select' ? { select: listener } : { steps: listener });
}

/** Further than this between down and up, in points, and it was a scroll or a drag, not a tap. */
export const TAP_SLOP = 10;
