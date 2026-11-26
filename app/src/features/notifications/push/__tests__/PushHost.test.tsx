import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import { AppState, Text } from 'react-native';

import { api } from '@/api/client';
import { keys } from '@/api/keys';
import SettingsIndexScreen from '@/app/settings/index';
import { useSession } from '@/state/session';
import { controls, FRIEND, ME, userIdFor } from '@/testing/fakeApi';
import { badgeCalls, fakePhone, pushListeners, TEST_PUSH_TOKEN } from '@/testing/push';

import { resetDeviceForTests } from '../device';
import { resetPushForTests } from '../push';
import { PushHost } from '../PushHost';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
let mockAvailable = true;
jest.mock('../availability', () => ({ pushAvailable: () => mockAvailable }));

const meId = userIdFor(ME.handle);
/** A profile id as the server has them (the fake's are not uuids). */
const USER = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
let client: QueryClient;

function Layout() {
  const status = useSession((s) => s.status);
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
      <PushHost ready={status === 'ready'} />
    </QueryClientProvider>
  );
}

const Named = (name: string) =>
  function Route() {
    return <Text>{name}</Text>;
  };

async function start(url = '/home') {
  const result = renderRouter(
    {
      _layout: Layout,
      home: Named('Home'),
      'post/[id]': Named('A post'),
      'user/[id]': Named('A person'),
      notifications: Named('The inbox'),
      'settings/index': SettingsIndexScreen,
      index: Named('Index'),
    },
    { initialUrl: url },
  );
  await result;
  return { path: () => result.getPathnameWithParams() };
}

/** Lets the host's effects and the fake's answers land (renderRouter turns on jest's fake timers). */
const settle = () => act(() => jest.advanceTimersByTimeAsync(50));

let foreground: ((s: string) => void)[];

beforeEach(() => {
  mockAvailable = true;
  resetPushForTests();
  resetDeviceForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  useSession.setState({ status: 'ready', checked: true, devForced: true, profile: { handle: ME.handle, displayName: ME.displayName, avatarUrl: null } });
  foreground = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: 'change', handler: (s: never) => void) => {
    foreground.push(handler as (s: string) => void);
    return { remove: () => undefined };
  }) as typeof AppState.addEventListener);
});

afterEach(async () => {
  await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  client.clear();
  jest.restoreAllMocks();
});

it('registers this device when notifications are allowed, once per token, also after coming to the front', async () => {
  fakePhone({ permission: 'granted' });
  const register = jest.spyOn(api.notifications, 'registerPushToken');
  await start();
  await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
  await act(async () => foreground.forEach((f) => f('active')));
  await settle();
  expect(register).toHaveBeenCalledTimes(1);
});

it('does not register while the phone has not said yes; it does once it has, at the next foreground', async () => {
  const phone = fakePhone({ permission: 'undetermined' });
  await start();
  await settle();
  expect(controls.pushTokens(meId)).toEqual([]);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  phone.permission = 'granted';
  await act(async () => foreground.forEach((f) => f('active')));
  await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
});

it('sets up the foreground presentation once', async () => {
  const handler = jest.spyOn(Notifications, 'setNotificationHandler');
  await start();
  await settle();
  expect(handler).toHaveBeenCalledTimes(1);
});

it('a push arriving while open refreshes the bell count, and marks the inbox stale without reading it', async () => {
  const push = pushListeners();
  await start();
  await waitFor(() => expect(client.getQueryData(keys.notifications.unreadCount())).toBe(3));
  client.setQueryData(keys.notifications.list(), { pages: [], pageParams: [] });
  const list = jest.spyOn(api.notifications, 'list');

  // friend_a likes another of ME's posts: a new unread row.
  const post = (await api.feed.listUser(meId, { limit: 3 })).items[2]!;
  controls.signInAs(FRIEND.handle);
  await api.feed.like(post.id);
  controls.signInAs(ME.handle);
  await act(async () => push.receive(`/post/${post.id}`));
  await waitFor(() => expect(client.getQueryData(keys.notifications.unreadCount())).toBe(4));
  expect(client.getQueryState(keys.notifications.list())?.isInvalidated).toBe(true);
  expect(list).not.toHaveBeenCalled();
});

it("keeps the icon's badge at the bell's count, 0 once read", async () => {
  const calls = badgeCalls();
  await start();
  await waitFor(() => expect(calls.at(-1)).toBe(3));
  await act(async () => {
    await api.notifications.markRead();
    await client.invalidateQueries({ queryKey: keys.notifications.unreadCount() });
  });
  await waitFor(() => expect(calls.at(-1)).toBe(0));
});

it.each([
  ['/post/123?comments=1', '/post/123?comments=1'],
  ['/post/42', '/post/42'],
  [`/user/${USER}`, `/user/${USER}`],
  ['/notifications', '/notifications'],
  ['https://evil.example/', '/notifications'],
  ['/settings/delete-account', '/notifications'],
])('a tapped push for %s opens %s', async (url, where) => {
  const push = pushListeners();
  const r = await start();
  await settle();
  await act(async () => push.open(url));
  await waitFor(() => expect(r.path()).toBe(where));
});

it('the tap that launched the app opens its post once the navigator is up', async () => {
  const push = pushListeners();
  push.launchedBy('/post/77?comments=1');
  const r = await start();
  await waitFor(() => expect(r.path()).toBe('/post/77?comments=1'));
  expect(await screen.findByText('A post')).toBeTruthy();
});

it('signing out forgets this device first and clears the badge', async () => {
  fakePhone({ permission: 'granted' });
  const calls = badgeCalls();
  await start('/settings');
  await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
  await fireEvent.press(await screen.findByLabelText('Sign out'));
  await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
  expect(controls.pushTokens(meId)).toEqual([]);
  expect(calls.at(-1)).toBe(0);
});

it('a session that ends any other way (expired, account deleted) clears the badge too', async () => {
  const calls = badgeCalls();
  await start();
  await waitFor(() => expect(calls.at(-1)).toBe(3));
  await act(async () => useSession.getState().signOut());
  await waitFor(() => expect(calls.at(-1)).toBe(0));
});

it('signing out still works when forgetting the device fails', async () => {
  fakePhone({ permission: 'granted' });
  await start('/settings');
  await waitFor(() => expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]));
  controls.failNext('network', 'notifications.unregisterPushToken');
  await fireEvent.press(await screen.findByLabelText('Sign out'));
  await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
  expect(await api.getSession()).toBeNull();
});

it('with the gate off it does nothing at all', async () => {
  mockAvailable = false;
  const phone = fakePhone({ permission: 'granted' });
  const push = pushListeners();
  const calls = badgeCalls();
  const handler = jest.spyOn(Notifications, 'setNotificationHandler');
  push.launchedBy('/post/1');
  const r = await start();
  await settle();
  expect(phone.permission).toBe('granted');
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(push.count()).toEqual({ received: 0, opened: 0 });
  expect(calls).toEqual([]);
  expect(handler).not.toHaveBeenCalled();
  expect(r.path()).toBe('/home');
  expect(controls.pushTokens(meId)).toEqual([]);
});
