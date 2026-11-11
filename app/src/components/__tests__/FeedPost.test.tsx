import type { BevSummary, Comment, Profile } from '@bevi/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { DOUBLE_TAP_MS, FeedPost, POST_AVATAR, POST_PICTURE } from '../FeedPost';

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
/** The same Bev once it has a Bayesian score: the post prints "8.4 on Bevi · 41 ratings". */
const SCORED: BevSummary = { ...BEV, bayesScore: 8.36 };
const ARJUN = { displayName: 'Arjun Cheema', handle: 'acheema5', avatarUrl: null };
const PRIYA = { displayName: 'Priya Rao', handle: 'priya', avatarUrl: 'https://example.com/priya.png' };
const SAM = { displayName: 'Sam Okafor', handle: 'sam', avatarUrl: null };

const FIVE_HOURS_AGO = () => new Date(Date.now() - 5 * 3_600_000).toISOString();
/** The meta line under the sentence, as it reads: the brand, then the time. */
const META = 'Tacos El Gordo · 5 hours ago';
/** The time on the meta line: its own text node, plain text, so a double-tap target. */
const WHEN = '5 hours ago';
/** Every string under a node, in render order: what the line reads as. */
const textOf = (n: { children?: unknown[] } | string): string =>
  typeof n === 'string' ? n : ((n.children ?? []) as ({ children?: unknown[] } | string)[]).map(textOf).join('');
/** People's own photos: the strip layout. */
const PHOTOS = [{ src: 'https://example.com/1.jpg' }, { src: 'https://example.com/2.jpg' }];
const LONG_NOTE = `${'tastes like flat Sprite, in a good way. '.repeat(6)}the end`;
// The burst and the like count are aria-hidden.
const hidden = { includeHiddenElements: true };
const doubleTap = async (target: Parameters<typeof fireEvent.press>[0]) => {
  await fireEvent.press(target);
  await fireEvent.press(target);
};
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('the head', () => {
  it("reads '<first name> Bev'd <Bev>' with the names bold, a 44pt avatar and a score", async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} />);
    expect(screen.getByText('Arjun').props.style).toMatchObject({ fontWeight: '700' });
    expect(screen.getByText('Horchata').props.style).toMatchObject({ fontWeight: '700' });
    expect(screen.getByText(" Bev'd ")).toBeTruthy();
    // The sentence is `heading`, the verb regular.
    expect(flat(screen.getByText("Arjun Bev'd Horchata").props.style)).toMatchObject({ fontSize: 17, fontWeight: '400' });
    expect(flat(screen.getByLabelText('Arjun Cheema').props.style)).toMatchObject({ width: POST_AVATAR, height: POST_AVATAR });
    expect(screen.getByLabelText('Score 9.5')).toBeTruthy();
  });

  it('"You" for your own post', async () => {
    await render(<FeedPost you actor={ARJUN} bev={BEV} score={9} />);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText("You Bev'd Horchata")).toBeTruthy();
  });

  it('a long Bev name wraps to two lines at most, beside the score bubble', async () => {
    const name = 'Extra Large Iced Brown Sugar Oat Milk Shaken Espresso With Cold Foam';
    await render(<FeedPost actor={ARJUN} bev={{ ...BEV, name }} score={8} />);
    expect(screen.getByText(`Arjun Bev'd ${name}`).props.numberOfLines).toBe(2);
    expect(screen.getByLabelText('Score 8.0')).toBeTruthy();
  });

  it('predicted and locked scores', async () => {
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={6.4} scoreVariant="predicted" />);
    expect(screen.getByLabelText('Predicted score 6.4')).toBeTruthy();
    await rerender(<FeedPost actor={ARJUN} bev={BEV} scoreVariant="locked" />);
    expect(screen.getByLabelText('Score hidden')).toBeTruthy();
    await rerender(<FeedPost actor={ARJUN} bev={BEV} />);
    expect(screen.queryByLabelText(/^Score|hidden$/)).toBeNull();
  });

  it('the meta line is the brand and the relative time', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} time={FIVE_HOURS_AGO()} />);
    const line = screen.getByTestId('post-meta');
    // It reads as one line, in order, as it did when it was a single text.
    expect(textOf(line)).toBe(META);
    const meta = within(line);
    // The time is its own node with the exact relative time.
    expect(meta.getByText(WHEN)).toBeTruthy();
    expect(meta.getByTestId('post-meta-brand').props.numberOfLines).toBe(1);
  });

  it('a very long brand truncates on its own; the time is never inside it and never shrinks', async () => {
    const brand = 'The Extraordinarily Long Artisanal Small Batch Cold Brew Coffee Company of Greater Brooklyn';
    await render(<FeedPost actor={ARJUN} bev={{ ...BEV, brand }} score={9.5} time={FIVE_HOURS_AGO()} />);
    const brandNode = screen.getByTestId('post-meta-brand');
    expect(brandNode.props.numberOfLines).toBe(1);
    expect(flat(brandNode.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
    expect(within(brandNode).queryByText(WHEN)).toBeNull();
    expect(textOf(brandNode)).toBe(brand);
    // The time, in full, in a sibling that keeps its width.
    const whenNode = screen.getByTestId('post-meta-when');
    expect(flat(whenNode.props.style).flexShrink).toBe(0);
    expect(within(whenNode).getByText(WHEN)).toBeTruthy();
    expect(textOf(whenNode)).toBe(` · ${WHEN}`);
    expect(textOf(screen.getByTestId('post-meta'))).toBe(`${brand} · ${WHEN}`);
  });

  it('the time alone when there is neither a brand nor a category', async () => {
    await render(<FeedPost actor={ARJUN} bev={{ ...BEV, brand: null, categoryId: 'no-such-category' as BevSummary['categoryId'] }} score={9.5} time={FIVE_HOURS_AGO()} />);
    expect(within(screen.getByTestId('post-meta')).getByText(WHEN)).toBeTruthy();
    expect(textOf(screen.getByTestId('post-meta'))).toBe(WHEN);
    expect(screen.queryByTestId('post-meta-brand')).toBeNull();
  });

  it('the meta line is the category with no brand, the brand alone with no time, and never a price', async () => {
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} />);
    expect(screen.getByText('Tacos El Gordo')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    await rerender(<FeedPost actor={ARJUN} bev={{ ...BEV, brand: null }} score={9.5} time={FIVE_HOURS_AGO()} />);
    expect(textOf(screen.getByTestId('post-meta'))).toBe(`Other · ${WHEN}`);
  });
});

