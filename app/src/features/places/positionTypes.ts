// What position.ts and position.web.ts share. A file of its own because neither of those can
// import the other: on the web './position' resolves to position.web.ts, so the web file importing
// it would be importing itself.

import type { LatLng } from '@bevi/shared';

export type PositionResult =
  | { kind: 'ok'; position: LatLng }
  /** The user, or the browser's settings, said no. */
  | { kind: 'denied' }
  /** No provider on this platform, no fix, or no answer in time. */
  | { kind: 'unavailable' };

/** Whether asking would show a prompt: only a 'granted' answer is silent. */
export type PositionPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** How long to wait for a fix before searching by name alone. */
export const POSITION_TIMEOUT_MS = 8_000;
/** A fix this recent is reused: opening the picker twice in a shop asks the GPS once. */
export const POSITION_MAX_AGE_MS = 60_000;
/**
 * A fix this old still stands in when a new one is slow: indoors the GPS can take longer than
 * anyone waits, and five minutes ago is usually the same shop. With one in hand a new fix is
 * given only `POSITION_QUICK_MS` to beat it.
 */
export const POSITION_FALLBACK_AGE_MS = 5 * 60_000;
export const POSITION_QUICK_MS = 3_000;
