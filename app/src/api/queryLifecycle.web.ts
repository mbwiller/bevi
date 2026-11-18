/**
 * The web file: nothing to connect. In a browser React Query already follows the `online` and
 * `offline` events and the tab's visibility. The native file, queryLifecycle.ts, supplies both from
 * NetInfo and AppState.
 */
export function connectQueryLifecycle(): void {}