describe('the body with the Bev’s own picture', () => {
  it('a 112pt picture that opens the Bev', async () => {
    const onOpen = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} onOpen={onOpen} />);
    const picture = screen.getByRole('button', { name: 'Open Horchata' });
    expect(within(screen.getByTestId('post-body')).getByRole('button', { name: 'Open Horchata' })).toBe(picture);
    expect(flat(within(picture).getByLabelText('Horchata').props.style)).toMatchObject({ width: POST_PICTURE, height: POST_PICTURE });
    await fireEvent.press(picture);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('feed-post-strip')).toBeNull();
  });

  it('the note sits beside the picture with no "Notes:" label, the Bevi score line under it', async () => {
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={9.5} note="oat milk, half sweet" />);
    const side = within(screen.getByTestId('post-side'));
    expect(side.getByText('oat milk, half sweet')).toBeTruthy();
    expect(side.getByText('8.4 on Bevi · 41 ratings')).toBeTruthy();
    expect(screen.queryByText(/Notes:/)).toBeNull();
    expect(docOrder(['post-note', 'post-bevi-score'])).toEqual(['post-note', 'post-bevi-score']);
  });

  it('the Bevi score line is one decimal and says "1 rating" for one', async () => {
    await render(<FeedPost actor={ARJUN} bev={{ ...BEV, bayesScore: 7, ratingCount: 1 }} score={7} />);
    expect(screen.getByText('7.0 on Bevi · 1 rating')).toBeTruthy();
  });

  it('no Bayesian score: no Bevi score line', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} note="oat milk, half sweet" />);
    expect(screen.queryByTestId('post-bevi-score')).toBeNull();
    expect(screen.queryByText(/on Bevi/)).toBeNull();
    expect(within(screen.getByTestId('post-side')).getByText('oat milk, half sweet')).toBeTruthy();
  });

  it('no note: the column holds only the Bevi score line', async () => {
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={9.5} />);
    const side = screen.getByTestId('post-side');
    expect(within(side).getByText('8.4 on Bevi · 41 ratings')).toBeTruthy();
    expect(screen.queryByTestId('post-note')).toBeNull();
  });

  it('no note and no Bayesian score: the picture stands alone, with no empty column', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} />);
    expect(screen.getByRole('button', { name: 'Open Horchata' })).toBeTruthy();
    expect(screen.queryByTestId('post-side')).toBeNull();
  });

  it('a one-word note shows whole, with no "See more"', async () => {
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={9.5} note="perfect" />);
    expect(within(screen.getByTestId('post-side')).getByText('perfect')).toBeTruthy();
    expect(screen.queryByText(/See more/)).toBeNull();
  });

  it('a 300-character note collapses to about four lines with "See more", and expands on press', async () => {
    const note = `${'a'.repeat(4)} ${'word '.repeat(58)}the end`;
    expect(note.length).toBeGreaterThanOrEqual(300);
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={7} note={note} />);
    const more = screen.getByRole('button', { name: /See more$/ });
    // About four `bodyLarge` lines in the column beside the picture.
    expect((more.props.accessibilityLabel as string).length).toBeLessThan(96);
    expect(flat(more.props.style).minHeight).toBe(44);
    expect(screen.queryByText(/the end/)).toBeNull();
    await fireEvent.press(more);
    expect(within(screen.getByTestId('post-side')).getByText(note)).toBeTruthy();
    expect(screen.queryByText(/See more/)).toBeNull();
    // The Bevi score line stays at the bottom of the column.
    expect(docOrder(['post-note', 'post-bevi-score'])).toEqual(['post-note', 'post-bevi-score']);
  });

  it('a note that fits under a strip still collapses beside the picture', async () => {
    const note = 'oat milk, half sweet, and somehow the best thing on the menu at nine in the morning before class';
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={7} note={note} />);
    expect(screen.getByRole('button', { name: /See more$/ })).toBeTruthy();
    await rerender(<FeedPost actor={ARJUN} bev={BEV} score={7} note={note} photos={PHOTOS} />);
    expect(screen.getByText(note)).toBeTruthy();
    expect(screen.queryByText(/See more/)).toBeNull();
  });
});

