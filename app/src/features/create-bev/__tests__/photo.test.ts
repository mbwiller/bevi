import type { ImagePickerAsset } from 'expo-image-picker';

import { preparePhoto, UnsupportedImageError } from '../photo';

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
  SaveFormat: { JPEG: 'jpeg' },
}));

const picked = (over: Partial<ImagePickerAsset> = {}): ImagePickerAsset =>
  ({ uri: 'blob:original', width: 4000, height: 3000, mimeType: 'image/heic', ...over }) as ImagePickerAsset;

let revoke: jest.SpyInstance;
const realFetch = global.fetch;

beforeEach(() => {
  revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) })) as unknown as typeof fetch;
});

afterEach(() => {
  revoke.mockRestore();
  global.fetch = realFetch;
  mockManipulate.mockReset();
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
  const revoked = revoke.mock.calls.map((c) => c[0]);
  expect(revoked).toEqual(expect.arrayContaining(['blob:original', 'blob:intermediate']));
  expect(revoked).not.toContain('blob:out');
});

it("rejects an image it can't decode instead of uploading the original (EXIF), and still revokes the picker URL", async () => {
  mockManipulate.mockImplementation(() => {
    throw new Error('decode failed');
  });
  await expect(preparePhoto(picked({ mimeType: 'image/jpeg' }))).rejects.toBeInstanceOf(UnsupportedImageError);
  expect(revoke).toHaveBeenCalledWith('blob:original');
});
