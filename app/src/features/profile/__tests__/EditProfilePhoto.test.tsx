import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import ProfileScreen from '@/app/(tabs)/profile/index';
import { cropPhoto, pickImage, preparePhoto, revokeIfBlob, UnsupportedImageError } from '@/features/create-bev/photo';

// The picker and the manipulator are native modules; the flow sees what they would return: the
// native pipeline's JPEG bytes (photo.ts), never a Blob.
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

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const asset = { uri: 'file:///cache/picked.jpg', width: 3000, height: 4000, mimeType: 'image/jpeg' } as NonNullable<Awaited<ReturnType<typeof pickImage>>>;
// The upright working copy the crop step shows: its size, not the picker's, is the truth.
const WORKING = { uri: 'blob:working', file: JPEG_BYTES, mimeType: 'image/jpeg', width: 2048, height: 1536 };

let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Slot />
    </QueryClientProvider>
  );
}

const Stub = () => null;

async function openEditSheet() {
  await renderRouter(
    {
      _layout: Layout,
      '(tabs)/profile/index': ProfileScreen,
      'user/[id]/index': Stub,
      'user/[id]/followers': Stub,
      'user/[id]/following': Stub,
      '(tabs)/lists/index': Stub,
      '(tabs)/add/index': Stub,
      'bev/[id]': Stub,
      'settings/index': Stub,
    },
    { initialUrl: '/profile' },
  );
  await fireEvent.press(await screen.findByLabelText('Edit profile'));
  return screen.findByTestId('sheet');
}

// Pin "now" (Date only; timers stay real), as Profile.test does, so the seeded data reads the same on any day.
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
beforeAll(() => {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockPick.mockReset().mockResolvedValue(asset);
  mockPrepare.mockReset().mockResolvedValue(WORKING);
  mockCrop.mockReset().mockResolvedValue({
    uri: 'blob:avatar',
    file: JPEG_BYTES,
    mimeType: 'image/jpeg',
    width: 512,
    height: 512,
  });
  mockRevoke.mockReset();
});

type Json = { type?: string; props?: Record<string, unknown>; children?: Json[] | null } | string | null;
function lastModal(node: Json | Json[]): Record<string, unknown> | undefined {
  if (!node || typeof node === 'string') return undefined;
  if (Array.isArray(node)) return node.map(lastModal).filter(Boolean).at(-1);
  const inner = lastModal(node.children ?? null);
  return inner ?? (node.type === 'Modal' ? node.props : undefined);
}

/** The "Move and scale" step, laid out as on a 393pt phone (jest never lays anything out). */
async function cropStep() {
  expect(await screen.findByRole('header', { name: 'Move and scale' })).toBeTruthy();
  await fireEvent(screen.getByTestId('photo-cropper-room'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 600 } } });
  return screen.getByTestId('avatar-crop-step');
}

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

