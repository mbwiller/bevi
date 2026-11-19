import { ApiError } from '@bevi/shared';
import NetInfo, { type NetInfoChangeHandler, type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useSubmitRanking } from '../hooks';
import { keys } from '../keys';
import { createQueryClient } from '../queryClient';

// A save made with no connection fails at once, with the `network` error the screen shows, and does
// not sit on a spinner waiting for the reads it refreshes afterwards to be able to run.

const addEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;
let connection: NetInfoChangeHandler | undefined;

beforeEach(() => {
  addEventListener.mockImplementation((l) => {
    connection = l;
    return jest.fn();
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  addEventListener.mockReset().mockReturnValue(jest.fn());
});

it('submitRanking offline rejects with the network error and settles, even with cached reads to refresh', async () => {
  const client = createQueryClient();
  client.mount();
  // Something cached that the ranking would refresh: its refetch can only wait while offline.
  // Rendered by a screen that is still open, so it is active and its refetch is paused.
  client.setQueryData(keys.rankings.mine(), { items: [], nextCursor: null });
  const stop = new QueryObserver(client, { queryKey: keys.rankings.mine(), queryFn: async () => ({ items: [], nextCursor: null }) }).subscribe(() => {});
  await act(async () => connection?.({ isConnected: false, isInternetReachable: null } as NetInfoState));

  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = await renderHook(() => useSubmitRanking(), { wrapper });
  // The mutation function itself (the FakeApi call) is the network failure the real API gives offline.
  const offline = new ApiError('network', 'offline');
  const api = jest.requireMock('@/api/client').api;
  jest.spyOn(api.rankings, 'submitRanking').mockRejectedValue(offline);

  let rejected: unknown;
  await act(async () => {
    result.current
      .mutateAsync({ bevId: 'b', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] })
      .catch((e: unknown) => (rejected = e));
  });
  await waitFor(() => expect(result.current.isPending).toBe(false), { timeout: 1000 });
  expect(rejected).toBe(offline);
  expect(result.current.isError).toBe(true);

  stop();
  client.clear();
  client.unmount();
});
