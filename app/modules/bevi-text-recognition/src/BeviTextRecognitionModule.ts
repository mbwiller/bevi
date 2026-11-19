import { NativeModule, requireNativeModule } from 'expo';

import type { RecognisedTextLine } from './BeviTextRecognition.types';

declare class BeviTextRecognitionModule extends NativeModule<{}> {
  /**
   * Reads the text in the image at `uri` (a local `file://` URI, or a path) with one
   * `VNRecognizeTextRequest`. Rejects with `ERR_IMAGE_NOT_READABLE` when the image cannot be
   * decoded and `ERR_TEXT_RECOGNITION_FAILED` when Vision itself fails; it never resolves with
   * part of a reading.
   */
  recogniseText(uri: string): Promise<RecognisedTextLine[]>;
}

/**
 * The native module, looked up per call rather than once at import.
 *
 * `requireNativeModule` throws wherever the module is not linked -- under jest, and on any
 * platform it was not built for -- and a module that throws while being imported takes down every
 * screen that imports anything near it (it did: the app shell's test). Looked up here, that same
 * failure arrives as a rejected promise the caller already has a `catch` for. The lookup reads the
 * registry Expo installs on the global object, so there is nothing worth caching.
 */
export function beviTextRecognition(): BeviTextRecognitionModule {
  return requireNativeModule<BeviTextRecognitionModule>('BeviTextRecognition');
}
