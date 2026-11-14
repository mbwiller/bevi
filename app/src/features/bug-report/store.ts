import type { BugBreadcrumb, BugReportEnvironment, BugReportInput, BugReportKind, BugReportResult } from '@bevi/shared';
import { create } from 'zustand';

import { revokeIfBlob, type PreparedPhoto } from '@/features/create-bev/photo';

import { collectContext, type ContextSources } from './context';
import {
  clearDraft,
  loadDock,
  loadDraft,
  loadUnplaced,
  newIdempotencyKey,
  saveDock,
  saveDraft,
  saveUnplaced,
  webStorage,
  type BugDraft,
  type Dock,
  type StorageLike,
} from './draft';
import { safeCapture, safeRecordNav, safeRelease, safeTrailSnapshot } from './engine';
import {
  addMark,
  addPhotos as addPhotosTo,
  beginCapture,
  captureMarksFor,
  currentLevel,
  emptyDraft,
  finishCapture,
  localId,
  markLimit,
  removeMark as removeMarkFrom,
  removePhoto as removePhotoFrom,
  removeShot as removeShotFrom,
  stepLevel as stepLevelOf,
  type Draft,
  type Mark,
} from './model';
import { buildInput, titleOf } from './send';
import type { PickLevel, Shot } from './types';

/**
 * The reporter's state, module-level so it survives every navigation: the note being written, the
 * live highlight while the drop is dragged, the outbox of notes being filed, and the tickets still
 * to be placed in the tester's ranked list. The transitions on the note are the pure functions of
 * model.ts; this file runs them and does the capturing, through the guarded engine (engine.ts).
 *
 * Components read it with `useReport(selector)` and change it only through the functions exported
 * below, never `setState` directly.
 */

export interface OutboxItem {
  /** The note's idempotency key. */
  key: string;
  title: string;
  status: 'sending' | 'sent' | 'failed';
  result?: BugReportResult;
  error?: unknown;
  /** The note itself, pictures and all, until it is filed: a failed send restores it. */
  draft?: Draft;
}

export interface Toast {
  ticketId: string;
  duplicate: boolean;
  /** Bumped per toast, so the host restarts its timer for a second one. */
  id: number;
}

export interface ReportState {
  draft: Draft | null;
  panel: 'closed' | 'open';
  picking: null | { levels: PickLevel[] };
  outbox: OutboxItem[];
  unplaced: string[];
  sheet: null | 'reports' | 'rank';
  /** The tickets the rank sheet places, in order. */
  rankQueue: string[];
  /** The mark Wider and Narrower act on, outlined on the app while the note is open. */
  selectedMarkId: string | null;
  /** The text field takes focus when the note opens for a new draft, once. */
  focusNote: boolean;
  /** The screen on show: a visit is one stay on one path. */
  nav: { visit: number; route: string; path: string };
  toast: Toast | null;
  /** Where the drop rests; null until the tester moves it (the default spot, above the tab bar). */
  dock: Dock | null;
  /** The open note's height, so the drop rests above it rather than under it. */
  panelHeight: number;
}

function initialState(): ReportState {
  return {
    draft: null,
    panel: 'closed',
    picking: null,
    outbox: [],
    unplaced: [],
    sheet: null,
    rankQueue: [],
    selectedMarkId: null,
    focusNote: false,
    nav: { visit: 0, route: '/', path: '/' },
    toast: null,
    dock: null,
    panelHeight: 0,
  };
}

export const useReport = create<ReportState>(() => initialState());

const get = () => useReport.getState();
const set = useReport.setState;

// ---------------------------------------------------------------- configuration

/** Undefined until first used: `localStorage`, looked up then. */
let injected: StorageLike | null | undefined;

/** Tests inject an in-memory storage; the app uses `localStorage`. */
export function setReportStorage(next: StorageLike | null): void {
  injected = next;
}

function storage(): StorageLike | null {
  if (injected === undefined) injected = webStorage();
  return injected;
}

/** What the environment block needs from React (the host keeps it current). */
export interface ContextInput {
  scheme?: 'light' | 'dark';
  insets?: { top: number; right: number; bottom: number; left: number };
}

let contextInput: ContextInput = {};

export function setContextInput(input: ContextInput): void {
  contextInput = input;
}

