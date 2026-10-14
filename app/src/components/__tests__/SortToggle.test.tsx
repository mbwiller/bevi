import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { SortToggle } from '../SortToggle';

it('labels the sort and search buttons and fires their handlers', async () => {
  const onPress = jest.fn();
  const onSearch = jest.fn();
  await render(<SortToggle label="Recent" onPress={onPress} onSearch={onSearch} />);
  expect(screen.getByText('Recent')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Sort by Recent' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Search this list' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenCalledTimes(1);
});

it('hides search when onSearch is false', async () => {
  await render(<SortToggle onPress={jest.fn()} onSearch={false} />);
  expect(screen.getByRole('button', { name: 'Sort by Score' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Search this list' })).toBeNull();
});

it('hides search when onSearch is omitted', async () => {
  await render(<SortToggle onPress={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Sort by Score' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Search this list' })).toBeNull();
});

it('gives both buttons 44pt targets', async () => {
  await render(<SortToggle onPress={jest.fn()} onSearch={jest.fn()} />);
  for (const name of ['Sort by Score', 'Search this list']) {
    expect(StyleSheet.flatten(screen.getByRole('button', { name }).props.style).minHeight).toBe(size.target);
  }
});
