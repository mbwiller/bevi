/**
 * Draft error contract for `BeviApi`. Every method that can fail should reject
 * with an `ApiError` (or document explicitly why it can't).
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
