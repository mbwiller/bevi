import { isApiError } from '@bevi/shared';
import type { ReactNativeOptions } from '@sentry/react-native';
import type { ComponentType } from 'react';

import { isExpectedError, scrubBreadcrumb, scrubEvent } from './crashScrub';

/**
 * Crash reporting for the iOS app (IS-4): a crash or an unexpected JavaScript error on a phone is
 * sent to Sentry, with the device, the iOS version and the build, and nothing that says who the
 * person is. The native file. The web build resolves crashReporting.web.ts instead, which does
 * nothing and imports nothing, so the SDK is never in the web bundle.
 *
 * It is switched on by a value, not by code: `EXPO_PUBLIC_SENTRY_DSN`, set in the EAS environments
 * (app/.env.example). A DSN is public by design, it only allows sending. With none, the SDK is not
 * even loaded: it is `require`d inside `initCrashReporting`, after the DSN check, because merely
 * importing it starts a timer of its own. So no handler is installed, the root component is not
 * wrapped, and every function here returns at its first line. In a development build it stays off
 * even with a DSN (`enabled: false`), so a red box on a simulator is never filed as a crash.
 *
 * What is sent, and what is not:
 * - Sent: native crashes, uncaught JavaScript errors and unhandled promise rejections (the SDK
 *   catches all three by itself), and whatever a call site hands to `captureError`.
 * - Never sent: an error the app expects (`isExpectedError`: offline, signed out, not found …).
 * - No identity. `Sentry.setUser` is never called and `sendDefaultPii` is off, so no username, no
 *   account id and no IP address is attached by the app. The SDK labels a report with a random id
 *   it makes per install, which is not the account and is gone on reinstall.
 * - No performance traces, no session replay, no profiles, no screenshots, no view hierarchy.
 *   Those are switched on by the mere presence of a sample rate, `0` included, so their options are
 *   left out here on purpose: do not add `tracesSampleRate: 0` "to be safe", it turns tracing on.
 * - No credentials and no signed URLs: crashScrub.ts, applied to every breadcrumb and every event
 *   that leaves through JavaScript. A native crash is written by the native layer and never passes
 *   through these hooks, so the one thing it records by itself that could hold a signature, its
 *   own log of network requests, is turned off (`enableNetworkBreadcrumbs`). The app's own
 *   requests are still logged by the JavaScript layer, scrubbed before the native layer sees them.
 *
 * `release` and `dist` are not set: the SDK reads them from the binary (bundle id, version, build
 * number), which is what the build's symbol upload was filed under, so the two always match.
 */

/** Read literally so Expo inlines the values at build time. */
const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
/** The name reports are filed under: `preview`, `production`. Unset, the SDK says `production`. */
const ENVIRONMENT = (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? '').trim();

/**
 * `enableNetworkBreadcrumbs` is the native SDK's option (sentry-cocoa's `SentryOptions`), not one
 * the JavaScript types know: the options object is handed to the native layer whole, which reads it.
 */
type Options = ReactNativeOptions & { enableNetworkBreadcrumbs: boolean };

type Sdk = typeof import('@sentry/react-native');

/** The SDK, once it is initialised and sending. Null with no DSN, in development, and before `initCrashReporting`. */
let sentry: Sdk | null = null;
let initialised = false;

/**
 * Starts crash reporting. Call once, at module scope in the root layout, before anything renders.
 * Does nothing without a DSN, and never throws: a reporter that fails to start must not be the
 * reason the app does.
 */
export function initCrashReporting(): void {
  if (initialised) return;
  initialised = true;
  if (!DSN) return;
  const enabled = !__DEV__;
  try {
    const options: Options = {
      dsn: DSN,
      enabled,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoPerformanceTracing: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      enableNetworkBreadcrumbs: false,
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubEvent,
    };
    // An absent key, not an undefined one: the SDK only falls back to its own default when the key is missing.
    if (ENVIRONMENT) options.environment = ENVIRONMENT;
    // Loaded here and nowhere else, so a build with no DSN never runs a line of it.
    const sdk = require('@sentry/react-native') as Sdk;
    sdk.init(options);
    if (enabled) sentry = sdk;
  } catch {
    sentry = null;
  }
}

/** Whether reports are being sent from this build. The test control in Settings shows only when they are. */
export function crashReportingEnabled(): boolean {
  return sentry !== null;
}

/**
 * The root component, wrapped by the SDK when reporting is on (it records which component was
 * touched before a crash) and returned as it is otherwise. Call after `initCrashReporting`.
 */
export function wrapRoot<P extends Record<string, unknown>>(Component: ComponentType<P>): ComponentType<P> {
  if (!sentry) return Component;
  try {
    return sentry.wrap(Component);
  } catch {
    return Component;
  }
}

/** What a call site may say about where an error was caught. Never a person, never free text they typed. */
export interface ErrorContext {
  /** Where it was caught: `query`, `mutation`, a feature's name. Filed as the `source` tag. */
  source?: string;
  /** Small facts about the call, e.g. which read failed. Scrubbed like everything else. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Reports an error the app caught and handled, so it is not lost just because a screen showed
 * "Couldn't load this". Expected errors are dropped here, for every call site (`isExpectedError`).
 * An `ApiError` is filed with its code and without its `detail`, which can hold what a person sent.
 */
export function captureError(error: unknown, context?: ErrorContext): void {
  if (!sentry || isExpectedError(error)) return;
  try {
    const tags: Record<string, string> = {};
    if (context?.source) tags.source = context.source;
    if (isApiError(error)) tags.api_code = error.code;
    sentry.captureException(error, { tags, extra: context?.extra });
  } catch {
    // Reporting an error must never raise one.
  }
}

/**
 * The end-to-end proof, part one: files a JavaScript error raised in the app's own code. It should
 * arrive in Sentry with a stack that names this file and this function, which proves the source
 * maps of this build were uploaded. The app carries on.
 */
export function sendTestError(): void {
  if (!sentry) return;
  sentry.captureException(new Error('Bevi crash reporting test: JavaScript error'), { tags: { source: 'crash-test' } });
}

/**
 * The end-to-end proof, part two: crashes the app in native code, at once. The report is written to
 * disk as the app dies and sent the next time it is opened; it should arrive with native frames
 * that have names, which proves the debug symbols of this build were uploaded.
 */
export function crashNatively(): void {
  if (!sentry) return;
  sentry.nativeCrash();
}
