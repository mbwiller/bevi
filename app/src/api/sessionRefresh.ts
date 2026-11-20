import { startAutoRefresh, stopAutoRefresh } from '@bevi/api';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Keeps the session's token fresh only while the app is in front. The native file: a browser tab
 * tells supabase-js when it is shown and hidden, so the web one (sessionRefresh.web.ts) does nothing,
 * but React Native has no such event and `@bevi/api` cannot import `AppState` itself
 * (packages/api/src/session.ts). So the app owns the listener and the package owns the refresh.
 * These two controls are the only thing the app takes from `@bevi/api` outside client.ts: they are
 * not part of `BeviApi`, so they cannot come through the `api` object.
 *
 * - Active: `startAutoRefresh()`, which checks the token at once and then on a timer. A session that
 *   sat in the background overnight is refreshed the moment the app is opened again, instead of
 *   coming back expired and reading as a sign-out.
 * - Anything else (`inactive`, `background`): `stopAutoRefresh()`, so no timer runs and no request is
 *   cut off half way when iOS suspends the app.
 *
 * Call it after the api exists: before that `startAutoRefresh()` has no client to refresh and does
 * nothing. Both calls are safe to repeat and never reject. Safe to call again: each call replaces
 * the listener of the one before.
 */
let subscription: { remove(): void } | undefined;

export function connectSessionRefresh(): void {
  subscription?.remove();
  const follow = (status: AppStateStatus) => {
    void (status === 'active' ? startAutoRefresh() : stopAutoRefresh());
  };
  subscription = AppState.addEventListener('change', follow);
  // The app is usually already active when this runs, and no `change` event reports that.
  follow(AppState.currentState);
}
