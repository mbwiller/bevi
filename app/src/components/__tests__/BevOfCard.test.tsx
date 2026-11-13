import type { BevSummary } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BevOfCard, bevOfCardLabel } from '../BevOfCard';

const HORCHATA: BevSummary = {
  id: 'b1',
  name: 'Horchata',
  brand: 'Tacos El Gordo',
  flavor: null,
  categoryId: 'other',
  photoUrl: null,
  iconUrl: null,
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

describe('period "both"', () => {
  it('is labelled "Bev of the day and week" and says so in its name, with the date when there is one', async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<BevOfCard period="both" bev={HORCHATA} score={8.9} onPress={onPress} />);
    expect(screen.getByText('Bev of the day and week')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bev of the day and week: Horchata, 8.9' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<BevOfCard period="both" bev={HORCHATA} score={8.9} date="Oct 17" />);
    expect(screen.getByText('Oct 17')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bev of the day and week: Horchata, 8.9, Oct 17' })).toBeTruthy();
  });

  it('keeps the card at one card of the pair (flex: 1) and lets the longer label run past it on one line', async () => {
    await render(<BevOfCard period="both" bev={HORCHATA} score={8.9} />);
    expect(StyleSheet.flatten(screen.getByRole('button').props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    const label = screen.getByText('Bev of the day and week');
    // No numberOfLines: on the web it caps the text at the card's width and adds an ellipsis.
    expect(label.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ flexShrink: 0 });
    expect(StyleSheet.flatten(label.parent!.props.style)).toMatchObject({ flexDirection: 'row' });
  });

  it('one period keeps its one-line, truncating label', async () => {
    await render(<BevOfCard period="week" bev={HORCHATA} score={8.9} />);
    expect(screen.getByText('Bev of the week').props.numberOfLines).toBe(1);
  });
});
