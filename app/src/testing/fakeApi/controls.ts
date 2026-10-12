// Test controls for the FakeApi. Suites import `controls` from '@/testing/fakeApi'. After a control
// changes data, invalidate TanStack Query (`queryClient.invalidateQueries()`) to refetch.

import type { ApiErrorCode } from '@bevi/shared';

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
}

export const controls: FakeControls = {
  failNext: (code, method) => getFakeApi().failNext(code, method),
  setLatency: (latency) => getFakeApi().setLatency(latency),
  resetToFixtures: () => getFakeApi().resetToFixtures(),
  emptyUser: () => getFakeApi().emptyUser(),
  signInAs: (handle) => getFakeApi().signInAs(handle),
};
