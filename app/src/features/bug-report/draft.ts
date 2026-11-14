import type { BugReportKind, BugReportTarget } from '@bevi/shared';

/**
 * The reporter's draft as it is kept in `localStorage`, and the idempotency key that belongs to it.
 *
 * Why a draft survives at all: a bug is often found on a flaky connection, and losing the typed
 * note to a failed send (or a reload) is the fastest way to stop people reporting bugs. So the text
 * and what was pointed at are kept until the report is filed, and restored when the app reloads.
 *
 * What is NOT kept: the pictures. Captures and photos are held in memory for the life of the page
 * and nowhere else — persisting a picture of whatever was on someone's screen, indefinitely, in a
 * store the app never prunes, is not a trade worth making for a convenience. A restored note keeps
 * its marks' details (the component, its route, its title) and says plainly that the screenshots
 * weren't kept.
 *
 * The idempotency key is part of the draft, not of the submission: the same draft retried after a
 * failure must reuse its key, or the retry creates a second ticket. A filed report clears both.
 */

/** A mark's metadata, without its picture or its on-screen box. */
export interface StoredMark {
  n: number;
  title: string;
  target: BugReportTarget;
  route: string;
}

export interface BugDraft {
  text: string;
  /** Set only when the tester pinned a kind. */
  kindOverride?: BugReportKind;
  marks: StoredMark[];
  /** Absent on a draft saved before the switch existed: on. */
  includeSteps?: boolean;
  /** The UUID this draft files under, on every attempt. */
  idempotencyKey: string;
  savedAt: string;
}

export const DRAFT_KEY = 'bevi.bug-report.draft';
/** Ticket ids filed from this device and not yet placed in the tester's ranked list. */
export const UNPLACED_KEY = 'bevi.bug-report.unplaced';
/** Where the drop is docked. */
export const DOCK_KEY = 'bevi.bug-report.dock';

/** The subset of the Web Storage API this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A draft older than this is stale enough that restoring it would confuse more than it helps. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const KINDS: readonly string[] = ['bug', 'fix', 'idea', 'design'];

export function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  // A UUIDv4 by hand, for a runtime without randomUUID. The server only checks
  // the shape; uniqueness is all this has to provide.
  const bytes = new Uint8Array(16);
  if (typeof g.crypto?.getRandomValues === 'function') g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `localStorage` where there is one. Private-mode Safari throws on access, so this never does. */
export function webStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the note lives in memory either way.
  }
}

function remove(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

function storedMark(raw: unknown): StoredMark | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<StoredMark>;
  if (typeof m.title !== 'string' || typeof m.route !== 'string' || !m.target || typeof m.target.component !== 'string') return null;
  return { n: typeof m.n === 'number' && m.n > 0 ? m.n : 1, title: m.title, target: m.target, route: m.route };
}

export function loadDraft(storage: StorageLike | null, now: Date = new Date()): BugDraft | null {
  if (!storage) return null;
  let found: boolean;
  try {
    found = storage.getItem(DRAFT_KEY) !== null;
  } catch {
    return null;
  }
  if (!found) return null;
  const raw = readJson(storage, DRAFT_KEY);
  if (!raw || typeof raw !== 'object') {
    clearDraft(storage);
    return null;
  }
  const draft = raw as Record<string, unknown>;
  if (typeof draft.idempotencyKey !== 'string' || !draft.idempotencyKey) return null;
  const savedAt = typeof draft.savedAt === 'string' ? Date.parse(draft.savedAt) : NaN;
  if (!Number.isFinite(savedAt) || now.getTime() - savedAt > DRAFT_MAX_AGE_MS) {
    clearDraft(storage);
    return null;
  }

  // A draft saved by the old form had a title, a description and typed steps; the note is one text.
  const text =
    typeof draft.text === 'string'
      ? draft.text
      : [draft.title, draft.description, draft.steps]
          .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
          .map((part) => part.trim())
          .join('\n\n');

  return {
    text,
    ...(typeof draft.kindOverride === 'string' && KINDS.includes(draft.kindOverride)
      ? { kindOverride: draft.kindOverride as BugReportKind }
      : {}),
    marks: Array.isArray(draft.marks) ? draft.marks.map(storedMark).filter((m): m is StoredMark => m !== null) : [],
    ...(typeof draft.includeSteps === 'boolean' ? { includeSteps: draft.includeSteps } : {}),
    idempotencyKey: draft.idempotencyKey,
    savedAt: draft.savedAt as string,
  };
}

export function saveDraft(storage: StorageLike | null, draft: Omit<BugDraft, 'savedAt'>, now: Date = new Date()): void {
  if (!storage) return;
  // An empty draft is not worth keeping, and keeping it would restore a blank note with a used-looking key.
  if (!draft.text.trim() && draft.marks.length === 0) {
    clearDraft(storage);
    return;
  }
  writeJson(storage, DRAFT_KEY, { ...draft, savedAt: now.toISOString() });
}

export function clearDraft(storage: StorageLike | null): void {
  remove(storage, DRAFT_KEY);
}

export function loadUnplaced(storage: StorageLike | null): string[] {
  const raw = readJson(storage, UNPLACED_KEY);
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id !== ''))] : [];
}

export function saveUnplaced(storage: StorageLike | null, ids: readonly string[]): void {
  if (ids.length === 0) remove(storage, UNPLACED_KEY);
  else writeJson(storage, UNPLACED_KEY, ids);
}

/** Which edge the drop docks against, and how far its bottom sits above the layer's bottom. */
export interface Dock {
  side: 'left' | 'right';
  bottom: number;
}

export function loadDock(storage: StorageLike | null): Dock | null {
  const raw = readJson(storage, DOCK_KEY) as Partial<Dock> | null;
  if (!raw || (raw.side !== 'left' && raw.side !== 'right') || typeof raw.bottom !== 'number' || !Number.isFinite(raw.bottom)) {
    return null;
  }
  return { side: raw.side, bottom: raw.bottom };
}

export function saveDock(storage: StorageLike | null, dock: Dock): void {
  writeJson(storage, DOCK_KEY, dock);
}
