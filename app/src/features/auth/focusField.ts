import { focusRegisteredField } from '@/components/fieldFocus';

/**
 * Moves focus to the field whose TextField `id` is `id` (return in one field → the next). The
 * native file: it goes through TextField's focus registry (src/components/fieldFocus.ts). The web
 * one, focusField.web.ts, uses the DOM id.
 */
export function focusField(id: string): void {
  focusRegisteredField(id);
}