/** The environment for a note started now, on the screen on show. Never throws. */
function environmentNow(): BugReportEnvironment {
  const { route, path } = get().nav;
  const sources: ContextSources = { pathname: path, routePattern: route, theme: contextInput.scheme, insets: contextInput.insets };
  try {
    return collectContext(sources);
  } catch {
    return { occurredAt: new Date().toISOString() };
  }
}

/** Back to nothing (tests). */
export function resetReport(): void {
  for (const item of get().outbox) releaseDraft(item.draft);
  releaseDraft(get().draft);
  inflight.clear();
  set(initialState(), true);
}

// ---------------------------------------------------------------- persistence

function toStored(d: Draft): Omit<BugDraft, 'savedAt'> {
  return {
    text: d.text,
    ...(d.kindOverride ? { kindOverride: d.kindOverride } : {}),
    marks: d.marks.flatMap((m) => {
      const level = currentLevel(m);
      return level ? [{ n: m.n, title: level.title, target: level.target, route: m.route }] : [];
    }),
    includeSteps: d.includeSteps,
    idempotencyKey: d.idempotencyKey,
  };
}

/** The note storage keeps: the one being written, else the newest one not yet filed. */
function persistedDraft(s: ReportState): Draft | null {
  if (s.draft) return s.draft;
  for (let i = s.outbox.length - 1; i >= 0; i--) {
    const item = s.outbox[i]!;
    if (item.status !== 'sent' && item.draft) return item.draft;
  }
  return null;
}

useReport.subscribe((s, prev) => {
  if (s.draft !== prev.draft || s.outbox !== prev.outbox) {
    const d = persistedDraft(s);
    if (d) saveDraft(storage(), toStored(d));
    else clearDraft(storage());
  }
  if (s.unplaced !== prev.unplaced) saveUnplaced(storage(), s.unplaced);
});

/** Loads what storage kept (a note, the tickets to place). Called once by the host on mount. */
export function hydrate(now: Date = new Date()): void {
  const unplaced = loadUnplaced(storage());
  const dock = loadDock(storage());
  const stored = get().draft ? null : loadDraft(storage(), now);
  const next: Partial<ReportState> = {};
  if (unplaced.length && get().unplaced.length === 0) next.unplaced = unplaced;
  if (dock && !get().dock) next.dock = dock;
  if (stored) {
    const d = emptyDraft(stored.idempotencyKey, environmentNow());
    d.text = stored.text;
    if (stored.kindOverride) d.kindOverride = stored.kindOverride;
    if (stored.includeSteps === false) d.includeSteps = false;
    d.restored = true;
    // A restored mark keeps what it pointed at, not where: it was on a screen of an earlier page
    // load, so it gets a visit of its own that no live visit (0 and up) will share.
    d.marks = stored.marks.map((m, i) => ({
      id: localId('mark'),
      n: m.n,
      levels: [{ target: m.target, title: m.title, box: m.target.rect ?? { x: 0, y: 0, width: 0, height: 0 } }],
      levelIndex: 0,
      route: m.route,
      visit: -1 - i,
      noPicture: 'restored' as const,
    }));
    next.draft = d;
  }
  if (Object.keys(next).length) set(next);
}

// ---------------------------------------------------------------- navigation

/** The host calls this on every route change; a new path is a new visit. */
export function navigate(route: string, path: string): void {
  const { nav } = get();
  safeRecordNav(route);
  if (nav.path === path && nav.route === route) return;
  set({ nav: { visit: nav.visit + 1, route, path }, picking: null });
}

// ---------------------------------------------------------------- the draft

function releaseDraft(d: Draft | null | undefined): void {
  if (!d) return;
  for (const s of d.shots) safeRelease(s.shot);
  for (const p of d.photos) revokeIfBlob(p.uri);
}

/** The note, started now (with this screen's environment) when there is none. */
function ensureDraft(): { draft: Draft; created: boolean } {
  const existing = get().draft;
  if (existing) return { draft: existing, created: false };
  const draft = emptyDraft(newIdempotencyKey(), environmentNow());
  set({ draft });
  return { draft, created: true };
}

/** The note's key, if `key`'s note is still around (being written, or in the outbox). */
function updateDraftByKey(key: string, update: (d: Draft) => Draft): void {
  const s = get();
  if (s.draft?.idempotencyKey === key) {
    set({ draft: update(s.draft) });
    return;
  }
  const item = s.outbox.find((o) => o.key === key && o.draft);
  if (item) set({ outbox: s.outbox.map((o) => (o === item ? { ...o, draft: update(o.draft!) } : o)) });
}

