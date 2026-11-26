// Test-only: a phone for the push suites (T-31 Release 2), over jest.setup.js's expo-notifications
// mock. Each helper spies on that mock, so `jest.restoreAllMocks()` in a suite's afterEach puts the
// defaults back (undetermined, no token, no launch tap). Nothing outside tests imports this.

import * as Notifications from 'expo-notifications';

export const TEST_PUSH_TOKEN = 'ExponentPushToken[test-device-1]';

type Answer = 'granted' | 'denied' | 'undetermined';

function statusOf(s: Answer) {
  return {
    status: s,
    granted: s === 'granted',
    canAskAgain: s === 'undetermined',
    expires: 'never',
    ios: { status: s === 'granted' ? 2 : s === 'denied' ? 1 : 0 },
  } as unknown as Notifications.NotificationPermissionsStatus;
}

/**
 * The phone's permission and token, changeable mid-test: `permission` is what it says without
 * asking, `answer` what the person taps in the iOS prompt, `token` what Expo hands out (null: the
 * call fails, as it does on a build without the push entitlement).
 */
export interface FakePhone {
  permission: Answer;
  answer: Answer;
  token: string | null;
}

export function fakePhone(initial: Partial<FakePhone> = {}): FakePhone {
  const phone: FakePhone = { permission: 'undetermined', answer: 'granted', token: TEST_PUSH_TOKEN, ...initial };
  jest.spyOn(Notifications, 'getPermissionsAsync').mockImplementation(async () => statusOf(phone.permission));
  jest.spyOn(Notifications, 'requestPermissionsAsync').mockImplementation(async () => {
    if (phone.permission === 'undetermined') phone.permission = phone.answer;
    return statusOf(phone.permission);
  });
  jest.spyOn(Notifications, 'getExpoPushTokenAsync').mockImplementation(async () => {
    if (!phone.token) throw new Error('aps-environment missing');
    return { type: 'expo', data: phone.token };
  });
  return phone;
}

let ids = 0;

/** A notification as expo-notifications hands it over, carrying `data.url`. */
export function pushNotification(url: unknown, id = `push-${++ids}`): Notifications.Notification {
  return {
    date: Date.now(),
    request: { identifier: id, content: { title: null, subtitle: null, body: 'Someone liked your Bev', data: { url }, categoryIdentifier: null, sound: null }, trigger: null },
  } as unknown as Notifications.Notification;
}

/** A tap on a notification. */
export function pushTap(url: unknown, id?: string): Notifications.NotificationResponse {
  return { notification: pushNotification(url, id), actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER };
}

/**
 * Captures the listeners the app adds, so a suite can play a push arriving (`receive`) or being
 * tapped (`open`), and the tap that launched the app (`launchedBy`, read by the first listener).
 */
export function pushListeners() {
  const received = new Set<(n: Notifications.Notification) => void>();
  const opened = new Set<(r: Notifications.NotificationResponse) => void>();
  jest.spyOn(Notifications, 'addNotificationReceivedListener').mockImplementation((cb) => {
    received.add(cb);
    return { remove: () => void received.delete(cb) };
  });
  jest.spyOn(Notifications, 'addNotificationResponseReceivedListener').mockImplementation((cb) => {
    opened.add(cb);
    return { remove: () => void opened.delete(cb) };
  });
  return {
    receive: (url: unknown) => received.forEach((cb) => cb(pushNotification(url))),
    open: (url: unknown, id?: string) => opened.forEach((cb) => cb(pushTap(url, id))),
    launchedBy: (url: unknown, id?: string) => {
      let launch: Notifications.NotificationResponse | null = pushTap(url, id);
      jest.spyOn(Notifications, 'getLastNotificationResponse').mockImplementation(() => launch);
      jest.spyOn(Notifications, 'clearLastNotificationResponse').mockImplementation(() => {
        launch = null;
      });
    },
    count: () => ({ received: received.size, opened: opened.size }),
  };
}

/** The numbers the app has put on its icon, in order. */
export function badgeCalls(): number[] {
  const calls: number[] = [];
  jest.spyOn(Notifications, 'setBadgeCountAsync').mockImplementation(async (n) => {
    calls.push(n);
    return true;
  });
  return calls;
}
