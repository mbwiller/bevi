import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors } from '@/theme';

import { LikeButton } from '../LikeButton';

const lightColors = colors.light;
// The count is aria-hidden (the button's name carries it), so text queries include hidden elements.
const hidden = { includeHiddenElements: true };

type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | string)[] };

/** The Lucide glyph's svg props (fill and stroke) under the heart. */
function heartGlyph(): { fill: string; stroke: string } {
  const find = (n: HostNode | string): HostNode | undefined =>
    typeof n === 'string' ? undefined : n.type === 'RNSVGSvgView' ? n : n.children.map(find).find(Boolean);
  const svg = find(screen.getByTestId('like-heart') as unknown as HostNode);
  return svg!.props as { fill: string; stroke: string };
}

it('is an outline heart in text until liked, then filled primary', async () => {
  const { rerender } = await render(<LikeButton />);
  expect(heartGlyph().fill).toBe('none');
  expect(heartGlyph().stroke).toBe(lightColors.text);
  await rerender(<LikeButton liked />);
  expect(heartGlyph().fill).toBe(lightColors.primary);
  expect(heartGlyph().stroke).toBe(lightColors.primary);
});

it('shows the count beside the heart, formatted, and hides it at 0', async () => {
  const { rerender } = await render(<LikeButton count={12} />);
  expect(screen.getByText('12', hidden)).toBeTruthy();
  await rerender(<LikeButton count={5200} />);
  expect(screen.getByText('5k', hidden)).toBeTruthy();
  await rerender(<LikeButton count={0} />);
  expect(screen.queryByText('0', hidden)).toBeNull();
});

it('is named "Like" / "Unlike" plus the count, with aria-pressed', async () => {
  const { rerender } = await render(<LikeButton />);
  expect(screen.getByRole('button', { name: 'Like' }).props['aria-pressed']).toBe(false);
  await rerender(<LikeButton liked count={12} />);
  expect(screen.getByRole('button', { name: 'Unlike, 12 likes' }).props['aria-pressed']).toBe(true);
  await rerender(<LikeButton liked count={1} />);
  expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeTruthy();
  await rerender(<LikeButton count={3} />);
  expect(screen.getByRole('button', { name: 'Like, 3 likes' }).props['aria-pressed']).toBe(false);
});

it('calls onPress', async () => {
  const onPress = jest.fn();
  await render(<LikeButton count={2} onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Like, 2 likes' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});
