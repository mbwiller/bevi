import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import ProfileScreen from '@/app/(tabs)/profile/index';
import { pickImage, preparePhoto } from '@/features/create-bev/photo';

// The picker and the canvas resize are browser-only; the flow sees what they would return.
jest.mock('@/features/create-bev/photo', () => ({
  ...jest.requireActual('@/features/create-bev/photo'),
  pickImage: jest.fn(),
  preparePhoto: jest.fn(),
}));
const mockPick = pickImage as jest.MockedFunction<typeof pickImage>;
const mockPrepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;

const asset = { uri: 'blob:picked', width: 3000, height: 3000, mimeType: 'image/jpeg' } as NonNullable<Awaited<ReturnType<typeof pickImage>>>;

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
  mockPrepare.mockReset().mockResolvedValue({
    uri: 'blob:avatar',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    width: 512,
    height: 512,
  });
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
});

describe('Edit profile › photo', () => {
  it('adds a photo as soon as it uploads, then removes it', async () => {
    const sheet = await openEditSheet();
    const me = await api.profile.getMe();
    expect(me.avatarUrl).toBeNull();
    const initials = within(sheet).getByLabelText(me.displayName);
    expect(within(initials).queryByText(/\w/)).toBeTruthy();
    expect(within(sheet).queryByLabelText('Remove photo')).toBeNull();

    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    // The buttons switch to Change / Remove once the saved profile comes back, and the server has the photo.
    expect(await within(sheet).findByLabelText('Change photo')).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeTruthy();
    expect(mockPrepare).toHaveBeenCalledWith(asset, 512);
    await waitFor(() => expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull());
    // The sheet's avatar shows the photo, not initials.
    expect(within(within(sheet).getByLabelText(me.displayName)).queryByText(/\w/)).toBeNull();

    await fireEvent.press(within(sheet).getByLabelText('Remove photo'));
    expect(await within(sheet).findByLabelText('Add a photo')).toBeTruthy();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
    expect(within(within(sheet).getByLabelText(me.displayName)).queryByText(/\w/)).toBeTruthy();
  });

  it('a failed upload shows an error and leaves the photo as it was', async () => {
    const sheet = await openEditSheet();
    controls.failNext('network', 'media.upload');
    await fireEvent.press(within(sheet).getByLabelText('Add a photo'));
    expect(await within(sheet).findByText("You're offline. We'll show this again as soon as you're back online.")).toBeTruthy();
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
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).queryByLabelText('Uploading your photo')).toBeNull();
    expect((await api.profile.getMe()).avatarUrl).toBeNull();
  });
});
