// A `Date.now()`-based suffix collided across these two live test files in
// CI once already (both started within the same millisecond, producing
// the same username -- the second signUp then failed as a generic
// "Database error saving new user", GoTrue swallowing the real conflict).
// `crypto.randomUUID()` doesn't have that failure mode.
export function randomTestUsername(): string {
  // 'vitest' (6) + 12 hex chars = 18, under HANDLE_PATTERN's 20-char cap.
  return `vitest${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
