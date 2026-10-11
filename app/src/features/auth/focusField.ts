import { Platform } from 'react-native';

/**
 * Moves focus to the field whose TextField `id` is `id` (Enter in one field → the next). The app is
 * web only, so this goes through the DOM id TextField puts on its input; elsewhere it's a no-op.
 */
export function focusField(id: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.getElementById(id)?.focus();
}
