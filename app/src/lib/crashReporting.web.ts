import type { ComponentType } from 'react';

/**
 * The web file: crash reporting is for the iOS app (crashReporting.ts), and the web build has none.
 * Nothing is imported here, so the SDK never reaches the web bundle, and every function does
 * nothing. The same names as the native file, so callers have one import path.
 */

export interface ErrorContext {
  source?: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

export function initCrashReporting(): void {}

export function crashReportingEnabled(): boolean {
  return false;
}

export function wrapRoot<P extends Record<string, unknown>>(Component: ComponentType<P>): ComponentType<P> {
  return Component;
}

export function captureError(_error: unknown, _context?: ErrorContext): void {}

export function sendTestError(): void {}

export function crashNatively(): void {}
