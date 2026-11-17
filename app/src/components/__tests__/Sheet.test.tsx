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

it('stops a 90% sheet below the top safe-area inset', async () => {
  const { Dimensions, StyleSheet } = require('react-native');
  const { SafeAreaProvider } = require('react-native-safe-area-context');
  const { width, height } = Dimensions.get('window');
  // An inset larger than the 10% a 90% sheet leaves above it (status bar + iOS's blur band).
  const top = Math.ceil(height * 0.1) + 20;
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top, left: 0, right: 0, bottom: 0 } }}>
      <Sheet open snap={90} title="Re-rank">
        <Text>Body</Text>
      </Sheet>
    </SafeAreaProvider>,
  );
  expect(StyleSheet.flatten(screen.getByTestId('sheet').props.style).height).toBe(height - top);
});

describe('on a wide viewport', () => {
  const { Dimensions, StyleSheet } = require('react-native');
  const frame = () => StyleSheet.flatten(screen.getByTestId('sheet-frame', { includeHiddenElements: true }).props.style);
  let saved: { window: object; screen: object };

  beforeEach(() => {
    saved = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  });
  afterEach(() => act(() => Dimensions.set(saved)));

  const resize = (width: number, height: number) =>
    act(() => Dimensions.set({ window: { width, height, scale: 2, fontScale: 1 }, screen: { width, height, scale: 2, fontScale: 1 } }));

  it('keeps the sheet and its scrim inside the centred 480pt column', async () => {
    await resize(1440, 900);
    await render(
      <Sheet open title="Sort by">
        <Text>Score</Text>
      </Sheet>,
    );
    expect(frame()).toMatchObject({ width: '100%', maxWidth: 480, alignSelf: 'center' });
    // The scrim and the panel are both inside that frame, so neither reaches past the column.
    const inFrame = (id: string) => {
      let node = screen.getByTestId(id, { includeHiddenElements: true }) as unknown as { parent: unknown; props: { testID?: string } } | null;
      while (node && node.props.testID !== 'sheet-frame') node = node.parent as typeof node;
      return !!node;
    };
    expect(inFrame('sheet-scrim')).toBe(true);
    expect(inFrame('sheet')).toBe(true);
  });

  it('still sizes its height by the window', async () => {
    await resize(1440, 900);
    await render(
      <Sheet open snap={40} title="Sort by">
        <Text>Score</Text>
      </Sheet>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('sheet').props.style).height).toBeCloseTo(900 * 0.4);
  });

  it.each([
    [393, 852],
    [320, 568],
    [852, 393],
  ])('leaves a %ix%i phone exactly as before', async (width, height) => {
    await resize(width, height);
    await render(
      <Sheet open title="Sort by">
        <Text>Score</Text>
      </Sheet>,
    );
    expect(frame().maxWidth).toBeUndefined();
    expect(frame().alignSelf).toBeUndefined();
    expect(frame().width).toBeUndefined();
  });
});
