/**
 * Bumped on any breaking change to the types or `BeviApi` below.
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
export const CONTRACT_VERSION = '3.3.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
