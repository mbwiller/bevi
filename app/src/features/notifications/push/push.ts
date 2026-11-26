// Push notifications on the phone (T-31 Release 2). The ONLY file that imports expo-notifications;
// push.web.ts is the web's no-ops. Every function here is small, promise-based and never throws to
// its caller: a failure reads as "no" (no permission, no token) and is otherwise silent.
//
// NOTHING HERE RUNS UNLESS `pushAvailable()` (availability.ts) said yes first. The callers check
// it; this file does not, so its own suite can drive it directly.
//
// A push token is never logged and never put in an error message.

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import type { PushMessage, PushPermission, Unsubscribe } from './pushTypes';

export type { PushMessage, PushPermission, Unsubscribe } from './pushTypes';

function permissionOf(status: Notifications.NotificationPermissionsStatus): PushPermission {
  // Provisional (quiet delivery) is a yes: iOS delivers to the list without asking.
  if (status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (status.status === 'denied') return 'denied';
  if (status.status === 'undetermined') return 'undetermined';
  return 'unavailable';
}

/** What the phone says now, without asking. */
export async function getPushPermission(): Promise<PushPermission> {
  try {
    return permissionOf(await Notifications.getPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/**
 * Shows the iOS prompt (banners, the badge and sounds) and answers what the person chose. iOS shows
 * it once per install: after that it answers at once with the earlier choice.
 */
export async function requestPushPermission(): Promise<PushPermission> {
  try {
    return permissionOf(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
  } catch {
    return 'unavailable';
  }
}

/**
 * This install's Expo push token, or null. Null on ANY failure, and silently: no EAS project id, no
 * permission, offline, and a build without the push entitlement, where iOS refuses to register and
 * this call rejects. That last one is every build until push is switched on, so it must never
 * surface.
 */
export async function getPushToken(): Promise<string | null> {
  const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas;
  const projectId = typeof eas?.projectId === 'string' ? eas.projectId : null;
  if (!projectId) return null;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** The number on the app icon; 0 clears it. iOS ignores it without the badge permission. */
export async function setAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch {
    // No badge is better than a crash.
  }
}

let presentationSet = false;

/**
 * While the app is open a push still shows: as a banner and in the notification list, with no
 * sound (the person is already looking at the phone), and it sets the icon's badge to the count it
 * carries. Once per launch.
 */
export function configureForegroundPresentation(): void {
  if (presentationSet) return;
  presentationSet = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
    });
  } catch {
    presentationSet = false;
  }
}

function messageOf(n: Notifications.Notification): PushMessage {
  const data = n.request?.content?.data;
  return { url: data && typeof data === 'object' ? (data as { url?: unknown }).url : undefined };
}

/** A push arrived while the app is open. */
export function onPushReceived(cb: (message: PushMessage) => void): Unsubscribe {
  try {
    const sub = Notifications.addNotificationReceivedListener((n) => cb(messageOf(n)));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** The tap that cold-started the app, delivered to the first `onPushOpened` only. */
let coldStartTaken = false;
/** That tap's notification, so no listener delivers it again when it is also heard. */
let launchId: string | null = null;

/**
 * The person tapped a push: while the app was open or in the background, and also the tap that
 * launched it (delivered once per launch, to the first listener, on the next tick).
 */
export function onPushOpened(cb: (message: PushMessage) => void): Unsubscribe {
  let live = true;
  // The last one this listener delivered: a response heard twice is one tap.
  let lastId: string | null = null;
  const deliver = (r: Notifications.NotificationResponse | null, launch = false) => {
    if (!live || !r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = r.notification?.request?.identifier ?? null;
    if (id !== null && (id === lastId || (!launch && id === launchId))) return;
    lastId = id;
    cb(messageOf(r.notification));
  };
  let remove = () => {};
  try {
    const sub = Notifications.addNotificationResponseReceivedListener(deliver);
    remove = () => sub.remove();
  } catch {
    // No listener: taps open the app where it was.
  }
  if (!coldStartTaken) {
    coldStartTaken = true;
    let launch: Notifications.NotificationResponse | null = null;
    try {
      launch = Notifications.getLastNotificationResponse();
      if (launch) Notifications.clearLastNotificationResponse();
    } catch {
      launch = null;
    }
    if (launch) {
      launchId = launch.notification?.request?.identifier ?? null;
      setTimeout(() => deliver(launch, true), 0);
    }
  }
  return () => {
    live = false;
    remove();
  };
}

/** Opens Bevi's page in the phone's Settings, where notifications are turned back on. */
export function openSystemSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

/** Test seam: a fresh launch (the cold-start tap not yet taken, presentation not yet set). */
export function resetPushForTests(): void {
  coldStartTaken = false;
  launchId = null;
  presentationSet = false;
}
