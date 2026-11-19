/**
 * TextField's focus registry: a field given an `id` registers a function that focuses its input
 * while it is mounted, so code that only knows the id (the native `focusField`) can move focus to
 * it. On the web `focusField` uses the DOM id instead (focusField.web.ts).
 */
const focusers = new Map<string, () => void>();

/** Registers `focus` under `id`; the returned function removes it (only if it is still this one). */
export function registerField(id: string, focus: () => void): () => void {
  focusers.set(id, focus);
  return () => {
    if (focusers.get(id) === focus) focusers.delete(id);
  };
}

/** Focuses the mounted field registered under `id`. False when there is none. */
export function focusRegisteredField(id: string): boolean {
  const focus = focusers.get(id);
  if (!focus) return false;
  focus();
  return true;
}
