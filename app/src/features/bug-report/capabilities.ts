import type { Capabilities } from './types';

/**
 * What the reporter can do on this platform (the iOS file; capabilities.web.ts is the web one).
 *
 * Everything the web's can, done its own way (DEVELOPMENT-MATT-IOS.md, IM-10): a real screenshot
 * of the window where the web redraws the page, Select element from the view a touch landed on
 * (pickNative.ts) where the web hit-tests the DOM, and Record steps from the touches the app's root
 * hears (ReportTouchRoot.tsx) where the web listens on `document`. Two differences remain, below.
 */
export const CAPABILITIES: Capabilities = {
  /** The note's Select element action, and select mode. */
  select: true,
  /** The note's Record steps action, and the step recording. */
  steps: true,
  /**
   * A new note opens only after a screenshot of the screen it was opened from has been taken, and
   * carries it: the reporter must not be in the picture, and the tester should not have to ask.
   */
  shotFirst: true,
  /**
   * Whether Filed reports and the rank sheet (the app's `Sheet`, a React Native `Modal`) can be
   * shown over a full-screen flow. On iOS UIKit is already presenting that flow, and a second
   * modal over it is not something to count on, so they stay closed there (store.ts).
   */
  sheetsOverFullScreen: false,
};

/** The route groups the root Stack presents as full-screen modals (`presentation: 'fullScreenModal'`, app/_layout.tsx). */
export const FULL_SCREEN_ROUTES: readonly string[] = ['rank', 'add', 'image', 'report-bug'];
