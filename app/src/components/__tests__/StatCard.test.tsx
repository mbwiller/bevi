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
