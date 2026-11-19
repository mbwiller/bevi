/**
 * `bevi-text-recognition` -- a local Expo module (iOS only) over Apple's Vision framework.
 *
 * It autolinks because it sits in `app/modules/`, which `expo-modules-autolinking` searches by
 * default (`nativeModulesDir`); `app.config.ts` needs no entry for it. There is no Android half
 * and no web half: the app has no Android target, and web gets
 * `app/src/features/create-bev/textRecognition.web.ts` instead.
 */
import type { RecognisedTextLine } from './src/BeviTextRecognition.types';
import { beviTextRecognition } from './src/BeviTextRecognitionModule';

export type { RecognisedTextLine };

/**
 * Reads the text in a local image on the device. `uri` is a local image URI as
 * `expo-image-picker` returns it (`file://...`).
 *
 * Rejects rather than returning part of a reading: `ERR_IMAGE_NOT_READABLE` when the image cannot
 * be decoded, `ERR_TEXT_RECOGNITION_FAILED` when Vision fails, and `Cannot find native module`
 * where the module is not linked at all. An image with no text in it resolves with an empty
 * array, which is an answer, not a failure.
 */
export async function recogniseText(uri: string): Promise<RecognisedTextLine[]> {
  return beviTextRecognition().recogniseText(uri);
}
