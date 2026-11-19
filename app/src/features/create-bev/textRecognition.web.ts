/**
 * The device's text recogniser -- the web half (`textRecognition.ts` is the native one).
 *
 * There is no recogniser here. Vision is an iOS framework, react-native-web has no equivalent,
 * and the alternatives were all rejected: a cloud OCR service would send someone's photo off the
 * device, and a WASM engine is megabytes of bundle for a route the phone app owns. So web says so
 * plainly, and the label-read route is simply not offered: the UI asks
 * `TEXT_RECOGNITION_AVAILABLE` before it shows the button, and the barcode scan and the manual
 * form still work. The reject is the backstop for a caller that asks anyway.
 */
import type { RecognisedLine } from './nutritionPanel';

export const TEXT_RECOGNITION_AVAILABLE: boolean = false;

export async function recogniseText(_uri: string): Promise<RecognisedLine[]> {
  throw new Error('Reading a label is only available in the Bevi app on a phone.');
}
