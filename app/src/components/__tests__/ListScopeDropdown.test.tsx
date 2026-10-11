import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { ListScopeDropdown } from '../ListScopeDropdown';

it('shows the scope, is labelled and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<ListScopeDropdown label="Sparkling water" onPress={onPress} />);
  expect(screen.getByText('Sparkling water')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Sparkling water, choose a category' });
  expect(button.props['aria-haspopup']).toBe('dialog');
  expect(StyleSheet.flatten(button.props.style).minHeight).toBe(size.target);
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('defaults to All', async () => {
  await render(<ListScopeDropdown />);
  expect(screen.getByText('All')).toBeTruthy();
});
