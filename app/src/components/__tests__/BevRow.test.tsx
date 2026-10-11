import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MAX_FONT_SCALE_DENSE } from '@/theme';

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

it('renders the name, price, category, brand, meta and score', async () => {
  await render(<BevRow bev={BEV} number={1} score={9.3} meta="Ranked Oct 3" />);
  expect(screen.getByText('1. Diet Coke')).toBeTruthy();
  expect(screen.getByText('~$$')).toBeTruthy();
  expect(screen.getByText(/Diet soda/)).toBeTruthy();
  // "Original" is dropped from the brand line.
  expect(screen.getByText(' • Coca-Cola')).toBeTruthy();
  expect(screen.getByText('Ranked Oct 3')).toBeTruthy();
  expect(screen.getByLabelText('Score 9.3')).toBeTruthy();
  expect(screen.getByText('1. Diet Coke').props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE_DENSE);
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
  expect(screen.getByLabelText('Predicted score 8.2, 58 ratings')).toBeTruthy();
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
