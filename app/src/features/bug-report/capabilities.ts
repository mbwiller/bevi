import type { Capabilities } from './types';

/**
 * What the reporter can do on this platform (the iOS file; capabilities.web.ts is the web one).
 *
 * Stage 1 on iOS is a report button, a real screenshot of the window and a one-field note, with
 * what the app sends by itself. Select element (a registry of measured, named targets) and Record
 * steps (route changes and touches) are stage 2, so their controls are not drawn and the engine's
 * select mode and recording are not there to start (DEVELOPMENT-MATT-IOS.md, IM-10).
 */
export const CAPABILITIES: Capabilities = {
  /** The note's Select element action, and select mode. */
  select: false,
  /** The note's Record steps action, and the step recording. */
  steps: false,
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
