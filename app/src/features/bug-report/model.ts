import type { BugReportEnvironment, BugReportKind, BugReportTarget } from '@bevi/shared';

import type { PreparedPhoto } from '@/features/create-bev/photo';

import type { CaptureMark, PickLevel, Shot } from './types';

/**
 * The note being written, and the pure transitions on it. No React, no DOM, no engine calls: the
 * store (store.ts) runs these and does the capturing; these only decide what is kept.
 *
 * Pictures. The server, the bucket and the ledger all take at most `EVIDENCE_MAX` images, so the
 * note never holds more. There are two kinds of capture: a visit's *marked* picture (a visit is a
 * stay on one route), one per visit, showing every mark made on it and redrawn when they change;
 * and *screen* pictures (Capture screen, "Screenshot of this screen"), unmarked, as many as there
 * is room for, each kept as taken. The captures go in the order they were first taken, then the
 * photos from the library. A mark made once the pictures are used up is kept with its component
 * details and takes no picture.
 */

export const EVIDENCE_MAX = 3;
/** The contract's cap on `targets`. */
export const MARKS_MAX = 6;

/**
 * Why a mark has no picture, for the line the note shows about it: there was no room ('limit'),
 * the capture failed, it came back from storage, or its picture was removed.
 */
export type NoPicture = 'limit' | 'failed' | 'restored' | 'removed';

export interface Mark {
  id: string;
  /** 1-based within its visit: the number drawn on that visit's picture. */
  n: number;
  /** Innermost first, as `pickAt` returned them; `levelIndex` is the one marked. */
  levels: PickLevel[];
  levelIndex: number;
  /** The route pattern it was marked on. */
  route: string;
  visit: number;
  /** The visit's picture, once one is taken or being taken. */
  shotId?: string;
  noPicture?: NoPicture;
}

/**
 * One captured picture. `shot` is null while the first capture runs; `pending` while any does.
 * 'marked': the visit's one picture of its marks. 'screen': a plain picture of the screen.
 */
export interface ShotEntry {
  id: string;
  kind: 'marked' | 'screen';
  shot: Shot | null;
  route: string;
  visit: number;
  /** The capture this entry waits for; an older capture that lands late is thrown away. */
  seq: number;
  pending: boolean;
}

export interface Draft {
  /** One per note, reused on every retry, so a retry never files a second ticket. */
  idempotencyKey: string;
  text: string;
  /** Set only when the tester picks a type in the note's type dropdown. */
  kindOverride?: BugReportKind;
  marks: Mark[];
  shots: ShotEntry[];
  photos: PreparedPhoto[];
  /** The steps the tester recorded with Record steps, in order; [] when none were. */
  steps: string[];
  /** The last screen picture couldn't be taken (cleared by the next one). */
  screenFailed?: boolean;
  /** Collected when the note was started, so its time is when the thing was seen. */
  environment: BugReportEnvironment;
  /** The last failed send. */
  error?: unknown;
  /** Restored from storage after a reload: its pictures were not kept. */
  restored?: boolean;
}

let counter = 0;
/** A local id for a mark or a picture: unique within the page, never sent. */
export function localId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function emptyDraft(idempotencyKey: string, environment: BugReportEnvironment): Draft {
  return { idempotencyKey, text: '', marks: [], shots: [], photos: [], steps: [], environment };
}

/** Pictures held or being taken, plus photos. */
export function evidenceCount(d: Draft): number {
  return d.shots.length + d.photos.length;
}

/** How many more photos the note can take. */
export function photoSlots(d: Draft): number {
  return Math.max(0, EVIDENCE_MAX - evidenceCount(d));
}

export function marksOfVisit(d: Draft, visit: number): Mark[] {
  return d.marks.filter((m) => m.visit === visit);
}

/** The visit's marked picture, if it has one. */
export function shotOfVisit(d: Draft, visit: number): ShotEntry | undefined {
  return d.shots.find((s) => s.visit === visit && s.kind === 'marked');
}

export function currentLevel(m: Mark): PickLevel | undefined {
  return m.levels[m.levelIndex] ?? m.levels[0];
}

/** What a capture of this visit draws: every mark made on it, at its chosen level. */
export function captureMarksFor(d: Draft, visit: number): CaptureMark[] {
  return marksOfVisit(d, visit).flatMap((m) => {
    const level = currentLevel(m);
    return level ? [{ box: level.box, n: m.n }] : [];
  });
}

/** Whether there is room for one more picture of any kind. */
export function hasRoom(d: Draft): boolean {
  return evidenceCount(d) < EVIDENCE_MAX;
}

export interface AddMarkInput {
  id: string;
  levels: PickLevel[];
  route: string;
  visit: number;
}

