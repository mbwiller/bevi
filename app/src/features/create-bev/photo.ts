import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Photo capture for the create-Bev wizard (DEVELOPMENT-MATT §3, §6.10).
 *
 * On the web (the only platform Bevi ships) `expo-image-picker` creates an
 * `<input type="file" accept="image/*">` and clicks it synchronously inside the tap handler, so
 * iOS Safari (including the home-screen app) keeps the user gesture and opens its picker:
 *   - "Choose photo" (`launchImageLibraryAsync`): no `capture`, so iOS offers Take Photo, Photo
 *     Library or Choose File.
 *   - "Take photo" (`launchCameraAsync`): adds `capture`, which opens the camera directly where the
 *     browser supports it; desktop browsers ignore it and show the file dialog.
 * Cancelling resolves `{ canceled: true }` (the input's `cancel` event).
 *
 * The chosen image is then resized to fit 1600px and re-encoded as JPEG q0.85 before upload
 * (expo-image-manipulator, which draws to a canvas on the web). If that fails, a plain canvas
 * fallback does the same; if the browser can't decode the image at all it is rejected (never
 * uploaded untouched, which would keep its EXIF/GPS data).
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.85;
export const PHOTO_MIME = 'image/jpeg';

export type PhotoSource = 'camera' | 'library';

/** A picked image, ready to preview and upload. */
export interface PreparedPhoto {
  /** Displayable now (an object URL on the web). */
  uri: string;
  blob: Blob;
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

/** Opens the camera or the photo library. Returns null when the person cancels. */
export async function pickImage(source: PhotoSource): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0] ?? null;
}

async function blobFromUri(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return res.blob();
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

/** Frees an object URL this module or the picker created (no-op for anything else). */
export function revokeIfBlob(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('blob:') || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // Already gone.
  }
}

async function viaManipulator(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const target = fitWithin(width, height);
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  if (target.width !== width) context.resize(target);
  const image = await context.renderAsync();
  try {
    const out = await image.saveAsync({ compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    try {
      const blob = await blobFromUri(out.uri);
      // The caller owns the preview URL (`uri`) and revokes it.
      return { uri: out.uri, blob, mimeType: PHOTO_MIME, width: out.width, height: out.height };
    } catch (e) {
      revokeIfBlob(out.uri);
      throw e;
    }
  } finally {
    // The full-size intermediate render (an object URL on the web).
    revokeIfBlob((image as unknown as { uri?: string }).uri);
    context.release();
    image.release();
  }
}

/** Plain canvas resize, for when the manipulator isn't available or throws. Web only. */
async function viaCanvas(uri: string): Promise<PreparedPhoto> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the image'));
    el.src = uri;
  });
  const target = fitWithin(img.naturalWidth, img.naturalHeight);
  if (!target.width || !target.height) throw new Error('Could not read the image');
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.drawImage(img, 0, 0, target.width, target.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PHOTO_MIME, PHOTO_QUALITY));
  if (!blob || blob.type !== PHOTO_MIME) throw new Error('Could not encode the image');
  // The caller owns this preview URL and revokes it.
  return { uri: URL.createObjectURL(blob), blob, mimeType: PHOTO_MIME, width: target.width, height: target.height };
}

/**
 * Resizes and re-encodes a picked image for upload (max 1600px, JPEG q0.85). Re-encoding also
 * drops EXIF (including GPS), so an image that can't be decoded is rejected with
 * `UnsupportedImageError` rather than uploaded untouched. The picker's own object URL is revoked
 * either way; the returned `uri` belongs to the caller.
 */
export async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<PreparedPhoto> {
  try {
    if (asset.width > 0 && asset.height > 0) {
      try {
        return await viaManipulator(asset.uri, asset.width, asset.height);
      } catch {
        // Fall through to the canvas.
      }
    }
    if (typeof document !== 'undefined') {
      try {
        return await viaCanvas(asset.uri);
      } catch {
        // Fall through.
      }
    }
    throw new UnsupportedImageError();
  } finally {
    revokeIfBlob(asset.uri);
  }
}
