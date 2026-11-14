import type { CaptureMark, Shot } from './types';

/**
 * STUB: signatures only. The engine task replaces the bodies; the UI task codes against them.
 *
 * A picture of the app as it is on screen now. Web only.
 */

/**
 * Rasterises the app column as it is now, without anything inside `[data-report-ui]`, draws each
 * mark as a numbered outline, and returns a JPEG. Resolves null when it cannot (off the web, the
 * rasteriser fails, or `timeoutMs` passes; default 4000). Never rejects.
 */
export function captureScreen(_marks: CaptureMark[], _opts?: { timeoutMs?: number }): Promise<Shot | null> {
  throw new Error('capture.ts: not implemented');
}

/** Revokes the shot's object URL. Safe to call twice. */
export function releaseShot(_shot: Shot): void {
  throw new Error('capture.ts: not implemented');
}
