/**
 * The device's text recogniser -- the native half (`textRecognition.web.ts` is the web one).
 *
 * `bevi-text-recognition` is a local Expo module over Apple's Vision framework
 * (`app/modules/bevi-text-recognition`): one `VNRecognizeTextRequest` per image, run on the
 * phone, offline, free, with no third-party OCR and no network call. `nutritionPanel.ts` turns
 * the lines it returns into a panel.
 */
import { recogniseText as recogniseOnDevice } from '../../../modules/bevi-text-recognition';

import type { RecognisedLine } from './nutritionPanel';

/** Vision is always there on iOS: it is part of the system, not a download. */
export const TEXT_RECOGNITION_AVAILABLE: boolean = true;

/**
 * The lines of text in the image at `uri` (a local `file://` URI from `expo-image-picker`).
 *
 * The module's coordinates pass through untouched: `nutritionPanel.ts` reads `y` to group a row
 * and `x` to pick the left-hand, per-serving column, both in Vision's normalised,
 * origin-bottom-left space. Rejects when the image cannot be read; it never returns part of a
 * reading.
 */
export async function recogniseText(uri: string): Promise<RecognisedLine[]> {
  return recogniseOnDevice(uri);
}
