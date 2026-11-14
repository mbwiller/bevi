// SPIKE S1/S2 (docs/find-bev-in-app-plan.md, Phase 0). Temporary: remove once the iPhone test is done.
//
// An iPhone has no console, so everything the spike learns is written here and shown on the Map tab
// and over the camera. Module-level, so it survives the overlay closing and the tab remounting.

export type LogEntry = { id: number; atMs: number; text: string };

const MAX = 200;
let entries: readonly LogEntry[] = [];
let nextId = 1;
const startedAt = Date.now();
const listeners = new Set<() => void>();

export function log(text: string): void {
  entries = [...entries.slice(-(MAX - 1)), { id: nextId++, atMs: Date.now() - startedAt, text }];
  for (const listener of listeners) listener();
}

export function clearLog(): void {
  entries = [];
  for (const listener of listeners) listener();
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readLog(): readonly LogEntry[] {
  return entries;
}

export function formatEntry(entry: LogEntry): string {
  return `${(entry.atMs / 1000).toFixed(1).padStart(6)}s  ${entry.text}`;
}

export function logAsText(): string {
  return entries.map(formatEntry).join('\n');
}
