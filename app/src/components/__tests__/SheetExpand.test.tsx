import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { SharedValue } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { spacing } from '@/theme';

import { Sheet } from '../Sheet';

// Reanimated's jest mock hands out a new shared value on every render, so nothing a gesture wrote
// would outlive the render it caused. Where the sheet rests is exactly that, so here a shared value
// lasts as long as its component, as the real one does.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return { ...require('react-native-reanimated/mock'), useSharedValue: (init: unknown) => React.useRef({ value: init }).current };
});

const still = { value: 0 } as SharedValue<number>;

// Jest resolves as iOS. The keyboard hook is mocked: its own plumbing is covered by its tests.
let mockKeyboard = 0;
jest.mock('@/lib/useKeyboardInset', () => ({ useKeyboardInset: () => mockKeyboard }));

const { width, height } = Dimensions.get('window');
const TOP = 59;
const HOME_INDICATOR = 34;
/** The whole screen below the status bar, and how far a 60% sheet is slid down from it. */
const FULL = height - TOP;
const FOLD = FULL - height * 0.6;

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
      <Sheet open title="Comments" snap={60} expand scroll={false} footer={<Text>Composer</Text>} {...props}>
        <Text>Thread</Text>
      </Sheet>
    </SafeAreaProvider>,
  );
}

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
/** The body is padded by the fold exactly while the sheet rests at `snap`: that is how a test sees where it rests. */
const atSnap = () => flat('sheet-body').paddingBottom === FOLD;
const atFull = () => flat('sheet-body').paddingBottom === undefined;

// The pan takes hold once the finger has moved past the slop (6pt), as on a device.
const drag = (translationY: number, velocityY = 0, gesture = 'sheet-grab') =>
  act(() =>
    fireGestureHandler(getByGestureTestId(gesture), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: Math.sign(translationY) * 6, velocityY },
      { state: State.ACTIVE, translationY, velocityY },
      { state: State.END, translationY, velocityY },
    ]),
  );

beforeEach(() => {
  mockKeyboard = 0;
});

describe('an expand sheet', () => {
  it('is laid out at the whole screen and opens slid down to snap, the body padded by the difference', async () => {
    await renderSheet();
    expect(flat('sheet').height).toBe(FULL);
    expect(FOLD).toBeGreaterThan(0);
    expect(atSnap()).toBe(true);
  });

  it('keeps its footer in the panel, carrying the bottom padding, so the thread never shows under it', async () => {
    await renderSheet();
    expect(screen.getByText('Composer')).toBeTruthy();
    expect(flat('sheet-footer').paddingBottom).toBe(spacing.xxl + HOME_INDICATOR);
    expect(flat('sheet').paddingBottom).toBeUndefined();
  });

  it('goes to the whole screen when its top is dragged up, and rests there', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });
    await drag(-FOLD);
    expect(atFull()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('goes to the whole screen on a short flick up', async () => {
    await renderSheet({ onClose: jest.fn() });
    await drag(-20, -900);
    expect(atFull()).toBe(true);
  });

  it('stays at snap after a small slow drag up', async () => {
    await renderSheet({ onClose: jest.fn() });
    await drag(-30);
    expect(atSnap()).toBe(true);
  });

  it('from the whole screen, a slow drag down stops at snap', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });
    await drag(-FOLD);
    await drag(FOLD * 0.8, 100);
    expect(atSnap()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('from the whole screen, a quick swipe down closes it outright', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });
    await drag(-FOLD);
    await drag(80, 1500);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('from snap, a flick down closes it', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });
    await drag(40, 900);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens at snap again the next time, wherever it was left', async () => {
    const onClose = jest.fn();
    const view = await renderSheet({ onClose });
    await drag(-FOLD);
    expect(atFull()).toBe(true);
    jest.useFakeTimers();
    await view.rerender(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
        <Sheet open={false} title="Comments" snap={60} expand scroll={false} onClose={onClose}>
          <Text>Thread</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    await act(() => jest.runAllTimers());
    jest.useRealTimers();
    await view.rerender(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
        <Sheet open title="Comments" snap={60} expand scroll={false} onClose={onClose}>
          <Text>Thread</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    expect(atSnap()).toBe(true);
  });

  it('takes the whole screen above the keyboard, and stays there once the keyboard is down', async () => {
    const view = await renderSheet({ onClose: jest.fn() });
    expect(atSnap()).toBe(true);
    mockKeyboard = 336;
    await view.rerender(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
        <Sheet open title="Comments" snap={60} expand scroll={false} onClose={jest.fn()}>
          <Text>Thread</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    expect(flat('sheet').height).toBe(FULL - 336);
    expect(flat('sheet').marginBottom).toBe(336);
    expect(atFull()).toBe(true);
    mockKeyboard = 0;
    await view.rerender(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height }, insets: { top: TOP, left: 0, right: 0, bottom: HOME_INDICATOR } }}>
        <Sheet open title="Comments" snap={60} expand scroll={false} onClose={jest.fn()}>
          <Text>Thread</Text>
        </Sheet>
      </SafeAreaProvider>,
    );
    expect(flat('sheet').height).toBe(FULL);
    expect(atFull()).toBe(true);
  });
});

describe('a body that moves the sheet (scrollTop)', () => {
  it('closes the sheet when the body is flicked down', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose, scrollTop: still });
    await drag(60, 1200, 'sheet-body');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes the sheet to the whole screen when the body is dragged up from snap', async () => {
    await renderSheet({ onClose: jest.fn(), scrollTop: still });
    await drag(-FOLD, -300, 'sheet-body');
    expect(atFull()).toBe(true);
  });

  it('has no body drag without scrollTop: only the top grabs', async () => {
    await renderSheet({ onClose: jest.fn() });
    expect(() => getByGestureTestId('sheet-body')).toThrow();
  });
});

describe('a sheet without expand', () => {
  it('is laid out at its snap height with nothing folded, as before', async () => {
    await renderSheet({ expand: false, snap: 40 });
    expect(flat('sheet').height).toBeCloseTo(height * 0.4);
    expect(flat('sheet-body').paddingBottom).toBeUndefined();
  });
});
