import * as Notifications from 'expo-notifications';

import { api } from '@/api/client';
import { controls, ME, userIdFor } from '@/testing/fakeApi';
import { fakePhone, pushListeners, TEST_PUSH_TOKEN } from '@/testing/push';

import { forgetThisDevice, registerThisDevice, resetDeviceForTests } from '../device';
import {
  configureForegroundPresentation,
  getPushPermission,
  getPushToken,
  onPushOpened,
  onPushReceived,
  requestPushPermission,
  resetPushForTests,
} from '../push';
import { pushRoute } from '../pushRoute';

// A build with an EAS project (the token call needs its id). The gate is this suite's to switch.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));
let mockAvailable = true;
jest.mock('../availability', () => ({ pushAvailable: () => mockAvailable }));

const meId = userIdFor(ME.handle);

beforeEach(() => {
  mockAvailable = true;
  resetPushForTests();
  resetDeviceForTests();
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
});
afterEach(() => jest.restoreAllMocks());

describe('pushRoute: only the in-app routes the sender writes', () => {
  it.each([
    ['/post/123', { pathname: '/post/[id]', params: { id: '123' } }],
    ['/post/9007199254740993?comments=1', { pathname: '/post/[id]', params: { id: '9007199254740993', comments: '1' } }],
    [
      '/user/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
      { pathname: '/user/[id]', params: { id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' } },
    ],
    ['/notifications', { pathname: '/notifications' }],
  ])('%s', (url, route) => {
    expect(pushRoute(url)).toEqual(route);
  });

  it.each([
    'https://evil.example/post/1',
    '//evil.example/post/1',
    '/settings/delete-account',
    'javascript:alert(1)',
    '/post/abc',
    '/post/1?comments=1&next=/settings/delete-account',
    '/post/1/../../settings',
    '/user/not-a-uuid',
    '/post/1 ',
    '',
    'garbage',
    42,
    null,
    undefined,
    { pathname: '/settings/delete-account' },
    `/post/${'1'.repeat(400)}`,
  ])('rejects %p: Notifications instead', (url) => {
    expect(pushRoute(url)).toEqual({ pathname: '/notifications' });
  });
});

describe('the wrapper', () => {
  it('reads the permission without asking, and asks for it only when told to', async () => {
    const phone = fakePhone({ permission: 'undetermined', answer: 'denied' });
    expect(await getPushPermission()).toBe('undetermined');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await requestPushPermission()).toBe('denied');
    expect(phone.permission).toBe('denied');
    expect(await getPushPermission()).toBe('denied');
  });

  it('counts a provisional permission as granted, and a failed read as unavailable', async () => {
    jest.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValueOnce({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
      ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL },
    } as unknown as Notifications.NotificationPermissionsStatus);
    expect(await getPushPermission()).toBe('granted');
    jest.spyOn(Notifications, 'getPermissionsAsync').mockRejectedValueOnce(new Error('no module'));
    expect(await getPushPermission()).toBe('unavailable');
  });

  it('a token, or null and silence when the call fails (a build without the push entitlement)', async () => {
    const phone = fakePhone({ permission: 'granted' });
    expect(await getPushToken()).toBe(TEST_PUSH_TOKEN);
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project' });
    phone.token = null;
    const logged = [jest.spyOn(console, 'error'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'log')];
    expect(await getPushToken()).toBeNull();
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });

  it('shows a push while the app is open, in the list too, without a sound, setting the badge', async () => {
    const handler = jest.spyOn(Notifications, 'setNotificationHandler');
    configureForegroundPresentation();
    configureForegroundPresentation();
    expect(handler).toHaveBeenCalledTimes(1);
    const behaviour = await handler.mock.calls[0]![0]!.handleNotification({} as Notifications.Notification);
    expect(behaviour).toEqual({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true });
  });

  it('hands a received push its url, and stops when unsubscribed', () => {
    const push = pushListeners();
    const cb = jest.fn();
    const stop = onPushReceived(cb);
    push.receive('/post/1');
    expect(cb).toHaveBeenCalledWith({ url: '/post/1' });
    stop();
    push.receive('/post/2');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('delivers the tap that launched the app once, to the first listener, and never twice when it is also heard', async () => {
    const push = pushListeners();
    push.launchedBy('/post/7', 'launch');
    const first = jest.fn();
    const second = jest.fn();
    onPushOpened(first);
    onPushOpened(second);
    await new Promise((r) => setTimeout(r, 0));
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ url: '/post/7' });
    // The same tap heard by the listener as well: not again. A new tap: yes, to both.
    push.open('/post/7', 'launch');
    expect(first).toHaveBeenCalledTimes(1);
    push.open('/notifications', 'tap-2');
    expect(first).toHaveBeenLastCalledWith({ url: '/notifications' });
    expect(second).toHaveBeenCalledWith({ url: '/notifications' });
    expect(Notifications.getLastNotificationResponse()).toBeNull();
  });
});

describe('this device on the server', () => {
  it('is registered when notifications are allowed, once per token per account', async () => {
    fakePhone({ permission: 'granted' });
    const register = jest.spyOn(api.notifications, 'registerPushToken');
    await registerThisDevice(ME.handle);
    await Promise.all([registerThisDevice(ME.handle), registerThisDevice(ME.handle)]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]);
  });

  it('is not registered without the permission, without a token, or with the gate off', async () => {
    const phone = fakePhone({ permission: 'undetermined' });
    await registerThisDevice(ME.handle);
    phone.permission = 'granted';
    phone.token = null;
    await registerThisDevice(ME.handle);
    phone.token = TEST_PUSH_TOKEN;
    mockAvailable = false;
    await registerThisDevice(ME.handle);
    expect(controls.pushTokens(meId)).toEqual([]);
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
  });

  it('a failed registration is swallowed and tried again next time', async () => {
    fakePhone({ permission: 'granted' });
    controls.failNext('network', 'notifications.registerPushToken');
    await expect(registerThisDevice(ME.handle)).resolves.toBeUndefined();
    expect(controls.pushTokens(meId)).toEqual([]);
    await registerThisDevice(ME.handle);
    expect(controls.pushTokens(meId)).toEqual([TEST_PUSH_TOKEN]);
  });

  it('is forgotten before signing out, the badge cleared; a failure never rejects', async () => {
    fakePhone({ permission: 'granted' });
    const badge = jest.spyOn(Notifications, 'setBadgeCountAsync');
    await registerThisDevice(ME.handle);
    await forgetThisDevice();
    expect(controls.pushTokens(meId)).toEqual([]);
    expect(badge).toHaveBeenCalledWith(0);

    await registerThisDevice(ME.handle);
    controls.failNext('network', 'notifications.unregisterPushToken');
    await expect(forgetThisDevice()).resolves.toBeUndefined();
    // Forgotten here all the same: the next sign-in registers again.
    const register = jest.spyOn(api.notifications, 'registerPushToken');
    await registerThisDevice(ME.handle);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('with the gate off, forgetting touches nothing', async () => {
    mockAvailable = false;
    const badge = jest.spyOn(Notifications, 'setBadgeCountAsync');
    const unregister = jest.spyOn(api.notifications, 'unregisterPushToken');
    await forgetThisDevice();
    expect(badge).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });
});
