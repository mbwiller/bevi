import type { UploadPayload } from '@bevi/shared';

/**
 * What both photo pipelines share: `photo.ts` (native) and `photo.web.ts` (web) re-export all of
 * this, so callers keep importing from `./photo` (or `@/features/create-bev/photo`) and Metro picks
 * the platform's file. Nothing here touches a platform API.
 */

export const PHOTO_MAX_EDGE = 1600;
/** Profile photos are shown at 100pt at most, so they are resized much smaller than Bev photos. */
export const AVATAR_MAX_EDGE = 512;
export const PHOTO_QUALITY = 0.85;
export const PHOTO_MIME = 'image/jpeg';

export type PhotoSource = 'camera' | 'library';

/** A picked image, ready to preview and upload. */
export interface PreparedPhoto {
  /** Displayable now: an object URL on the web, a `file://` URI on native. */
  uri: string;
  /**
   * The re-encoded JPEG for `media.upload`: a `Blob` on the web, bytes (`Uint8Array`) on native,
   * where a React Native `Blob` would upload as an empty file (`UploadPayload`).
   */
  file: UploadPayload;
  mimeType: string;
  width: number;
  height: number;
}

/** The size that fits inside `max` × `max`, keeping the aspect ratio; never scales up. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Thrown when the picked file can't be decoded and re-encoded (it is never uploaded as-is). */
export class UnsupportedImageError extends Error {
  constructor() {
    super('unsupported_image');
    this.name = 'UnsupportedImageError';
  }
}

export function isUnsupportedImage(e: unknown): boolean {
  return e instanceof UnsupportedImageError;
}

/**
 * Thrown by `pickImage('camera')` when the camera permission is refused (native only; the browser
 * asks on its own). `canAskAgain` is false once iOS will no longer prompt, which after a "Don't
 * Allow" is always: only the Settings app can turn it back on.
 */
export class CameraPermissionError extends Error {
  readonly canAskAgain: boolean;
  constructor(canAskAgain: boolean) {
    super('camera_permission_denied');
    this.name = 'CameraPermissionError';
    this.canAskAgain = canAskAgain;
  }
}

export function isCameraPermissionDenied(e: unknown): e is CameraPermissionError {
  return e instanceof CameraPermissionError;
}

/** Frees an object URL this module or the picker created (no-op for anything else, e.g. `file://`). */
export function revokeIfBlob(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('blob:') || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // Already gone.
  }
}
