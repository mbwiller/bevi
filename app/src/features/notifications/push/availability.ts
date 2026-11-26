import Constants from 'expo-constants';

/**
 * Whether this build can receive push notifications (T-31 Release 2): the one gate on everything
 * push the person can see or the phone can be asked for. On this file (every platform but the web)
 * it is `extra.push === true` in the app config; availability.web.ts is always false.
 *
 * WHY A FLAG. Real push needs the `expo-notifications` config plugin, the push entitlement and an
 * Apple push key, which a later config change adds together with `extra.push = true`. Until then a
 * build has none of them, and asking iOS for the permission, or for a token, would offer something
 * that can never arrive. With it false there is no Notifications row in Settings, no gear on the
 * Notifications screen, no ask, no permission request, no token, no listener and no badge.
 */
export function pushAvailable(): boolean {
  const extra = Constants.expoConfig?.extra as { push?: unknown } | undefined;
  return extra?.push === true;
}
