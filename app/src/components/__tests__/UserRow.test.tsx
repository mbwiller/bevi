import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { UserRow } from '../UserRow';

const ARJUN = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };

it('shows name, handle, meta and streak, and fires onPress', async () => {
  const onPress = jest.fn();
  await render(<UserRow user={ARJUN} rank={1} meta="212 pts" streak={14} onPress={onPress} />);
  expect(screen.getByText('Arjun Cheema')).toBeTruthy();
  expect(screen.getByText(/@acheema5 · 212 pts/)).toBeTruthy();
  expect(screen.getByLabelText('Rank 1')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Arjun Cheema, @acheema5, 212 pts, 14 day streak' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

describe('meta line on a narrow row', () => {
  type Node = { type?: unknown; props: Record<string, unknown>; children?: (Node | string)[] };
  const flat = (n: Node) => StyleSheet.flatten(n.props.style as ViewStyle) as ViewStyle;
  const nodes = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap((c) => (typeof c === 'string' ? [] : nodes(c)))];
  const LONG = { displayName: 'Arjun Cheema', handle: 'a_very_long_handle_for_a_narrow_row', avatarUrl: null };

  it('truncates only the handle and meta; the flame and its number sit after them and never shrink or wrap', async () => {
    await render(<UserRow user={LONG} rank={12} meta="1,204 pts" streak={128} following={false} />);
    const meta = screen.getByTestId('user-row-meta');
    expect(meta.props.numberOfLines).toBe(1);
    expect(flat(meta as unknown as Node)).toMatchObject({ flexShrink: 1, minWidth: 0 });
    // The truncating text holds no part of the streak.
    expect(nodes(meta as unknown as Node).some((n) => n.props.children === 128)).toBe(false);
    expect(JSON.stringify(meta.props.children)).not.toContain('128');

    const streak = screen.getByTestId('user-row-streak') as unknown as Node;
    expect(flat(streak)).toMatchObject({ flexDirection: 'row', flexShrink: 0 });
    // Same line: both are children of the one row-direction meta line.
    const line = (meta as unknown as { parent: Node }).parent;
    expect(flat(line)).toMatchObject({ flexDirection: 'row' });
    expect(flat(line).flexWrap).toBeUndefined();
    expect((streak as unknown as { parent: Node }).parent).toBe(line);
    // The flame (a 14pt decorative icon) and the number, kept on one line.
    const inside = nodes(streak);
    expect(inside.some((n) => n.props['aria-hidden'] === true && flat(n).width === 14 && flat(n).height === 14)).toBe(true);
    const days = screen.getByText('128');
    expect(days.props.numberOfLines).toBe(1);
    expect(inside).toContain(days as unknown as Node);
  });

  it('keeps the accessible name as it was', async () => {
    await render(<UserRow user={LONG} rank={12} meta="1,204 pts" streak={128} following={false} />);
    expect(
      screen.getByRole('button', { name: 'Arjun Cheema, @a_very_long_handle_for_a_narrow_row, 1,204 pts, 128 day streak' }),
    ).toBeTruthy();
  });

  it('draws no streak group without a streak', async () => {
    await render(<UserRow user={ARJUN} meta="212 pts" />);
    expect(screen.queryByTestId('user-row-streak')).toBeNull();
    expect(screen.getByTestId('user-row-meta').props.children).toEqual(['@', 'acheema5', ' · 212 pts']);
  });
});

it('toggles Follow / Following with aria-pressed', async () => {
  const onFollow = jest.fn();
  const { rerender } = await render(<UserRow user={ARJUN} following={false} onFollow={onFollow} />);
  const follow = screen.getByRole('button', { name: 'Follow Arjun Cheema' });
  expect(follow.props['aria-pressed']).toBe(false);
  expect(screen.getByText('Follow')).toBeTruthy();
  await fireEvent.press(follow);
  expect(onFollow).toHaveBeenCalledTimes(1);
  await rerender(<UserRow user={ARJUN} following onFollow={onFollow} />);
  expect(screen.getByRole('button', { name: 'Follow Arjun Cheema' }).props['aria-pressed']).toBe(true);
  expect(screen.getByText('Following')).toBeTruthy();
});

it('marks your own row and never shows Follow on it', async () => {
  await render(<UserRow user={ARJUN} self following={false} />);
  expect(screen.getByText(/\(you\)/)).toBeTruthy();
  expect(screen.queryByText('Follow')).toBeNull();
});

describe('context line', () => {
  it('shows a third line, with the users icon, and puts it in the label', async () => {
    await render(<UserRow user={ARJUN} meta="212 pts" context="Followed by Sam and Priya" />);
    const line = screen.getByText('Followed by Sam and Priya');
    expect(line.props.numberOfLines).toBe(1);
    expect(screen.getByRole('button', { name: 'Arjun Cheema, @acheema5, 212 pts, Followed by Sam and Priya' })).toBeTruthy();
  });

  it('draws nothing extra when absent', async () => {
    await render(<UserRow user={ARJUN} meta="212 pts" />);
    expect(screen.queryByText(/Followed by/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Arjun Cheema, @acheema5, 212 pts' })).toBeTruthy();
  });

  it('is 72pt tall at least with the line and 64 without', async () => {
    const minHeight = (el: { props: { style?: unknown } }) =>
      (StyleSheet.flatten(el.props.style as ViewStyle) as ViewStyle).minHeight;
    const { rerender } = await render(<UserRow user={ARJUN} context="Followed by Sam" />);
    expect(minHeight(screen.getByTestId('user-row'))).toBe(72);
    await rerender(<UserRow user={ARJUN} />);
    expect(minHeight(screen.getByTestId('user-row'))).toBe(64);
  });
});
