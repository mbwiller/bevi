import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { colors, size } from '@/theme';

import { TasteBar } from '../TasteBar';
import { TasteProfile } from '../TasteProfile';

const fill = () => StyleSheet.flatten(screen.getByTestId('progress-fill', { includeHiddenElements: true }).props.style) as ViewStyle;

it('is one 44pt element that reads "Coffee, average 8.1, 9 ranked", and not a button', async () => {
  await render(<TasteBar categoryId="coffee" mean={8.07} rankingCount={9} />);
  const bar = screen.getByLabelText('Coffee, average 8.1, 9 ranked');
  expect((StyleSheet.flatten(bar.props.style) as ViewStyle).minHeight).toBe(size.target);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Coffee')).toBeTruthy();
  expect(screen.getByText('8.1')).toBeTruthy();
});

it('shows the number and fills the bar to mean / 10', async () => {
  await render(<TasteBar categoryId="soda" mean={7.5} rankingCount={4} />);
  expect(screen.getByText('7.5')).toBeTruthy();
  expect(screen.getByText(/ · 4 ranked/)).toBeTruthy();
  expect(fill().width).toBe('75%');
});

it.each([
  [7, 'scoreHigh'],
  [6.96, 'scoreHigh'],
  [6.9, 'scoreMid'],
  [4, 'scoreMid'],
  [3.9, 'scoreLow'],
] as const)('a mean of %s takes the %s colour on the number and the bar', async (mean, token) => {
  await render(<TasteBar categoryId="tea" mean={mean} rankingCount={3} />);
  const score = screen.getByText(mean.toFixed(1));
  expect((StyleSheet.flatten(score.props.style) as TextStyle).color).toBe(colors.light[token]);
  expect(fill().backgroundColor).toBe(colors.light[token]);
});

describe('TasteProfile', () => {
  it('renders nothing without rows', async () => {
    await render(<TasteProfile rows={[]} readout="ignored" />);
    expect(screen.toJSON()).toBeNull();
  });

  it('shows the read-out over a bar per row, in the order given', async () => {
    await render(
      <TasteProfile
        readout="You prefer coffee over soda"
        rows={[
          { categoryId: 'soda', mean: 9, rankingCount: 4 },
          { categoryId: 'coffee', mean: 6, rankingCount: 8 },
        ]}
      />,
    );
    expect(screen.getByText('You prefer coffee over soda')).toBeTruthy();
    const labels = screen.getAllByLabelText(/, average /).map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(['Soda, average 9.0, 4 ranked', 'Coffee, average 6.0, 8 ranked']);
  });

  it('leaves the line out without a read-out', async () => {
    await render(<TasteProfile rows={[{ categoryId: 'tea', mean: 5, rankingCount: 1 }]} readout={null} />);
    expect(screen.getAllByLabelText(/, average /)).toHaveLength(1);
    expect(screen.queryByText(/prefer/)).toBeNull();
  });
});
