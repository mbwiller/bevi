import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { Button } from '../Button';
import { Sheet } from '../Sheet';

function Harness({ snap = 40 as 40 | 90 }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Open</Button>
      <Sheet open={open} title="Sort by" snap={snap} onClose={() => setOpen(false)}>
        <Text>Score</Text>
      </Sheet>
    </>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const settle = () => act(() => jest.runAllTimers());

it('renders nothing while closed', async () => {
  await render(<Harness />);
  expect(screen.queryByText('Score')).toBeNull();
});

it('opens as a named modal dialog and closes from the scrim', async () => {
  await render(<Harness />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
  // One dialog only: the Modal wrapper carries the name; the panel just takes focus.
  expect(screen.getByLabelText('Sort by', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('sheet').props.role).toBeUndefined();
  expect(screen.getByRole('header', { name: 'Sort by' })).toBeTruthy();
  expect(screen.getByText('Score')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));
  await settle();
  expect(screen.queryByText('Score')).toBeNull();
});

it('closes on onRequestClose (Escape on the web, back elsewhere)', async () => {
  const onClose = jest.fn();
  await render(
    <Sheet open title="Filters" onClose={onClose}>
      <Text>Body</Text>
    </Sheet>,
  );
  await fireEvent(screen.getByTestId('sheet'), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('sizes to the snap point as a share of the window', async () => {
  const { Dimensions, StyleSheet } = require('react-native');
  const h = Dimensions.get('window').height;
  await render(
    <Sheet open snap={90} title="Re-rank">
      <Text>Body</Text>
    </Sheet>,
  );
  expect(StyleSheet.flatten(screen.getByTestId('sheet').props.style).height).toBeCloseTo(h * 0.9);
});
