import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { size } from '@/theme';

import { ProfileListRow } from '../ProfileListRow';

it('shows label and count, is 44pt tall, and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<ProfileListRow icon="circle-check" label="Bev'd" count={42} onPress={onPress} />);
  const row = screen.getByRole('button', { name: "Bev'd, 42" });
  expect((StyleSheet.flatten(row.props.style) as ViewStyle).minHeight).toBe(size.target);
  expect(screen.getByText('42')).toBeTruthy();
  await fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('omits the count when none is given', async () => {
  await render(<ProfileListRow icon="heart" label="Recommended for you" />);
  expect(screen.getByRole('button', { name: 'Recommended for you' })).toBeTruthy();
});
