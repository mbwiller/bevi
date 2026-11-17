import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion } from '@/theme';

import { POP_PEAK, POP_SCALE, usePop, usePopWhenOn } from '../usePop';

// withSequence is recorded as the list of its steps, each withTiming as its target and config.
let mockReduced = false;
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return {
    ...mock,
    useReducedMotion: () => mockReduced,
    withTiming: jest.fn((to: number, config: unknown) => ({ to, config })),
    withSequence: jest.fn((...steps: unknown[]) => steps),
  };
});
const { withSequence } = jest.requireMock('react-native-reanimated') as { withSequence: jest.Mock };

beforeEach(() => {
  mockReduced = false;
  withSequence.mockClear();
});

const popSteps = () =>
  (withSequence.mock.calls.at(-1) as { to: number; config: { duration: number } }[]).map((s) => [s.to, s.config.duration]);

function Toggle({ onPress }: { onPress: () => void }) {
  const { style, pop } = usePop();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Toggle"
      onPress={() => {
        pop();
        onPress();
      }}
    >
      <Animated.View style={style}>
        <Text>Toggle</Text>
      </Animated.View>
    </Pressable>
  );
}

it('pops 1 → 1.22 → 1 over motion.base on the press, and the press fires once', async () => {
  const onPress = jest.fn();
  await render(<Toggle onPress={onPress} />);
  expect(withSequence).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Toggle' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(withSequence).toHaveBeenCalledTimes(1);
  expect(popSteps()).toEqual([
    [POP_SCALE, motion.base * POP_PEAK],
    [1, motion.base * (1 - POP_PEAK)],
  ]);
  expect(POP_SCALE).toBe(1.22);
});

it('does not pop when it only re-renders with new data', async () => {
  const { rerender } = await render(<Toggle onPress={() => {}} />);
  await rerender(<Toggle onPress={() => {}} />);
  expect(withSequence).not.toHaveBeenCalled();
});

it('under Reduce Motion there is no pop, and the press still fires', async () => {
  mockReduced = true;
  const onPress = jest.fn();
  await render(<Toggle onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Toggle' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(withSequence).not.toHaveBeenCalled();
});

describe('usePopWhenOn', () => {
  function Icon({ on }: { on: boolean }) {
    return <Animated.View style={usePopWhenOn(on)} />;
  }

  it('pops once each time it turns on, never on mount or while it stays on', async () => {
    const { rerender } = await render(<Icon on />);
    expect(withSequence).not.toHaveBeenCalled();
    await rerender(<Icon on />);
    await rerender(<Icon on={false} />);
    expect(withSequence).not.toHaveBeenCalled();
    await rerender(<Icon on />);
    expect(withSequence).toHaveBeenCalledTimes(1);
    await rerender(<Icon on />);
    expect(withSequence).toHaveBeenCalledTimes(1);
  });

  it('holds still under Reduce Motion', async () => {
    mockReduced = true;
    const { rerender } = await render(<Icon on={false} />);
    await rerender(<Icon on />);
    expect(withSequence).not.toHaveBeenCalled();
  });
});
