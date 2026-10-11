import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { FilterPill } from '../FilterPill';

it('is labelled "Filters" and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<FilterPill onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('0')).toBeNull();
});

it('shows the active count in its badge and label', async () => {
  await render(<FilterPill count={3} />);
  expect(screen.getByRole('button', { name: 'Filters, 3 on' })).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
});

it('names a single-facet pill by its label', async () => {
  await render(<FilterPill label="Bucket" chevron icon={null} />);
  expect(screen.getByRole('button', { name: 'Bucket' })).toBeTruthy();
});

it('reaches a 44pt hit area', async () => {
  await render(<FilterPill />);
  const pill = StyleSheet.flatten(screen.getByRole('button', { name: 'Filters' }).props.style);
  const target = StyleSheet.flatten(screen.getByTestId('hit-target').props.style);
  expect(pill.height - 2 * pill.borderWidth - target.top - target.bottom).toBeGreaterThanOrEqual(size.target);
});