describe('Edit profile › photo', () => {
  it('adds a photo as soon as it uploads, then removes it', async () => {
    const upload = jest.spyOn(api.media, 'upload');
    const sheet = await openEditSheet();
    const me = await api.profile.getMe();
    expect(me.avatarUrl).toBeNull();
    const initials = within(sheet).getByLabelText(me.displayName);
    expect(within(initials).queryByText(/\w/)).toBeTruthy();
    expect(within(sheet).queryByLabelText('Remove photo')).toBeNull();

    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    // The working copy is framed first, under the spinner; nothing has uploaded yet.
    const step = await cropStep();
    expect(mockPrepare).toHaveBeenCalledWith(asset, 2048);
    expect(within(sheet).getByLabelText('Uploading your photo')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    await fireEvent.press(within(step).getByRole('button', { name: 'Use photo' }));
    // The step closes at once, and the framed square (the middle 1536 of 2048 x 1536) is what uploads.
    expect(screen.queryByTestId('avatar-crop-step')).toBeNull();
    expect(mockCrop).toHaveBeenCalledWith({ uri: 'blob:working', width: 2048, height: 1536 }, { x: 256, y: 0, size: 1536 }, 512);
    // The buttons switch to Change / Remove once the saved profile comes back, and the server has the photo.
    expect(await within(sheet).findByLabelText('Change photo')).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeTruthy();
    // The library only (it needs no permission), and the upload carries the bytes.
    expect(mockPick).toHaveBeenCalledWith('library');
    expect(upload).toHaveBeenCalledWith({ kind: 'avatar', file: JPEG_BYTES, mimeType: 'image/jpeg' });
    expect(upload.mock.calls[0]![0].file).not.toBeInstanceOf(Blob);
    await waitFor(() => expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull());
    // Neither the working copy nor the cropped preview outlives the upload.
    expect(mockRevoke).toHaveBeenCalledWith('blob:working');
    expect(mockRevoke).toHaveBeenCalledWith('blob:avatar');
    // The sheet's avatar shows the photo, not initials.
    expect(within(within(sheet).getByLabelText(me.displayName)).queryByText(/\w/)).toBeNull();

    await fireEvent.press(within(sheet).getByLabelText('Remove photo'));
    expect(await within(sheet).findByLabelText('Add a photo')).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(within(within(sheet).getByLabelText(me.displayName)).queryByText(/\w/)).toBeTruthy();
    upload.mockRestore();
  });

  it('Cancel in the crop step uploads nothing, clears the spinner and keeps the photo as it was', async () => {
    const upload = jest.spyOn(api.media, 'upload');
    const sheet = await openEditSheet();
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    const step = await cropStep();
    await fireEvent.press(within(step).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('avatar-crop-step')).toBeNull();
    await waitFor(() => expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull());
    expect(mockCrop).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).getByLabelText('Add a photo')).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(mockRevoke).toHaveBeenCalledWith('blob:working');
    // The sheet itself is still open.
    expect(screen.getByTestId('sheet')).toBeTruthy();
    upload.mockRestore();
  });

  it('closing the crop step from the system (Escape, a hardware back) is a Cancel', async () => {
    const sheet = await openEditSheet();
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    await cropStep();
    // The innermost Modal on screen is the step's, presented over the sheet's.
    const close = lastModal(screen.toJSON() as Json)?.onRequestClose as () => void;
    await act(async () => close());
    expect(screen.queryByTestId('avatar-crop-step')).toBeNull();
    await waitFor(() => expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull());
    expect(mockCrop).not.toHaveBeenCalled();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
  });

  it('closing the Edit profile sheet with the step open cancels the step', async () => {
    const upload = jest.spyOn(api.media, 'upload');
    const sheet = await openEditSheet();
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    await cropStep();
    // The sheet is closed from behind the step (its scrim), as a system dismissal would.
    await fireEvent.press(screen.getByTestId('sheet-scrim'));
    await waitFor(() => expect(screen.queryByTestId('avatar-crop-step')).toBeNull());
    expect(screen.queryByRole('header', { name: 'Move and scale' })).toBeNull();
    expect(mockCrop).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('blob:working'));
    upload.mockRestore();
  });

  it("a square that can't be encoded says so and uploads nothing", async () => {
    const upload = jest.spyOn(api.media, 'upload');
    mockCrop.mockRejectedValue(new UnsupportedImageError());
    const sheet = await openEditSheet();
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    await fireEvent.press(within(await cropStep()).getByRole('button', { name: 'Use photo' }));
    expect(await within(sheet).findByText("That image can't be used. Try a JPEG or PNG.")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull();
    expect(mockRevoke).toHaveBeenCalledWith('blob:working');
    upload.mockRestore();
  });

  it('a failed upload shows an error and leaves the photo as it was', async () => {
    const sheet = await openEditSheet();
    controls.failNext('network', 'media.upload');
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    await fireEvent.press(within(await cropStep()).getByRole('button', { name: 'Use photo' }));
    expect(await within(sheet).findByText("You're offline. Check your connection and try again.")).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(within(sheet).getByLabelText('Add a photo')).toBeTruthy();
    expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull();
  });

  it('cancelling the picker changes nothing and shows no error', async () => {
    const sheet = await openEditSheet();
    mockPick.mockResolvedValue(null);
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(screen.queryByTestId('avatar-crop-step')).toBeNull();
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
  });
});
