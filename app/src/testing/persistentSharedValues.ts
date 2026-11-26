/**
 * Reanimated's jest mock as jest.setup.js gives it, except that `useSharedValue` keeps its value
 * across re-renders, as the real hook does. The packaged mock makes a fresh value on every render,
 * so a component that re-renders after a gesture (the PhotoCropper's zoom, read back by "Use photo")
 * would lose where the gesture left it. A suite opts in with
 *
 *   jest.mock('react-native-reanimated/mock', () => require('@/testing/persistentSharedValues').reanimatedMock());
 *
 * ('react-native-reanimated/mock' is what both jest.setup.js and expo-router's testing-library load).
 */
export function reanimatedMock(): Record<string, unknown> {
  const actual = jest.requireActual('react-native-reanimated/mock') as Record<string, unknown> & {
    useSharedValue: <T>(init: T) => { value: T };
  };
  const { useRef } = jest.requireActual('react') as typeof import('react');
  return {
    ...actual,
    useReducedMotion: () => false,
    useSharedValue: <T,>(init: T) => {
      const ref = useRef<{ value: T } | null>(null);
      if (!ref.current) ref.current = actual.useSharedValue(init);
      return ref.current;
    },
  };
}
