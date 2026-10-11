import { fireEvent, render, screen } from '@testing-library/react-native';

import { UserRow } from '../UserRow';

const ARJUN = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };

it('shows name, handle, meta and streak, and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<UserRow user={ARJUN} rank={1} meta="212 pts" streak={14} onPress={onPress} />);
  expect(screen.getByText('Arjun Cheema')).toBeTruthy();
  expect(screen.getByText(/@acheema5 · 212 pts/)).toBeTruthy();
  expect(screen.getByLabelText('Rank 1')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Arjun Cheema, @acheema5, 212 pts, 14 day streak' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('toggles Follow / Following with aria-pressed', async () => {
  const onFollow = jest.fn();
  const { rerender } = await render(<UserRow user={ARJUN} following={false} onFollow={onFollow} />);
  const follow = screen.getByRole('button', { name: 'Follow Arjun Cheema' });
  expect(follow.props['aria-pressed']).toBe(false);
  expect(screen.getByText('Follow')).toBeTruthy();
  await fireEvent.press(follow);
  expect(onFollow).toHaveBeenCalledTimes(1);
  await rerender(<UserRow user={ARJUN} following onFollow={onFollow} />);
  expect(screen.getByRole('button', { name: 'Follow Arjun Cheema' }).props['aria-pressed']).toBe(true);
  expect(screen.getByText('Following')).toBeTruthy();
});

it('marks your own row and never shows Follow on it', async () => {
  await render(<UserRow user={ARJUN} self following={false} />);
  expect(screen.getByText(/\(you\)/)).toBeTruthy();
  expect(screen.queryByText('Follow')).toBeNull();
});
