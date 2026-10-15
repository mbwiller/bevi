import { act, renderHook } from '@testing-library/react-native';

import { motion } from '@/theme';

import { useCountUp } from '../useCountUp';

let mockReduced = false;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => mockReduced,
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
});

afterEach(() => {
  jest.useRealTimers();
});

it('starts at `from`, rises, and ends exactly on the target after motion.pour', async () => {
  const { result } = await renderHook(() => useCountUp(8.93, 7));
  expect(result.current).toBe(7);

  await act(() => jest.advanceTimersByTime(motion.pour / 2));
  expect(result.current).toBeGreaterThan(7);
  expect(result.current).toBeLessThan(8.93);

  await act(() => jest.advanceTimersByTime(motion.pour / 2));
  expect(result.current).toBe(8.93);

  // And stays there.
  await act(() => jest.advanceTimersByTime(motion.pour));
  expect(result.current).toBe(8.93);
});

it('never overshoots the target on the way up', async () => {
  const { result } = await renderHook(() => useCountUp(5.5, 4));
  const seen: number[] = [];
  for (let t = 0; t < motion.pour; t += 10) {
    await act(() => jest.advanceTimersByTime(10));
    seen.push(result.current);
  }
  expect(Math.max(...seen)).toBe(5.5);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
});

it('counts again from `from` when the target changes', async () => {
  const { result, rerender } = await renderHook(({ target }: { target: number }) => useCountUp(target, 7), {
    initialProps: { target: 9.5 },
  });
  await act(() => jest.advanceTimersByTime(motion.pour));
  expect(result.current).toBe(9.5);
  await rerender({ target: 8.1 });
  expect(result.current).toBe(7);
  await act(() => jest.advanceTimersByTime(motion.pour));
  expect(result.current).toBe(8.1);
});

it('under Reduce Motion returns the target immediately, on the first render', async () => {
  mockReduced = true;
  const seen: number[] = [];
  const { result } = await renderHook(() => {
    const v = useCountUp(8.93, 7);
    seen.push(v);
    return v;
  });
  expect(seen.every((v) => v === 8.93)).toBe(true);
  await act(() => jest.advanceTimersByTime(motion.pour / 2));
  expect(result.current).toBe(8.93);
});