function draftByKey(key: string): Draft | undefined {
  const s = get();
  if (s.draft?.idempotencyKey === key) return s.draft;
  return s.outbox.find((o) => o.key === key)?.draft;
}

// ---------------------------------------------------------------- capturing

let captureSeq = 0;
/** Captures still running, per note, so a send waits for its pictures. */
const inflight = new Map<string, Set<Promise<void>>>();

function track(key: string, p: Promise<void>): void {
  const set_ = inflight.get(key) ?? new Set<Promise<void>>();
  set_.add(p);
  inflight.set(key, set_);
  void p.finally(() => {
    set_.delete(p);
    if (set_.size === 0) inflight.delete(key);
  });
}

/** Resolves once every capture of `key`'s note has landed. */
export async function settleCaptures(key: string): Promise<void> {
  for (;;) {
    const pending = inflight.get(key);
    if (!pending || pending.size === 0) return;
    await Promise.all([...pending]);
  }
}

/**
 * (Re)takes the picture of `visit`, showing all of its marks. Only the visit on show can be
 * captured: a mark from an earlier screen keeps the picture taken there.
 */
function capture(visit: number): void {
  const s = get();
  const d = s.draft;
  if (!d || visit !== s.nav.visit) return;
  const key = d.idempotencyKey;
  const seq = ++captureSeq;
  const begun = beginCapture(d, visit, s.nav.route, seq, localId('shot'));
  if (!begun) {
    set({ draft: markLimit(d, visit) });
    return;
  }
  set({ draft: begun });
  const p = safeCapture(captureMarksFor(begun, visit)).then((shot) => landCapture(key, visit, seq, shot));
  track(key, p);
}

function landCapture(key: string, visit: number, seq: number, shot: Shot | null): void {
  const d = draftByKey(key);
  if (!d) {
    safeRelease(shot);
    return;
  }
  const { draft, release } = finishCapture(d, visit, seq, shot);
  release.forEach(safeRelease);
  if (draft !== d) updateDraftByKey(key, () => draft);
}

// ---------------------------------------------------------------- the drop

/** The live highlight while dragging; unchanged levels don't re-render anything. */
export function setPicking(levels: PickLevel[] | null): void {
  const current = get().picking?.levels[0];
  const next = levels?.[0];
  if (!current && !next) return;
  if (current && next && current.title === next.title && sameBox(current.box, next.box)) return;
  set({ picking: levels && levels.length ? { levels } : null });
}

function sameBox(a: PickLevel['box'], b: PickLevel['box']): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Marks the component under the drop's tip: the note opens at once, the picture follows. */
export function markLevels(levels: PickLevel[]): boolean {
  set({ picking: null });
  if (levels.length === 0) return false;
  const { draft, created } = ensureDraft();
  const { visit, route } = get().nav;
  const id = localId('mark');
  const next = addMark(draft, { id, levels, route, visit });
  if (!next) {
    set({ panel: 'open' });
    return false;
  }
  set({ draft: next, selectedMarkId: id, panel: 'open', focusNote: created || get().focusNote, sheet: null });
  capture(visit);
  return true;
}

/** A press with no note: a note with one picture of the whole screen and no marks. */
export function captureWholeScreen(): void {
  const { created } = ensureDraft();
  set({ panel: 'open', focusNote: created, selectedMarkId: null, sheet: null });
  capture(get().nav.visit);
}

/** A press on the drop: the note if there is one, else the last failed one, else a new capture. */
export function pressDrop(): void {
  const s = get();
  if (s.draft) {
    openNote();
    return;
  }
  const failed = [...s.outbox].reverse().find((o) => o.status === 'failed' && o.draft);
  if (failed) {
    restoreFailed(failed.key);
    return;
  }
  captureWholeScreen();
}

/** The drop was let go of in the dock strip: it rests there from now on, on this device. */
export function setDock(dock: Dock): void {
  saveDock(storage(), dock);
  set({ dock });
}

export function setPanelHeight(panelHeight: number): void {
  if (Math.abs(get().panelHeight - panelHeight) >= 1) set({ panelHeight });
}

