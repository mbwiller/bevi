import { act, renderHook } from '@testing-library/react-native';

import { useAllPages, useToggleSet } from '../useToggleSet';

it('an override shows at once, then yields to the server once it agrees', async () => {
  const { result, rerender } = await renderHook(({ base }: { base: string[] }) => useToggleSet(base), {
    initialProps: { base: [] as string[] },
  });
  await act(async () => void result.current.set('a', true));
  expect(result.current.has('a')).toBe(true);
  // The refetch confirms it…
  await rerender({ base: ['a'] });
  expect(result.current.has('a')).toBe(true);
  // …so a later change made elsewhere (unsaved in Your Lists) shows through.
  await rerender({ base: [] });
  expect(result.current.has('a')).toBe(false);
});

it('undo drops the override (mutation error)', async () => {
  const { result } = await renderHook(() => useToggleSet(['a']));
  let undo = () => {};
  await act(async () => void (undo = result.current.set('a', false)));
  expect(result.current.has('a')).toBe(false);
  await act(async () => undo());
  expect(result.current.has('a')).toBe(true);
});

it('useAllPages fetches until there is no next page', async () => {
  const fetchNextPage = jest.fn();
  const { rerender } = await renderHook((q: Parameters<typeof useAllPages>[0]) => useAllPages(q), {
    initialProps: { hasNextPage: true, isFetchingNextPage: false, isError: false, fetchNextPage },
  });
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  await rerender({ hasNextPage: true, isFetchingNextPage: true, isError: false, fetchNextPage });
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  await rerender({ hasNextPage: false, isFetchingNextPage: false, isError: false, fetchNextPage });
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
});