/** Adds a mark at level 0, numbered within its visit. Null when the note already has `MARKS_MAX`. */
export function addMark(d: Draft, input: AddMarkInput): Draft | null {
  if (d.marks.length >= MARKS_MAX || input.levels.length === 0) return null;
  const n = marksOfVisit(d, input.visit).length + 1;
  const mark: Mark = { id: input.id, n, levels: input.levels, levelIndex: 0, route: input.route, visit: input.visit };
  return { ...d, marks: [...d.marks, mark] };
}

/**
 * A capture of `visit` is starting. Reuses the visit's entry (its old picture stays on show until
 * the new one lands) or reserves a new one when there is room; with no room the visit's marks are
 * flagged 'limit' and null comes back, meaning: don't capture.
 */
export function beginCapture(d: Draft, visit: number, route: string, seq: number, newId: string): Draft | null {
  const existing = shotOfVisit(d, visit);
  if (!existing && evidenceCount(d) >= EVIDENCE_MAX) {
    return null;
  }
  const entry: ShotEntry = existing
    ? { ...existing, seq, pending: true }
    : { id: newId, kind: 'marked' as const, shot: null, route, visit, seq, pending: true };
  const shots = existing ? d.shots.map((s) => (s === existing ? entry : s)) : [...d.shots, entry];
  const marks = d.marks.map((m) => (m.visit === visit ? { ...m, shotId: entry.id, noPicture: undefined } : m));
  return { ...d, shots, marks };
}

/** Flags the visit's marks that have no picture as over the limit. */
export function markLimit(d: Draft, visit: number): Draft {
  return {
    ...d,
    marks: d.marks.map((m) => (m.visit === visit && !m.shotId ? { ...m, noPicture: 'limit' } : m)),
  };
}

/**
 * A capture of `visit` finished. `release` lists the shots to let go of: the old picture it
 * replaces, or this one when a newer capture has started since (or the visit lost its marks).
 */
export function finishCapture(d: Draft, visit: number, seq: number, shot: Shot | null): { draft: Draft; release: Shot[] } {
  const entry = shotOfVisit(d, visit);
  if (!entry || entry.seq !== seq) return { draft: d, release: shot ? [shot] : [] };
  if (!shot) {
    if (entry.shot) {
      // Keep the picture it had; it just doesn't show the newest outline.
      return { draft: { ...d, shots: d.shots.map((s) => (s === entry ? { ...s, pending: false } : s)) }, release: [] };
    }
    return {
      draft: {
        ...d,
        shots: d.shots.filter((s) => s !== entry),
        marks: d.marks.map((m) => (m.visit === visit ? { ...m, shotId: undefined, noPicture: 'failed' as const } : m)),
      },
      release: [],
    };
  }
  return {
    draft: { ...d, shots: d.shots.map((s) => (s === entry ? { ...s, shot, pending: false } : s)) },
    release: entry.shot ? [entry.shot] : [],
  };
}

/** A screen picture is starting: a placeholder at the end of the captures, or null with no room. */
export function beginScreenCapture(d: Draft, visit: number, route: string, id: string): Draft | null {
  if (!hasRoom(d)) return null;
  const entry: ShotEntry = { id, kind: 'screen', shot: null, route, visit, seq: 0, pending: true };
  return { ...d, shots: [...d.shots, entry], screenFailed: false };
}

/** A screen picture landed; null (it couldn't be taken) removes its placeholder and says so. */
export function finishScreenCapture(d: Draft, id: string, shot: Shot | null): { draft: Draft; release: Shot[] } {
  const entry = d.shots.find((s) => s.id === id);
  if (!entry) return { draft: d, release: shot ? [shot] : [] };
  if (!shot) return { draft: { ...d, shots: d.shots.filter((s) => s !== entry), screenFailed: true }, release: [] };
  return { draft: { ...d, shots: d.shots.map((s) => (s === entry ? { ...s, shot, pending: false } : s)) }, release: [] };
}

/**
 * Removes a mark. With `renumber` (its screen is on show, so the picture can be retaken to match)
 * the rest of its visit are numbered 1, 2… again and `recapture` asks for the new picture; without
 * it they keep the numbers the existing picture shows. A visit with no marks left loses its picture.
 */
export function removeMark(d: Draft, id: string, renumber = true): { draft: Draft; recapture?: number; release: Shot[] } {
  const mark = d.marks.find((m) => m.id === id);
  if (!mark) return { draft: d, release: [] };
  let n = 0;
  const marks = d.marks
    .filter((m) => m.id !== id)
    .map((m) => (m.visit === mark.visit ? (n++, renumber ? { ...m, n } : m) : m));
  const next = { ...d, marks };
  const entry = shotOfVisit(d, mark.visit);
  if (!entry) return { draft: next, release: [] };
  if (n > 0) return { draft: next, recapture: renumber ? mark.visit : undefined, release: [] };
  return { draft: { ...next, shots: d.shots.filter((s) => s !== entry) }, release: entry.shot ? [entry.shot] : [] };
}

