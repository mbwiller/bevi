import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { CameraPermissionError, fitWithin, PHOTO_MAX_EDGE, PHOTO_MIME, PHOTO_QUALITY, UnsupportedImageError, type PhotoSource, type PreparedPhoto } from './photoCommon';

export * from './photoCommon';

/**
 * Photo capture for the create-Bev wizard, the native file (DEVELOPMENT-MATT-IOS IM-5). The web
 * one, photo.web.ts, keeps the file input, the canvas fallback and the Blob.
 *
 * The picker hands back a `file://` URI. The manipulator decodes it (HEIC included), resizes it to
 * fit `maxEdge` and saves a JPEG q0.85 to the cache; the upload then carries that file's **bytes**.
 * Never a `Blob`: a React Native Blob handed to Storage stores 0 bytes with no error, which is why
 * `media.upload` rejects one off the web (`UploadPayload`).
 */

/**
 * Opens the camera or the photo library. Returns null when the person cancels.
 *
 * The camera needs the camera permission (iOS rejects `launchCameraAsync` without it), so it is
 * asked for first; a refusal throws `CameraPermissionError`. The library asks for nothing: on iOS it
 * is the system picker, which runs outside the app and needs no photo-library permission.
 */
export async function pickImage(source: PhotoSource): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionError(permission.canAskAgain);
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0] ?? null;
}

type Rendered = Awaited<ReturnType<ImageManipulator.ImageManipulatorContext['renderAsync']>>;

/**
 * Decodes `source`, resized to fit `maxEdge` when its size is known. Only the longer edge is given
 * to the manipulator, which derives the other from the decoded image: the picker's width and height
 * can be the unrotated ones (a portrait HEIC), and passing both would squash the photo.
 */
async function render(source: string | Rendered, width: number, height: number, maxEdge: number): Promise<Rendered> {
  const context = ImageManipulator.ImageManipulator.manipulate(source);
  try {
    const target = fitWithin(width, height, maxEdge);
    if (width > 0 && height > 0 && (target.width !== width || target.height !== height)) {
      context.resize(width >= height ? { width: target.width } : { height: target.height });
    }
    return await context.renderAsync();
  } finally {
    context.release();
  }
}

/**
 * Resizes and re-encodes a picked image for upload (longest edge `maxEdge`, default 1600px; JPEG
 * q0.85) and reads the result's bytes. It always re-encodes, even when no resize is needed: that is
 * what drops EXIF (including GPS). An image the decoder can't handle is rejected with
 * `UnsupportedImageError`, never uploaded untouched. The returned `uri` (a cache file) is the preview.
 */
export async function preparePhoto(asset: ImagePicker.ImagePickerAsset, maxEdge = PHOTO_MAX_EDGE): Promise<PreparedPhoto> {
  let image: Rendered | null = null;
  try {
    image = await render(asset.uri, asset.width, asset.height, maxEdge);
    {
      // The picker's size is a hint (absent, or unrotated): the decoded image's is the truth. If it
      // still doesn't fit, shrink it by its own longer edge.
      const target = fitWithin(image.width, image.height, maxEdge);
      if (target.width !== image.width || target.height !== image.height) {
        const full = image;
        image = null;
        try {
          image = await render(full, full.width, full.height, maxEdge);
        } finally {
          full.release();
        }
      }
    }
    const out = await image.saveAsync({ compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    const bytes = await new File(out.uri).bytes();
    if (!bytes.byteLength) throw new Error('empty_image');
    return { uri: out.uri, file: bytes, mimeType: PHOTO_MIME, width: out.width, height: out.height };
  } catch {
    throw new UnsupportedImageError();
  } finally {
    image?.release();
  }
}
