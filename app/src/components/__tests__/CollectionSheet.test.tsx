import type { CategoryProgress } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CollectionSheet } from '../CollectionSheet';

const ROWS: CategoryProgress[] = [
  { categoryId: 'soda', ranked: 4, total: 61 },
  { categoryId: 'juice', ranked: 0, total: 25 },
  { categoryId: 'smoothie', ranked: 0, total: 0 },
  { categoryId: 'coffee', ranked: 9, total: 40 },
];

it('lists every category with a total, in the order given, with the overall line on top', async () => {
  await render(<CollectionSheet open rows={ROWS} />);
  expect(screen.getByRole('header', { name: 'Your collection' })).toBeTruthy();
  expect(screen.getByText('13 of 126 tried · 10%')).toBeTruthy();
  expect(screen.getByLabelText('13 of 126 tried, 10 percent')).toBeTruthy();
  const rows = screen
    .getAllByRole('button', { name: /Show only/ })
    .map((b) => b.props.accessibilityLabel as string);
  expect(rows).toEqual([
    'Soda, 4 of 61 tried, 6 percent. Show only Soda',
    'Juice, 0 of 25 tried, 0 percent. Show only Juice',
    'Coffee, 9 of 40 tried, 22 percent. Show only Coffee',
  ]);
  expect(screen.queryByText('Smoothie')).toBeNull();
  expect(screen.getByText('9 of 40')).toBeTruthy();
});

it('scopes to a category when a row is tapped', async () => {
  const onSelect = jest.fn();
  await render(<CollectionSheet open rows={ROWS} onSelect={onSelect} />);
  await fireEvent.press(screen.getByRole('button', { name: /^Coffee,/ }));
  expect(onSelect).toHaveBeenCalledWith('coffee');
});

it('renders nothing while closed', async () => {
  await render(<CollectionSheet rows={ROWS} />);
  expect(screen.queryByText('Your collection')).toBeNull();
});
