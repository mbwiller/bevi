import type { ImagePickerAsset } from 'expo-image-picker';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_MAX_EDGE, AVATAR_SOURCE_MAX_EDGE, CameraPermissionError, cropPhoto, fitWithin, pickImage, preparePhoto, UnsupportedImageError } from '../photo';

// The native file (jest resolves '../photo' as iOS): manipulator → JPEG file → its bytes. The web
// file is covered by photo.web.test.ts.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (source: unknown) => mockManipulate(source) },
  SaveFormat: { JPEG: 'jpeg' },
}));

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

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const picked = (over: Partial<ImagePickerAsset> = {}): ImagePickerAsset =>
  ({ uri: 'file:///cache/ImagePicker/original.heic', width: 4000, height: 3000, mimeType: 'image/heic', ...over }) as ImagePickerAsset;

/** A manipulator context whose render saves to `out`. */
function context(out = { uri: 'file:///cache/ImageManipulator/out.jpg', width: 1600, height: 1200 }, rendered = { width: out.width, height: out.height }) {
  const saveAsync = jest.fn(async () => out);
  const imageRelease = jest.fn();
  const ctx = { resize: jest.fn(), crop: jest.fn(), release: jest.fn(), renderAsync: jest.fn(async () => ({ ...rendered, saveAsync, release: imageRelease })) };
  return { ctx, saveAsync, imageRelease };
}

beforeEach(() => {
  mockBytes.mockResolvedValue(JPEG);
  mockFileUris.length = 0;
});

afterEach(() => {
  mockManipulate.mockReset();
  mockBytes.mockReset();
  jest.clearAllMocks();
});

