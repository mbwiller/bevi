import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Platform, Text } from 'react-native';

import { grabModalDismiss } from '@/testing/modalDismiss';

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

describe('onClosed', () => {
  function Closing({ onClosed }: { onClosed: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <Sheet open={open} title="Done?" onClose={() => setOpen(false)} onClosed={onClosed}>
        <Text>Body</Text>
      </Sheet>
    );
  }
  const closeIt = () => fireEvent.press(screen.getByTestId('sheet-scrim', { includeHiddenElements: true }));

  it('iOS: waits for the Modal to report it is dismissed, not just for the exit animation', async () => {
    const onClosed = jest.fn();
    await render(<Closing onClosed={onClosed} />);
    const dismiss = grabModalDismiss();
    await closeIt();
    expect(onClosed).not.toHaveBeenCalled();
    await settle();
    expect(screen.queryByText('Body')).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    await act(() => dismiss());
    expect(onClosed).toHaveBeenCalledTimes(1);
    // Once per close, however often it is told.
    await act(() => dismiss());
    await act(() => jest.advanceTimersByTime(5000));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('iOS: still fires if the Modal never reports it, so nothing waiting on it is stranded', async () => {
    const onClosed = jest.fn();
    await render(<Closing onClosed={onClosed} />);
    await closeIt();
    await settle();
    expect(onClosed).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1000));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('web (no onDismiss there): fires as soon as the Sheet has unmounted its Modal', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onClosed = jest.fn();
    await render(<Closing onClosed={onClosed} />);
    await closeIt();
    expect(onClosed).not.toHaveBeenCalled();
    await settle();
    expect(screen.queryByText('Body')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('does not fire for a sheet that was never opened', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const onClosed = jest.fn();
    await render(<Sheet open={false} onClosed={onClosed} />);
    await settle();
    expect(onClosed).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe('dragging the top down', () => {
  const { fireGestureHandler, getByGestureTestId } = require('react-native-gesture-handler/jest-utils');
  const { State } = require('react-native-gesture-handler');
  // The pan takes hold once the finger has moved past the slop (6pt), as on a device.
  const drag = (translationY: number, velocityY = 0) =>
    fireGestureHandler(getByGestureTestId('sheet-grab'), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 6, velocityY },
      { state: State.ACTIVE, translationY, velocityY },
      { state: State.END, translationY, velocityY },
    ]);

  it('closes the sheet once let go far enough down, however slowly', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a quick flick, however short', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(30, 1500));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes back when let go, slowly, less than a third of the way down', async () => {
    const { Dimensions } = require('react-native');
    const sheetHeight = Dimensions.get('window').height * 0.4;
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(sheetHeight * 0.3));
    expect(onClose).not.toHaveBeenCalled();
    await act(() => drag(sheetHeight * 0.4));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('judges a release by where it was heading: the same short drag closes at a walking pace', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    // 30pt down and still: back. 30pt down at 400pt/s would have coasted another 200pt: closed.
    await act(() => drag(30, 0));
    expect(onClose).not.toHaveBeenCalled();
    await act(() => drag(30, 400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back after a short, slow drag', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(30));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a long drag ends in a flick back up', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(400, -1500));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks to close once, and comes back if the parent keeps it open', async () => {
    // A parent that ignores onClose: the sheet has already left for the bottom edge, so it is
    // brought back rather than left off the screen, still open, with nothing to drag.
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(400, 1500));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('Body')).toBeTruthy();
    // And it can be flung again.
    await act(() => drag(400, 1500));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a parent that closes a moment later still gets the flung exit, not a second one', async () => {
    const onClose = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>
    );
    const view = await render(sheet(true));
    await act(() => drag(400, 1500));
    // The parent answers after a few frames (a navigation, a mutation), inside the grace period.
    await act(() => jest.advanceTimersByTime(100));
    await view.rerender(sheet(false));
    expect(screen.getByText('Body')).toBeTruthy();
    await settle();
    expect(screen.queryByText('Body')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never closes on a cancelled drag', async () => {
    const onClose = jest.fn();
    await render(
      <Sheet open title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() =>
      fireGestureHandler(getByGestureTestId('sheet-grab'), [
        { state: State.BEGAN, translationY: 0 },
        { state: State.ACTIVE, translationY: 400 },
        { state: State.CANCELLED, translationY: 400 },
      ]),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be dragged again while it is closing', async () => {
    const onClose = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} title="Comments" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>
    );
    const view = await render(sheet(true));
    await view.rerender(sheet(false));
    // Still mounted for its exit: the grab area is there, and no longer takes a drag.
    expect(screen.getByText('Body')).toBeTruthy();
    await act(() => drag(400));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays on screen when the parent keeps it open', async () => {
    await render(
      <Sheet open title="Comments" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    await act(() => drag(400));
    await settle();
    expect(screen.getByText('Body')).toBeTruthy();
  });
});
