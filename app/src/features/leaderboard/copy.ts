import { RANK_POINTS_WEIGHTS } from '@bevi/ranking';

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** The People board's scoring rules in plain words, built from the ranking weights so they can't drift. */
export function pointsRules(w: typeof RANK_POINTS_WEIGHTS = RANK_POINTS_WEIGHTS): string[] {
  return [
    `${points(w.bevsRanked)} for each Bev you rank`,
    `${points(w.currentStreak)} for each day of your current streak`,
    `${points(w.bevsCreated)} for each Bev you added that someone else ranked`,
    "Followers don't count",
    'Rank a Bev to get on the board',
  ];
}
