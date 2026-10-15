import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { radius, size } from '@/theme';

import { BucketButton } from '../BucketButton';

const flat = (el: { props: Record<string, unknown> }): ViewStyle => {
  const s = el.props.style;
  return StyleSheet.flatten((typeof s === 'function' ? s({ pressed: false }) : s) as StyleProp<ViewStyle>);
};

it('labels each bucket with the fixed copy and fires onPress', async () => {
  const onPress = jest.fn();
  await render(
    <>
      <BucketButton bucket="LOVED" onPress={onPress} />
      <BucketButton bucket="FINE" />
      <BucketButton bucket="DISLIKED" />
    </>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Loved it' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByText('It was fine')).toBeTruthy();
  expect(screen.getByText("Didn't like it")).toBeTruthy();
});

it('reports selection with aria-pressed and is at least 44pt tall', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" selected />
      <BucketButton bucket="FINE" />
    </>,
  );
  const loved = screen.getByRole('button', { name: 'Loved it' });
  expect(loved.props['aria-pressed']).toBe(true);
  expect(screen.getByRole('button', { name: 'It was fine' }).props['aria-pressed']).toBe(false);
  expect(flat(loved).height).toBeGreaterThanOrEqual(size.target);
});

it('is always the tint material, with no backdrop-filter', async () => {
  await render(<BucketButton bucket="LOVED" />);
  const style = flat(screen.getByRole('button', { name: 'Loved it' })) as Record<string, unknown>;
  expect(style.borderRadius).toBe(radius.card);
  expect(style.backdropFilter).toBeUndefined();
  expect(style.WebkitBackdropFilter).toBeUndefined();
  expect(style.boxShadow).toBeUndefined();
});

it('rings the selected button in its bucket colour', async () => {
  await render(<BucketButton bucket="DISLIKED" selected />);
  const style = flat(screen.getByRole('button', { name: "Didn't like it" }));
  expect(style.borderRadius).toBe(radius.card);
  expect(String(style.boxShadow)).toContain('inset 0 0 0 2px');
});
