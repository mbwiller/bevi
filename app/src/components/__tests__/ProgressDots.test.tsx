import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ProgressDots } from '../ProgressDots';

it('is a progressbar named for the current comparison', async () => {
  await render(<ProgressDots total={4} current={1} />);
  const bar = screen.getByRole('progressbar', { name: 'Comparison 2 of up to 4' });
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 4, now: 1 });
  const dots = screen.getAllByTestId('progress-dot');
  expect(dots).toHaveLength(4);
  expect(StyleSheet.flatten(dots[1]!.props.style).width).toBe(20);
  expect(StyleSheet.flatten(dots[2]!.props.style).width).toBe(8);
});

it('never names a comparison past the total', async () => {
  await render(<ProgressDots total={3} current={3} />);
  expect(screen.getByRole('progressbar', { name: 'Comparison 3 of up to 3' })).toBeTruthy();
});
