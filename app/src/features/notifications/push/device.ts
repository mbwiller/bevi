// This device's push token on the server (T-31 Release 2): registered while someone is signed in and
// notifications are allowed, forgotten just before they sign out. Kept in memory only, for this
// launch: which token was registered, and for whom, so it is sent once per token per signed-in
// account rather than at every foreground. A failure is swallowed and tried again at the next one.
//
// The token is never logged and never put in an error.

import { api } from '@/api/client';

import { pushAvailable } from './availability';
import { getPushPermission, getPushToken, setAppBadge } from './push';

/** How long sign-out waits for the server to forget the token before signing out anyway. */
export const UNREGISTER_TIMEOUT_MS = 3_000;

let registered: { account: string; token: string } | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Registers this device for `account` (the signed-in handle) when notifications are allowed. Does
 * nothing when it is already registered for that account this launch, while another call is on
 * its way, or when push is not available. Never rejects.
 */
export function registerThisDevice(account: string): Promise<void> {
  if (!pushAvailable()) return Promise.resolve();
  if (registered?.account === account) return Promise.resolve();
  inFlight ??= (async () => {
    try {
      if ((await getPushPermission()) !== 'granted') return;
      const token = await getPushToken();
      if (!token) return;
      await api.notifications.registerPushToken(token);
      registered = { account, token };
    } catch {
      // Offline, rate limited, signed out meanwhile: the next foreground tries again.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Before signing out: asks the server to forget this device, so the next person to sign in here
 * gets no pushes meant for the last one, and clears the icon's badge. Best effort and bounded:
 * never rejects and never takes longer than `UNREGISTER_TIMEOUT_MS`, so it cannot hold up or fail
 * the sign-out.
 */
export async function forgetThisDevice(): Promise<void> {
  if (!pushAvailable()) {
    registered = null;
    return;
  }
  void setAppBadge(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, UNREGISTER_TIMEOUT_MS);
  });
  try {
    // A registration on its way finishes first, so the token it sends is the one forgotten.
    if (inFlight) await Promise.race([inFlight, gaveUp]);
    const last = registered;
    registered = null;
    if (last) await Promise.race([api.notifications.unregisterPushToken(last.token), gaveUp]);
  } catch {
    // The server drops a token Expo reports dead, and one device moves to whoever registers it next.
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: a fresh launch, nothing registered. */
export function resetDeviceForTests(): void {
  registered = null;
  inFlight = null;
}
