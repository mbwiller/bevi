import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DOUBLE_TAP_MS, FeedPost } from '../FeedPost';

const BEV: BevSummary = {
  id: 'b2',
  name: 'Horchata',
  brand: 'Tacos El Gordo',
  flavor: null,
  categoryId: 'other',
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: false,
  ratingCount: 41,
  bayesScore: null,
};
const ARJUN = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };

it("reads '<first name> Bev'd <Bev>' with a score, a photo tile and a relative time", async () => {
  const onOpen = jest.fn();
  const time = new Date(Date.now() - 5 * 3_600_000).toISOString();
  await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} time={time} onOpen={onOpen} />);
  expect(screen.getByText('Arjun')).toBeTruthy();
  expect(screen.getByText(" Bev'd ")).toBeTruthy();
  expect(screen.getByLabelText('Score 9.5')).toBeTruthy();
  expect(screen.getByText('5 hours ago')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Open Horchata' }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it('"You" for your own post', async () => {
  await render(<FeedPost you actor={ARJUN} bev={BEV} score={9} />);
  expect(screen.getByText('You')).toBeTruthy();
  expect(screen.getByText(" Bev'd ")).toBeTruthy();
});

it('truncates a long note and expands it on press', async () => {
  const note = `${'tastes like flat Sprite, in a good way. '.repeat(6)}the end`;
  await render(<FeedPost actor={ARJUN} bev={BEV} score={7} note={note} />);
  expect(screen.queryByText(/the end/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /See more$/ }));
  expect(screen.getByText(/the end/)).toBeTruthy();
});

it('fires onRank and onSave', async () => {
  const onRank = jest.fn();
  const onSave = jest.fn();
  await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onRank={onRank} onSave={onSave} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Rank Horchata' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save to Want to Try' }));
  expect(onRank).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
});

describe('likes', () => {
  const time = new Date(Date.now() - 5 * 3_600_000).toISOString();
  // The burst and the like count are aria-hidden.
  const hidden = { includeHiddenElements: true };
  const doubleTap = async (target: Parameters<typeof fireEvent.press>[0]) => {
    await fireEvent.press(target);
    await fireEvent.press(target);
  };

  it('leads the action row with the heart, then Rank and Want to Try', async () => {
    await render(
      <FeedPost actor={ARJUN} bev={BEV} score={7} liked likeCount={12} onLike={() => {}} onRank={() => {}} onSave={() => {}} />,
    );
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    const row = names.slice(names.indexOf('Unlike, 12 likes'));
    expect(row).toEqual(['Unlike, 12 likes', 'Rank Horchata', 'Save to Want to Try']);
    expect(screen.getByRole('button', { name: 'Unlike, 12 likes' }).props['aria-pressed']).toBe(true);
    expect(screen.getByText('12', hidden)).toBeTruthy();
  });

  it('the heart toggles through onLike; without onLike there is no heart', async () => {
    const onLike = jest.fn();
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onLike={onLike} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(onLike).toHaveBeenCalledTimes(1);
    await rerender(<FeedPost actor={ARJUN} bev={BEV} score={7} />);
    expect(screen.queryByRole('button', { name: /^(Un)?like/i })).toBeNull();
  });

  it('a double-tap outside the photo strip likes once and bursts; a single tap does nothing', async () => {
    const onLike = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={time} onLike={onLike} />);
    await fireEvent.press(screen.getByText('5 hours ago'));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
    await fireEvent.press(screen.getByText('5 hours ago'));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
    // On the head, too: anywhere on the post outside the strip.
    await doubleTap(screen.getByText('Horchata'));
    expect(onLike).toHaveBeenCalledTimes(2);
  });

  it('two taps further apart than the double-tap window do not like', async () => {
    const onLike = jest.fn();
    const now = jest.spyOn(Date, 'now');
    try {
      await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={time} onLike={onLike} />);
      now.mockReturnValue(1_000_000);
      await fireEvent.press(screen.getByText('5 hours ago'));
      now.mockReturnValue(1_000_000 + DOUBLE_TAP_MS + 1);
      await fireEvent.press(screen.getByText('5 hours ago'));
      expect(onLike).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('a double-tap on the photo strip never likes; a single tap there still opens the Bev', async () => {
    const onLike = jest.fn();
    const onOpen = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onLike={onLike} onOpen={onOpen} />);
    await doubleTap(screen.getByRole('button', { name: 'Open Horchata' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    // Between and around the tiles, the strip swallows taps.
    await doubleTap(screen.getByTestId('feed-post-strip'));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
  });

  it("double-tapping an already-liked post bursts but doesn't call onLike (it never unlikes)", async () => {
    const onLike = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={time} liked likeCount={3} onLike={onLike} />);
    await doubleTap(screen.getByText('5 hours ago'));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
  });

  it('buttons and "See more" keep their single tap inside a double-tappable post', async () => {
    const onLike = jest.fn();
    const onRank = jest.fn();
    const note = `${'tastes like flat Sprite, in a good way. '.repeat(6)}the end`;
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} note={note} onLike={onLike} onRank={onRank} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Rank Horchata' }));
    expect(onRank).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: /See more$/ }));
    expect(screen.getByText(/the end/)).toBeTruthy();
    expect(onLike).not.toHaveBeenCalled();
  });

  it('with no photo the burst plays over the post', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={time} photos={[]} onLike={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open Horchata' })).toBeNull();
    await doubleTap(screen.getByText('5 hours ago'));
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
  });
});
