// Test controls for the FakeApi. Suites import `controls` from '@/testing/fakeApi'. After a control
// changes data, invalidate TanStack Query (`queryClient.invalidateQueries()`) to refetch.

import type { ApiErrorCode, AppConfig, BugTicketState, IconStatus } from '@bevi/shared';

import { getFakeApi } from './instance';
import type { Latency } from './FakeApi';

export interface FakeControls {
  /** The next call (to `method`, e.g. 'rankings.submitRanking', or to any method) rejects with `code`. */
  failNext(code: ApiErrorCode, method?: string): void;
  /** Per-call latency in ms: a number or [min, max]. Default [200, 600]. */
  setLatency(latency: Latency): void;
  /** Back to the seeded fixtures, signed out. */
  resetToFixtures(): void;
  /** First-run state for the signed-in user (no rankings/follows/Want to Try, back to onboarding). */
  emptyUser(): void;
  /** Sign in as a fixture user without a password, e.g. ME.handle, FRIEND.handle, MINOR.handle (under 21). */
  signInAs(handle: string): void;
  /**
   * Make the signed-in user an internal bug reporter (`profiles.role` 'admin' or 'tester'), which
   * is what `bugs.canReport()` answers and what `bugs.report()` requires. Off after
   * `resetToFixtures()`.
   */
  setInternalReporter(internal: boolean): void;
  /**
   * Move one of the fake's bug tickets to a workflow state, as a founder would on the board: 'in_review'
   * makes My reports offer Verified on device; anything but triage/todo/in_progress takes it out
   * of the ranked list (`rank: null`).
   */
  setBugTicketState(ticketId: string, state: BugTicketState): void;
  /**
   * Force a Bev's generated-icon state, for rendering a state a clock cannot
   * reach: 'processing', 'failed', or 'completed' straight away. 'none' also
   * clears the schedule, so the Bev reads as never eligible. `null` hands it
   * back to the clock. Setting this does NOT run a generation job -- there is
   * no job in the fake, only the state a screen would see.
   */
  setIconStatus(bevId: string, status: IconStatus | null): void;
  /**
   * Edit what `meta.getAppConfig` answers, as an operator would the `app_config` row: the fields
   * given replace the current ones, e.g. `{ maintenance: true, maintenanceMessage: 'Back by 9pm ET.' }`
   * or `{ minAppVersion: '9.0.0' }`. Versions must be `x.y.z`. Back to the default (`maintenance`
   * false, no message, `minAppVersion` '0.1.0', `minContractVersion` '0.0.0') after
   * `resetToFixtures()`. To make the read fail instead, `failNext(code, 'meta.getAppConfig')`.
   */
  setAppConfig(config: Partial<AppConfig>): void;
}

export const controls: FakeControls = {
  failNext: (code, method) => getFakeApi().failNext(code, method),
  setLatency: (latency) => getFakeApi().setLatency(latency),
  resetToFixtures: () => getFakeApi().resetToFixtures(),
  emptyUser: () => getFakeApi().emptyUser(),
  signInAs: (handle) => getFakeApi().signInAs(handle),
  setInternalReporter: (internal) => getFakeApi().setInternalReporter(internal),
  setBugTicketState: (ticketId, state) => getFakeApi().setBugTicketState(ticketId, state),
  setIconStatus: (bevId, status) => getFakeApi().setIconStatus(bevId, status),
  setAppConfig: (config) => getFakeApi().setAppConfig(config),
};
