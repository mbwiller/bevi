/**
 * Bumped on any breaking change to the types or `BeviApi` below.
 *
 * 2.16.0, over 2.15.0's byte uploads: blocking and content reporting (IS-7,
 * App Store Guideline 1.2). `BeviApi` gains `blocks` (`block`, `unblock`, and
 * `list` returning `Page<BlockedUser>`) and `reports` (`report`, about a post,
 * a comment or a profile, with a `ReportReason` and an optional note), plus
 * `ReportContentKind`, `ReportReason`, `REPORT_REASONS` and `REPORT_NOTE_MAX`.
 * Purely additive for callers, hence a minor: no existing type or method
 * changes shape. A block does change what existing reads return (the two
 * people drop out of each other's feeds, comments and lists, and read each
 * other as 'not_found'), but through codes every older client already
 * handles. Nothing lets a caller learn who has blocked them.
 */
export const CONTRACT_VERSION = '2.16.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
