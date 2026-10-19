import { formatCount, formatRatings, formatScore, formatTried, formatTriedPercent, initialsOf, spokenTried } from '../format';

it('formats scores to one decimal', () => {
  expect(formatScore(9.25)).toBe('9.3');
  expect(formatScore(8.5)).toBe('8.5');
  expect(formatScore(10)).toBe('10.0');
});

it('formats counts', () => {
  expect(formatCount(362)).toBe('362');
  expect(formatCount(5200)).toBe('5k');
});

it('formats rating counts in words', () => {
  expect(formatRatings(0)).toBe('0 ratings');
  expect(formatRatings(1)).toBe('1 rating');
  expect(formatRatings(12)).toBe('12 ratings');
  expect(formatRatings(5120)).toBe('5k ratings');
});

it('takes two initials', () => {
  expect(initialsOf('Matt Willer')).toBe('MW');
  expect(initialsOf('  arjun  ')).toBe('A');
});

describe('formatTried (M-08: round down, never a misleading 0%)', () => {
  it('reads 0% only when nothing is tried', () => {
    expect(formatTried(0, 61)).toBe('0 of 61 tried · 0%');
  });

  it('shows <1% once anything is tried but the share rounds down to 0', () => {
    expect(formatTriedPercent(1, 140)).toBe('<1%');
    expect(formatTried(1, 378)).toBe('1 of 378 tried · <1%');
  });

  it('rounds down, never up', () => {
    expect(formatTriedPercent(4, 61)).toBe('6%'); // 6.56
    expect(formatTriedPercent(2, 3)).toBe('66%'); // 66.7
    expect(formatTriedPercent(199, 200)).toBe('99%'); // 99.5 must not read as done
  });

  it('is exact on whole percentages and 100% only when everything is tried', () => {
    expect(formatTriedPercent(1, 4)).toBe('25%');
    expect(formatTried(22, 22)).toBe('22 of 22 tried · 100%');
  });

  it('drops the percentage for an empty category', () => {
    expect(formatTriedPercent(0, 0)).toBeNull();
    expect(formatTried(0, 0)).toBe('0 of 0 tried');
  });

  it('spells it out for a screen reader', () => {
    expect(spokenTried(4, 61)).toBe('4 of 61 tried, 6 percent');
    expect(spokenTried(1, 140)).toBe('1 of 140 tried, less than 1 percent');
    expect(spokenTried(0, 0)).toBe('0 of 0 tried');
  });
});
