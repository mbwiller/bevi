import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { motion } from '@/theme';

import { ARRIVE_RISE, Arrive, useArrival } from '../Arrive';

let mockReduced = false;
jest.mock('react-native-reanimated', () => {
  const mock = jest.requireActual('react-native-reanimated/mock');
  return { ...mock, useReducedMotion: () => mockReduced, withTiming: jest.fn((to: number) => to) };
});
const { withTiming } = jest.requireMock('react-native-reanimated') as { withTiming: jest.Mock };

beforeEach(() => {
  mockReduced = false;
  withTiming.mockClear();
});

/** A progress the test sets by hand. */
const at = (value: number) => ({ value }) as SharedValue<number>;

describe('Arrive', () => {
  it('starts 6pt low and transparent, and ends in place and opaque', async () => {
    const { rerender } = await render(
      <Arrive progress={at(0)}>
        <Text>Rows</Text>
      </Arrive>,
    );
    const box = () => screen.getByText('Rows').parent!;
    expect(box()).toHaveStyle({ opacity: 0, transform: [{ translateY: ARRIVE_RISE }] });
    expect(ARRIVE_RISE).toBe(6);
    await rerender(
      <Arrive progress={at(1)}>
        <Text>Rows</Text>
      </Arrive>,
    );
    expect(box()).toHaveStyle({ opacity: 1, transform: [{ translateY: 0 }] });
  });

  it('under Reduce Motion only fades: it never moves', async () => {
    mockReduced = true;
    await render(
      <Arrive progress={at(0)}>
        <Text>Rows</Text>
      </Arrive>,
    );
    expect(screen.getByText('Rows').parent!).toHaveStyle({ opacity: 0, transform: [{ translateY: 0 }] });
  });
});

describe('useArrival', () => {
  let progress: SharedValue<number>;
  function Probe({ pending }: { pending: boolean }) {
    progress = useArrival(pending);
    return null;
  }
  const arrivals = () => withTiming.mock.calls.filter(([to]) => to === 1);

  it('runs to 1 over motion.base once, when content replaces the skeleton', async () => {
    const { rerender } = await render(<Probe pending />);
    expect(progress.value).toBe(0);
    expect(arrivals()).toHaveLength(0);
    await rerender(<Probe pending={false} />);
    expect(arrivals()).toEqual([[1, expect.objectContaining({ duration: motion.base })]]);
    // A refetch or a next page keeps `isPending` false: nothing plays again.
    await rerender(<Probe pending={false} />);
    await rerender(<Probe pending={false} />);
    expect(arrivals()).toHaveLength(1);
  });

  it('never plays for content that was there when the screen mounted', async () => {
    const { rerender } = await render(<Probe pending={false} />);
    expect(progress.value).toBe(1);
    await rerender(<Probe pending={false} />);
    expect(withTiming).not.toHaveBeenCalled();
  });

  it('plays again only after a skeleton shows again', async () => {
    const { rerender } = await render(<Probe pending />);
    await rerender(<Probe pending={false} />);
    await rerender(<Probe pending />);
    expect(progress.value).toBe(0);
    await rerender(<Probe pending={false} />);
    expect(arrivals()).toHaveLength(2);
  });
});
