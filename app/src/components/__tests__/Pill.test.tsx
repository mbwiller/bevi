import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { size } from '@/theme';

import { Pill } from '../Pill';

it('is a labelled button that fires onPress', async () => {
  const onPress = jest.fn();
  await render(
    <Pill variant="filled" icon="camera" onPress={onPress}>
      Snap it
    </Pill>,
  );
  const pill = screen.getByRole('button', { name: 'Snap it' });
  await fireEvent.press(pill);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('reaches a 44pt hit area', async () => {
  await render(<Pill>Following</Pill>);
  const pill = screen.getByRole('button', { name: 'Following' });
  const { top, bottom } = pill.props.hitSlop;
  expect(StyleSheet.flatten(pill.props.style).height + top + bottom).toBeGreaterThanOrEqual(size.target);
});

it('marks an active outlined pill as pressed', async () => {
  await render(<Pill active>Not tried</Pill>);
  expect(screen.getByRole('button', { name: 'Not tried' }).props['aria-pressed']).toBe(true);
});

it('does not fire when disabled', async () => {
  const onPress = jest.fn();
  await render(
    <Pill disabled onPress={onPress}>
      Follow
    </Pill>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
  expect(onPress).not.toHaveBeenCalled();
});
