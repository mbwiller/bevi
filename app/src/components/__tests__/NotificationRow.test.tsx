import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

import { NotificationRow } from '../NotificationRow';

const BEV: BevSummary = {
  id: 'b1',
  name: 'Diet Coke',
  brand: 'Coca-Cola',
  flavor: 'Original',
  categoryId: 'diet_soda',
  photoUrl: null,
  iconUrl: null,
  iconLabelBand: null,
  photoStatus: 'ready',
  priceTier: 1,
  priceEstimated: false,
  ratingCount: 204,
  bayesScore: 8.8,
};

const person = (handle: string, displayName: string) => ({ handle, displayName, avatarUrl: null });
const PRIYA = person('priya', 'Priya Nair');
const SAMO = person('samo', 'Sam Okafor');
const LENA = person('lenap', 'Lena Park');

// Half a minute past the minute, so neither age sits on a boundary while the test runs.
const ago = (minutes: number) => new Date(Date.now() - (minutes + 0.5) * 60_000).toISOString();
const flat = (style: unknown) => StyleSheet.flatten(style as ViewStyle) as ViewStyle;

it('names one person, the Bev and the short age, and speaks the age in words', async () => {
  const onPress = jest.fn();
  await render(<NotificationRow kind="like" actors={[PRIYA]} bev={BEV} time={ago(2)} onPress={onPress} />);
  expect(screen.getByText(/liked your/)).toBeTruthy();
  expect(screen.getByText('priya')).toBeTruthy();
  expect(screen.getByText('Diet Coke')).toBeTruthy();
  // Joined by non-breaking spaces: the age never starts a line alone.
  expect(screen.getByText(' · 2m')).toBeTruthy();
  const row = screen.getByRole('button', { name: 'priya liked your Diet Coke, 2 minutes ago' });
  await fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
  // One person: one 44pt avatar, no pair.
  expect(screen.queryByTestId('notification-pair')).toBeNull();
});

it('names two people with "and" and pairs their avatars', async () => {
  await render(<NotificationRow kind="like" actors={[PRIYA, SAMO]} bev={BEV} time={ago(2)} />);
  expect(screen.getByRole('button', { name: 'priya and samo liked your Diet Coke, 2 minutes ago' })).toBeTruthy();
  expect(screen.getByTestId('notification-pair')).toBeTruthy();
});

it('names the first two and counts the rest, "1 other" in the singular', async () => {
  const { rerender } = await render(<NotificationRow kind="like" actors={[PRIYA, SAMO]} actorCount={5} bev={BEV} time={ago(2)} />);
  expect(screen.getByRole('button', { name: 'priya, samo and 3 others liked your Diet Coke, 2 minutes ago' })).toBeTruthy();
  expect(screen.getByText(/and 3 others/)).toBeTruthy();
  await rerender(<NotificationRow kind="like" actors={[PRIYA, SAMO]} actorCount={3} bev={BEV} time={ago(2)} />);
  expect(screen.getByRole('button', { name: 'priya, samo and 1 other liked your Diet Coke, 2 minutes ago' })).toBeTruthy();
});

it('quotes a comment beneath the sentence, on two lines at most', async () => {
  await render(<NotificationRow kind="comment" actors={[LENA]} bev={BEV} comment="This is the correct ranking." time={ago(14)} />);
  const quote = screen.getByTestId('notification-quote');
  expect(quote.props.numberOfLines).toBe(2);
  expect(screen.getByText('“This is the correct ranking.”')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'lenap commented on your Diet Coke, 14 minutes ago. “This is the correct ranking.”' }),
  ).toBeTruthy();
});

it('ends a follow row in "Follow back", then "Following", each its own target naming the person', async () => {
  const onFollow = jest.fn();
  const onPress = jest.fn();
  const { rerender } = await render(
    <NotificationRow kind="follow" actors={[SAMO]} time={ago(60)} following={false} onFollow={onFollow} onPress={onPress} />,
  );
  expect(screen.getByRole('button', { name: 'samo started following you, 1 hour ago' })).toBeTruthy();
  const pill = screen.getByRole('button', { name: 'Follow back samo' });
  expect(screen.getByText('Follow back')).toBeTruthy();
  await fireEvent.press(pill);
  expect(onFollow).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();

  await rerender(<NotificationRow kind="follow" actors={[SAMO]} time={ago(60)} following onFollow={onFollow} />);
  const following = screen.getByRole('button', { name: 'Following samo' });
  expect(following.props.accessibilityHint).toBe('Double tap to unfollow');
  expect(screen.getByText('Following')).toBeTruthy();
});

it('shows no pill on a follow row without `following`, and none on a like', async () => {
  const { rerender } = await render(<NotificationRow kind="follow" actors={[SAMO]} time={ago(60)} />);
  expect(screen.queryByText('Follow back')).toBeNull();
  await rerender(<NotificationRow kind="like" actors={[SAMO]} bev={BEV} time={ago(60)} following={false} />);
  expect(screen.queryByText('Follow back')).toBeNull();
});

it('marks an unread row with the tint, the dot, and "Unread." in its spoken sentence', async () => {
  const { rerender } = await render(<NotificationRow kind="like" actors={[PRIYA, SAMO]} bev={BEV} time={ago(2)} unread />);
  expect(screen.getByRole('button', { name: 'Unread. priya and samo liked your Diet Coke, 2 minutes ago' })).toBeTruthy();
  expect(screen.getByTestId('notification-unread-dot')).toBeTruthy();
  expect(flat(screen.getByTestId('notification-row').props.style).backgroundColor).toBe(colors.light.primaryTint);

  await rerender(<NotificationRow kind="like" actors={[PRIYA, SAMO]} bev={BEV} time={ago(2)} />);
  expect(screen.getByRole('button', { name: 'priya and samo liked your Diet Coke, 2 minutes ago' })).toBeTruthy();
  expect(screen.queryByTestId('notification-unread-dot')).toBeNull();
  expect(flat(screen.getByTestId('notification-row').props.style).backgroundColor).toBe(colors.light.surface);
});
