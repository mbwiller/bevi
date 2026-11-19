/**
 * Bumped on any breaking change to the types or `BeviApi` below.
 *
 * 2.16.0, over 2.15.0: nutrition snapshots no longer have to come from a
 * barcode. `NutritionPreview` gains `source` (`NutritionSource`:
 * `'openfoodfacts' | 'label-ocr'`), and `barcode` and `sourceUrl` widen to
 * `string | null`, which a label read leaves null. `NutritionApi` gains
 * `scanLabel(labelAssetId)`, which reads the panel out of a photo the caller
 * uploaded. Barcode lookup, its stored snapshots and the two `basis` strings
 * are unchanged.
 *
 * A minor rather than a major, deliberately, on three grounds. Nothing reads
 * `barcode` at runtime -- it is stored and traced, never rendered -- so the
 * widening costs no shipped client a screen; `sourceUrl` is only ever opened
 * as a link, now behind a null check; and `source` is absent from every
 * snapshot written before this version, so `packages/api` defaults a missing
 * one to `'openfoodfacts'` where it maps the row, which is what all of them
 * are. No field is removed or retyped into a shape an older client cannot
 * parse. `min_contract_version` therefore stays `'0.0.0'`: there is nothing to
 * gate out (no EAS build has ever run, so no binary exists off this repo), and
 * raising a floor before IM-9's "update required" screen exists would be a
 * dead app with no explanation (`DEVELOPMENT-ARJUN.md` §14).
 *
 * 2.15.0, over 2.14.0's barcode nutrition lookup: `UploadMediaInput.file`
 * widened from `Blob` to `UploadPayload` (`Blob | ArrayBuffer | Uint8Array`),
 * so `media.upload` takes raw bytes. Purely additive for callers, hence a
 * minor. Off the web an implementation must reject a `Blob` with
 * `'validation'` instead of uploading it: React Native's `Blob` holds a native
 * handle, not bytes, and Storage silently writes a 0-byte object. Bug report
 * evidence (`BugReportInput.evidence[].file`) is deliberately unchanged and
 * stays web-only until the reporter is ported.
 */
export const CONTRACT_VERSION = '2.16.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
