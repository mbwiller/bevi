import type { ComponentType } from 'react';

/**
 * The reporter is built on the DOM (it redraws the page to a canvas and hit-tests real elements),
 * so the native app has none: this file is what iOS bundles, and it never imports the reporter.
 * The web build resolves loadHost.web.ts instead. `REPORTER_SUPPORTED` (supported.ts) keeps every
 * way in closed off the web, so this component is never mounted; it exists so the root layout has
 * one import on both platforms.
 */
export function loadReportHost(): Promise<{ default: ComponentType }> {
  return Promise.resolve({ default: () => null });
}