describe('the body with people’s photos', () => {
  it('the scrolling strip, each tile opening the Bev, the note under it and no Bevi score line', async () => {
    const onOpen = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={9.5} note="oat milk, half sweet" photos={PHOTOS} onOpen={onOpen} />);
    const strip = screen.getByTestId('feed-post-strip');
    const tiles = within(strip).getAllByRole('button', { name: 'Open Horchata' });
    expect(tiles).toHaveLength(2);
    await fireEvent.press(tiles[1]!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('post-side')).toBeNull();
    expect(within(strip).queryByText('oat milk, half sweet')).toBeNull();
    expect(docOrder(['feed-post-strip', 'post-note'])).toEqual(['feed-post-strip', 'post-note']);
    expect(screen.queryByText(/on Bevi/)).toBeNull();
  });

  it('a long note under the strip truncates at the full width and expands on press', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} note={LONG_NOTE} photos={PHOTOS} />);
    expect(screen.queryByText(/the end/)).toBeNull();
    const more = screen.getByRole('button', { name: /See more$/ });
    expect((more.props.accessibilityLabel as string).length).toBeGreaterThan(140);
    expect(more.props.accessibilityLabel).not.toMatch(/^Notes:/);
    await fireEvent.press(more);
    expect(screen.getByText(/the end/)).toBeTruthy();
  });

  it('an empty list draws neither the strip nor the picture; the note sits under the head', async () => {
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={7} note="oat milk" photos={[]} />);
    expect(screen.queryByRole('button', { name: 'Open Horchata' })).toBeNull();
    expect(screen.queryByTestId('feed-post-strip')).toBeNull();
    expect(screen.getByText('oat milk')).toBeTruthy();
  });
});

