import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { ImageViewer } from '../ImageViewer';
import { openingFrom, takeImageOrigin, windowRect } from '../imageOrigin';

const URL = 'https://example.test/photo.jpg';
const HEIGHT = Dimensions.get('window').height;

// The pan takes hold once the finger has moved past its slop, as on a device.
const swipe = (translationY: number, velocityY = 0, end: typeof State.END | typeof State.CANCELLED = State.END) =>
  act(() =>
    fireGestureHandler(getByGestureTestId('image-viewer-pan'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: Math.sign(translationY) * 8, velocityX: 0, velocityY },
      { state: State.ACTIVE, translationX: 0, translationY, velocityX: 0, velocityY },
      { state: end, translationX: 0, translationY, velocityX: 0, velocityY },
    ]),
  );

it('shows the picture with a Close button that leaves', async () => {
  const onClose = jest.fn();
  await render(<ImageViewer url={URL} onClose={onClose} />);
  expect(screen.getByLabelText('Full-screen image')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('says so when there is no picture to show', async () => {
  await render(<ImageViewer url={null} onClose={jest.fn()} />);
  expect(screen.getByText('Image not available')).toBeTruthy();
});

describe('swiping down (T-26)', () => {
  it('leaves once dragged far enough down the screen', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(HEIGHT * 0.3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves on a quick flick, however short', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(30, 1500);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays for a small slow drag: it springs back', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(40);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Full-screen image')).toBeTruthy();
  });

  it('stays when a long drag ends in a flick back up (a change of mind)', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(HEIGHT * 0.3, -1500);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays when pulled up, and when the drag is cancelled', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(-HEIGHT * 0.5, -2000);
    await swipe(HEIGHT * 0.5, 0, State.CANCELLED);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves once, however many times it is asked', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await swipe(HEIGHT * 0.5, 2000);
    await swipe(HEIGHT * 0.5, 2000);
    await fireEvent.press(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the frame a picture opens from', () => {
  it('reads a view that can say where it is, and nothing else', () => {
    expect(windowRect({ getBoundingClientRect: () => ({ x: 10, y: 20, width: 155, height: 155 }) })).toEqual({ x: 10, y: 20, width: 155, height: 155 });
    expect(windowRect(null)).toBeNull();
    expect(windowRect({})).toBeNull();
    // Not laid out yet.
    expect(windowRect({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) })).toBeNull();
  });

  it('is handed to the next viewer once', () => {
    openingFrom({ getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }) });
    expect(takeImageOrigin()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(takeImageOrigin()).toBeNull();
  });

  it('is taken by a viewer as it opens, so a later one does not grow from a stale place', async () => {
    openingFrom({ getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }) });
    await render(<ImageViewer url={URL} onClose={jest.fn()} />);
    expect(takeImageOrigin()).toBeNull();
  });
});

describe('zooming, and tapping off the picture', () => {
  // The body is laid out 400×800, so the picture's box is that inside its padding.
  const layOut = () => fireEvent(screen.getByTestId('image-viewer-body'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
  // A 400×400 photo, fitted to that box: a square band across its middle.
  const load = () => fireEvent(screen.getByLabelText('Full-screen image'), 'load', { nativeEvent: { source: { width: 400, height: 400 } } });
  const tapAt = (id: string, x: number, y: number) =>
    act(() =>
      fireGestureHandler(getByGestureTestId(id), [
        { state: State.BEGAN, x, y },
        { state: State.ACTIVE, x, y },
        { state: State.END, x, y },
      ]),
    );
  const pinch = (scale: number) =>
    act(() =>
      fireGestureHandler(getByGestureTestId('image-viewer-pinch'), [
        { state: State.BEGAN, scale: 1, focalX: 200, focalY: 400 },
        { state: State.ACTIVE, scale: 1, focalX: 200, focalY: 400 },
        { state: State.ACTIVE, scale, focalX: 200, focalY: 400 },
        { state: State.END, scale, focalX: 200, focalY: 400 },
      ]),
    );

  it('closes on a tap above or below the picture', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await tapAt('image-viewer-tap', 200, 60);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays on a tap on the picture itself', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await tapAt('image-viewer-tap', 200, 400);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pinched in, the picture covers more of the screen, so a tap there no longer closes it', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await pinch(3);
    await tapAt('image-viewer-tap', 200, 60);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('zoomed, a drag down moves the picture instead of closing the viewer; fitted again, it closes', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await pinch(2);
    await swipe(HEIGHT * 0.5, 2000);
    expect(onClose).not.toHaveBeenCalled();
    // A double tap fits it again.
    await tapAt('image-viewer-double-tap', 200, 400);
    await swipe(HEIGHT * 0.5, 2000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('zoomed, a tap in the margin around the picture still closes it (the picture is clipped to its box)', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await pinch(4);
    await tapAt('image-viewer-tap', 4, 4);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pinched out past fitted, it settles back to fitted', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} />);
    await layOut();
    await load();
    await pinch(0.5);
    await tapAt('image-viewer-tap', 200, 60);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
