// The app-visible half of token refresh on native (DEVELOPMENT-ARJUN-IOS.md,
// IA-5). Ownership is split on purpose and neither half works alone:
//
//   * **The app owns the listener.** Only `app/` may import `AppState` from
//     react-native. This package is also consumed by vitest/Node and by the
//     web build, so an import of react-native here would break both. The app
//     registers one `AppState` listener (IM-3) and calls `startAutoRefresh()`
//     when the app becomes `active` and `stopAutoRefresh()` when it leaves.
//
//   * **This package owns the refresh.** `createBeviApi()` deliberately
//     returns only `BeviApi` and never the supabase client (see `index.ts`),
//     so the app cannot reach `client.auth.startAutoRefresh()` itself. These
//     two functions are the whole seam: they expose the refresh ticker and
//     nothing else of the client.
//
// Why it is needed at all: `client.ts` sets `autoRefreshToken: true`, but on a
// non-browser platform supabase-js cannot tell whether the app is focused, so
// it refreshes continuously in the background (draining battery and firing
// requests the OS may suspend mid-flight) unless something tells it when the
// app is foregrounded. Without the nudge a session that sat backgrounded
// overnight can come back with an expired access token, which the app sees as
// a surprise sign-out. On web this is a no-op in practice: supabase-js already
// hooks `visibilitychange` itself, and the app's web build never calls these.
//
// NOTE: calling `startAutoRefresh()` takes over from that managed
// visibility-change handling (auth-js documents this), which is exactly what
// native wants and is why the web build should leave these alone.

/**
 * The slice of `client.auth` this module drives. Declared structurally so the
 * supabase client stays private and so tests can register a stand-in.
 */
export interface AutoRefreshTarget {
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
}

// Module-level, because the app creates exactly one api (one supabase client)
// for the life of the process and the control has to be callable from an
// `AppState` listener that holds no reference to it. A later `createBeviApi()`
// replaces the target: the newest client is the one a foreground nudge should
// refresh.
let target: AutoRefreshTarget | undefined;
let running = false;

/** Called by `createBeviApi()`. Not exported from the package's entry point. */
export function registerAutoRefreshTarget(next: AutoRefreshTarget | undefined): void {
  target = next;
  running = false;
}

/**
 * Start proactive token refresh -- call when the app becomes active.
 *
 * Safe to call repeatedly (a second call while already running does nothing)
 * and before any api exists (it is then a no-op, not a crash). Never rejects:
 * an `AppState` listener has nowhere to put a rejection, and a failed refresh
 * tick is not fatal -- the next request still refreshes on demand.
 */
export async function startAutoRefresh(): Promise<void> {
  if (!target || running) return;
  running = true;
  try {
    await target.startAutoRefresh();
  } catch {
    // Leave `running` false so a later foreground nudge can try again.
    running = false;
  }
}

/** Stop proactive token refresh -- call when the app goes to the background. */
export async function stopAutoRefresh(): Promise<void> {
  if (!target || !running) return;
  running = false;
  try {
    await target.stopAutoRefresh();
  } catch {
    // Nothing to recover: the ticker is either stopped or will be on the next
    // start/stop pair.
  }
}

/** Whether a start is currently in effect. Exposed for tests and debugging. */
export function isAutoRefreshRunning(): boolean {
  return running;
}