describe('preparePhoto (native)', () => {
  it('resizes to 1600px, re-encodes as JPEG q0.85 and returns the saved file as bytes, not a Blob', async () => {
    const { ctx, saveAsync, imageRelease } = context();
    mockManipulate.mockReturnValue(ctx);
    const photo = await preparePhoto(picked());
    expect(mockManipulate).toHaveBeenCalledWith('file:///cache/ImagePicker/original.heic');
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' });
    // The bytes are read from the file the manipulator saved.
    expect(mockFileUris).toEqual(['file:///cache/ImageManipulator/out.jpg']);
    expect(photo).toMatchObject({ uri: 'file:///cache/ImageManipulator/out.jpg', mimeType: 'image/jpeg', width: 1600, height: 1200 });
    // The bug this file exists for: a React Native Blob uploads as an empty object.
    expect(photo.file).not.toBeInstanceOf(Blob);
    expect(photo.file).toBeInstanceOf(Uint8Array);
    expect(photo.file).toBe(JPEG);
    expect(ctx.release).toHaveBeenCalled();
    expect(imageRelease).toHaveBeenCalled();
  });

  it('fits 512px for profile photos', async () => {
    expect(AVATAR_MAX_EDGE).toBe(512);
    expect(fitWithin(4000, 3000, AVATAR_MAX_EDGE)).toEqual({ width: 512, height: 384 });
    const { ctx } = context({ uri: 'file:///out.jpg', width: 512, height: 384 });
    mockManipulate.mockReturnValue(ctx);
    await preparePhoto(picked(), AVATAR_MAX_EDGE);
    expect(ctx.resize).toHaveBeenCalledWith({ width: 512 });
  });

  it('re-encodes even when no resize is needed (that is what drops EXIF/GPS)', async () => {
    const { ctx, saveAsync } = context({ uri: 'file:///out.jpg', width: 800, height: 600 }, { width: 800, height: 600 });
    mockManipulate.mockReturnValue(ctx);
    const photo = await preparePhoto(picked({ width: 800, height: 600, mimeType: 'image/jpeg' }));
    expect(ctx.resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' });
    expect(photo.uri).toBe('file:///out.jpg');
  });

  it('fits the decoded size when the picker gives none', async () => {
    const first = context(undefined, { width: 4000, height: 2000 });
    const second = context({ uri: 'file:///out.jpg', width: 1600, height: 800 }, { width: 1600, height: 800 });
    mockManipulate.mockReturnValueOnce(first.ctx).mockReturnValueOnce(second.ctx);
    const photo = await preparePhoto(picked({ width: 0, height: 0 }));
    expect(first.ctx.resize).not.toHaveBeenCalled();
    expect(second.ctx.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(first.imageRelease).toHaveBeenCalled();
    expect(first.saveAsync).not.toHaveBeenCalled();
    expect(photo).toMatchObject({ width: 1600, height: 800 });
  });

  it('resizes a portrait by its height only, so the manipulator keeps the aspect ratio', async () => {
    const { ctx } = context({ uri: 'file:///out.jpg', width: 1200, height: 1600 });
    mockManipulate.mockReturnValue(ctx);
    await preparePhoto(picked({ width: 3000, height: 4000 }));
    expect(ctx.resize).toHaveBeenCalledTimes(1);
    expect(ctx.resize).toHaveBeenCalledWith({ height: 1600 });
  });

  it('shrinks again by the decoded longer edge when the picker reported unrotated dimensions', async () => {
    // A portrait HEIC: the picker says 4032x3024 (landscape), the decoded image is 3024x4032.
    // Resizing by the picker's width leaves the decoded image 1600x2133: still over the limit.
    const first = context(undefined, { width: 1600, height: 2133 });
    const second = context({ uri: 'file:///out.jpg', width: 1200, height: 1600 }, { width: 1200, height: 1600 });
    mockManipulate.mockReturnValueOnce(first.ctx).mockReturnValueOnce(second.ctx);
    const photo = await preparePhoto(picked({ width: 4032, height: 3024 }));
    expect(first.ctx.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(second.ctx.resize).toHaveBeenCalledWith({ height: 1600 });
    expect(first.saveAsync).not.toHaveBeenCalled();
    expect(photo).toMatchObject({ width: 1200, height: 1600 });
  });

  it("rejects an image the decoder can't handle, never uploading the original", async () => {
    mockManipulate.mockReturnValue({ resize: jest.fn(), release: jest.fn(), renderAsync: jest.fn(async () => Promise.reject(new Error('decode failed'))) });
    await expect(preparePhoto(picked())).rejects.toBeInstanceOf(UnsupportedImageError);
    expect(mockBytes).not.toHaveBeenCalled();
  });

  it('rejects an empty or unreadable saved file', async () => {
    mockManipulate.mockReturnValue(context().ctx);
    mockBytes.mockResolvedValueOnce(new Uint8Array(0));
    await expect(preparePhoto(picked())).rejects.toBeInstanceOf(UnsupportedImageError);
    mockManipulate.mockReturnValue(context().ctx);
    mockBytes.mockRejectedValueOnce(new Error('no such file'));
    await expect(preparePhoto(picked())).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe('cropPhoto (native)', () => {
  const working = { uri: 'file:///cache/ImageManipulator/working.jpg', width: 2048, height: 1536 };

  it('cuts the square out of the working copy, resizes it to 512 and returns JPEG bytes, not a Blob', async () => {
    expect(AVATAR_SOURCE_MAX_EDGE).toBe(2048);
    const { ctx, saveAsync, imageRelease } = context({ uri: 'file:///cache/ImageManipulator/avatar.jpg', width: 512, height: 512 });
    mockManipulate.mockReturnValue(ctx);
    const photo = await cropPhoto(working, { x: 256, y: 0, size: 1536 });
    expect(mockManipulate).toHaveBeenCalledWith(working.uri);
    expect(ctx.crop).toHaveBeenCalledWith({ originX: 256, originY: 0, width: 1536, height: 1536 });
    expect(ctx.resize).toHaveBeenCalledWith({ width: 512, height: 512 });
    expect(ctx.crop.mock.invocationCallOrder[0]).toBeLessThan(ctx.resize.mock.invocationCallOrder[0]!);
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' });
    expect(mockFileUris).toEqual(['file:///cache/ImageManipulator/avatar.jpg']);
    expect(photo).toMatchObject({ uri: 'file:///cache/ImageManipulator/avatar.jpg', mimeType: 'image/jpeg', width: 512, height: 512 });
    expect(photo.file).toBeInstanceOf(Uint8Array);
    expect(photo.file).not.toBeInstanceOf(Blob);
    expect(ctx.release).toHaveBeenCalled();
    expect(imageRelease).toHaveBeenCalled();
  });

  it('never scales a small square up', async () => {
    const { ctx } = context({ uri: 'file:///out.jpg', width: 300, height: 300 });
    mockManipulate.mockReturnValue(ctx);
    await cropPhoto(working, { x: 650, y: 450, size: 300 });
    expect(ctx.crop).toHaveBeenCalledWith({ originX: 650, originY: 450, width: 300, height: 300 });
    expect(ctx.resize).not.toHaveBeenCalled();
  });

  it('takes another edge', async () => {
    const { ctx } = context({ uri: 'file:///out.jpg', width: 256, height: 256 });
    mockManipulate.mockReturnValue(ctx);
    await cropPhoto(working, { x: 0, y: 0, size: 1000 }, 256);
    expect(ctx.resize).toHaveBeenCalledWith({ width: 256, height: 256 });
  });

  it('rejects a crop that fails or saves an empty file with UnsupportedImageError', async () => {
    mockManipulate.mockReturnValue({ crop: jest.fn(), resize: jest.fn(), release: jest.fn(), renderAsync: jest.fn(async () => Promise.reject(new Error('bad crop'))) });
    await expect(cropPhoto(working, { x: 0, y: 0, size: 100 })).rejects.toBeInstanceOf(UnsupportedImageError);
    mockManipulate.mockImplementation(() => {
      throw new Error('no image');
    });
    await expect(cropPhoto(working, { x: 0, y: 0, size: 100 })).rejects.toBeInstanceOf(UnsupportedImageError);
    mockManipulate.mockReset().mockReturnValue(context().ctx);
    mockBytes.mockResolvedValueOnce(new Uint8Array(0));
    await expect(cropPhoto(working, { x: 0, y: 0, size: 100 })).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe('pickImage (native)', () => {
  const asset = picked();

  it('asks for the camera permission before opening the camera', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    await expect(pickImage('camera')).resolves.toBe(asset);
    expect(picker.requestCameraPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(picker.launchCameraAsync.mock.invocationCallOrder[0]!);
  });

  it('a refused camera rejects with CameraPermissionError and never opens the camera', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as never);
    const err = await pickImage('camera').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CameraPermissionError);
    expect((err as CameraPermissionError).canAskAgain).toBe(false);
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('opens the library without asking for any permission', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    await expect(pickImage('library')).resolves.toBe(asset);
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns null when the person cancels', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImage('library')).resolves.toBeNull();
  });
});