// ---------------------------------------------------------------- the note

export function openNote(): void {
  set({ panel: 'open', sheet: null });
}

/** Settings' "Report a bug": the note, a new one with no capture when there is none. */
export function openBlankNote(): void {
  const { created } = ensureDraft();
  set({ panel: 'open', focusNote: created, sheet: null });
}

export function setAside(): void {
  set({ panel: 'closed', focusNote: false });
}

export function noteFocused(): void {
  if (get().focusNote) set({ focusNote: false });
}

export function discardNote(): void {
  releaseDraft(get().draft);
  set({ draft: null, panel: 'closed', selectedMarkId: null, focusNote: false });
}

function updateDraft(update: (d: Draft) => Draft): void {
  const d = get().draft;
  if (d) set({ draft: update(d) });
}

export function setText(text: string): void {
  updateDraft((d) => ({ ...d, text }));
}

const KIND_ORDER: readonly BugReportKind[] = ['bug', 'fix', 'idea', 'design'];

/** The chip: from the kind on show (inferred or pinned) to the next, pinned. */
export function cycleKind(shown: BugReportKind): void {
  const next = KIND_ORDER[(KIND_ORDER.indexOf(shown) + 1) % KIND_ORDER.length]!;
  updateDraft((d) => ({ ...d, kindOverride: next }));
}

export function setIncludeSteps(includeSteps: boolean): void {
  updateDraft((d) => ({ ...d, includeSteps }));
}

export function selectMark(id: string | null): void {
  set({ selectedMarkId: id });
}

export function removeMark(id: string): void {
  const s = get();
  const d = s.draft;
  if (!d) return;
  const mark = d.marks.find((m) => m.id === id);
  // Renumbering only makes sense when the picture can be retaken to match.
  const { draft, recapture, release } = removeMarkFrom(d, id, mark?.visit === s.nav.visit);
  release.forEach(safeRelease);
  const selected = s.selectedMarkId === id ? (draft.marks[draft.marks.length - 1]?.id ?? null) : s.selectedMarkId;
  set({ draft, selectedMarkId: selected });
  if (recapture !== undefined) capture(recapture);
}

export function removeShot(id: string): void {
  const d = get().draft;
  if (!d) return;
  const { draft, release } = removeShotFrom(d, id);
  release.forEach(safeRelease);
  set({ draft });
}

/** Wider (+1) or Narrower (-1) for a mark; the picture is retaken when its screen is on show. */
export function stepLevel(id: string, delta: 1 | -1): void {
  const d = get().draft;
  if (!d) return;
  const stepped = stepLevelOf(d, id, delta);
  if (!stepped) return;
  set({ draft: stepped.draft });
  if (stepped.recapture !== undefined) capture(stepped.recapture);
}

/** Adds what fits; the rest are let go of and returned. */
export function addPhotos(photos: PreparedPhoto[]): PreparedPhoto[] {
  const d = get().draft;
  if (!d) {
    photos.forEach((p) => revokeIfBlob(p.uri));
    return photos;
  }
  const { draft, rejected } = addPhotosTo(d, photos);
  rejected.forEach((p) => revokeIfBlob(p.uri));
  set({ draft });
  return rejected;
}

export function removePhoto(uri: string): void {
  const d = get().draft;
  if (!d) return;
  const { draft, release } = removePhotoFrom(d, uri);
  if (release) revokeIfBlob(release.uri);
  set({ draft });
}

// ---------------------------------------------------------------- sending

export type Sender = (input: BugReportInput) => Promise<BugReportResult>;

/**
 * Send: the note moves to the outbox and the panel closes at once; the pictures still being taken
 * are waited for, then the report files in the background. A failure keeps the whole note.
 */
export function sendNote(sender: Sender): Promise<void> {
  const d = get().draft;
  if (!d || !d.text.trim()) return Promise.resolve();
  const trail = safeTrailSnapshot();
  const item: OutboxItem = { key: d.idempotencyKey, title: titleOf(d), status: 'sending', draft: { ...d, error: undefined } };
  set((s) => ({
    draft: null,
    panel: 'closed',
    selectedMarkId: null,
    focusNote: false,
    picking: null,
    outbox: [...s.outbox.filter((o) => o.key !== item.key), item],
  }));
  return dispatch(item.key, sender, trail);
}

