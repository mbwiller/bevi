/**
 * Moves focus to the field whose TextField `id` is `id` (Enter in one field → the next). The web
 * file: it goes through the DOM id TextField puts on its input. The native one, focusField.ts, uses
 * TextField's focus registry.
 */
export function focusField(id: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(id)?.focus();
}
