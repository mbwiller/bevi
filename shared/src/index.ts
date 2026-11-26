/**
 * Bumped on any breaking change to the types or `BeviApi` below.
 *
 * 3.10.0, over 3.9.0's go-to categories: a nutrition snapshot no longer has
 * to come from a barcode. `NutritionPreview` gains `source` (`NutritionSource`:
 * `'openfoodfacts' | 'label-ocr'`), and `barcode` and `sourceUrl` widen to
 * `string | null`, which a label read leaves null.
 * `BeviApi` is otherwise unchanged: a label is read ON THE DEVICE, by the app,
 * using the platform's own text recogniser, so there is no new API method, no
 * new service and no credential. Barcode lookup, its stored snapshots and the
 * two `basis` strings are unchanged.
 *
 * A minor rather than a major, deliberately, and only because of what the
 * backend does alongside it. Every installed binary before this version types
 * `sourceUrl` as a string and passes it to `Linking.openURL` unguarded, which
 * throws on null -- fatal in a release build. No floor protects them: builds
 * 0.1.0 (2) and (3) never read `app_config`, and no build at 3.10.0 exists to
 * raise a floor to. So those binaries are never served a label read at all:
 * `bev_nutrition`'s select policy shows Open Food Facts rows only, and this
 * version reads both kinds through `get_bev_nutrition()`
 * (20261130000100). An old binary sees a label-read Bev as one with no
 * nutrition, which it already handles. `source` is absent from every
 * snapshot stored before this version, so `packages/api` defaults a missing
 * one to `'openfoodfacts'` where it maps the row, which is what all of them
 * are.
 *
 * NOT a reason to raise `min_contract_version`: with the policy narrowed, no
 * older binary is served anything it cannot parse (`DEVELOPMENT-ARJUN.md`
 * §14). Widening the policy back is a §15 row.
 *
 * 3.9.0, over 3.8.0's push notifications: go-to categories (DELIVERABLE-44).
 * Additive: `profile.getCategoryPicks()` and `profile.setCategoryPicks()`,
 * up to `MAX_CATEGORY_PICKS` top-level categories picked in onboarding,
 * favourite first, private to their owner. Backed by the new
 * `user_category_picks` table and `set_category_picks` RPC. NOT a reason to
 * raise `min_contract_version`: no existing type or method changed, and an
 * older client calls neither method.
 *
 * 3.8.0, over 3.7.0's inbox: push notifications and their settings (T-31,
 * Release 2). Additive: six `notifications` methods -- `getSettings` and
 * `updateSettings` (`NotificationSettings`: `paused` and one switch per kind),
 * `listPostNotificationPeople` and `setPostNotification` (be pushed when
 * someone you follow posts a new Bev; `PostNotificationPerson`), and
 * `registerPushToken` / `unregisterPushToken` (this device's Expo token). A
 * backend without them answers the default settings and an empty people list,
 * and ignores a token; saving a setting or a choice throws instead of
 * pretending. NOT a reason to raise `min_contract_version`: an older client
 * calls none of it, and nothing it already reads changed.
 *
 * 3.7.0, over 3.6.0's tester reporting: the notifications inbox (T-31).
 * Additive: a `notifications` namespace (`list`, `unreadCount`, `markRead`)
 * answering `Notification` rows, and `feed.getPost`, the one post a
 * notification opens. Likes on one post share a row; every row is checked at
 * read time, so an unfollow, an unlike, a deleted comment or a block hides
 * it. A backend without the inbox answers an empty page and a count of 0.
 * NOT a reason to raise `min_contract_version`: an older client never calls
 * any of it, and nothing it already reads changed.
 *
 * 3.6.0, over 3.5.0's places: testers report bugs without ranking them.
 * Additive: `bugs.canRank()`, true for a founder (an admin) only. For an
 * account that may not rank, `place` throws 'unauthorized' and every
 * `BugReportSummary.rank` is null. `markVerified` now throws 'conflict' for
 * a ticket that is not in review, for every caller. NOT a reason to raise
 * `min_contract_version`: an older client never calls `canRank`, still
 * files and lists, and reads a refused placement or verify as a failure.
 *
 * 3.5.0, over 3.4.0's barcode product lookup: where a Bev was had (BEV-22).
 * Additive: `RankedBev.venue` and `FeedItem.venue` (so `ExplorePost` too),
 * `SubmitRankingInput.venueId`, `rankings.setVenue`, `rankings.getVenue` and
 * `rankings.locationSummary`, and six `venues` methods: `search`,
 * `searchMore`, `addPlace`, `recent`, `bevdMap`, `bevdAt`. A venue says what
 * kind of place it is (`placeType`), and may now be anywhere on the Earth, so
 * `NYC_BOUNDS` describes the imported venues and the parked venue map, not
 * every `Venue`. NOT a reason to raise `min_contract_version`:
 * a client built against 3.3.0 never reads the new fields and calls none of
 * the new methods.
 *
 * 3.4.0, over 3.3.0's native bug reporter: a barcode scan fills in a new Bev.
 * `NutritionApi` gains `lookupProduct`, returning a `BarcodeProduct`: the name,
 * brand and Bevi category the provider lists for a barcode, with the
 * `NutritionPreview` `lookupBarcode` already returned. Purely additive for
 * callers, hence a minor: `lookupBarcode`, `NutritionPreview` and
 * `CreateBevInput` keep their shapes, and nothing a client is served changed.
 * The app's wizard copies the product into its form fields; what is created
 * still goes through `bevs.create` unchanged, so there is no migration and no
 * new RPC. NOT a reason to raise `min_contract_version`.
 *
 * 3.3.0, over 3.2.0's version gate: the native bug reporter (IM-10 part 2).
 * `BugReportInput.evidence[].file` widens from `Blob` to `UploadPayload`, the
 * union `media.upload` has taken since 2.15.0. Purely additive for callers,
 * hence a minor: every `Blob` a caller passes today is still accepted, and
 * nothing a client is served changed. On React Native a caller passes bytes,
 * and an implementation off the web refuses a `Blob` with `'validation'`
 * before anything is staged (the same guard as `media.upload`). The
 * `bug-report` Edge Function and the `bug-evidence` bucket are untouched: they
 * only ever see the uploaded object. NOT a reason to raise
 * `min_contract_version`.
 *
 * 3.2.0, over 3.1.0's blocks and reports: the version gate reads its real row
 * (IA-2). `AppConfig` gains `minContractVersion` (the lowest `CONTRACT_VERSION`
 * the backend still serves, beside `minAppVersion`) and `maintenanceMessage`
 * (what to show while `maintenance` is true, or null). Purely additive for
 * callers, hence a minor: `minAppVersion` and `maintenance` keep their names
 * and types, `meta.getAppConfig` keeps its signature and stays callable signed
 * out, and a client built against 3.1.0 never reads the two new fields. What
 * does change is where the values come from: `packages/api` returned a fixed
 * `{ minAppVersion: '0.1.0', maintenance: false }` until now, and reads
 * `app_config` through `get_app_config()` from here on.
 *
 * NOT a reason to raise `min_contract_version` either: nothing an installed
 * binary is served changed shape. Both floors are still seeded `'0.0.0'`, so
 * the gate is open until an operator raises one on purpose
 * (`DEVELOPMENT-ARJUN.md` §14).
 *
 * 3.1.0, over 3.0.0's custom Bevs and generated icons: blocking and content
 * reporting (IS-7, App Store Guideline 1.2). `BeviApi` gains `blocks` (`block`,
 * `unblock`, and `list` returning `Page<BlockedUser>`) and `reports` (`report`,
 * about a post, a comment or a profile, with a `ReportReason` and an optional
 * note), plus `ReportContentKind`, `ReportReason`, `REPORT_REASONS` and
 * `REPORT_NOTE_MAX`. Purely additive for callers, hence a minor: no existing
 * type or method changes shape. A block does change what existing reads return
 * (the two people drop out of each other's feeds, comments and lists, and read
 * each other as 'not_found'), but through codes every older client already
 * handles. Nothing lets a caller learn who has blocked them.
 *
 * 3.0.0, over 2.15.0's raw-byte uploads: `CreateBevInput.photoAssetId` became
 * OPTIONAL. That is a widening for anything CONSTRUCTING the input, but a
 * breaking change for anything READING it -- every `BeviApi` implementation
 * now gets `string | undefined` where it had `string`. Both implementations
 * live in this repo and are updated, so nothing is broken today; the major
 * bump is so that an implementor outside it could not read a minor bump as
 * safe. Also adds `bevs.icons()`, `BevIcon`, `BevIconLabelBand` and
 * `IconStatus`, which are purely additive.
 *
 * NOT a reason to raise `min_contract_version`. That floor exists for a client
 * which would be served a RESPONSE it cannot parse (`DEVELOPMENT-ARJUN.md`
 * §14); an installed binary still sends `photoAssetId` and the backend still
 * accepts it, and §14's own table calls dropping a `not null` safe in one
 * release. Raising the floor to 3.0.0 would lock out every shipped build for
 * nothing, which §14 forbids in the same breath.
 *
 * Note the two distinct icon concepts, which 2.13.0 and this change
 * introduced within a day of each other: `BevSummary.iconUrl` is the AUTHORED
 * catalogue icon, served from `public.bev_icons`. `BevIcon.generatedIconUrl`
 * is the AI illustration made for a custom Bev. See `BevIcon`.
 *
 * Carried forward from 2.15.0, being a standing requirement on implementations
 * rather than a changelog line: `UploadMediaInput.file` is `UploadPayload`
 * (`Blob | ArrayBuffer | Uint8Array`), and off the web an implementation must
 * reject a `Blob` with `'validation'` instead of uploading it -- React
 * Native's `Blob` holds a native handle, not bytes, and Storage silently
 * writes a 0-byte object. Bug report evidence
 * (`BugReportInput.evidence[].file`) followed in 3.3.0.
 */
// 3.0.0: user-created photo-backed Bevs enqueue icon generation automatically.
// 3.1.0: blocks and content reports (IS-7), additive.
// 3.2.0: AppConfig gains minContractVersion and maintenanceMessage (IA-2), additive.
// 3.3.0: BugReportInput.evidence[].file is an UploadPayload (the native bug reporter, IM-10), additive.
// 3.4.0: nutrition.lookupProduct and BarcodeProduct (a barcode scan fills in a new Bev), additive.
// 3.5.0: where a Bev was had: a place on a ranking and a post, the place picker, the map (BEV-22), additive.
// 3.6.0: bugs.canRank; testers cannot place and see no ranks; markVerified only from In review, additive.
// 3.7.0: the notifications inbox (notifications.list/unreadCount/markRead) and feed.getPost (T-31), additive.
// 3.8.0: push notifications: settings, post subscriptions, device tokens (T-31 Release 2), additive.
// 3.9.0: profile.getCategoryPicks / setCategoryPicks, the go-to categories picked in onboarding (DELIVERABLE-44), additive.
// 3.10.0: NutritionPreview.source; a snapshot read from a label photo on the device, with no barcode (BEV-13), additive.
export const CONTRACT_VERSION = '3.10.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
