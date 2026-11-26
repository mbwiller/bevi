import { NativeModule, requireNativeModule, requireOptionalNativeModule } from 'expo';

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

/**
 * Whether the native half is in THIS binary -- which is not the same question as whether the
 * device has Vision. Vision ships with iOS; this module ships with the build. An app installed
 * before it existed (a tester's dev client, a TestFlight build already out) has the Swift
 * missing, and asserting availability there offers a button that cannot work and then blames the
 * person's photo for it.
 *
 * `requireOptionalNativeModule` answers null instead of throwing, which is the only way to ask.
 */
export function beviTextRecognitionAvailable(): boolean {
  return requireOptionalNativeModule('BeviTextRecognition') !== null;
}
