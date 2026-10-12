import { isApiError, type ValidationErrorDetail } from '@bevi/shared';

import { errorCopy } from '@/lib/errorCopy';

/**
 * Password rule shown on the sign-up form. The contract has no constant for it (the server and the
 * test FakeApi enforce 8 and `signUp` throws `validation` with `field: 'password'` otherwise); the server's message wins
 * when it rejects one.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** The form field a `validation` error points at (`detail.field`), if any. */
export function errorField(error: unknown): string | undefined {
  if (!isApiError(error) || error.code !== 'validation') return undefined;
  const detail = error.detail as ValidationErrorDetail | undefined;
  return detail?.field;
}

/**
 * One line under a form for a failed submit, in the design-system voice: what happened and what to
 * do, no apologies, no codes. Field-level problems are shown on their field instead.
 */
export function formErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'network') return "You're offline. Check your connection and try again.";
  const copy = errorCopy(error);
  return `${copy.title}. ${copy.message}`;
}
