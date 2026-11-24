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
