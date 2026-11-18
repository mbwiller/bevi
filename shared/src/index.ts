/**
 * Bumped on any breaking change to the types or `BeviApi` below.
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
export const CONTRACT_VERSION = '2.15.0';

export * from './enums';
export * from './errors';
export * from './hours';
export * from './types';
export * from './api';
