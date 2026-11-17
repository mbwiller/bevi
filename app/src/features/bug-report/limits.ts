/**
 * Limits the reporter's engine and its UI share, in a module of their own with nothing else in it,
 * so the UI can show a limit without importing (or a test having to mock) the engine.
 */

/** A step recording stops counting at this many steps (trail.ts); the Stop pill says so. */
export const MAX_STEPS = 30;
