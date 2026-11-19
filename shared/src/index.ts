/**
 * Bumped on any breaking change to the types or `BeviApi` below.
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
 * (`BugReportInput.evidence[].file`) stays web-only until the reporter is
 * ported.
 */
// 3.0.0: user-created photo-backed Bevs enqueue icon generation automatically.
export const CONTRACT_VERSION = '3.0.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
