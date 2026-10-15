import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors } from '@/theme';

import { CommentButton } from '../CommentButton';

// The count is aria-hidden (the button's name carries it), so text queries include hidden elements.
const hidden = { includeHiddenElements: true };

type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | string)[] };

/** The Lucide glyph's svg props under the bubble. */
function bubbleGlyph(): { fill: string; stroke: string } {
  const find = (n: HostNode | string): HostNode | undefined =>
    typeof n === 'string' ? undefined : n.type === 'RNSVGSvgView' ? n : n.children.map(find).find(Boolean);
  return find(screen.getByTestId('comment-bubble') as unknown as HostNode)!.props as { fill: string; stroke: string };
}

it('is an outline bubble in text, never grape', async () => {
  await render(<CommentButton count={4} />);
  expect(bubbleGlyph().fill).toBe('none');
  expect(bubbleGlyph().stroke).toBe(colors.light.text);
});

it('shows the count, formatted, and hides it at 0', async () => {
  const { rerender } = await render(<CommentButton count={3} />);
  expect(screen.getByText('3', hidden)).toBeTruthy();
  await rerender(<CommentButton count={5200} />);
  expect(screen.getByText('5k', hidden)).toBeTruthy();
  await rerender(<CommentButton count={0} />);
  expect(screen.queryByText('0', hidden)).toBeNull();
});

it('is named "Comment" plus the count', async () => {
  const { rerender } = await render(<CommentButton />);
  expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  await rerender(<CommentButton count={1} />);
  expect(screen.getByRole('button', { name: 'Comment, 1 comment' })).toBeTruthy();
  await rerender(<CommentButton count={3} />);
  expect(screen.getByRole('button', { name: 'Comment, 3 comments' })).toBeTruthy();
});

it('is a 44pt target and calls onPress', async () => {
  const onPress = jest.fn();
  await render(<CommentButton count={2} onPress={onPress} />);
  const button = screen.getByRole('button', { name: 'Comment, 2 comments' });
  const style = Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean));
  expect(style.minWidth).toBe(44);
  expect(style.minHeight).toBe(44);
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
