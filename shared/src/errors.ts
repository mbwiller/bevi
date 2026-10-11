/**
 * Error contract for `BeviApi`. Every method rejects with an `ApiError`; each
 * method's doc comment lists the codes it can throw (`network` and `unknown`
 * are always possible and listed only where they matter).
 *
 * UI mapping: `conflict` → refetch and retry (placement restarts);
 * `validation` → field errors from `detail`; `age_restricted` → neutral "Not
 * available" screen; `network` → Retry; `unauthorized` → sign out (except on
 * `signIn`, where it means wrong username or password).
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'age_restricted'
  | 'network'
  | 'unknown';

/**
 * `detail` shape for `validation` errors where a form field is at fault, e.g.
 * `{ field: 'inviteCode' }` on sign-up. Other codes may carry other details
 * (documented on the method).
 */
export interface ValidationErrorDetail {
  field?: string;
  reason?: string;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly detail?: unknown;

  constructor(code: ApiErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