/**
 * Removes a picture. The marks a removed marked picture showed keep their details and say they have
 * no picture; it is not taken again on its own (selecting the element again does that).
 */
export function removeShot(d: Draft, id: string): { draft: Draft; release: Shot[] } {
  const entry = d.shots.find((s) => s.id === id);
  if (!entry) return { draft: d, release: [] };
  return {
    draft: {
      ...d,
      shots: d.shots.filter((s) => s !== entry),
      marks: d.marks.map((m) => (m.shotId === id ? { ...m, shotId: undefined, noPicture: 'removed' as const } : m)),
    },
    release: entry.shot ? [entry.shot] : [],
  };
}

/** Wider (+1) or narrower (-1): the next level out or in. Null at the end of the list. */
export function stepLevel(d: Draft, id: string, delta: 1 | -1): { draft: Draft; recapture?: number } | null {
  const mark = d.marks.find((m) => m.id === id);
  if (!mark) return null;
  const levelIndex = mark.levelIndex + delta;
  if (levelIndex < 0 || levelIndex >= mark.levels.length) return null;
  const draft = { ...d, marks: d.marks.map((m) => (m.id === id ? { ...m, levelIndex } : m)) };
  return { draft, recapture: shotOfVisit(d, mark.visit) ? mark.visit : undefined };
}

/** Adds photos up to the free slots; `rejected` are the ones there was no room for. */
export function addPhotos(d: Draft, photos: PreparedPhoto[]): { draft: Draft; rejected: PreparedPhoto[] } {
  const room = photoSlots(d);
  return { draft: { ...d, photos: [...d.photos, ...photos.slice(0, room)] }, rejected: photos.slice(room) };
}

export function removePhoto(d: Draft, uri: string): { draft: Draft; release?: PreparedPhoto } {
  const photo = d.photos.find((p) => p.uri === uri);
  if (!photo) return { draft: d };
  return { draft: { ...d, photos: d.photos.filter((p) => p !== photo) }, release: photo };
}

export function isPending(d: Draft): boolean {
  return d.shots.some((s) => s.pending);
}

/** The lines the note shows about its pictures, plain sentences, in a fixed order. */
export function pictureNotices(d: Draft): string[] {
  const out: string[] = [];
  // A note restored after a reload never brings its pictures back (draft.ts); say so until there is one again.
  if (d.restored && d.shots.length === 0 && d.photos.length === 0) {
    out.push("Screenshots weren't kept. Mark it again to add one.");
  }
  // The limit line is only true while there are three pictures; once one is removed, a mark that
  // missed out is in the same state as one whose picture was removed.
  const full = !hasRoom(d);
  if (full && d.marks.some((m) => m.noPicture === 'limit')) out.push('3 pictures is the limit; this mark has no picture.');
  if (d.marks.some((m) => m.noPicture === 'removed' || (!full && m.noPicture === 'limit'))) {
    out.push('This mark has no picture. Select it again to add one.');
  }
  if (d.marks.some((m) => m.noPicture === 'failed')) {
    out.push("Couldn't take a picture of this screen. The component details are still attached.");
  } else if (d.screenFailed) {
    out.push("Couldn't take a picture of this screen.");
  }
  if (d.marks.length >= MARKS_MAX) out.push('6 marks is the limit for one note.');
  return out;
}

/** "1", "1 and 2", "1, 2 and 3". */
export function joinNumbers(ns: number[]): string {
  if (ns.length <= 1) return ns.map(String).join('');
  return `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * What a picture shows: '/feed, with 1 and 2 marked' for a marked one; '/lists, whole screen' for a
 * screen picture, numbered from the second of the same route on ('/lists, whole screen (2)').
 */
export function shotCaption(d: Draft, entry: ShotEntry): string {
  if (entry.kind === 'marked') {
    const ns = marksOfVisit(d, entry.visit)
      .map((m) => m.n)
      .sort((a, b) => a - b);
    if (ns.length) return `${entry.route}, with ${joinNumbers(ns)} marked`;
  }
  const same = d.shots.filter((s) => s.kind === 'screen' && s.route === entry.route);
  const n = same.indexOf(entry) + 1;
  return n > 1 ? `${entry.route}, whole screen (${n})` : `${entry.route}, whole screen`;
}

export const PHOTO_CAPTION = 'Photo from the library';

/** The target as the ticket carries it: the chosen level's, with its route and number. */
export function markTarget(m: Mark): BugReportTarget | undefined {
  const level = currentLevel(m);
  if (!level) return undefined;
  return { ...level.target, route: m.route, mark: m.n };
}
