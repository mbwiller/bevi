import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, size } from '@/theme';

import { Switch } from '../Switch';

const sw = () => screen.getByRole('switch', { name: 'Likes' });

it('is the platform switch, named by its label and announced on or off', async () => {
  await render(<Switch label="Likes" checked />);
  expect(sw().props.value).toBe(true);
  expect(sw().props.accessibilityState).toMatchObject({ checked: true, disabled: false });
});

it('is tinted from the tokens: primary on, borderStrong off, a surface knob', async () => {
  await render(<Switch label="Likes" />);
  // The host component carries the colours as the native switch reads them.
  const props = sw().props as { onTintColor?: string; tintColor?: string; thumbTintColor?: string; value?: boolean };
  expect(props.value).toBe(false);
  expect(props.onTintColor).toBe(colors.light.primary);
  expect(props.thumbTintColor).toBe(colors.light.surface);
  expect(props.tintColor).toBe(colors.light.borderStrong);
});

it('turning it reports the new state', async () => {
  const onChange = jest.fn();
  await render(<Switch label="Likes" checked={false} onChange={onChange} />);
  await fireEvent(sw(), 'valueChange', true);
  expect(onChange).toHaveBeenCalledWith(true);
});

it('a press beside the knob, inside its 44pt box, toggles it too', async () => {
  const onChange = jest.fn();
  await render(<Switch label="Likes" checked onChange={onChange} />);
  await fireEvent.press(screen.getByTestId('switch-target'));
  expect(onChange).toHaveBeenCalledWith(false);
  expect(StyleSheet.flatten(screen.getByTestId('switch-box').props.style).minHeight).toBe(size.target);
});

it('disabled: says so, and neither the switch nor its box reports a change', async () => {
  const onChange = jest.fn();
  await render(<Switch label="Likes" disabled onChange={onChange} />);
  expect(sw().props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId('switch-target'));
  expect(onChange).not.toHaveBeenCalled();
});
