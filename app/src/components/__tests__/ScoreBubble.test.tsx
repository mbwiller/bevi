import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, scoreColor } from '@/theme';

import { ScoreBubble } from '../ScoreBubble';

const textColor = (label: string) => StyleSheet.flatten(screen.getByText(label).props.style).color;

it('shows the score to one decimal with an accessible label', async () => {
  await render(<ScoreBubble score={9.25} />);
  expect(screen.getByText('9.3')).toBeTruthy();
  expect(screen.getByLabelText('Score 9.3')).toBeTruthy();
  expect(textColor('9.3')).toBe(colors.light.scoreHigh);
});

it.each([
  [3.94, 'scoreLow'],
  [3.95, 'scoreMid'],
  [4.0, 'scoreMid'],
  [6.94, 'scoreMid'],
  [6.95, 'scoreHigh'],
  [7.0, 'scoreHigh'],
] as const)('colours %s as %s (bands on the shown decimal)', async (score, token) => {
  expect(scoreColor(score)).toBe(token);
  await render(<ScoreBubble score={score} />);
  expect(textColor((Math.round(score * 10) / 10).toFixed(1))).toBe(colors.light[token]);
});

it('uses the bucket colour when known', async () => {
  await render(<ScoreBubble score={7.4} bucket="FINE" />);
  expect(textColor('7.4')).toBe(colors.light.scoreMid);
});

it('prefixes predictions with ~', async () => {
  await render(<ScoreBubble score={8.2} variant="predicted" size={56} />);
  expect(screen.getByText('~8.2')).toBeTruthy();
  expect(screen.getByLabelText('Predicted score 8.2')).toBeTruthy();
});

it('locks when locked or null, hiding the number', async () => {
  await render(<ScoreBubble variant="locked" score={8} />);
  expect(screen.getByLabelText('Score hidden')).toBeTruthy();
  expect(screen.queryByText('8.0')).toBeNull();
  await render(<ScoreBubble score={null} />);
  expect(screen.getByLabelText('Score hidden')).toBeTruthy();
});
