import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { PhotoCrop } from '@/lib/photoCrop';

import {
  AVATAR_MAX_EDGE,
  croppedEdge,
  fitWithin,
  PHOTO_MAX_EDGE,
  PHOTO_MIME,
  PHOTO_QUALITY,
  revokeIfBlob,
  UnsupportedImageError,
  type CropSource,
  type PhotoSource,
  type PreparedPhoto,
} from './photoCommon';

export * from './photoCommon';

/**
 * Photo capture for the create-Bev wizard, the web file (DEVELOPMENT-MATT §3, §6.10). The native
 * one, photo.ts, sends bytes instead of a Blob.
 *
 * `expo-image-picker` creates an `<input type="file" accept="image/*">` and clicks it synchronously
 * inside the tap handler, so iOS Safari (including the home-screen app) keeps the user gesture and
 * opens its picker:
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

async function viaManipulator(uri: string, width: number, height: number, maxEdge: number): Promise<PreparedPhoto> {
  const target = fitWithin(width, height, maxEdge);
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  if (target.width !== width) context.resize(target);
  const image = await context.renderAsync();
  try {
    const out = await image.saveAsync({ compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    try {
      const blob = await blobFromUri(out.uri);
      // The caller owns the preview URL (`uri`) and revokes it.
      return { uri: out.uri, file: blob, mimeType: PHOTO_MIME, width: out.width, height: out.height };
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

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the image'));
    el.src = uri;
  });
}

/** Plain canvas resize, for when the manipulator isn't available or throws. */
async function viaCanvas(uri: string, maxEdge: number): Promise<PreparedPhoto> {
  const img = await loadImage(uri);
  const target = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
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
  return { uri: URL.createObjectURL(blob), file: blob, mimeType: PHOTO_MIME, width: target.width, height: target.height };
}

/**
 * Resizes and re-encodes a picked image for upload (longest edge `maxEdge`, default 1600px; JPEG q0.85). Re-encoding also
 * drops EXIF (including GPS), so an image that can't be decoded is rejected with
 * `UnsupportedImageError` rather than uploaded untouched. The picker's own object URL is revoked
 * either way; the returned `uri` belongs to the caller.
 */
export async function preparePhoto(asset: ImagePicker.ImagePickerAsset, maxEdge = PHOTO_MAX_EDGE): Promise<PreparedPhoto> {
  try {
    if (asset.width > 0 && asset.height > 0) {
      try {
        return await viaManipulator(asset.uri, asset.width, asset.height, maxEdge);
      } catch {
        // Fall through to the canvas.
      }
    }
    if (typeof document !== 'undefined') {
      try {
        return await viaCanvas(asset.uri, maxEdge);
      } catch {
        // Fall through.
      }
    }
    throw new UnsupportedImageError();
  } finally {
    revokeIfBlob(asset.uri);
  }
}

async function cropViaManipulator(uri: string, crop: PhotoCrop, side: number): Promise<PreparedPhoto> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  try {
    context.crop({ originX: crop.x, originY: crop.y, width: crop.size, height: crop.size });
    if (side < crop.size) context.resize({ width: side, height: side });
    const image = await context.renderAsync();
    try {
      const out = await image.saveAsync({ compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
      try {
        const blob = await blobFromUri(out.uri);
        // The caller owns the preview URL (`uri`) and revokes it.
        return { uri: out.uri, file: blob, mimeType: PHOTO_MIME, width: out.width, height: out.height };
      } catch (e) {
        revokeIfBlob(out.uri);
        throw e;
      }
    } finally {
      // The cropped intermediate render (an object URL on the web).
      revokeIfBlob((image as unknown as { uri?: string }).uri);
      image.release();
    }
  } finally {
    context.release();
  }
}

/** Plain canvas crop (`drawImage` from a source rectangle), for when the manipulator isn't available or throws. */
async function cropViaCanvas(uri: string, crop: PhotoCrop, side: number): Promise<PreparedPhoto> {
  const img = await loadImage(uri);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('Could not read the image');
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PHOTO_MIME, PHOTO_QUALITY));
  if (!blob || blob.type !== PHOTO_MIME) throw new Error('Could not encode the image');
  // The caller owns this preview URL and revokes it.
  return { uri: URL.createObjectURL(blob), file: blob, mimeType: PHOTO_MIME, width: side, height: side };
}

/**
 * Cuts the square `crop` (the photo's own pixels, from the PhotoCropper) out of `photo`, an upright
 * working copy `preparePhoto` made, resizes it to at most `edge` square (never up) and re-encodes it
 * as a JPEG q0.85 Blob; a plain canvas does the same if the manipulator fails. Any failure is an
 * `UnsupportedImageError`. `photo.uri` is the caller's and is not revoked here; the returned `uri` is
 * the caller's too.
 */
export async function cropPhoto(photo: CropSource, crop: PhotoCrop, edge = AVATAR_MAX_EDGE): Promise<PreparedPhoto> {
  const side = croppedEdge(crop, edge);
  try {
    return await cropViaManipulator(photo.uri, crop, side);
  } catch {
    // Fall through to the canvas.
  }
  if (typeof document !== 'undefined') {
    try {
      return await cropViaCanvas(photo.uri, crop, side);
    } catch {
      // Fall through.
    }
  }
  throw new UnsupportedImageError();
}