describe("Bev'd it too", () => {
  it.each([
    ['one person', [ARJUN], undefined, "Arjun Bev'd it too"],
    ['two people', [ARJUN, PRIYA], undefined, "Arjun and Priya Bev'd it too"],
    ['two people of five', [ARJUN, PRIYA, SAM], 5, "Arjun, Priya and 3 others Bev'd it too"],
    ['two people of three', [ARJUN, PRIYA, SAM], 3, "Arjun, Priya and 1 other Bev'd it too"],
    ['a count under the list', [ARJUN, PRIYA], 1, "Arjun and Priya Bev'd it too"],
  ])('%s', async (_, people, count, line) => {
    await render(<FeedPost actor={SAM} bev={BEV} score={7} alsoBevdBy={people} alsoBevdCount={count} />);
    const also = within(screen.getByTestId('post-also'));
    expect(also.getByText(line)).toBeTruthy();
    expect(also.getByText('Arjun').props.style).toMatchObject({ fontWeight: '700' });
    // A 24pt AvatarStack of the named people, at most two, hidden from a screen reader (the names are in the line).
    const avatars = people.slice(0, 2).map((p) => also.getAllByLabelText(p.displayName, hidden).at(-1)!);
    avatars.forEach((a) => expect(flat(a.props.style)).toMatchObject({ width: 24, height: 24 }));
    if (people[2]) expect(also.queryByLabelText(people[2].displayName, hidden)).toBeNull();
    expect(also.queryByText(/^\+/, hidden)).toBeNull();
    expect(also.queryByLabelText(/Arjun Cheema/)).toBeNull();
  });

  it('sits under the body and above the foot', async () => {
    await render(<FeedPost actor={SAM} bev={BEV} score={7} alsoBevdBy={[ARJUN]} onLike={() => {}} />);
    expect(docOrder(['post-body', 'post-also', 'post-foot'])).toEqual(['post-body', 'post-also', 'post-foot']);
  });

  it.each([
    ['absent', undefined],
    ['empty', []],
  ])('nothing when the list is %s', async (_, people) => {
    await render(<FeedPost actor={SAM} bev={BEV} score={7} alsoBevdBy={people} alsoBevdCount={4} />);
    expect(screen.queryByTestId('post-also')).toBeNull();
    expect(screen.queryByText(/Bev'd it too/)).toBeNull();
  });
});

describe('the foot', () => {
  it('heart and comment on the left, Rank it and Want to Try on the right, and no time', async () => {
    await render(
      <FeedPost
        actor={ARJUN}
        bev={BEV}
        score={7}
        time={FIVE_HOURS_AGO()}
        likeCount={2}
        commentCount={1}
        onLike={() => {}}
        onComment={() => {}}
        onRank={() => {}}
        onSave={() => {}}
      />,
    );
    const foot = within(screen.getByTestId('post-foot'));
    const social = within(screen.getByTestId('post-social'));
    expect(social.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Like, 2 likes', 'Comment, 1 comment']);
    expect(social.queryByLabelText('Rank Horchata')).toBeNull();
    expect(foot.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'Like, 2 likes',
      'Comment, 1 comment',
      'Rank Horchata',
      'Save to Want to Try',
    ]);
    expect(foot.queryByText(/ago/)).toBeNull();
    expect(screen.getByText(WHEN)).toBeTruthy();
  });

  it('every control has a 44pt target', async () => {
    await render(
      <FeedPost actor={ARJUN} bev={BEV} score={7} onLike={() => {}} onComment={() => {}} onRank={() => {}} onSave={() => {}} />,
    );
    for (const b of within(screen.getByTestId('post-foot')).getAllByRole('button')) {
      const s = flat(b.props.style);
      expect(Math.min(s.minWidth ?? s.width ?? 0, s.minHeight ?? s.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });

  it('fires onRank and onSave; a saved Bev reads Saved', async () => {
    const onRank = jest.fn();
    const onSave = jest.fn();
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onRank={onRank} onSave={onSave} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Rank Horchata' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save to Want to Try' }));
    expect(onRank).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    await rerender(<FeedPost actor={ARJUN} bev={BEV} score={7} saved onRank={onRank} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Saved to Want to Try' })).toBeTruthy();
  });

  it('without onRank (alcohol under 21) only Want to Try is on the right', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onLike={() => {}} onSave={() => {}} />);
    expect(screen.queryByLabelText('Rank Horchata')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save to Want to Try' })).toBeTruthy();
  });
});

describe('likes', () => {
  it('the heart leads the foot, then Rank and Want to Try', async () => {
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

  it('a double-tap outside the picture likes once and bursts over the picture; a single tap does nothing', async () => {
    const onLike = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={SCORED} score={7} time={FIVE_HOURS_AGO()} note="perfect" onLike={onLike} />);
    await fireEvent.press(screen.getByText(WHEN));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
    await fireEvent.press(screen.getByText(WHEN));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('post-body')).getByTestId('like-burst', hidden)).toBeTruthy();
    // On the sentence, the note and the Bevi score line too: anywhere on the post outside the picture.
    await doubleTap(screen.getByText('Horchata'));
    await doubleTap(screen.getByText('perfect'));
    await doubleTap(screen.getByText('8.4 on Bevi · 41 ratings'));
    expect(onLike).toHaveBeenCalledTimes(4);
  });

  it("double-tapping the Bev'd it too line likes too", async () => {
    const onLike = jest.fn();
    await render(<FeedPost actor={SAM} bev={BEV} score={7} alsoBevdBy={[ARJUN]} onLike={onLike} />);
    await doubleTap(screen.getByText("Arjun Bev'd it too"));
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('two taps further apart than the double-tap window do not like', async () => {
    const onLike = jest.fn();
    const now = jest.spyOn(Date, 'now');
    try {
      await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={FIVE_HOURS_AGO()} onLike={onLike} />);
      now.mockReturnValue(1_000_000);
      await fireEvent.press(screen.getByText(WHEN));
      now.mockReturnValue(1_000_000 + DOUBLE_TAP_MS + 1);
      await fireEvent.press(screen.getByText(WHEN));
      expect(onLike).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('a double-tap on the picture never likes; a single tap there still opens the Bev', async () => {
    const onLike = jest.fn();
    const onOpen = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onLike={onLike} onOpen={onOpen} />);
    await doubleTap(screen.getByRole('button', { name: 'Open Horchata' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
  });

  it('a double-tap on the photo strip never likes; the burst plays over the strip', async () => {
    const onLike = jest.fn();
    const onOpen = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={FIVE_HOURS_AGO()} photos={PHOTOS} onLike={onLike} onOpen={onOpen} />);
    await doubleTap(screen.getAllByRole('button', { name: 'Open Horchata' })[0]!);
    expect(onOpen).toHaveBeenCalledTimes(2);
    // Between and around the tiles, the strip swallows taps.
    await doubleTap(screen.getByTestId('feed-post-strip'));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
    await doubleTap(screen.getByText(WHEN));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('feed-post-strip')).queryByTestId('like-burst', hidden)).toBeNull();
  });

  it("double-tapping an already-liked post bursts but doesn't call onLike (it never unlikes)", async () => {
    const onLike = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={FIVE_HOURS_AGO()} liked likeCount={3} onLike={onLike} />);
    await doubleTap(screen.getByText(WHEN));
    expect(onLike).not.toHaveBeenCalled();
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
  });

  it('buttons and "See more" keep their single tap inside a double-tappable post', async () => {
    const onLike = jest.fn();
    const onRank = jest.fn();
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} note={LONG_NOTE} onLike={onLike} onRank={onRank} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Rank Horchata' }));
    expect(onRank).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: /See more$/ }));
    expect(screen.getByText(/the end/)).toBeTruthy();
    expect(onLike).not.toHaveBeenCalled();
  });

  it('with no photo the burst plays over the post', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={FIVE_HOURS_AGO()} photos={[]} onLike={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open Horchata' })).toBeNull();
    await doubleTap(screen.getByText(WHEN));
    expect(screen.getByTestId('like-burst', hidden)).toBeTruthy();
  });

  it('without onLike a double-tap does nothing', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} time={FIVE_HOURS_AGO()} />);
    await doubleTap(screen.getByText(WHEN));
    expect(screen.queryByTestId('like-burst', hidden)).toBeNull();
  });
});

