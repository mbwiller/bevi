import { act, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { Text } from 'react-native';

import { SwipeTabs } from '../SwipeTabs';

const TABS = ['a', 'b', 'c'] as const;
type Id = (typeof TABS)[number];

function Harness({ start = 'a' as Id }) {
  const [tab, setTab] = useState<Id>(start);
  return (
    <SwipeTabs tabs={TABS} value={tab} onChange={setTab}>
      <Text>{`tab ${tab}`}</Text>
    </SwipeTabs>
  );
}

const swipe = (translationX: number, velocityX = 0) =>
  fireGestureHandler(getByGestureTestId('swipe-tabs'), [
    { state: State.BEGAN, translationX: 0 },
    { state: State.ACTIVE, translationX, velocityX },
    { state: State.END, translationX, velocityX },
  ]);

it('a swipe left goes to the next tab, a swipe right back', async () => {
  await render(<Harness />);
  await act(() => swipe(-120));
  expect(screen.getByText('tab b')).toBeTruthy();
  await act(() => swipe(120));
  expect(screen.getByText('tab a')).toBeTruthy();
});

it('stays put past either end and on a short drag', async () => {
  await render(<Harness />);
  await act(() => swipe(120));
  expect(screen.getByText('tab a')).toBeTruthy();
  await act(() => swipe(-20));
  expect(screen.getByText('tab a')).toBeTruthy();
});

it('a quick flick is enough', async () => {
  await render(<Harness start="b" />);
  await act(() => swipe(-30, -900));
  expect(screen.getByText('tab c')).toBeTruthy();
});

it('a cancelled swipe never changes tab', async () => {
  await render(<Harness />);
  await act(() =>
    fireGestureHandler(getByGestureTestId('swipe-tabs'), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: -120 },
      { state: State.CANCELLED, translationX: -120 },
    ]),
  );
  expect(screen.getByText('tab a')).toBeTruthy();
});
