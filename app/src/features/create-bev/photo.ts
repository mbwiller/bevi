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
 * fallback does the same; if the browser can't decode the image at all, the original file is sent
 * when it is a type the server accepts.
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.85;
export const PHOTO_MIME = 'image/jpeg';
/** What `media.upload` accepts without conversion (the contract says "unsupported mimeType" only). */
const PASSTHROUGH_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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

async function viaManipulator(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const target = fitWithin(width, height);
  const actions = target.width !== width ? [{ resize: target }] : [];
  const out = await ImageManipulator.manipulateAsync(uri, actions, { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
  const blob = await blobFromUri(out.uri);
  return { uri: out.uri, blob, mimeType: PHOTO_MIME, width: out.width, height: out.height };
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
  return { uri: URL.createObjectURL(blob), blob, mimeType: PHOTO_MIME, width: target.width, height: target.height };
}

/** Resizes and compresses a picked image for upload (max 1600px, JPEG q0.85). */
export async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<PreparedPhoto> {
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
      // Fall through to the original.
    }
  }
  const mimeType = asset.mimeType ?? asset.file?.type ?? '';
  if (!PASSTHROUGH_MIME.includes(mimeType)) throw new Error('unsupported_image');
  const blob = asset.file ?? (await blobFromUri(asset.uri));
  return { uri: asset.uri, blob, mimeType, width: asset.width, height: asset.height };
}
