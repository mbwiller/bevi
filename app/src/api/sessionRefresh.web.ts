/**
 * The web file: nothing to connect. In a browser supabase-js follows the tab's visibility by itself
 * and refreshes the token only while the tab is shown; calling `startAutoRefresh()` would take that
 * over (packages/api/src/session.ts). The native file, sessionRefresh.ts, drives it from AppState.
 */
export function connectSessionRefresh(): void {}
