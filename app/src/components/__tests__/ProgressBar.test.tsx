import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { ProgressBar } from '../ProgressBar';

const fill = () => StyleSheet.flatten(screen.getByTestId('progress-fill', { includeHiddenElements: true }).props.style) as ViewStyle;

it('fills to the share given, clamped to 0–100%', async () => {
  const { rerender } = await render(<ProgressBar value={0.25} />);
  expect(fill().width).toBe('25%');
  await rerender(<ProgressBar value={2} />);
  expect(fill().width).toBe('100%');
  await rerender(<ProgressBar value={-1} />);
  expect(fill().width).toBe('0%');
});

it('is hidden from screen readers: the text beside it says the number', async () => {
  await render(<ProgressBar value={0.5} />);
  expect(screen.queryByTestId('progress-fill')).toBeNull();
});
