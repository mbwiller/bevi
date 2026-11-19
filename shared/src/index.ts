/**
 * Bumped on any breaking change to the types or `BeviApi` below.
 *
 * 3.1.0, over 3.0.0's optional `photoAssetId` and Bev icons: a nutrition
 * snapshot no longer has to come from a barcode. `NutritionPreview` gains
 * `source` (`NutritionSource`: `'openfoodfacts' | 'label-ocr'`), and `barcode`
 * and `sourceUrl` widen to `string | null`, which a label read leaves null.
 * `BeviApi` is otherwise unchanged: a label is read ON THE DEVICE, by the app,
 * using the platform's own text recogniser, so there is no new API method, no
 * new service and no credential. Barcode lookup, its stored snapshots and the
 * two `basis` strings are unchanged.
 *
 * A minor rather than a major, deliberately. Nothing reads `barcode` at
 * runtime -- it is stored and traced, never rendered -- so the widening costs
 * no shipped client a screen; `sourceUrl` is only ever opened as a link, now
 * behind a null check; and `source` is absent from every snapshot written
 * before this version, so `packages/api` defaults a missing one to
 * `'openfoodfacts'` where it maps the row, which is what all of them are. No
 * field is removed or retyped into a shape an older client cannot parse.
 *
 * NOT a reason to raise `min_contract_version`, for the same reason 3.0.0 was
 * not: the floor exists for a client that would be served a RESPONSE it cannot
 * parse (`DEVELOPMENT-ARJUN.md` §14), and an older binary reading a snapshot
 * it has no `source` field for simply ignores the key.
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
export const CONTRACT_VERSION = '3.1.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
