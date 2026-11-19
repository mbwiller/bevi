/**
 * The platform split behind the label read. Jest resolves as iOS, so `../textRecognition` is the
 * native file and the web one is loaded by its full name.
 *
 * The native module itself cannot be exercised here -- it is Swift, and Vision only exists on a
 * device -- so it is mocked, and what is under test is the contract both halves owe the UI:
 * whether a recogniser exists, and lines shaped like `RecognisedLine`.
 */
import { recogniseText as recogniseOnDevice } from '../../../../modules/bevi-text-recognition';
import type { RecognisedLine } from '../nutritionPanel';
import { recogniseText, TEXT_RECOGNITION_AVAILABLE } from '../textRecognition';
import * as web from '../textRecognition.web';

// AVAILABLE is now what the module reports about THIS binary, not a constant,
// so the stand-in has to answer it too.
jest.mock('../../../../modules/bevi-text-recognition', () => ({ AVAILABLE: true, recogniseText: jest.fn() }));

const mockRecognise = jest.mocked(recogniseOnDevice);

afterEach(() => mockRecognise.mockReset());

it('reports a recogniser on the device and passes the photo URI to the native module', async () => {
  expect(TEXT_RECOGNITION_AVAILABLE).toBe(true);
  mockRecognise.mockResolvedValue([]);

  await expect(recogniseText('file:///tmp/label.jpg')).resolves.toEqual([]);
  expect(mockRecognise).toHaveBeenCalledWith('file:///tmp/label.jpg');
});

it("returns the module's lines as RecognisedLine, coordinates untouched", async () => {
  // Vision's own space: normalised, origin bottom-left. Renormalising or flipping y here would
  // break the parser, which groups a row by y and picks the per-serving column by x.
  mockRecognise.mockResolvedValue([
    { text: 'Serving size 1 can (355ml)', confidence: 1, x: 0.08, y: 0.82 },
    { text: 'Sodium 140mg', confidence: 0.93, x: 0.08, y: 0.41 },
  ]);

  const lines = await recogniseText('file:///tmp/label.jpg');

  const typed: RecognisedLine[] = lines;
  expect(typed).toEqual([
    { text: 'Serving size 1 can (355ml)', confidence: 1, x: 0.08, y: 0.82 },
    { text: 'Sodium 140mg', confidence: 0.93, x: 0.08, y: 0.41 },
  ]);
  for (const line of typed) {
    expect(typeof line.text).toBe('string');
    expect(typeof line.confidence).toBe('number');
    expect(typeof line.x).toBe('number');
    expect(typeof line.y).toBe('number');
  }
});

it('passes a failed reading on rather than resolving with part of one', async () => {
  mockRecognise.mockRejectedValue(new Error('ERR_IMAGE_NOT_READABLE'));

  await expect(recogniseText('file:///tmp/label.jpg')).rejects.toThrow('ERR_IMAGE_NOT_READABLE');
});

it('imports where the native module is not linked, and fails only when called', async () => {
  // Not the mock: the real module, in an environment with no native module registered -- jest, and
  // any build the Swift half did not make it into. Looking the module up at import time instead
  // would throw here, and in the app it would take down every screen that imports the wizard.
  const native = jest.requireActual<typeof import('../../../../modules/bevi-text-recognition')>(
    '../../../../modules/bevi-text-recognition',
  );

  await expect(native.recogniseText('file:///tmp/label.jpg')).rejects.toThrow(/Cannot find native module/);
});

it('reports no recogniser on the web, and rejects if asked anyway', async () => {
  expect(web.TEXT_RECOGNITION_AVAILABLE).toBe(false);

  await expect(web.recogniseText('file:///tmp/label.jpg')).rejects.toThrow(/only available/i);
  // The web half never reaches for the native module.
  expect(mockRecognise).not.toHaveBeenCalled();
});
