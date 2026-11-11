import type { CategoryId, LeaderboardRow } from '@bevi/shared';

import { popularBevs } from '../popular';

function row(id: string, categoryId: string): LeaderboardRow {
  return {
    rank: 1,
    bev: {
      id,
      name: id,
      brand: null,
      flavor: null,
      // A category the app's table doesn't know (a newer catalog than this build).
      categoryId: categoryId as CategoryId,
      photoUrl: null,
      photoStatus: 'ready',
      priceTier: 1,
      priceEstimated: false,
      ratingCount: 40,
      bayesScore: 9.1,
    },
    bayesScore: 9.1,
    ratingCount: 40,
    myScore: null,
  };
}

const rows = [row('cola', 'soda'), row('lager', 'beer'), row('mystery', 'not-a-category')];

describe('popularBevs and alcohol', () => {
  it('hides alcoholic and unknown-category Bevs from a viewer who cannot see alcohol', () => {
    expect(popularBevs(rows, false).map((b) => b.id)).toEqual(['cola']);
  });

  it('lists all of them to a viewer who can', () => {
    expect(popularBevs(rows, true).map((b) => b.id)).toEqual(['cola', 'lager', 'mystery']);
  });
});
