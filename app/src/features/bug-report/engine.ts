import type { BugBreadcrumb, BugReportKind } from '@bevi/shared';

import { captureScreen, releaseShot } from './capture';
import { inferKind, titleFor } from './infer';
import { pickAt } from './pick';
import { hadRecentFailure, recordedSteps, recordNav, routePattern, startTrail, trailSnapshot } from './trail';
import type { CaptureMark, PickLevel, Shot } from './types';

/**
 * The reporter's UI reaches the engine (pick, capture, trail, infer) only through these. Each one
 * turns a throw, or an answer of the wrong shape, into the "nothing" answer, so a broken engine
 * costs the tester a picture or a highlight and never the app: the reporter runs on every screen
 * of an internal account, including the ones they are trying to report.
 */

export function safePickAt(x: number, y: number): PickLevel[] {
  try {
    const levels = pickAt(x, y);
    return Array.isArray(levels) ? levels : [];
  } catch {
    return [];
  }
}

export async function safeCapture(marks: CaptureMark[]): Promise<Shot | null> {
  try {
    const shot = await captureScreen(marks);
    return shot && typeof shot === 'object' && typeof shot.uri === 'string' ? shot : null;
  } catch {
    return null;
  }
}

export function safeRelease(shot: Shot | null | undefined): void {
  if (!shot) return;
  try {
    releaseShot(shot);
  } catch {
    // An object URL left behind costs memory until the tab closes; nothing worse.
  }
}

export function safeStartTrail(): () => void {
  try {
    const stop = startTrail();
    return typeof stop === 'function' ? stop : () => {};
  } catch {
    return () => {};
  }
}

export function safeRecordNav(pattern: string): void {
  try {
    recordNav(pattern);
  } catch {
    // The trail is a nice-to-have; a missing step never blocks a report.
  }
}

/** The route pattern for `useSegments()`; without the engine, the segments joined as they are. */
export function safeRoutePattern(segments: readonly string[]): string {
  try {
    const pattern = routePattern(segments);
    if (typeof pattern === 'string' && pattern) return pattern;
  } catch {
    // Falls through to the plain join below.
  }
  const parts = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return `/${parts.join('/')}`;
}

export function safeTrailSnapshot(): BugBreadcrumb[] {
  try {
    const crumbs = trailSnapshot();
    return Array.isArray(crumbs) ? crumbs : [];
  } catch {
    return [];
  }
}

export function safeRecordedSteps(crumbs: readonly BugBreadcrumb[]): string[] {
  try {
    const steps = recordedSteps(crumbs);
    return Array.isArray(steps) ? steps : [];
  } catch {
    return [];
  }
}

export function safeHadRecentFailure(crumbs: readonly BugBreadcrumb[]): boolean {
  try {
    return hadRecentFailure(crumbs) === true;
  } catch {
    return false;
  }
}

const KINDS: readonly BugReportKind[] = ['bug', 'fix', 'idea', 'design'];

/** `inferKind`, or the documented no-signal answer ('design' when something was pointed at, else 'bug'). */
export function safeInferKind(note: string, signals: { hasTarget: boolean; recentFailure: boolean }): BugReportKind {
  try {
    const kind = inferKind(note, signals);
    if (KINDS.includes(kind)) return kind;
  } catch {
    // Falls through.
  }
  return signals.hasTarget ? 'design' : 'bug';
}

/** `titleFor`, or the note's first line (prefixed with what was pointed at) when it can't answer. */
export function safeTitleFor(note: string, pointedAt?: string): string {
  try {
    const title = titleFor(note, pointedAt);
    if (typeof title === 'string' && title.trim()) return title;
  } catch {
    // Falls through.
  }
  const first = note.trim().split('\n')[0]?.trim() ?? '';
  const line = pointedAt ? `${pointedAt}: ${first}` : first;
  return line.slice(0, 160) || 'Report';
}
