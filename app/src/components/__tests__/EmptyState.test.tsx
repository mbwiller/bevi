import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from '../EmptyState';

it('shows title, body and one action', async () => {
  const onAction = jest.fn();
  await render(
    <EmptyState icon="users" title="Follow friends to see their Bevs" body="Rankings from people you follow show up here." action="Find people" onAction={onAction} />,
  );
  expect(screen.getByText('Follow friends to see their Bevs')).toBeTruthy();
  expect(screen.getByText('Rankings from people you follow show up here.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Find people' }));
  expect(onAction).toHaveBeenCalledTimes(1);
});

it('has no button without an action', async () => {
  await render(<EmptyState title="Nothing in Want to Try yet" />);
  expect(screen.queryByRole('button')).toBeNull();
});
