import type { ImagePickerAsset } from 'expo-image-picker';

import { AVATAR_MAX_EDGE, cropPhoto, fitWithin, preparePhoto, UnsupportedImageError } from '../photo.web';

// The web file (file input, canvas, object URLs, a Blob payload), imported by name: jest resolves
// '../photo' as iOS. The native file is covered by photo.test.ts.

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
  SaveFormat: { JPEG: 'jpeg' },
}));

const picked = (over: Partial<ImagePickerAsset> = {}): ImagePickerAsset =>
  ({ uri: 'blob:original', width: 4000, height: 3000, mimeType: 'image/heic', ...over }) as ImagePickerAsset;

let revoke: jest.SpyInstance;
const realFetch = global.fetch;
const g = globalThis as { document?: unknown; Image?: unknown };

beforeEach(() => {
  revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) })) as unknown as typeof fetch;
});

afterEach(() => {
  revoke.mockRestore();
  global.fetch = realFetch;
  mockManipulate.mockReset();
  delete g.document;
  delete g.Image;
});

it('resizes to 1600px JPEG and revokes the picker URL and the intermediate render, keeping the preview URL', async () => {
  const resize = jest.fn();
  const saveAsync = jest.fn(async () => ({ uri: 'blob:out', width: 1600, height: 1200 }));
  mockManipulate.mockReturnValue({
    resize,
    release: jest.fn(),
    renderAsync: async () => ({ uri: 'blob:intermediate', saveAsync, release: jest.fn() }),
  });
  const photo = await preparePhoto(picked());
  expect(resize).toHaveBeenCalledWith({ width: 1600, height: 1200 });
  expect(saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' });
  expect(photo).toMatchObject({ uri: 'blob:out', mimeType: 'image/jpeg', width: 1600, height: 1200 });
  // The web payload is the Blob the browser made.
  expect(photo.file).toBeInstanceOf(Blob);
  const revoked = revoke.mock.calls.map((c) => c[0]);
  expect(revoked).toEqual(expect.arrayContaining(['blob:original', 'blob:intermediate']));
  expect(revoked).not.toContain('blob:out');
});

it('fits a smaller longest edge for profile photos (512px) and never scales up', async () => {
  expect(AVATAR_MAX_EDGE).toBe(512);
  expect(fitWithin(4000, 3000, AVATAR_MAX_EDGE)).toEqual({ width: 512, height: 384 });
  expect(fitWithin(300, 200, AVATAR_MAX_EDGE)).toEqual({ width: 300, height: 200 });
  const resize = jest.fn();
  mockManipulate.mockReturnValue({
    resize,
    release: jest.fn(),
    renderAsync: async () => ({ uri: 'blob:intermediate', saveAsync: async () => ({ uri: 'blob:out', width: 512, height: 384 }), release: jest.fn() }),
  });
  await preparePhoto(picked(), AVATAR_MAX_EDGE);
  expect(resize).toHaveBeenCalledWith({ width: 512, height: 384 });
});

it('falls back to a canvas when the manipulator throws, still as a JPEG Blob', async () => {
  mockManipulate.mockImplementation(() => {
    throw new Error('no manipulator');
  });
  const drawImage = jest.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (cb: (b: Blob | null) => void, mime: string) => cb(new Blob(['jpeg'], { type: mime })),
  };
  g.document = { createElement: () => canvas };
  g.Image = class {
    naturalWidth = 3200;
    naturalHeight = 2400;
    onload: (() => void) | null = null;
    set src(_: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canvas');
  try {
    const photo = await preparePhoto(picked());
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(photo).toMatchObject({ uri: 'blob:canvas', mimeType: 'image/jpeg', width: 1600, height: 1200 });
    expect(photo.file).toBeInstanceOf(Blob);
    expect(revoke).toHaveBeenCalledWith('blob:original');
  } finally {
    create.mockRestore();
  }
});

it("rejects an image it can't decode instead of uploading the original (EXIF), and still revokes the picker URL", async () => {
  mockManipulate.mockImplementation(() => {
    throw new Error('decode failed');
  });
  await expect(preparePhoto(picked({ mimeType: 'image/jpeg' }))).rejects.toBeInstanceOf(UnsupportedImageError);
  expect(revoke).toHaveBeenCalledWith('blob:original');
});

describe('cropPhoto (web)', () => {
  const working = { uri: 'blob:working', width: 2048, height: 1536 };

  it('cuts the square, resizes it to 512 as a JPEG Blob, revokes the intermediate and leaves the working copy alone', async () => {
    const crop = jest.fn();
    const resize = jest.fn();
    const saveAsync = jest.fn(async () => ({ uri: 'blob:avatar', width: 512, height: 512 }));
    mockManipulate.mockReturnValue({
      crop,
      resize,
      release: jest.fn(),
      renderAsync: async () => ({ uri: 'blob:intermediate', saveAsync, release: jest.fn() }),
    });
    const photo = await cropPhoto(working, { x: 256, y: 0, size: 1536 });
    expect(mockManipulate).toHaveBeenCalledWith('blob:working');
    expect(crop).toHaveBeenCalledWith({ originX: 256, originY: 0, width: 1536, height: 1536 });
    expect(resize).toHaveBeenCalledWith({ width: 512, height: 512 });
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: 'jpeg' });
    expect(photo).toMatchObject({ uri: 'blob:avatar', mimeType: 'image/jpeg', width: 512, height: 512 });
    expect(photo.file).toBeInstanceOf(Blob);
    const revoked = revoke.mock.calls.map((c) => c[0]);
    expect(revoked).toContain('blob:intermediate');
    expect(revoked).not.toContain('blob:working');
    expect(revoked).not.toContain('blob:avatar');
  });

  it('never scales a small square up', async () => {
    const resize = jest.fn();
    mockManipulate.mockReturnValue({
      crop: jest.fn(),
      resize,
      release: jest.fn(),
      renderAsync: async () => ({ uri: 'blob:intermediate', saveAsync: async () => ({ uri: 'blob:out', width: 300, height: 300 }), release: jest.fn() }),
    });
    await cropPhoto(working, { x: 650, y: 450, size: 300 });
    expect(resize).not.toHaveBeenCalled();
  });

  it('falls back to a canvas drawn from the square, still a JPEG Blob', async () => {
    mockManipulate.mockImplementation(() => {
      throw new Error('no manipulator');
    });
    const drawImage = jest.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void, mime: string) => cb(new Blob(['jpeg'], { type: mime })),
    };
    g.document = { createElement: () => canvas };
    g.Image = class {
      naturalWidth = 2048;
      naturalHeight = 1536;
      onload: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    };
    const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canvas');
    try {
      const photo = await cropPhoto(working, { x: 256, y: 0, size: 1536 });
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 256, 0, 1536, 1536, 0, 0, 512, 512);
      expect(canvas).toMatchObject({ width: 512, height: 512 });
      expect(photo).toMatchObject({ uri: 'blob:canvas', mimeType: 'image/jpeg', width: 512, height: 512 });
      expect(photo.file).toBeInstanceOf(Blob);
      expect(revoke).not.toHaveBeenCalledWith('blob:working');
    } finally {
      create.mockRestore();
    }
  });

  it('rejects a square it cannot make with UnsupportedImageError', async () => {
    mockManipulate.mockImplementation(() => {
      throw new Error('decode failed');
    });
    await expect(cropPhoto(working, { x: 0, y: 0, size: 100 })).rejects.toBeInstanceOf(UnsupportedImageError);
    expect(revoke).not.toHaveBeenCalledWith('blob:working');
  });
});
