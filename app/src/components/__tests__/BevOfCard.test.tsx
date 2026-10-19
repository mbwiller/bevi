import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { BevOfCard, bevOfCardLabel } from '../BevOfCard';

const HORCHATA: BevSummary = {
  id: 'b1',
  name: 'Horchata',
  brand: 'Tacos El Gordo',
  flavor: null,
  categoryId: 'other',
  photoUrl: null,
  photoStatus: 'ready',
  priceTier: 2,
  priceEstimated: true,
  ratingCount: 1,
  bayesScore: 8.9,
};

it('is one button named for the period, the Bev and its score, and opens on press', async () => {
  const onPress = jest.fn();
  await render(<BevOfCard period="day" bev={HORCHATA} score={8.9} onPress={onPress} />);
  expect(screen.getByText('Bev of the day')).toBeTruthy();
  expect(screen.getByText('Horchata')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Bev of the day: Horchata, 8.9' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('shows the date only for an earlier period, and says it too', async () => {
  await render(<BevOfCard period="week" bev={HORCHATA} score={8.9} date="Week of Oct 12" />);
  expect(screen.getByText('Bev of the week')).toBeTruthy();
  expect(screen.getByText('Week of Oct 12')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Bev of the week: Horchata, 8.9, Week of Oct 12' })).toBeTruthy();
});

it('prints no price and no date for the current period', async () => {
  await render(<BevOfCard period="day" bev={HORCHATA} score={8.9} />);
  expect(screen.queryByText(/\$/)).toBeNull();
  expect(screen.queryByText(/Oct|Week of/)).toBeNull();
});

it('leaves the score out of the name when there is none', () => {
  expect(bevOfCardLabel('day', 'Horchata', null)).toBe('Bev of the day: Horchata');
});
