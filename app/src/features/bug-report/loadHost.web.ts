import type { ComponentType } from 'react';

/**
 * The reporter's code, fetched on demand: the root layout mounts it only for a signed-in internal
 * reporter, so no other account downloads it. A chunk that fails to load (offline, a stale deploy)
 * yields nothing rather than an error that would take the app down with it. Its own module so a
 * test can swap the dynamic import (jest can't run one) for a plain require.
 */
export function loadReportHost(): Promise<{ default: ComponentType }> {
  return import('./ReportHost').catch(() => ({ default: () => null }));
}
