import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, motion, scoreColor, size } from '@/theme';

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

it('size 72 renders at the scoreBubbleXl token with the 28/34 number', async () => {
  await render(<ScoreBubble score={8.9} size={72} bucket="LOVED" />);
  const bubble = StyleSheet.flatten(screen.getByLabelText('Score 8.9').props.style);
  expect(bubble.width).toBe(size.scoreBubbleXl);
  expect(bubble.height).toBe(size.scoreBubbleXl);
  const num = StyleSheet.flatten(screen.getByText('8.9').props.style);
  expect(num).toMatchObject({ fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontWeight: '700' });
});

it('size 72 predicted is 24 and the lock is 28', async () => {
  await render(<ScoreBubble score={7.6} size={72} variant="predicted" />);
  expect(StyleSheet.flatten(screen.getByText('~7.6').props.style).fontSize).toBe(24);
  await render(<ScoreBubble variant="locked" size={72} />);
  expect(StyleSheet.flatten(screen.getByLabelText('Score hidden').props.style).width).toBe(size.scoreBubbleXl);
});

describe('countFrom', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('counts the number up while the label is the final score from the start', async () => {
    await render(<ScoreBubble score={8.93} size={72} bucket="LOVED" countFrom={7} />);
    expect(screen.getByText('7.0')).toBeTruthy();
    expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
    // Colour is the final score's (the bucket's) all the way up.
    expect(textColor('7.0')).toBe(colors.light.scoreHigh);

    await act(() => jest.advanceTimersByTime(motion.pour / 2));
    expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
    expect(screen.queryByText('7.0')).toBeNull();

    await act(() => jest.advanceTimersByTime(motion.pour / 2));
    expect(screen.getByText('8.9')).toBeTruthy();
    expect(screen.getByLabelText('Score 8.9')).toBeTruthy();
  });
});
