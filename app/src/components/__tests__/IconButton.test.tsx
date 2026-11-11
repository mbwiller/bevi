import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { IconButton } from '../IconButton';

it('uses label as its accessible name and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<IconButton icon="x" label="Close" variant="filled" onPress={onPress} />);
  const button = screen.getByRole('button', { name: 'Close' });
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('has a 44pt target', async () => {
  await render(<IconButton icon="settings" label="Settings" />);
  const style = StyleSheet.flatten(screen.getByRole('button', { name: 'Settings' }).props.style);
  expect(style.minWidth).toBe(size.target);
  expect(style.minHeight).toBe(size.target);
});

it('shows a badge', async () => {
  await render(<IconButton icon="menu" label="Menu" badge={4} />);
  expect(screen.getByText('4')).toBeTruthy();
});

it('Press: the whole 44pt target gives way, and a disabled button stays still and silent', async () => {
  const onPress = jest.fn();
  const { rerender } = await render(<IconButton icon="settings" label="Settings" onPress={onPress} />);
  const style = StyleSheet.flatten(screen.getByRole('button', { name: 'Settings' }).props.style);
  expect(style).toMatchObject({ minHeight: size.target, opacity: 1, transform: [{ scale: 1 }] });
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  await rerender(<IconButton icon="settings" label="Settings" onPress={onPress} disabled />);
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});
