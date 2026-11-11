import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MAX_FONT_SCALE_DENSE, size, spacing } from '@/theme';

import { BevRow } from '../BevRow';

const BEV: BevSummary = {
  id: 'b1',
  name: 'Diet Coke',
  brand: 'Coca-Cola',
  flavor: 'Original',
  categoryId: 'diet_soda',
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: true,
  ratingCount: 362,
  bayesScore: 8.4,
};

it('renders the name, one category · brand line, meta and score, and no price', async () => {
  await render(<BevRow bev={BEV} number={1} score={9.3} meta="Ranked Oct 3" />);
  expect(screen.getByText('1. Diet Coke')).toBeTruthy();
  // One secondary line; "Original" is dropped from the brand part.
  expect(screen.getByText('Diet soda · Coca-Cola')).toBeTruthy();
  // D-06: the price tier is on Bev detail only, estimated or not.
  expect(screen.queryByText(/\$/)).toBeNull();
  expect(screen.getByText('Ranked Oct 3')).toBeTruthy();
  expect(screen.getByLabelText('Score 9.3')).toBeTruthy();
  expect(screen.getByText('1. Diet Coke').props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE_DENSE);
});

it('prints just the category when the Bev has no brand', async () => {
  await render(<BevRow bev={{ ...BEV, brand: null, flavor: null }} />);
  expect(screen.getByText('Diet soda')).toBeTruthy();
  expect(screen.queryByText(/·/)).toBeNull();
});

it('fires onPress, onRank and onSave, and reports saved with aria-pressed', async () => {
  const onPress = jest.fn();
  const onRank = jest.fn();
  const onSave = jest.fn();
  await render(<BevRow bev={BEV} number={1} saved onPress={onPress} onRank={onRank} onSave={onSave} />);
  await fireEvent.press(screen.getByRole('button', { name: '1. Diet Coke' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Rank Diet Coke' }));
  const save = screen.getByRole('button', { name: 'Saved to Want to Try' });
  expect(save.props['aria-pressed']).toBe(true);
  await fireEvent.press(save);
  expect([onPress, onRank, onSave].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});

it('shows a predicted or locked bubble, and no bubble without a score', async () => {
  const { rerender } = await render(<BevRow bev={BEV} score={8.2} scoreVariant="predicted" count={58} />);
  expect(screen.getByLabelText('Predicted score 8.2')).toBeTruthy();
  await rerender(<BevRow bev={BEV} score={null} scoreVariant="locked" />);
  expect(screen.getByLabelText('Score hidden')).toBeTruthy();
  await rerender(<BevRow bev={BEV} />);
  expect(screen.queryByLabelText(/Score/)).toBeNull();
});

it('shows the image (with the processing shimmer) only with showImage, and hides actions', async () => {
  const { rerender } = await render(<BevRow bev={BEV} onRank={() => {}} />);
  expect(screen.queryByTestId('shimmer', { includeHiddenElements: true })).toBeNull();
  await rerender(<BevRow bev={{ ...BEV, photoUrl: 'https://example.com/a.png', photoStatus: 'processing' }} showImage actions={false} onRank={() => {}} />);
  // The tile sits inside the row's button, so it is found as a hidden element.
  expect(screen.getByLabelText('Diet Coke (photo processing)', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('shimmer', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Rank Diet Coke' })).toBeNull();
});

it('shows the rating count in the meta line only when there is no meta', async () => {
  const { rerender } = await render(<BevRow bev={BEV} score={8.2} count={362} />);
  expect(screen.getByText('362 ratings')).toBeTruthy();
  await rerender(<BevRow bev={BEV} score={8.2} count={362} meta="Ranked Oct 3" />);
  expect(screen.getByText('Ranked Oct 3')).toBeTruthy();
  expect(screen.queryByText('362 ratings')).toBeNull();
  await rerender(<BevRow bev={BEV} score={8.2} count={362} meta="" />);
  expect(screen.getByText('362 ratings')).toBeTruthy();
  await rerender(<BevRow bev={BEV} score={8.2} count={0} />);
  expect(screen.queryByText(/ratings?$/)).toBeNull();
  await rerender(<BevRow bev={BEV} score={null} scoreVariant="locked" count={362} />);
  expect(screen.getByText('362 ratings')).toBeTruthy();
});

const footOf = () => screen.getByText('Ranked Oct 3').parent!;

it('puts the foot under the text column with an image and across the full row without one', async () => {
  const { rerender } = await render(<BevRow bev={BEV} meta="Ranked Oct 3" onRank={() => {}} />);
  const noImage = StyleSheet.flatten(footOf().props.style);
  expect(noImage.minHeight).toBe(32);
  expect(noImage.paddingLeft ?? 0).toBe(0);
  await rerender(<BevRow bev={BEV} showImage meta="Ranked Oct 3" onRank={() => {}} />);
  const withImage = StyleSheet.flatten(footOf().props.style);
  // Indented past the 56pt image and the gap, so it lines up with the name.
  expect(withImage.paddingLeft).toBe(56 + spacing.md);
});

it('keeps 44pt targets on the actions inside the 32pt foot line', async () => {
  await render(<BevRow bev={BEV} meta="Ranked Oct 3" onRank={() => {}} onSave={() => {}} />);
  for (const name of ['Rank Diet Coke', 'Save to Want to Try']) {
    const style = StyleSheet.flatten(screen.getByRole('button', { name }).props.style);
    expect(style.minWidth).toBe(size.target);
    expect(style.minHeight).toBe(size.target);
  }
  // The wrapper overhangs the foot line by 6pt top and bottom instead of using hitSlop.
  const actions = screen.getByRole('button', { name: 'Rank Diet Coke' }).parent!.parent!;
  expect(StyleSheet.flatten(actions.props.style).marginVertical).toBe(-6);
});

it('does not add a second button for the image: the name is the row button', async () => {
  await render(<BevRow bev={BEV} showImage actions={false} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
