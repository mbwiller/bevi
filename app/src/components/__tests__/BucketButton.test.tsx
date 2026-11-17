import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors, size } from '@/theme';

import { BucketButton } from '../BucketButton';

const flat = (el: { props: Record<string, unknown> }) => StyleSheet.flatten(el.props.style as StyleProp<ViewStyle & TextStyle>);
const button = (name: string) => screen.getByRole('button', { name });
const part = (name: string, testID: string) => within(button(name)).getByTestId(testID, { includeHiddenElements: true });

it('labels each bucket with the fixed copy and fires onPress', async () => {
  const onPress = jest.fn();
  await render(
    <>
      <BucketButton bucket="LOVED" onPress={onPress} />
      <BucketButton bucket="FINE" />
      <BucketButton bucket="DISLIKED" />
    </>,
  );
  await fireEvent.press(button('Loved it'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByText('It was okay')).toBeTruthy();
  expect(screen.getByText('Not for me')).toBeTruthy();
});

it('fills the ring to a level per bucket, so the order never depends on colour', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" />
      <BucketButton bucket="FINE" />
      <BucketButton bucket="DISLIKED" />
    </>,
  );
  expect(flat(part('Loved it', 'bucket-fill')).height).toBe('100%');
  expect(flat(part('It was okay', 'bucket-fill')).height).toBe('50%');
  expect(flat(part('Not for me', 'bucket-fill')).height).toBe('0%');
});

it('draws every bucket in primary alone: no score colours, no shadow', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" />
      <BucketButton bucket="FINE" />
      <BucketButton bucket="DISLIKED" />
    </>,
  );
  for (const name of ['Loved it', 'It was okay', 'Not for me']) {
    const disc = flat(part(name, 'bucket-disc'));
    expect(disc.borderColor).toBe(colors.light.primary);
    expect(disc.boxShadow).toBeUndefined();
    expect(flat(part(name, 'bucket-fill')).backgroundColor).toBe(colors.light.primary);
  }
});

it('reports selection with aria-pressed, shows the check badge only when chosen, and clears 44pt', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" selected />
      <BucketButton bucket="FINE" dimmed />
    </>,
  );
  expect(button('Loved it').props['aria-pressed']).toBe(true);
  expect(button('It was okay').props['aria-pressed']).toBe(false);
  expect(flat(part('Loved it', 'bucket-badge')).opacity).toBe(1);
  expect(flat(part('It was okay', 'bucket-badge')).opacity).toBe(0);
  expect(Number(flat(part('Loved it', 'bucket-disc')).height)).toBeGreaterThanOrEqual(size.target);
});

it('fades the ring and greys the label when another bucket is chosen', async () => {
  await render(
    <>
      <BucketButton bucket="LOVED" selected />
      <BucketButton bucket="DISLIKED" dimmed />
    </>,
  );
  expect(flat(part('Not for me', 'bucket-disc')).opacity).toBeLessThan(1);
  expect(flat(screen.getByText('Not for me')).color).toBe(colors.light.textSecondary);
  expect(flat(part('Loved it', 'bucket-disc')).opacity).toBeUndefined();
  expect(flat(screen.getByText('Loved it')).color).toBe(colors.light.text);
});