/** "Try again" on a failed outbox row: the same note, the same key. */
export function retrySend(key: string, sender: Sender): Promise<void> {
  const item = get().outbox.find((o) => o.key === key);
  if (!item || item.status !== 'failed' || !item.draft) return Promise.resolve();
  patchOutbox(key, { status: 'sending', error: undefined });
  return dispatch(key, sender, safeTrailSnapshot());
}

function patchOutbox(key: string, patch: Partial<OutboxItem>): void {
  set((s) => ({ outbox: s.outbox.map((o) => (o.key === key ? { ...o, ...patch } : o)) }));
}

let toastId = 0;

async function dispatch(key: string, sender: Sender, trail: BugBreadcrumb[]): Promise<void> {
  await settleCaptures(key);
  const item = get().outbox.find((o) => o.key === key);
  if (!item?.draft) return;
  const input = buildInput(item.draft, trail);
  try {
    const result = await sender(input);
    releaseDraft(item.draft);
    set((s) => ({
      outbox: s.outbox.map((o) => (o.key === key ? { key, title: o.title, status: 'sent' as const, result } : o)),
      unplaced:
        result.status === 'created' && !s.unplaced.includes(result.ticketId) ? [...s.unplaced, result.ticketId] : s.unplaced,
      toast: { ticketId: result.ticketId, duplicate: result.status === 'duplicate', id: ++toastId },
    }));
  } catch (error) {
    set((s) => ({
      outbox: s.outbox.map((o) =>
        o.key === key ? { ...o, status: 'failed' as const, error, draft: o.draft ? { ...o.draft, error } : o.draft } : o,
      ),
    }));
  }
}

/** A failed note back in the panel, its error above Try again, with the key it was sent under. */
export function restoreFailed(key: string): void {
  const s = get();
  const item = s.outbox.find((o) => o.key === key && o.status === 'failed');
  if (!item?.draft) return;
  // A note being written stays: it goes to the outbox's place rather than being lost.
  if (s.draft && s.draft.idempotencyKey !== key) return;
  set({
    draft: item.draft,
    outbox: s.outbox.filter((o) => o !== item),
    panel: 'open',
    sheet: null,
    selectedMarkId: item.draft.marks[item.draft.marks.length - 1]?.id ?? null,
  });
}

export function hideToast(id?: number): void {
  const t = get().toast;
  if (t && (id === undefined || t.id === id)) set({ toast: null });
}

// ---------------------------------------------------------------- sheets and ranking

export function openReports(): void {
  set({ sheet: 'reports', picking: null });
}

/** The rank sheet, placing `ids` in order. */
export function openRank(ids: readonly string[]): void {
  if (ids.length === 0) return;
  set({ sheet: 'rank', rankQueue: [...new Set(ids)], picking: null, toast: null });
}

export function closeSheet(): void {
  set({ sheet: null, rankQueue: [] });
}

/** The current ticket is done with: placed (or nothing to compare it with) drops it from `unplaced`. */
export function finishRanking(ticketId: string, placed: boolean): void {
  set((s) => {
    const rankQueue = s.rankQueue.filter((id) => id !== ticketId);
    return {
      rankQueue,
      unplaced: placed ? s.unplaced.filter((id) => id !== ticketId) : s.unplaced,
      sheet: rankQueue.length ? s.sheet : null,
    };
  });
}

/** Forgets the tickets to place that the list shows are no longer open (fixed, closed, moved to review). */
export function pruneUnplaced(openIds: ReadonlySet<string>, knownIds: ReadonlySet<string>): void {
  const { unplaced } = get();
  const next = unplaced.filter((id) => openIds.has(id) || !knownIds.has(id));
  if (next.length !== unplaced.length) set({ unplaced: next });
}

export function addUnplaced(ticketId: string): void {
  set((s) => (s.unplaced.includes(ticketId) ? s : { unplaced: [...s.unplaced, ticketId] }));
}

// ---------------------------------------------------------------- selectors

export function selectedMark(s: ReportState): Mark | undefined {
  return s.draft?.marks.find((m) => m.id === s.selectedMarkId);
}

export function isSending(s: ReportState): boolean {
  return s.outbox.some((o) => o.status === 'sending');
}

export function hasFailed(s: ReportState): boolean {
  return s.outbox.some((o) => o.status === 'failed');
}
