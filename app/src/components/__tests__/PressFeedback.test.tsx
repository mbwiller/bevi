import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion } from '@/theme';

import { FeedbackPressable, PRESS_OPACITY, PRESS_SCALE, usePressFeedback } from '../PressFeedback';

// The Reanimated mock evaluates a style once per render and makes a new shared value every render,
// so the suite keeps each style's worklet and runs it again after a press to read what it targets.
let mockReduced = false;
const mockWorklets: (() => Record<string, unknown>)[] = [];
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return {
    ...mock,
    useReducedMotion: () => mockReduced,
    useAnimatedStyle: (worklet: () => Record<string, unknown>) => {
      mockWorklets.push(worklet);
      return worklet();
    },
    withTiming: jest.fn((to: number) => to),
  };
});
const { withTiming } = jest.requireMock('react-native-reanimated') as { withTiming: jest.Mock };

beforeEach(() => {
  mockReduced = false;
  mockWorklets.length = 0;
  withTiming.mockClear();
});

/** What the press style targets now. */
const pose = () => mockWorklets[mockWorklets.length - 1]!() as { opacity: number; transform: [{ scale: number }] };

it('gives way under the finger, scale 0.98 and opacity 0.7 over motion.fast, and comes back on release', async () => {
  await render(
    <FeedbackPressable accessibilityRole="button" accessibilityLabel="Row" onPress={() => {}}>
      <Text>Row</Text>
    </FeedbackPressable>,
  );
  expect(pose()).toEqual({ opacity: 1, transform: [{ scale: 1 }] });

  await fireEvent(screen.getByRole('button', { name: 'Row' }), 'pressIn');
  expect(withTiming).toHaveBeenLastCalledWith(1, { duration: motion.fast });
  expect(pose()).toEqual({ opacity: PRESS_OPACITY, transform: [{ scale: PRESS_SCALE }] });
  expect([PRESS_SCALE, PRESS_OPACITY]).toEqual([0.98, 0.7]);

  await fireEvent(screen.getByRole('button', { name: 'Row' }), 'pressOut');
  expect(withTiming).toHaveBeenLastCalledWith(0, { duration: motion.fast });
  expect(pose()).toEqual({ opacity: 1, transform: [{ scale: 1 }] });
});

it('under Reduce Motion only dims: the scale stays 1', async () => {
  mockReduced = true;
  await render(
    <FeedbackPressable accessibilityRole="button" accessibilityLabel="Row">
      <Text>Row</Text>
    </FeedbackPressable>,
  );
  await fireEvent(screen.getByRole('button', { name: 'Row' }), 'pressIn');
  expect(pose()).toEqual({ opacity: PRESS_OPACITY, transform: [{ scale: 1 }] });
});

it("fires onPress exactly once per tap, and still runs the caller's own pressIn and pressOut", async () => {
  const onPress = jest.fn();
  const onPressIn = jest.fn();
  const onPressOut = jest.fn();
  await render(
    <FeedbackPressable accessibilityRole="button" accessibilityLabel="Row" onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Text>Row</Text>
    </FeedbackPressable>,
  );
  const button = screen.getByRole('button', { name: 'Row' });
  await fireEvent(button, 'pressIn');
  await fireEvent(button, 'pressOut');
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onPressIn).toHaveBeenCalledTimes(1);
  expect(onPressOut).toHaveBeenCalledTimes(1);
});

it("keeps the caller's style on the Pressable, with the press style after it", async () => {
  await render(
    <FeedbackPressable accessibilityRole="button" accessibilityLabel="Row" style={{ minHeight: 44 }}>
      <Text>Row</Text>
    </FeedbackPressable>,
  );
  expect(screen.getByRole('button', { name: 'Row' })).toHaveStyle({ minHeight: 44, opacity: 1 });
});

it("usePressFeedback hands out the handlers and the style separately, for a full-bleed row's content", async () => {
  function Row({ onPress }: { onPress: () => void }) {
    const press = usePressFeedback();
    return (
      <Pressable accessibilityRole="button" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <Animated.View style={press.style}>
          <Text>Row</Text>
        </Animated.View>
      </Pressable>
    );
  }
  const onPress = jest.fn();
  await render(<Row onPress={onPress} />);
  await fireEvent(screen.getByRole('button'), 'pressIn');
  expect(pose()).toEqual({ opacity: PRESS_OPACITY, transform: [{ scale: PRESS_SCALE }] });
  await fireEvent.press(screen.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);
});
