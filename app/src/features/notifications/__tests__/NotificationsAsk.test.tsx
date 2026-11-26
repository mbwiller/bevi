import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';

import FeedRoute from '@/app/(tabs)/feed/index';
import TabsLayout from '@/app/(tabs)/_layout';
import NotificationsRoute from '@/app/(tabs)/notifications/index';
import { useSession } from '@/state/session';
import { controls, ME, userIdFor } from '@/testing/fakeApi';
import { grabModalDismiss } from '@/testing/modalDismiss';
import { fakePhone, TEST_PUSH_TOKEN } from '@/testing/push';

import { ASK_BODY, ASK_TITLE } from '../NotificationsAsk';
import { ASKED_KEY } from '../push/askedFlag';
import { resetDeviceForTests } from '../push/device';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
let mockAvailable = true;
jest.mock('@/features/notifications/push/availability', () => ({ pushAvailable: () => mockAvailable }));

const meId = userIdFor(ME.handle);
let client: QueryClient;

function Layout() {
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const Stub = () => null;

/** The tabs group as the app has it, Notifications real; returns a pathname reader and the unmount. */
async function start(url = '/notifications') {
  const result = renderRouter(
    {
      _layout: Layout,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/feed/index': FeedRoute,
      '(tabs)/lists/index': Stub,
      '(tabs)/add/index': Stub,
      '(tabs)/map/index': Stub,
      '(tabs)/profile/index': Stub,
      '(tabs)/people/index': Stub,
      '(tabs)/notifications/index': NotificationsRoute,
      'post/[id]': Stub,
      'user/[id]/index': Stub,
      'settings/notifications': Stub,
      index: Stub,
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

async function idle() {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  await act(() => jest.advanceTimersByTimeAsync(50));
}

/** Presses one of the ask's buttons and plays the sheet closing for real: its exit, then iOS's dismissal. */
async function answer(button: 'Turn on notifications' | 'Not now') {
  const dismiss = grabModalDismiss();
  await fireEvent.press(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(screen.queryByTestId('notifications-ask')).toBeNull());
  await act(async () => dismiss());
  await idle();
}

/** The inbox is on screen, and every read the screen starts with has landed. */
async function inboxShown() {
  await screen.findAllByTestId('notification-row');
  await idle();
}

beforeEach(async () => {
  mockAvailable = true;
  resetDeviceForTests();
  await AsyncStorage.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  useSession.setState({ status: 'ready', checked: true, devForced: true, profile: { handle: ME.handle, displayName: ME.displayName, avatarUrl: null } });
});

afterEach(async () => {
  await idle();
  client.clear();
  jest.restoreAllMocks();
});

it('appears over the inbox the first time, with the bell, the title, the line and two buttons', async () => {
  fakePhone({ permission: 'undetermined' });
  await start();
  await inboxShown();
  expect(screen.getByTestId('notifications-ask')).toBeTruthy();
  expect(screen.getByText(ASK_TITLE)).toBeTruthy();
  expect(screen.getByText(ASK_BODY)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Turn on notifications' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
  // It asks nothing of the phone by itself, and the inbox was still marked read under it.
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(client.getQueryData(['bevi', 'notifications', 'unreadCount'])).toBe(0);
  expect(await AsyncStorage.getItem(ASKED_KEY)).toBe('1');
});

it('Not now closes it, and it does not come back on another visit', async () => {
  fakePhone({ permission: 'undetermined' });
  await start();
  await inboxShown();
  await answer('Not now');
  expect(screen.queryByTestId('notifications-ask')).toBeNull();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ASKED_KEY)).toBe('1');
  // Away to the Feed and back: the screen stays mounted in the tabs and is focused again.
  await act(async () => router.navigate('/feed'));
  await act(async () => router.navigate('/notifications'));
  await idle();
  expect(screen.queryByTestId('notifications-ask')).toBeNull();
});

it('never appears on a later launch once this device has been asked (the flag Not now leaves)', async () => {
  fakePhone({ permission: 'undetermined' });
  await AsyncStorage.setItem(ASKED_KEY, '1');
  await start();
  await inboxShown();
  expect(screen.queryByTestId('notifications-ask')).toBeNull();
});

it('Turn on notifications shows the iOS prompt once the sheet has gone, and registers the device on a yes', async () => {
  const phone = fakePhone({ permission: 'undetermined', answer: 'granted' });
  await start();
  await inboxShown();
  const dismiss = grabModalDismiss();
  await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
  await waitFor(() => expect(screen.queryByTestId('notifications-ask')).toBeNull());
  // Closing, not closed: iOS cannot show its prompt over a Modal still being dismissed.
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => dismiss());
  await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(phone.permission).toBe('granted');
});

it('Turn on notifications with a no registers nothing', async () => {
  fakePhone({ permission: 'undetermined', answer: 'denied' });
  await start();
  await inboxShown();
  await answer('Turn on notifications');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(controls.pushTokens(meId)).toEqual([]);
});

it('a row tap under it still opens what the row is about once it is closed', async () => {
  fakePhone({ permission: 'undetermined' });
  const r = await start();
  await inboxShown();
  await answer('Not now');
  await fireEvent.press(within(screen.getAllByTestId('notification-row')[0]!).getAllByRole('button')[0]!);
  await waitFor(() => expect(r.path()).toMatch(/^\/post\//));
});

it.each(['granted', 'denied'] as const)('never appears once the phone has answered (%s)', async (permission) => {
  fakePhone({ permission });
  await start();
  await inboxShown();
  expect(screen.queryByTestId('notifications-ask')).toBeNull();
  expect(await AsyncStorage.getItem(ASKED_KEY)).toBeNull();
});

it('never appears over an empty inbox', async () => {
  fakePhone({ permission: 'undetermined' });
  controls.clearNotifications();
  await start();
  await screen.findByText('No notifications yet');
  await idle();
  expect(screen.queryByTestId('notifications-ask')).toBeNull();
  expect(await AsyncStorage.getItem(ASKED_KEY)).toBeNull();
});

describe('with the gate off', () => {
  it('no ask, no gear, and the phone is never asked anything', async () => {
    mockAvailable = false;
    const spies = (
      [
        'getPermissionsAsync',
        'requestPermissionsAsync',
        'getExpoPushTokenAsync',
        'setBadgeCountAsync',
        'setNotificationHandler',
        'addNotificationReceivedListener',
        'addNotificationResponseReceivedListener',
        'getLastNotificationResponse',
      ] as const
    ).map((name) => jest.spyOn(Notifications, name));
    await start();
    await inboxShown();
    expect(screen.queryByTestId('notifications-ask')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(ASKED_KEY)).toBeNull();
  });
});

describe('the gear', () => {
  it('opens Settings > Notifications', async () => {
    fakePhone({ permission: 'granted' });
    const r = await start();
    await inboxShown();
    await fireEvent.press(screen.getByRole('button', { name: 'Notification settings' }));
    expect(r.path()).toBe('/settings/notifications');
  });
});
