import type { BugReportKind, BugReportSeverity } from '@bevi/shared';

/**
 * The reporter's draft, and the idempotency key that belongs to it.
 *
 * Why a draft survives at all: a bug is often found on a flaky connection, and
 * losing the typed report to a failed send is the fastest way to stop people
 * reporting bugs. So the text is kept in `localStorage` until the report is
 * filed, and restored when the form reopens.
 *
 * What is NOT kept: the screenshot. An attachment is held in memory for the
 * life of the form and nowhere else — persisting a picture of whatever was on
 * someone's screen, indefinitely, in a store the app never prunes, is not a
 * trade worth making for a convenience. Reopening a restored draft asks for
 * the screenshot again, which the UI says plainly.
 *
 * The idempotency key is part of the draft, not of the submission: the same
 * draft retried after a failure must reuse its key, or the retry creates a
 * second ticket. A filed report clears both.
 */

export interface BugDraft {
  /** What the reporter said it is; absent on a draft saved before the controls existed. */
  kind?: BugReportKind;
  severity?: BugReportSeverity;
  title: string;
  description: string;
  steps: string;
  /** The UUID this draft files under, on every attempt. */
  idempotencyKey: string;
  savedAt: string;
}

export const DRAFT_KEY = 'bevi.bug-report.draft';

/** The subset of the Web Storage API this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A draft older than this is stale enough that restoring it would confuse more than it helps. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

export function loadDraft(storage: StorageLike | null, now: Date = new Date()): BugDraft | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<BugDraft>;
    if (typeof draft.idempotencyKey !== 'string' || !draft.idempotencyKey) return null;
    const savedAt = typeof draft.savedAt === 'string' ? Date.parse(draft.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || now.getTime() - savedAt > DRAFT_MAX_AGE_MS) {
      clearDraft(storage);
      return null;
    }
    const kinds: readonly string[] = ['bug', 'fix', 'idea', 'design'];
    const severities: readonly string[] = ['blocker', 'bad', 'annoying', 'polish'];
    return {
      ...(typeof draft.kind === 'string' && kinds.includes(draft.kind) ? { kind: draft.kind as BugReportKind } : {}),
      ...(typeof draft.severity === 'string' && severities.includes(draft.severity)
        ? { severity: draft.severity as BugReportSeverity }
        : {}),
      title: typeof draft.title === 'string' ? draft.title : '',
      description: typeof draft.description === 'string' ? draft.description : '',
      steps: typeof draft.steps === 'string' ? draft.steps : '',
      idempotencyKey: draft.idempotencyKey,
      savedAt: draft.savedAt as string,
    };
  } catch {
    clearDraft(storage);
    return null;
  }
}

export function saveDraft(
  storage: StorageLike | null,
  draft: Omit<BugDraft, 'savedAt'>,
  now: Date = new Date(),
): void {
  if (!storage) return;
  // An empty draft is not worth keeping, and keeping it would restore a blank
  // form with a used-looking key.
  if (!draft.title.trim() && !draft.description.trim() && !draft.steps.trim()) {
    clearDraft(storage);
    return;
  }
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: now.toISOString() }));
  } catch {
    // Storage full or blocked: the draft lives in component state either way.
  }
}

export function clearDraft(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do; the draft is gone from state when the form closes.
  }
}

/** The typed steps, one per line, as the contract's `reproductionSteps`. */
export function parseSteps(steps: string): string[] {
  return steps
    .split('\n')
    // A pasted list often arrives as "1. open the app"; the numbers are ours to add back.
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}
