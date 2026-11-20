import type { Capabilities } from './types';

/**
 * What the reporter can do on the web (capabilities.ts is the iOS one): everything. It is built on
 * the DOM, so it can select an element, record steps, redraw the page for a picture that leaves the
 * reporter out, and show a Sheet over anything.
 */
export const CAPABILITIES: Capabilities = {
  select: true,
  steps: true,
  shotFirst: false,
  sheetsOverFullScreen: true,
};

/** The web has no iOS-style full-screen presentation to keep a sheet out of. */
export const FULL_SCREEN_ROUTES: readonly string[] = [];
