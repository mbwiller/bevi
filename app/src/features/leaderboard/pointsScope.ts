import { create } from 'zustand';

/**
 * Whom the points ranking ranks: you and the people you follow (`leaderboard.friends`, contract
 * 2.12.0), or everyone on Bevi (`leaderboard.users`).
 */
export type PointsScope = 'friends' | 'everyone';

/** People opens on Friends (TASKS.md M-34). */
export const DEFAULT_POINTS_SCOPE: PointsScope = 'friends';

export interface PointsScopeState {
  scope: PointsScope;
  setScope: (scope: PointsScope) => void;
  /** Back to the default; sign-out calls it (`clearUserQueries`). */
  reset: () => void;
}

/**
 * The People screen's Friends | Everyone choice. In memory, outside the screen, so it survives leaving
 * People and coming back; a reload or a sign-out starts on Friends again. Nothing here is sent anywhere.
 */
export const usePointsScope = create<PointsScopeState>()((set) => ({
  scope: DEFAULT_POINTS_SCOPE,
  setScope: (scope) => set({ scope }),
  reset: () => set({ scope: DEFAULT_POINTS_SCOPE }),
}));
