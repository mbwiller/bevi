import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePullToRefresh } from '../usePullToRefresh';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('is not refreshing until a pull, however often the query refetches in the background', async () => {
  const refetch = jest.fn();
  const { result, rerender } = await renderHook(() => usePullToRefresh(refetch));
  await rerender({});
  expect(result.current.refreshing).toBe(false);
  expect(refetch).not.toHaveBeenCalled();
});

it('is refreshing from the pull until its refetch resolves', async () => {
  const d = deferred();
  const refetch = jest.fn(() => d.promise);
  const { result } = await renderHook(() => usePullToRefresh(refetch));
  await act(async () => {
    void result.current.onRefresh();
  });
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(result.current.refreshing).toBe(true);
  await act(async () => d.resolve());
  await waitFor(() => expect(result.current.refreshing).toBe(false));
});

it('clears when the refetch rejects, or throws', async () => {
  const d = deferred();
  const refetch = jest.fn(() => d.promise);
  const { result } = await renderHook(() => usePullToRefresh(refetch));
  await act(async () => {
    void result.current.onRefresh();
  });
  expect(result.current.refreshing).toBe(true);
  await act(async () => d.reject(new Error('offline')));
  await waitFor(() => expect(result.current.refreshing).toBe(false));

  const throwing = await renderHook(() =>
    usePullToRefresh(() => {
      throw new Error('boom');
    }),
  );
  await act(async () => {
    await throwing.result.current.onRefresh();
  });
  expect(throwing.result.current.refreshing).toBe(false);
});

it('calls the latest refetch', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const { result, rerender } = await renderHook((props: { fn: () => unknown }) => usePullToRefresh(props.fn), { initialProps: { fn: first } });
  await rerender({ fn: second });
  await act(async () => {
    void result.current.onRefresh();
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
