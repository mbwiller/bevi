import { HANDLE_PATTERN, RESERVED_HANDLES } from '@bevi/shared';

export const HANDLE_RULE = '3–20 lowercase letters, numbers or _';

/** What the username field says before asking the server: null when it's worth checking availability. */
export function localHandleProblem(handle: string): 'empty' | 'chars' | 'length' | 'reserved' | null {
  if (!handle) return 'empty';
  if (!/^[a-z0-9_]*$/.test(handle)) return 'chars';
  if (!HANDLE_PATTERN.test(handle)) return 'length';
  if (RESERVED_HANDLES.includes(handle)) return 'reserved';
  return null;
}
