import type { Venue, VenueMatch } from '@bevi/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ADD_LOCATION } from '../copy';
import { LocationRow } from '../LocationRow';

const VENUE: Venue = {
  id: 'v1',
  name: 'Duane Reade',
  kind: 'chain',
  placeType: 'store',
  lat: 40.7616,
  lng: -73.9497,
  address: '425 Main Street',
  neighborhood: 'Roosevelt Island',
  borough: 'Manhattan',
  hoursOsm: null,
  hoursKnown: false,
  website: null,
};
const NEARBY: VenueMatch = { venue: VENUE, distanceMeters: 46 };

it('with nothing chosen and nothing nearby it is "Add location", which opens the picker', async () => {
  const onPick = jest.fn();
  await render(<LocationRow venue={null} onPick={onPick} />);
  await fireEvent.press(screen.getByRole('button', { name: ADD_LOCATION }));
  expect(onPick).toHaveBeenCalledTimes(1);
});

it('a nearby venue is offered: one tap takes it, "Other" opens the picker', async () => {
  const onPick = jest.fn();
  const onAccept = jest.fn();
  await render(<LocationRow venue={null} suggestion={NEARBY} onPick={onPick} onAccept={onAccept} />);

  expect(screen.getByText('At Duane Reade?')).toBeTruthy();
  expect(screen.getByText('150 ft away · Tap to add')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add location: Duane Reade' }));
  expect(onAccept).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Choose another place' }));
  expect(onPick).toHaveBeenCalledTimes(1);
});

it('a suggestion with no way to take it is not offered', async () => {
  await render(<LocationRow venue={null} suggestion={NEARBY} onPick={jest.fn()} />);
  expect(screen.queryByText('At Duane Reade?')).toBeNull();
  expect(screen.getByText(ADD_LOCATION)).toBeTruthy();
});

it('a chosen place shows its name and address, and wins over a suggestion', async () => {
  const onPick = jest.fn();
  await render(<LocationRow venue={VENUE} suggestion={NEARBY} onPick={onPick} onAccept={jest.fn()} />);
  expect(screen.getByText('Duane Reade')).toBeTruthy();
  expect(screen.getByText('425 Main Street')).toBeTruthy();
  expect(screen.queryByText('At Duane Reade?')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Location: Duane Reade. Change' }));
  expect(onPick).toHaveBeenCalledTimes(1);
});

it('takes no press while the step is saving', async () => {
  const onPick = jest.fn();
  await render(<LocationRow venue={null} onPick={onPick} disabled />);
  await fireEvent.press(screen.getByTestId('location-row'));
  expect(onPick).not.toHaveBeenCalled();
});
