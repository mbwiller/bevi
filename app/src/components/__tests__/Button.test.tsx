import { fireEvent, render, screen } from '@testing-library/react-native';

import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { Button } from '../Button';

it('is a labelled button that fires onPress', async () => {
  const onPress = jest.fn();
  await render(
    <Button variant="primary" onPress={onPress}>
      Rank it
    </Button>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Rank it' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('labels an icon-only button', async () => {
  await render(<Button icon="chevron-down" accessibilityLabel="More" />);
  expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
});

it('extends the 36pt md button to a 44pt target', async () => {
  await render(<Button>Edit profile</Button>);
  const button = screen.getByRole('button', { name: 'Edit profile' });
  expect(button.props.hitSlop).toBeUndefined();
  const visual = StyleSheet.flatten(button.props.style).height;
  const target = StyleSheet.flatten(screen.getByTestId('hit-target').props.style);
  expect(visual).toBe(36);
  // Absolute children sit inside the 1pt border, so the reach is measured from the padding box.
  const border = StyleSheet.flatten(button.props.style).borderWidth ?? 0;
  expect(visual - 2 * border - target.top - target.bottom).toBeGreaterThanOrEqual(size.target);
});

it('shows a spinner and ignores presses while loading', async () => {
  const onPress = jest.fn();
  await render(
    <Button variant="primary" loading onPress={onPress}>
      Rank it
    </Button>,
  );
  expect(screen.getByText('Working…')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Rank it' });
  expect(button).toBeBusy();
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
