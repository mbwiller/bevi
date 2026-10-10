import { describe, expect, it } from 'vitest';
import { bayesianAverage, BAYES_C, categoryPrior, globalPrior, leaderboardOrder } from '../src/index.ts';

describe('bayesianAverage: DEVELOPMENT-MATT §8.7 worked example (m = 6.0, C = 3)', () => {
  const prior = { m: 6, C: BAYES_C };

  it('pulls a lone 10/10 down to 7.0', () => expect(bayesianAverage(10, 1, prior)).toBe(7));
  it('lets five 10/10s reach 8.5', () => expect(bayesianAverage(10, 5, prior)).toBe(8.5));
  it('pulls a lone 2/10 up to 5.0', () => expect(bayesianAverage(2, 1, prior)).toBe(5));
  it('is the prior with no ratings', () => expect(bayesianAverage(0, 0, prior)).toBe(6));
});

describe('priors', () => {
  const global = { n: 120, mean: 6.4, stddev: 2 };

  it('uses the category mean from 30 rankings, else the global mean', () => {
    expect(categoryPrior({ n: 30, mean: 4.2, stddev: 1 }, global)).toBe(4.2);
    expect(categoryPrior({ n: 29, mean: 4.2, stddev: 1 }, global)).toBe(6.4);
  });

  it('falls back to 5.0 when nothing is ranked', () => {
    expect(globalPrior({ n: 0, mean: 0, stddev: 0 })).toBe(5);
  });
});

describe('leaderboardOrder', () => {
  it('keeps Bevs with 2+ raters, ordered bayes desc, n desc, name asc, id asc', () => {
    expect(
      leaderboardOrder([
        { bevId: 'new', bayes: 9.9, n: 1, name: 'New Bev' },
        { bevId: 'b', bayes: 7.2, n: 4, name: 'Sprite' },
        { bevId: 'a', bayes: 7.2, n: 9, name: 'Coke' },
        { bevId: 'c', bayes: 7.2, n: 4, name: 'Fanta' },
        { bevId: 'd2', bayes: 8.1, n: 2, name: 'Topo Chico' },
        { bevId: 'd1', bayes: 8.1, n: 2, name: 'Topo Chico' },
      ]),
    ).toEqual(['d1', 'd2', 'a', 'c', 'b']);
  });

  it('sorts names by code point, like SQL collate "C"', () => {
    expect(
      leaderboardOrder([
        { bevId: 'lower', bayes: 7, n: 2, name: 'arizona' },
        { bevId: 'upper', bayes: 7, n: 2, name: 'Zevia' },
      ]),
    ).toEqual(['upper', 'lower']);
  });
});
