/**
 * Gut-check bucket. Identical to `@bevi/ranking`'s `Bucket` (shared/ must not
 * import ranking, so it is restated here; the two must stay equal).
 *
 * The DB stores bucket as smallint 3/2/1 (LOVED/FINE/DISLIKED). That mapping is
 * `packages/api`'s job (its mappers); nothing above `packages/api` ever sees the
 * number.
 */
export type Bucket = 'LOVED' | 'FINE' | 'DISLIKED';

/** Best bucket first: the order lists, filters, counts and sorting use. */
export const BUCKET_ORDER: readonly Bucket[] = ['LOVED', 'FINE', 'DISLIKED'];

/** Gut-check copy, per the design system's voice. */
export const BUCKET_LABEL: Readonly<Record<Bucket, string>> = {
  LOVED: 'Loved it',
  FINE: 'It was okay',
  DISLIKED: 'Not for me',
};

export type CategoryId =
  | 'soda' | 'diet_soda' | 'juice' | 'water' | 'sparkling_water' | 'energy'
  | 'coffee' | 'tea' | 'boba' | 'sports' | 'smoothie'
  | 'beer' | 'wine' | 'spirits_cocktails' | 'other';

/**
 * A Bev's dominant taste family. Deliberately coarser than a category and cuts
 * across them: a cola soda and a cola slushie share `cola`. Mirrored by the
 * `base` check constraint on `bev_flavor_profiles`; keep the two in sync by
 * hand, as with `HANDLE_PATTERN`.
 *
 * The leaves of the finer taxonomy (D-04) are meant to line up with these.
 */
export type FlavorBase =
  | 'cola' | 'citrus' | 'lemon-lime' | 'berry' | 'tropical' | 'apple'
  | 'grape' | 'orange' | 'ginger' | 'root-beer' | 'cream'
  | 'coffee' | 'tea' | 'matcha' | 'chai' | 'chocolate' | 'nut'
  | 'herbal' | 'mineral' | 'hop' | 'wine' | 'agave' | 'grain' | 'other';

/** How a Bev is normally served. */
export type FlavorServe = 'hot' | 'cold' | 'either';

/**
 * Where a Bev's flavour profile came from. `catalog` is hand-labelled in
 * `data/catalog/flavor-profiles.csv`; `inferred` is copied from the nearest
 * seeded Bev by embedding for a Bev a user created (D-11), and gets relabelled
 * by a later pass.
 */
export type FlavorProfileSource = 'catalog' | 'inferred';

export type PriceTier = 1 | 2 | 3 | 4;

/** Server-side photo processing (background removal). The UI shows a shimmer while 'processing'. */
export type PhotoStatus = 'processing' | 'ready';

/**
 * Kinds of feed post the app renders. `packages/api` maps DB `feed_events.kind`:
 * 'ranked' | 'reranked' → 'RANKING'. Saving a Bev is not a feed post, so the
 * feed carries rankings only.
 */
export type FeedEventKind = 'RANKING';

export type BevStatus = 'pending_photo' | 'active' | 'merged' | 'hidden';

/**
 * Handle (= username) rules, mirrored from the DB check on `profiles.handle`:
 * lowercase letters, digits and underscore, 3–20 chars. The sign-up form
 * validates with this before calling `profile.checkHandle`.
 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Handles the server rejects even when the pattern matches. */
export const RESERVED_HANDLES: readonly string[] = ['admin', 'bevi', 'support', 'null'];

/**
 * What a content report is about (IS-7), mirrored from the check on
 * `content_reports.content_type`: a feed post (`FeedItem.id` / `ExplorePost.id`),
 * a comment (`Comment.id`) or a person (`Profile.id`). A Bev in the catalog is
 * not one of them: that is `bevs.report`.
 */
export type ReportContentKind = 'post' | 'comment' | 'profile';

/**
 * Why something is reported (IS-7), mirrored from the check on
 * `content_reports.reason` and `report_content`'s own validation; keep the
 * three in sync by hand, as with `HANDLE_PATTERN`.
 */
export type ReportReason =
  | 'spam' | 'harassment' | 'hate' | 'violence' | 'sexual'
  | 'self_harm' | 'illegal' | 'misinformation' | 'other';

/** Every `ReportReason`, in the order a report sheet offers them (`other` last). */
export const REPORT_REASONS: readonly ReportReason[] = [
  'spam', 'harassment', 'hate', 'violence', 'sexual', 'self_harm', 'illegal', 'misinformation', 'other',
];

/** The longest `note` a content report takes, in characters after trimming (`content_reports.note`). */
export const REPORT_NOTE_MAX = 500;
