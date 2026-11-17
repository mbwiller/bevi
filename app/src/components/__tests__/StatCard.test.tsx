import { fireEvent, render, screen } from '@testing-library/react-native';

import { StatCard } from '../StatCard';

it('shows label over value, as a button only when pressable', async () => {
  const onPress = jest.fn();
  const { rerender } = await render(<StatCard icon="trophy" label="Rank on Bevi" value="#12" onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Rank on Bevi, #12' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  await rerender(<StatCard icon="flame" label="Current Streak" value="4 days" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Current Streak, 4 days')).toBeTruthy();
  expect(screen.getByText('4 days')).toBeTruthy();
});

it('wraps a long label to a second line instead of truncating it, as values do', async () => {
  // "Current streak" is wider than a 393pt phone's card text (about 110pt), so it needs the second line.
  await render(<StatCard icon="flame" label="Current streak" value="Rank today to start" />);
  expect(screen.getByText('Current streak').props.numberOfLines).toBe(2);
  expect(screen.getByText('Rank today to start').props.numberOfLines).toBe(2);
});
