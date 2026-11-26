import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { renderRouter, screen as routerScreen } from 'expo-router/testing-library';
import { Dimensions, StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import ImageScreen from '@/app/image/[url]';
import { radius, spacing } from '@/theme';

import { ImageViewer } from '../ImageViewer';
import * as imageOrigin from '../imageOrigin';
import { openingFrom, takeImageOrigin, windowRect } from '../imageOrigin';

const URL = 'https://example.test/photo.jpg';
const { width: WIDTH, height: HEIGHT } = Dimensions.get('window');

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

describe('a profile photo, round (T-29)', () => {
  it('is drawn as a circle that fills the screen across, cropped to fit', async () => {
    await render(<ImageViewer url={URL} onClose={jest.fn()} round />);
    const photo = screen.getByLabelText('Profile photo');
    expect(photo.props.contentFit ?? photo.props.resizeMode).toBe('cover');
    expect(screen.queryByLabelText('Full-screen image')).toBeNull();
    const frame = StyleSheet.flatten(screen.getByTestId('image-viewer-picture').props.style);
    // No body frame can be read in jest: the diameter is the window's smaller side, inside the body's padding.
    const side = Math.min(WIDTH, HEIGHT) - 2 * spacing.gutter;
    expect(frame).toMatchObject({ width: side, height: side, borderRadius: radius.pill, overflow: 'hidden', alignSelf: 'center' });
  });

  it('takes its diameter from the measured body: the smaller side, inside the padding', async () => {
    const spy = jest.spyOn(imageOrigin, 'windowRect').mockReturnValue({ x: 0, y: 100, width: 390, height: 600 });
    await render(<ImageViewer url={URL} onClose={jest.fn()} round />);
    const frame = StyleSheet.flatten(screen.getByTestId('image-viewer-picture').props.style);
    expect(frame).toMatchObject({ width: 390 - 2 * spacing.gutter, height: 390 - 2 * spacing.gutter });
    spy.mockRestore();
  });

  it('without round, the picture is the rectangle, fitted whole, as before', async () => {
    await render(<ImageViewer url={URL} onClose={jest.fn()} />);
    expect(screen.getByLabelText('Full-screen image').props.contentFit ?? screen.getByLabelText('Full-screen image').props.resizeMode).toBe('contain');
    expect(screen.queryByLabelText('Profile photo')).toBeNull();
    const frame = StyleSheet.flatten(screen.getByTestId('image-viewer-picture').props.style);
    expect(frame.borderRadius).toBeUndefined();
    expect(frame.flex).toBe(1);
  });

  it('closes once with the Close button', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} round />);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once with a swipe down, and springs back from a small one', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer url={URL} onClose={onClose} round />);
    await swipe(40);
    expect(onClose).not.toHaveBeenCalled();
    await swipe(HEIGHT * 0.3);
    await swipe(HEIGHT * 0.3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still says so when there is no picture to show', async () => {
    await render(<ImageViewer url={null} onClose={jest.fn()} round />);
    expect(screen.getByText('Image not available')).toBeTruthy();
  });
});

describe('the route\'s shape', () => {
  const open = (query: string) =>
    renderRouter({ 'image/[url]': ImageScreen }, { initialUrl: `/image/${encodeURIComponent(URL)}${query}` });

  it('shape=circle opens the round viewer', async () => {
    await open('?shape=circle');
    expect(await routerScreen.findByLabelText('Profile photo')).toBeTruthy();
    expect(routerScreen.queryByLabelText('Full-screen image')).toBeNull();
  });

  it.each(['', '?shape=square', '?shape=Circle'])('%p opens the rectangle', async (query) => {
    await open(query);
    expect(await routerScreen.findByLabelText('Full-screen image')).toBeTruthy();
    expect(routerScreen.queryByLabelText('Profile photo')).toBeNull();
  });
});
