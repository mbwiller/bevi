import { fireEvent, render, screen } from '@testing-library/react-native';

import { Header } from '../Header';

it('shows a title heading, labelled actions and a back button', async () => {
  const onBack = jest.fn();
  const onMore = jest.fn();
  await render(<Header title="Diet Coke" onBack={onBack} actions={[{ icon: 'ellipsis', label: 'More', onPress: onMore }]} />);
  expect(screen.getByRole('heading', { name: 'Diet Coke' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onMore).toHaveBeenCalledTimes(1);
});

it('shows the wordmark instead of a title', async () => {
  await render(<Header wordmark actions={[{ icon: 'user-plus', label: 'Find people' }]} />);
  expect(screen.getByLabelText('bevi')).toBeTruthy();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByRole('button', { name: 'Find people' })).toBeTruthy();
});

it('centres a caps title and shows action badges', async () => {
  await render(<Header centered title="Your lists" actions={[{ icon: 'settings', label: 'Settings', badge: 2 }]} />);
  expect(screen.getByRole('heading', { name: 'Your lists' })).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
});
