import type { BugReportKind } from '@bevi/shared';

/**
 * STUB: signatures only. The engine task replaces the bodies; the UI task codes against them.
 *
 * What the note's one sentence implies, so the reporter is not asked for it.
 */

/**
 * The kind a note most likely is. A recent failure, or words like "crash", "broken", "can't",
 * "doesn't", "wrong", "error" → 'bug'; "should", "instead", "rename", "move", "reorder" → 'fix';
 * "what if", "could we", "add a", "it would be nice" → 'idea'; a pointed-at component with words
 * about looks ("colour", "spacing", "size", "font", "align", "heavy") → 'design'. With nothing to
 * go on: 'design' when a component was pointed at, else 'bug'.
 */
export function inferKind(_note: string, _signals: { hasTarget: boolean; recentFailure: boolean }): BugReportKind {
  throw new Error('infer.ts: not implemented');
}

/**
 * The ticket title: the note's first sentence, prefixed with what was pointed at when the sentence
 * does not already name it ('TabBar › Add Bev: too heavy, make it flat'). One line, at most 160
 * characters, never empty for a non-empty note.
 */
export function titleFor(_note: string, _pointedAt?: string): string {
  throw new Error('infer.ts: not implemented');
}
