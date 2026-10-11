import { fireEvent, render, screen } from '@testing-library/react-native';

import { SectionHeader } from '../SectionHeader';

it('renders the title as a heading and fires the action', async () => {
  const onAction = jest.fn();
  await render(<SectionHeader title="Featured Bevs" action="See all" onAction={onAction} />);
  expect(screen.getByRole('heading', { name: 'Featured Bevs' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('link', { name: 'See all featured bevs' }));
  expect(onAction).toHaveBeenCalledTimes(1);
});

it('has no link without an action', async () => {
  await render(<SectionHeader title="Your feed" />);
  expect(screen.queryByRole('link')).toBeNull();
});