describe('comments', () => {
  const person = (handle: string): Profile => ({
    id: `user-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    timezone: 'America/New_York',
    createdAt: FIVE_HOURS_AGO(),
    birthdate: null,
    canSeeAlcohol: false,
    onboarded: true,
  });
  const thread = (n: number): Comment[] =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, author: person(`user${i + 1}`), body: `comment ${i + 1}`, createdAt: FIVE_HOURS_AGO() }));

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

  it('0 comments: a bare bubble, nothing under the foot', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={7} onComment={() => {}} />);
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
    expect(screen.queryByTestId('feed-post-comments')).toBeNull();
    expect(screen.queryByText(/^View all/)).toBeNull();
  });

  it.each([3, 7])('%i comments: every one inline as "handle text", oldest first, under the foot', async (n) => {
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
    // Under the foot: the list renders after the foot.
    expect(docOrder(['post-foot', 'feed-post-comments'])).toEqual(['post-foot', 'feed-post-comments']);
  });

  it("each inline comment draws its author's avatar: the photo when they have one, else initials", async () => {
    const withPhoto = { ...person('sam'), displayName: 'Sam Okafor', avatarUrl: 'https://example.com/sam.png' };
    const comments: Comment[] = [
      { id: 'c1', author: withPhoto, body: 'love it', createdAt: FIVE_HOURS_AGO() },
      { id: 'c2', author: person('jo'), body: 'same', createdAt: FIVE_HOURS_AGO() },
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
    expect(flat(all.props.style).minHeight).toBe(44);
    await fireEvent.press(all);
    await fireEvent.press(screen.getByRole('button', { name: 'Comment, 8 comments' }));
    expect(onComment).toHaveBeenCalledTimes(2);
  });

  it('double-tap still likes on the post and on inline comments, never through the comment targets', async () => {
    const onLike = jest.fn();
    const onComment = jest.fn();
    const time = FIVE_HOURS_AGO();
    const { rerender } = await render(
      <FeedPost actor={ARJUN} bev={BEV} score={7} time={time} commentCount={3} comments={thread(3)} onLike={onLike} onComment={onComment} />,
    );
    await doubleTap(screen.getByText(WHEN));
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

describe('the plain post and the Follow pill (Explore)', () => {
  it('with no handlers: no heart, comment bubble, Rank it, Want to Try, pill or foot', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} likeCount={3} commentCount={2} />);
    expect(screen.queryByRole('button', { name: /^(Like|Unlike)/ })).toBeNull();
    expect(screen.queryByLabelText(/comment/i)).toBeNull();
    expect(screen.queryByLabelText('Rank Horchata')).toBeNull();
    expect(screen.queryByLabelText(/to Want to Try$/)).toBeNull();
    expect(screen.queryByText('Follow')).toBeNull();
    expect(screen.queryByTestId('post-foot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Horchata' })).toBeTruthy();
  });

  it("onFollow draws the author's Follow pill first on the left; following turns it to Following", async () => {
    const onFollow = jest.fn();
    const { rerender } = await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} onFollow={onFollow} />);
    const pill = within(screen.getByTestId('post-social')).getByRole('button', { name: 'Follow Arjun Cheema' });
    expect(pill.props['aria-pressed']).toBe(false);
    expect(within(pill).getByText('Follow')).toBeTruthy();
    // A leading pill has no side padding, so the group isn't pulled back past the gutter.
    expect(flat(screen.getByTestId('post-social').props.style).marginLeft).toBeUndefined();
    await fireEvent.press(pill);
    expect(onFollow).toHaveBeenCalledTimes(1);

    await rerender(<FeedPost actor={ARJUN} bev={BEV} score={9.5} following onFollow={onFollow} />);
    const following = screen.getByRole('button', { name: 'Follow Arjun Cheema' });
    expect(following.props['aria-pressed']).toBe(true);
    expect(within(following).getByText('Following')).toBeTruthy();
  });

  it('with the heart first, the left group pulls its padding back to the gutter', async () => {
    await render(<FeedPost actor={ARJUN} bev={BEV} score={9.5} onLike={() => {}} />);
    expect(flat(screen.getByTestId('post-social').props.style).marginLeft).toBe(-8);
  });
});
