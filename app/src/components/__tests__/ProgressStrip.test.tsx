import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { size } from '@/theme';

import { ProgressStrip } from '../ProgressStrip';

const fillWidth = () => (StyleSheet.flatten(screen.getByTestId('progress-fill', { includeHiddenElements: true }).props.style) as ViewStyle).width;

it('reads "Soda · 4 of 61 tried · 6%", is a 44pt button and opens the collection', async () => {
  const onPress = jest.fn();
  await render(<ProgressStrip label="Soda" ranked={4} total={61} onPress={onPress} />);
  expect(screen.getByText('Soda · 4 of 61 tried · 6%')).toBeTruthy();
  const strip = screen.getByRole('button', { name: 'Soda, 4 of 61 tried, 6 percent. Show your collection' });
  expect((StyleSheet.flatten(strip.props.style) as ViewStyle).minHeight).toBe(size.target);
  await fireEvent.press(strip);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('defaults to "All Bevs" and fills the bar to the share tried', async () => {
  await render(<ProgressStrip ranked={37} total={378} onPress={() => {}} />);
  expect(screen.getByText('All Bevs · 37 of 378 tried · 9%')).toBeTruthy();
  expect(fillWidth()).toBe(`${(37 / 378) * 100}%`);
});

it('never shows 0% once something is tried', async () => {
  await render(<ProgressStrip label="Coffee" ranked={1} total={140} />);
  expect(screen.getByText('Coffee · 1 of 140 tried · <1%')).toBeTruthy();
  expect(screen.getByLabelText('Coffee, 1 of 140 tried, less than 1 percent')).toBeTruthy();
});

it('is plain text, not a button, without onPress', async () => {
  await render(<ProgressStrip label="Boba" ranked={0} total={22} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(fillWidth()).toBe('0%');
});
