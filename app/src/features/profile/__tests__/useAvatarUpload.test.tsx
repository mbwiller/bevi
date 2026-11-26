import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { cropPhoto, pickImage, preparePhoto, revokeIfBlob } from '@/features/create-bev/photo';

import { useAvatarUpload } from '../useAvatarUpload';

// The crop step's lifecycle, without the screens: what is released, and what a newer call wins over.
jest.mock('@/features/create-bev/photo', () => ({
  ...jest.requireActual('@/features/create-bev/photo'),
  pickImage: jest.fn(),
  preparePhoto: jest.fn(),
  cropPhoto: jest.fn(),
  revokeIfBlob: jest.fn(),
}));
const mockPick = pickImage as jest.MockedFunction<typeof pickImage>;
const mockPrepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;
const mockCrop = cropPhoto as jest.MockedFunction<typeof cropPhoto>;
const mockRevoke = revokeIfBlob as jest.MockedFunction<typeof revokeIfBlob>;

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const asset = (uri: string) => ({ uri, width: 100, height: 100, mimeType: 'image/jpeg' }) as NonNullable<Awaited<ReturnType<typeof pickImage>>>;
const working = (uri: string) => ({ uri, file: BYTES, mimeType: 'image/jpeg', width: 2048, height: 1536 });

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockPick.mockReset().mockResolvedValue(asset('file:///picked.jpg'));
  mockPrepare.mockReset().mockImplementation(async (a) => working(a.uri.replace('picked', 'working')));
  mockCrop.mockReset().mockResolvedValue({ uri: 'blob:avatar', file: BYTES, mimeType: 'image/jpeg', width: 512, height: 512 });
  mockRevoke.mockReset();
});

it('offers the working copy to the crop step while busy, at its decoded size', async () => {
  const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
  await act(async () => void result.current.choose());
  await waitFor(() => expect(result.current.crop.photo).toEqual({ uri: 'file:///working.jpg', width: 2048, height: 1536 }));
  expect(result.current.busy).toBe(true);
  await act(async () => result.current.crop.confirm({ x: 256, y: 0, size: 1536 }));
  expect(result.current.crop.photo).toBeNull();
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(mockCrop).toHaveBeenCalledWith({ uri: 'file:///working.jpg', width: 2048, height: 1536 }, { x: 256, y: 0, size: 1536 }, 512);
  expect(result.current.error).toBeUndefined();
});

it('releases the working copy when unmounted with the step open, and uploads nothing', async () => {
  const upload = jest.spyOn(api.media, 'upload');
  const { result, unmount } = await renderHook(() => useAvatarUpload(), { wrapper });
  await act(async () => void result.current.choose());
  await waitFor(() => expect(result.current.crop.photo).not.toBeNull());
  await act(async () => unmount());
  await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('file:///working.jpg'));
  expect(mockCrop).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  upload.mockRestore();
});

it('a newer pick replaces an open step, releasing the older photo', async () => {
  const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
  await act(async () => void result.current.choose());
  await waitFor(() => expect(result.current.crop.photo?.uri).toBe('file:///working.jpg'));
  mockPick.mockResolvedValue(asset('file:///picked-2.jpg'));
  await act(async () => void result.current.choose());
  await waitFor(() => expect(result.current.crop.photo?.uri).toBe('file:///working-2.jpg'));
  expect(mockRevoke).toHaveBeenCalledWith('file:///working.jpg');
  expect(result.current.busy).toBe(true);
  await act(async () => result.current.crop.cancel());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(mockRevoke).toHaveBeenCalledWith('file:///working-2.jpg');
  expect(mockCrop).not.toHaveBeenCalled();
});

it('remove() closes an open step first', async () => {
  const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
  await act(async () => void result.current.choose());
  await waitFor(() => expect(result.current.crop.photo).not.toBeNull());
  await act(async () => void result.current.remove());
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.crop.photo).toBeNull();
  expect(mockRevoke).toHaveBeenCalledWith('file:///working.jpg');
  expect(mockCrop).not.toHaveBeenCalled();
});

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** updateMe calls that would set a photo (removing sends `avatarAssetId: null`). */
const photoSaves = (spy: jest.SpyInstance) => spy.mock.calls.filter(([patch]) => typeof patch?.avatarAssetId === 'string');

describe('a newer change stops an older photo once it has left the step', () => {
  it('remove() while the square is being encoded: nothing uploads and no photo is saved', async () => {
    const upload = jest.spyOn(api.media, 'upload');
    const updateMe = jest.spyOn(api.profile, 'updateMe');
    const encoding = deferred<Awaited<ReturnType<typeof cropPhoto>>>();
    mockCrop.mockReturnValue(encoding.promise);
    const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
    await act(async () => void result.current.choose());
    await waitFor(() => expect(result.current.crop.photo).not.toBeNull());
    await act(async () => result.current.crop.confirm({ x: 256, y: 0, size: 1536 }));
    await waitFor(() => expect(mockCrop).toHaveBeenCalled());
    await act(async () => void result.current.remove());
    await act(async () => encoding.resolve({ uri: 'blob:avatar', file: BYTES, mimeType: 'image/jpeg', width: 512, height: 512 }));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(upload).not.toHaveBeenCalled();
    expect(photoSaves(updateMe).length).toBe(0);
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(result.current.error).toBeUndefined();
    // Its files are still released.
    expect(mockRevoke).toHaveBeenCalledWith('file:///working.jpg');
    expect(mockRevoke).toHaveBeenCalledWith('blob:avatar');
    upload.mockRestore();
    updateMe.mockRestore();
  });

  it('remove() while the upload is in flight: the uploaded photo is never saved', async () => {
    const realUpload = api.media.upload.bind(api.media);
    const uploading = deferred<void>();
    const upload = jest.spyOn(api.media, 'upload').mockImplementation(async (payload) => {
      await uploading.promise;
      return realUpload(payload);
    });
    const updateMe = jest.spyOn(api.profile, 'updateMe');
    const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
    await act(async () => void result.current.choose());
    await waitFor(() => expect(result.current.crop.photo).not.toBeNull());
    await act(async () => result.current.crop.confirm({ x: 256, y: 0, size: 1536 }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    await act(async () => void result.current.remove());
    await act(async () => uploading.resolve());
    await waitFor(() => expect(result.current.busy).toBe(false));
    // Let the older call run on past the upload.
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(photoSaves(updateMe).length).toBe(0);
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeUndefined();
    upload.mockRestore();
    updateMe.mockRestore();
  });
});
