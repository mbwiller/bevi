import type { PickModeHandlers } from './types';

/**
 * Select mode, the iOS file: there is none yet. Selecting an element on the web is DOM hit-testing
 * (pickMode.web.ts, pick.ts); on iOS it will be a registry of measured, named targets, which is
 * stage 2 of the native reporter (DEVELOPMENT-MATT-IOS.md, IM-10). The note does not draw Select
 * element (capabilities.ts), and if something asked anyway this throws, which the engine
 * (engine.ts `safeStartPickMode`) turns into "Selecting isn't available here."
 */

export type { PickModeHandlers };

export function startPickMode(_handlers: PickModeHandlers): () => void {
  throw new Error('select mode is not available on iOS yet');
}

/** Select mode is never on. */
export function isPickModeOn(): boolean {
  return false;
}
