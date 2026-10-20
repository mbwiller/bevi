import type { BevSummary, Comment, Profile } from '@bevi/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

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

it('the meta line is the brand, or the category with no brand, and never a price', async () => {
  const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} />);
  expect(screen.getByText('Tacos El Gordo')).toBeTruthy();
  expect(screen.queryByText(/\$/)).toBeNull();
  await rerender(<FeedPost actor={ARJUN} bev={{ ...BEV, brand: null }} score={9.5} />);
  expect(screen.getByText('Other')).toBeTruthy();
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

describe('comments', () => {
  const time = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const hidden = { includeHiddenElements: true };
  const person = (handle: string): Profile => ({
    id: `user-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    timezone: 'America/New_York',
    createdAt: time,
    birthdate: null,
    canSeeAlcohol: false,
    onboarded: true,
  });
  const thread = (n: number): Comment[] =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, author: person(`user${i + 1}`), body: `comment ${i + 1}`, createdAt: time }));
  const doubleTap = async (target: Parameters<typeof fireEvent.press>[0]) => {
    await fireEvent.press(target);
    await fireEvent.press(target);
  };

  it('the comment bubble sits right after the heart, before Rank and Want to Try', async () => {
    await render(
      <FeedPost
        actor={ARJUN}
        bev={BEV}
        score={7}
        likeCount={2}
        commentCount={3}
        comments={thread(3)}
        onLike={() => {}}
        onComment={() => {}}
        onRank={() => {}}
        onSave={() => {}}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    const row = names.slice(names.indexOf('Like, 2 likes'));
    expect(row).toEqual(['Like, 2 likes', 'Comment, 3 comments', 'Rank Horchata', 'Save to Want to Try']);
    expect(screen.getByText('3', hidden)).toBeTruthy();
  });

  it('without onComment there is no comment bubble', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onLike={() => {}} />);
    expect(screen.queryByRole('button', { name: /^Comment/ })).toBeNull();
  });

  it('0 comments: a bare bubble, nothing under the actions', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onComment={() => {}} />);
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
    expect(screen.queryByTestId('feed-post-comments')).toBeNull();
    expect(screen.queryByText(/^View all/)).toBeNull();
  });

  it.each([3, 7])('%i comments: every one inline as "handle text", oldest first, under the action row', async (n) => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} commentCount={n} comments={thread(n)} onComment={() => {}} />);
    const list = screen.getByTestId('feed-post-comments');
    const rows = within(list).getAllByTestId(/^feed-post-comment-/);
    expect(rows).toHaveLength(n);
    expect(list.props.role).toBe('list');
    rows.forEach((r) => expect(r.props.role).toBe('listitem'));
    // Each row is the author's avatar (initials here: no photo) then "handle body"; the text line is its own node.
    thread(n).forEach((c, i) => {
      expect(within(rows[i]!).getByText(`${c.author.handle} ${c.body}`)).toBeTruthy();
      expect(within(rows[i]!).getByLabelText(c.author.displayName)).toBeTruthy();
    });
    expect(within(rows[0]!).getByText('user1').props.style).toMatchObject({ fontWeight: '700' });
    expect(screen.queryByText(/^View all/)).toBeNull();
    // Under the action row: the list renders after the row's last control.
    const bubble = `Comment, ${n} comments`;
    expect(docOrder([bubble, 'feed-post-comments'])).toEqual([bubble, 'feed-post-comments']);
  });

  it("each inline comment draws its author's avatar: the photo when they have one, else initials", async () => {
    const withPhoto = { ...person('sam'), displayName: 'Sam Okafor', avatarUrl: 'https://example.com/sam.png' };
    const comments: Comment[] = [
      { id: 'c1', author: withPhoto, body: 'love it', createdAt: time },
      { id: 'c2', author: person('jo'), body: 'same', createdAt: time },
    ];
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} commentCount={2} comments={comments} onComment={() => {}} />);
    const rows = within(screen.getByTestId('feed-post-comments')).getAllByTestId(/^feed-post-comment-/);
    const first = within(rows[0]!);
    expect(first.getByLabelText('Sam Okafor')).toBeTruthy();
    expect(first.queryByText('SO')).toBeNull();
    expect(first.getByText('sam love it')).toBeTruthy();
    const second = within(rows[1]!);
    expect(second.getByLabelText('jo')).toBeTruthy();
    expect(second.getByText('J')).toBeTruthy();
  });

  it('8 or more: one "View all N comments" line, no preview, and it opens the sheet', async () => {
    const onComment = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} commentCount={8} comments={thread(7)} onComment={onComment} />);
    expect(screen.queryByTestId('feed-post-comments')).toBeNull();
    expect(screen.queryByText(/comment 1/)).toBeNull();
    const all = screen.getByRole('button', { name: 'View all 8 comments' });
    const style = Object.assign({}, ...[all.props.style].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBe(44);
    await fireEvent.press(all);
    await fireEvent.press(screen.getByRole('button', { name: 'Comment, 8 comments' }));
    expect(onComment).toHaveBeenCalledTimes(2);
  });

  it('double-tap still likes on the post and on inline comments, never through the comment targets', async () => {
    const onLike = jest.fn();
    const onComment = jest.fn();
    const { rerender } = await render(
      <FeedPost actor={ARJUN} bev={BEV} score={7} time={time} commentCount={3} comments={thread(3)} onLike={onLike} onComment={onComment} />,
    );
    await doubleTap(screen.getByText('5 hours ago'));
    expect(onLike).toHaveBeenCalledTimes(1);
    await doubleTap(screen.getByText('user2 comment 2'));
    expect(onLike).toHaveBeenCalledTimes(2);
    await doubleTap(screen.getByRole('button', { name: 'Comment, 3 comments' }));
    expect(onComment).toHaveBeenCalledTimes(2);
    expect(onLike).toHaveBeenCalledTimes(2);

    await rerender(
      <FeedPost actor={ARJUN} bev={BEV} score={7} time={time} commentCount={9} comments={thread(7)} onLike={onLike} onComment={onComment} />,
    );
    await doubleTap(screen.getByRole('button', { name: 'View all 9 comments' }));
    expect(onComment).toHaveBeenCalledTimes(4);
    expect(onLike).toHaveBeenCalledTimes(2);
  });
});

type JsonNode = { props: Record<string, unknown>; children: (JsonNode | string)[] | null };

/** Which of `markers` (a testID or an accessibilityLabel) appear, in render order. */
function docOrder(markers: string[]): string[] {
  const out: string[] = [];
  const walk = (n: JsonNode | string | null) => {
    if (!n || typeof n === 'string') return;
    const hit = markers.find((m) => n.props.testID === m || n.props.accessibilityLabel === m);
    if (hit && !out.includes(hit)) out.push(hit);
    (n.children ?? []).forEach(walk);
  };
  const json = screen.toJSON() as JsonNode | JsonNode[] | null;
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out;
}
