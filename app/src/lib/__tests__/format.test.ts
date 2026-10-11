import { formatCount, formatScore, initialsOf } from '../format';

it('formats scores to one decimal', () => {
  expect(formatScore(9.25)).toBe('9.3');
  expect(formatScore(8.5)).toBe('8.5');
  expect(formatScore(10)).toBe('10.0');
});

it('formats counts', () => {
  expect(formatCount(362)).toBe('362');
  expect(formatCount(5200)).toBe('5k');
});

it('takes two initials', () => {
  expect(initialsOf('Matt Willer')).toBe('MW');
  expect(initialsOf('  arjun  ')).toBe('A');
});
