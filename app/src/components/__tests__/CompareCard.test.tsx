import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CompareCard } from '../CompareCard';

const BEV: BevSummary = {
  id: 'b7',
  name: 'Mexican Coke',
  brand: 'Coca-Cola',
  flavor: null,
  categoryId: 'soda',
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: false,
  ratingCount: 0,
  bayesScore: null,
};

it('labels the incumbent with its rank and reports selection', async () => {
  const onPress = jest.fn();
  await render(<CompareCard bev={BEV} rankLabel="#3 in Loved" selected onPress={onPress} />);
  const card = screen.getByRole('button', { name: 'Mexican Coke, currently #3 in Loved' });
  expect(card.props['aria-pressed']).toBe(true);
  expect(screen.getByText('#3 in Loved')).toBeTruthy();
  expect(screen.getByText('Coca-Cola')).toBeTruthy();
  await fireEvent.press(card);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('tags the candidate as New', async () => {
  await render(<CompareCard bev={BEV} isNew />);
  expect(screen.getByRole('button', { name: 'Mexican Coke, candidate' }).props['aria-pressed']).toBe(false);
  expect(screen.getByText('New')).toBeTruthy();
});
