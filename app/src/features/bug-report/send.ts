import type { BugBreadcrumb, BugReportInput, BugReportKind, BugReportTarget } from '@bevi/shared';

import { safeHadRecentFailure, safeInferKind, safeTitleFor } from './engine';
import { currentLevel, EVIDENCE_MAX, MARKS_MAX, markTarget, PHOTO_CAPTION, shotCaption, type Draft } from './model';

/**
 * A note as the contract files it. Pure: the trail is passed in (taken at send time), and the
 * engine's `titleFor` / `inferKind` are plain functions of their arguments. The steps are the ones
 * the tester recorded on purpose (Record steps), never inferred from the trail.
 *
 * The severity is always 'annoying': the reporter is never asked how bad it is. Where the ticket
 * lands in the tester's ranked list (RankSheet) sets its priority afterwards.
 */

/** The kind the note will be filed as: the pinned one, else what its words and context suggest. */
export function kindOf(draft: Pick<Draft, 'text' | 'kindOverride' | 'marks'>, trail: readonly BugBreadcrumb[]): BugReportKind {
  return (
    draft.kindOverride ??
    safeInferKind(draft.text, { hasTarget: draft.marks.length > 0, recentFailure: safeHadRecentFailure(trail) })
  );
}

/** The ticket title: the note's first sentence, prefixed with the first mark when it doesn't name it. */
export function titleOf(draft: Pick<Draft, 'text' | 'marks'>): string {
  const first = draft.marks[0];
  return safeTitleFor(draft.text, first ? currentLevel(first)?.title : undefined);
}

export function buildInput(draft: Draft, trail: readonly BugBreadcrumb[]): BugReportInput {
  // Pictures: the captures (marked and screen) in the order they were first taken, then the photos; at most 3.
  const ready = draft.shots.filter((s) => s.shot !== null);
  const evidence: NonNullable<BugReportInput['evidence']> = [];
  const indexOfVisit = new Map<number, number>();
  for (const entry of ready) {
    if (evidence.length >= EVIDENCE_MAX) break;
    // A mark points at its visit's marked picture, wherever that sits among the pictures.
    if (entry.kind === 'marked') indexOfVisit.set(entry.visit, evidence.length);
    evidence.push({ file: entry.shot!.file, mimeType: entry.shot!.mimeType, caption: shotCaption(draft, entry) });
  }
  for (const photo of draft.photos) {
    if (evidence.length >= EVIDENCE_MAX) break;
    // A photo's file is whatever its platform prepared: a Blob on the web, bytes on native.
    evidence.push({ file: photo.file, mimeType: photo.mimeType, caption: PHOTO_CAPTION });
  }

  const targets: BugReportTarget[] = draft.marks.slice(0, MARKS_MAX).flatMap((m) => {
    const target = markTarget(m);
    if (!target) return [];
    const index = indexOfVisit.get(m.visit);
    return [index === undefined ? target : { ...target, evidenceIndex: index }];
  });

  // Steps exist only when the tester recorded them (Record steps); nothing is inferred from the trail.
  const steps = draft.steps.filter((step) => step.trim() !== '');

  return {
    kind: kindOf(draft, trail),
    severity: 'annoying',
    title: titleOf(draft),
    description: draft.text.trim(),
    ...(steps.length ? { reproductionSteps: steps, stepsSource: 'recorded' as const } : {}),
    environment: draft.environment,
    ...(trail.length ? { breadcrumbs: [...trail] } : {}),
    ...(targets.length ? { targets } : {}),
    ...(evidence.length ? { evidence } : {}),
    idempotencyKey: draft.idempotencyKey,
  };
}
