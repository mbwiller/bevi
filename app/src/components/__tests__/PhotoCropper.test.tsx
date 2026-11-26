import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { PhotoCropper } from '../PhotoCropper';

// Shared values that survive a re-render, as on a device (the packaged mock makes new ones each render).
jest.mock('react-native-reanimated/mock', () => require('@/testing/persistentSharedValues').reanimatedMock());

// A 1600x1200 photo on a 393pt-wide phone: the stage is 393pt square, the circle 361pt (inset 16).
const W = 1600;
const H = 1200;
const SIDE = 393;
const D = SIDE - 32;

async function show(props: Partial<Parameters<typeof PhotoCropper>[0]> = {}) {
  const onDone = jest.fn();
  const onCancel = jest.fn();
  await render(<PhotoCropper src="file:///working.jpg" width={W} height={H} onDone={onDone} onCancel={onCancel} {...props} />);
  return { onDone, onCancel };
}

/** The room the stage sits in, as a phone lays it out (jest never lays anything out). */
async function measure(width = SIDE, height = 600) {
  await fireEvent(screen.getByTestId('photo-cropper-room'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}

const stage = () => screen.getByLabelText('Photo');

it('shows the title, the caption and both buttons', async () => {
  await show();
  expect(screen.getByRole('header', { name: 'Move and scale' })).toBeTruthy();
  expect(screen.getByText('Drag to move. Pinch to zoom.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use photo' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
});

it('does nothing on Use photo before the stage is measured', async () => {
  const { onDone } = await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).not.toHaveBeenCalled();
});

it('frames the centre square when nothing has moved', async () => {
  const { onDone } = await show();
  await measure();
  expect(screen.getByTestId('photo-cropper-stage')).toHaveStyle({ width: SIDE, height: SIDE });
  // Drawn at its zoom-1 size: the short side spans the circle.
  expect(screen.getByTestId('photo-cropper-photo')).toHaveStyle({ width: W * (D / H), height: D });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenCalledWith({ x: 200, y: 0, size: 1200 });
});

it('keeps the stage inside a short room, so the buttons stay on screen', async () => {
  await show();
  await measure(1200, 300);
  expect(screen.getByTestId('photo-cropper-stage')).toHaveStyle({ width: 300, height: 300 });
});

it('moves with a drag and stops at the photo’s edge', async () => {
  const { onDone } = await show();
  await measure();
  const drag = (dx: number, dy: number) =>
    act(() =>
      fireGestureHandler(getByGestureTestId('photo-cropper-pan'), [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: dx, translationY: dy },
        { state: State.END, translationX: dx, translationY: dy },
      ]),
    );
  // 30pt left is 30 / (361/1200) ≈ 100px further right in the photo; up and down it cannot move.
  await drag(-30, 50);
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 300, y: 0, size: 1200 });
  // Far to the right: it stops with the photo's left edge on the circle's.
  await drag(1000, 0);
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 0, y: 0, size: 1200 });
});

it('zooms with a pinch about the fingers, no further than 4 times', async () => {
  const { onDone } = await show();
  await measure();
  const pinch = (scale: number, focalX: number, focalY: number) =>
    act(() =>
      fireGestureHandler(getByGestureTestId('photo-cropper-pinch'), [
        { state: State.BEGAN, scale: 1, focalX, focalY },
        { state: State.ACTIVE, scale: 1, focalX, focalY },
        { state: State.ACTIVE, scale, focalX, focalY },
        { state: State.END, scale, focalX, focalY },
      ]),
    );
  // About the circle's centre: the middle 600 square.
  await pinch(2, SIDE / 2, SIDE / 2);
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 2.0 times' });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 500, y: 300, size: 600 });
  await pinch(10, SIDE / 2, SIDE / 2);
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 4.0 times' });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 650, y: 450, size: 300 });
});

it('keeps the point under an off-centre pinch where it is', async () => {
  const { onDone } = await show();
  await measure();
  // Pinch to 2 times with the fingers 60pt left of the centre: that point of the photo stays under them,
  // so the square moves left of the middle one (x 500) by 60pt / (2 * 361/1200) ≈ 100px.
  await act(() =>
    fireGestureHandler(getByGestureTestId('photo-cropper-pinch'), [
      { state: State.BEGAN, scale: 1, focalX: SIDE / 2 - 60, focalY: SIDE / 2 },
      { state: State.ACTIVE, scale: 1, focalX: SIDE / 2 - 60, focalY: SIDE / 2 },
      { state: State.ACTIVE, scale: 2, focalX: SIDE / 2 - 60, focalY: SIDE / 2 },
      { state: State.END, scale: 2, focalX: SIDE / 2 - 60, focalY: SIDE / 2 },
    ]),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 400, y: 300, size: 600 });
});

it('zooms to 2 on a double tap, and back to the start on another', async () => {
  const { onDone } = await show();
  await measure();
  const doubleTap = () =>
    act(() =>
      fireGestureHandler(getByGestureTestId('photo-cropper-double-tap'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]),
    );
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 1.0 times' });
  await doubleTap();
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 2.0 times' });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 500, y: 300, size: 600 });
  await doubleTap();
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 1.0 times' });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 200, y: 0, size: 1200 });
});

it('is one adjustable element for VoiceOver: swipes zoom and the value follows', async () => {
  const { onDone } = await show();
  await measure();
  expect(stage()).toHaveProp('accessibilityRole', 'adjustable');
  const action = (actionName: string) => fireEvent(stage(), 'accessibilityAction', { nativeEvent: { actionName } });
  await action('increment');
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 1.5 times' });
  await action('increment');
  await action('increment');
  await action('increment');
  await action('increment');
  await action('increment');
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 4.0 times' });
  await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
  expect(onDone).toHaveBeenLastCalledWith({ x: 650, y: 450, size: 300 });
  for (let i = 0; i < 8; i++) await action('decrement');
  expect(stage()).toHaveAccessibilityValue({ text: 'Zoom 1.0 times' });
});

it('Cancel calls onCancel and frames nothing', async () => {
  const { onDone, onCancel } = await show();
  await measure();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
});
