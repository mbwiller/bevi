/**
 * Gut-check bucket. Identical to `@bevi/ranking`'s `Bucket` (shared/ must not
 * import ranking, so it is restated here; the two must stay equal).
 *
 * The DB stores bucket as smallint 3/2/1 (LOVED/FINE/DISLIKED). That mapping is
 * `packages/api`'s job (its mappers); nothing above `packages/api` ever sees the
 * number.
 */
export type Bucket = 'LOVED' | 'FINE' | 'DISLIKED';

/** Best bucket first: the order lists and the gut-check buttons use. */
export const BUCKET_ORDER: readonly Bucket[] = ['LOVED', 'FINE', 'DISLIKED'];

/** Gut-check copy, per the design system's voice. */
export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  LOVED: 'Loved it',
  FINE: 'It was fine',
  DISLIKED: "Didn't like it",
};

export type CategoryId =
  | 'soda' | 'diet_soda' | 'juice' | 'water' | 'sparkling_water' | 'energy'
  | 'coffee' | 'tea' | 'boba' | 'sports' | 'smoothie'
  | 'beer' | 'wine' | 'spirits_cocktails' | 'other';

export type PriceTier = 1 | 2 | 3 | 4;

/** Server-side photo processing (background removal). The UI shows a shimmer while 'processing'. */
export type PhotoStatus = 'processing' | 'ready';

/**
 * Kinds of feed post the app renders. `packages/api` maps DB `feed_events.kind`:
 * 'ranked' | 'reranked' → 'RANKING', 'want_to_try' → 'SAVED'; 'followed' events
 * are not feed posts in v1 and are filtered out.
 */
export type FeedEventKind = 'RANKING' | 'SAVED';

export type BevStatus = 'pending_photo' | 'active' | 'merged' | 'hidden';

/**
 * Handle (= username) rules, mirrored from the DB check on `profiles.handle`:
 * lowercase letters, digits and underscore, 3–20 chars. The sign-up form
 * validates with this before calling `profile.checkHandle`.
 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Handles the server rejects even when the pattern matches. */
export const RESERVED_HANDLES: readonly string[] = ['admin', 'bevi', 'support', 'null'];
