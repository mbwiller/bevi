import { isApiError } from '@bevi/shared';

import { isExpectedError, scrubText, scrubValue } from './crashScrub';

/**
 * The one place the app hands over an error it did not expect: `captureError`. Call sites (the
 * query client, the root error boundary) say what went wrong and where; this module decides what
 * may leave, and gives the result to whatever reports crashes.
 *
 * Nothing reports crashes yet. A reporter registers itself with `setCrashSink`; until one does,
 * `captureError` does nothing at all: nothing is built, nothing is logged, nothing is sent.
 *
 * The rules hold whatever the reporter turns out to be, which is why they live here and not in it:
 * - An error the app expects is never handed over (`isExpectedError`, crashScrub.ts): offline,
 *   signed out, not found and the other `ApiError`s the contract gives a meaning to.
 * - The sink never sees the error object, only a `CrashReport` built from it: its name, message
 *   and stack with every credential and every URL query string removed (crashScrub.ts), the code
 *   of an `ApiError` but never its `detail`, which can hold what a person sent.
 * - Nothing about who the person is. A call site passes where it was caught and small facts about
 *   the call (`ErrorContext`), never an id and never text someone typed.
 *
 * One file for every platform: there is nothing native here.
 */

/** What a call site may say about where an error was caught. Never a person, never free text they typed. */
export interface ErrorContext {
  /** Where it was caught: `query`, `mutation`, `render`. */
  source?: string;
  /** Small facts about the call, e.g. which read failed. Scrubbed like everything else. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

/** What a sink receives: already scrubbed, and plain data, so it can be stored or sent as it is. */
export interface CrashReport {
  /** The error's name: `TypeError`, `ApiError`. `NonError` when what was thrown was not an Error. */
  name: string;
  message: string;
  /** Absent when the thrown value had none. */
  stack?: string;
  /** `ErrorContext.source`. */
  source?: string;
  /** The code of an `ApiError`. Only ever `unknown`: every other code is expected and never gets here. */
  apiCode?: string;
  /** `ErrorContext.extra`. */
  extra?: Record<string, unknown>;
}

export type CrashSink = (report: CrashReport) => void;

let sink: CrashSink | null = null;

/** Sets the one sink, or removes it with null. */
export function setCrashSink(next: CrashSink | null): void {
  sink = next;
}

function toReport(error: unknown, context?: ErrorContext): CrashReport {
  const report: CrashReport =
    error instanceof Error
      ? { name: error.name || 'Error', message: scrubText(error.message) }
      : { name: 'NonError', message: typeof error === 'string' ? scrubText(error) : Object.prototype.toString.call(error) };
  if (error instanceof Error && typeof error.stack === 'string') report.stack = scrubText(error.stack);
  if (context?.source) report.source = context.source;
  if (isApiError(error)) report.apiCode = error.code;
  if (context?.extra) report.extra = scrubValue(context.extra) as Record<string, unknown>;
  return report;
}

/**
 * Hands an error the app caught to the crash sink, so it is not lost just because a screen showed
 * "Couldn't load this". Expected errors are dropped here, for every call site. Never throws: neither
 * building the report nor a sink that fails may become a second error.
 */
export function captureError(error: unknown, context?: ErrorContext): void {
  try {
    if (!sink || isExpectedError(error)) return;
    sink(toReport(error, context));
  } catch {
    // Reporting an error must never raise one.
  }
}
