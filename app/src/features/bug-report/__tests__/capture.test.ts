import { Dimensions, PixelRatio } from 'react-native';
import * as ViewShot from 'react-native-view-shot';

import { captureScreen, releaseShot } from '../capture';
import * as layerHidden from '../layerHidden';

// The iOS file (jest resolves '../capture' as iOS): a window screenshot from react-native-view-shot,
// read into bytes. The web file, which redraws the DOM, is not run here.

jest.mock('react-native-view-shot', () => ({ captureScreen: jest.fn(), releaseCapture: jest.fn() }));
const shoot = ViewShot.captureScreen as jest.MockedFunction<typeof ViewShot.captureScreen>;
const release = ViewShot.releaseCapture as jest.MockedFunction<typeof ViewShot.releaseCapture>;

const mockBytes = jest.fn();
const mockFileUris: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    constructor(uri: string) {
      mockFileUris.push(uri);
    }
    bytes() {
      return mockBytes();
    }
  },
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const TMP = '/var/mobile/tmp/ReactNative/ReactNative-snapshot-image-1.jpg';

/** The steps of one capture, in the order they happen, so "the layer is hidden before the shutter" is a fact about order. */
let steps: string[];
let showLayer: jest.Mock;

beforeEach(() => {
  steps = [];
  showLayer = jest.fn(() => void steps.push('layer shown'));
  jest.spyOn(layerHidden, 'hideReporterLayer').mockImplementation(async () => {
    steps.push('layer hidden');
    return showLayer;
  });
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 3, fontScale: 1 });
  jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
  shoot.mockImplementation(async () => {
    steps.push('shutter');
    return TMP;
  });
  mockBytes.mockResolvedValue(JPEG);
  mockFileUris.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
  shoot.mockReset();
  release.mockReset();
  mockBytes.mockReset();
});

describe('captureScreen (iOS)', () => {
  it('takes a real screenshot of the window as a JPEG and returns its bytes, never a Blob', async () => {
    const shot = await captureScreen([]);
    expect(shot).not.toBeNull();
    expect(shot!.file).toBeInstanceOf(Uint8Array);
    expect([...(shot!.file as Uint8Array)]).toEqual([...JPEG]);
    expect(typeof Blob === 'undefined' || !(shot!.file instanceof Blob)).toBe(true);
    expect(shot!.mimeType).toBe('image/jpeg');
    expect(shoot).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpg', result: 'tmpfile', quality: 0.85 }));
  });

  it('hides the reporter before the shutter and shows it again straight after, before the file is read', async () => {
    mockBytes.mockImplementation(async () => {
      steps.push('file read');
      return JPEG;
    });
    await captureScreen([]);
    expect(steps).toEqual(['layer hidden', 'shutter', 'layer shown', 'file read']);
  });

  it('shows the reporter again when the shutter fails', async () => {
    shoot.mockRejectedValue(new Error('The view cannot be captured'));
    expect(await captureScreen([])).toBeNull();
    expect(showLayer).toHaveBeenCalledTimes(1);
  });

  it('scales the picture to a long side of at most 1600 pixels at the screen\'s own scale', async () => {
    const shot = await captureScreen([]);
    // 852 x 3 = 2556 pixels tall on this screen; 1600 / 2556 of that is asked for, in points.
    const options = shoot.mock.calls[0]![0]!;
    expect(options.width).toBe(246);
    expect(options.height).toBe(533);
    expect(shot!.height).toBe(533 * 3);
    expect(Math.max(shot!.width, shot!.height)).toBeLessThanOrEqual(1600);
  });

  it('does not scale a small screen up', async () => {
    (Dimensions.get as jest.Mock).mockReturnValue({ width: 320, height: 480, scale: 1, fontScale: 1 });
    (PixelRatio.get as jest.Mock).mockReturnValue(1);
    await captureScreen([]);
    expect(shoot.mock.calls[0]![0]).toMatchObject({ width: 320, height: 480 });
  });

  it('gives the note a file:// thumbnail and keeps the library\'s own path for releasing it', async () => {
    const shot = await captureScreen([]);
    expect(shot!.uri).toBe(`file://${TMP}`);
    expect(shot!.tmp).toBe(TMP);
    expect(mockFileUris).toEqual([`file://${TMP}`]);
    releaseShot(shot!);
    expect(release).toHaveBeenCalledWith(TMP);
  });

  it('accepts a path the library already gave as a file:// URI', async () => {
    shoot.mockResolvedValue(`file://${TMP}`);
    const shot = await captureScreen([]);
    expect(shot!.uri).toBe(`file://${TMP}`);
  });

  it('resolves null, and cleans up, when the file is empty or cannot be read', async () => {
    mockBytes.mockResolvedValue(new Uint8Array());
    expect(await captureScreen([])).toBeNull();
    expect(release).toHaveBeenCalledWith(TMP);

    release.mockClear();
    mockBytes.mockRejectedValue(new Error('no such file'));
    expect(await captureScreen([])).toBeNull();
    expect(release).toHaveBeenCalledWith(TMP);
  });

  it('resolves null when the capture library throws synchronously (it is not linked)', async () => {
    shoot.mockImplementation(() => {
      throw new Error('NativeModules.RNViewShot is undefined');
    });
    expect(await captureScreen([])).toBeNull();
    expect(showLayer).toHaveBeenCalled();
  });

  it('gives up after the timeout and lets go of a picture that arrives late', async () => {
    jest.useFakeTimers();
    try {
      let finish: (uri: string) => void = () => {};
      shoot.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = captureScreen([], { timeoutMs: 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      expect(await pending).toBeNull();
      finish(TMP);
      // Until the late picture has been read and let go of (no timer is involved: wait on the call).
      for (let i = 0; i < 100 && release.mock.calls.length === 0; i++) await Promise.resolve();
      expect(release).toHaveBeenCalledWith(TMP);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releasing a shot twice, or one with no temporary file, is safe', () => {
    expect(() => releaseShot({ file: JPEG, mimeType: 'image/jpeg', uri: 'x', width: 1, height: 1 })).not.toThrow();
    release.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(() => releaseShot({ file: JPEG, mimeType: 'image/jpeg', uri: 'x', width: 1, height: 1, tmp: TMP })).not.toThrow();
  });
});
