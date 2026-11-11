import { RANK_POINTS_WEIGHTS, STREAK_PERIOD } from '@bevi/ranking';

import type { PointsScope } from './pointsScope';

/** The Friends | Everyone pills' labels, which are also their accessible names. */
export const SCOPE_LABELS: Record<PointsScope, string> = { friends: 'Friends', everyone: 'Everyone' };

/** The points ranking's empty states. */
export const BOARD_EMPTY = {
  /** Everyone: nobody on Bevi has ranked a Bev. */
  everyone: { title: "No one's on the board yet", body: 'Rank a Bev to get on the board.' },
  /** Friends, following nobody: the suggestions above are the way out, so there is no action. */
  noFollows: { title: 'Follow people to see how you compare', body: 'You and the people you follow, ranked by points.' },
  /** Friends: you follow people, but none of you has ranked a Bev. */
  friends: { title: 'No one here has ranked a Bev yet', body: 'Rank a Bev to get on the board.' },
} as const;

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** The People board's scoring rules in plain words, built from the ranking weights and streak period so they can't drift. */
export function pointsRules(
  w: typeof RANK_POINTS_WEIGHTS = RANK_POINTS_WEIGHTS,
  period: typeof STREAK_PERIOD = STREAK_PERIOD,
): string[] {
  return [
    `${points(w.bevsRanked)} for each Bev you rank`,
    `${points(w.currentStreak)} for each ${period} of your current streak`,
    `${points(w.bevsCreated)} for each Bev you added that someone else ranked`,
    "Followers don't count",
    'Rank a Bev to get on the board',
  ];
}
