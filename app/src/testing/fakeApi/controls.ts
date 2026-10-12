// Dev controls for the mock (a dev panel can drive these). Reach them through `mockControls` in
// app/src/api/client.ts, which is null when the app runs against the real API. After a control
// changes data, invalidate TanStack Query (`queryClient.invalidateQueries()`) to refetch.

import type { ApiErrorCode } from '@bevi/shared';

import { getMockApi } from './instance';
import type { Latency } from './MockApi';

export interface MockControls {
  /** The next call (to `method`, e.g. 'rankings.submitRanking', or to any method) rejects with `code`. */
  failNext(code: ApiErrorCode, method?: string): void;
  /** Per-call latency in ms: a number or [min, max]. Default [200, 600]. */
  setLatency(latency: Latency): void;
  /** Back to the seeded fixtures, signed out. */
  resetToFixtures(): void;
  /** First-run state for the signed-in user (no rankings/follows/Want to Try, back to onboarding). */
  emptyUser(): void;
  /** Sign in as a mock user without a password, e.g. 'demo', 'jules', 'theo' (under 21). */
  signInAs(handle: string): void;
}

export const mockControls: MockControls = {
  failNext: (code, method) => getMockApi().failNext(code, method),
  setLatency: (latency) => getMockApi().setLatency(latency),
  resetToFixtures: () => getMockApi().resetToFixtures(),
  emptyUser: () => getMockApi().emptyUser(),
  signInAs: (handle) => getMockApi().signInAs(handle),
};

export const failNext = mockControls.failNext;
export const setLatency = mockControls.setLatency;
export const resetToFixtures = mockControls.resetToFixtures;
export const emptyUser = mockControls.emptyUser;
export const signInAs = mockControls.signInAs;
