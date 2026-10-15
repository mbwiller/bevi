import { formatCount, formatRatings, formatScore, initialsOf } from '../format';

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
