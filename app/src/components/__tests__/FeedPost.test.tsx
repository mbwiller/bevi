import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedPost } from '../FeedPost';

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

it('a save has no score and no photo; "You" for your own post', async () => {
  const { rerender } = await render(<FeedPost actor={ARJUN} verb="saved" bev={BEV} score={9} saved onSave={() => {}} />);
  expect(screen.getByText(' saved ')).toBeTruthy();
  expect(screen.queryByLabelText(/Score/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Horchata' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Saved to Want to Try' }).props['aria-pressed']).toBe(true);
  await rerender(<FeedPost you actor={ARJUN} bev={BEV} score={9} />);
  expect(screen.getByText('You')).toBeTruthy();
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
