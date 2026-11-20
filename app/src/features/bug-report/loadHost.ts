import type { ComponentType } from 'react';

/**
 * The reporter's code, fetched on demand: the root layout mounts it only for a signed-in internal
 * reporter, so no other account runs any of it. One file for both platforms: a web build code-splits
 * it into its own chunk.
 *
 * Metro bundles a dynamic `import()` on iOS into the one bundle (there is no code splitting in
 * Hermes), so "not downloaded" is "not evaluated": the reporter's modules, including its store's
 * session subscription, do not run until this is called, and it is called only once `bugs.canReport()`
 * has said yes. A chunk that fails to load yields nothing rather than an error that would take the
 * app down with it. Its own module so a test can swap the dynamic import (jest can't run one) for a
 * plain require.
 */
export function loadReportHost(): Promise<{ default: ComponentType }> {
  return import('./ReportHost').catch(() => ({ default: () => null }));
}
