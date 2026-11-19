import { ApiError } from '@bevi/shared';
import NetInfo, { type NetInfoChangeHandler, type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { createQueryClient } from '../queryClient';
import { connectQueryLifecycle } from '../queryLifecycle';

// Jest resolves as iOS, so this is the native file (NetInfo is mocked in jest.setup.js); the web one
// is queryLifecycle.web.ts.

const addEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;

let connection: NetInfoChangeHandler | undefined;
let unsubscribe: jest.Mock;
/** Every AppState listener: React Query's focus one, and the connection store's own (src/lib/connectionStore.ts). */
let appStateListeners: ((status: AppStateStatus) => void)[];
const appState = (status: AppStateStatus) => appStateListeners.forEach((l) => l(status));
let removeAppState: jest.Mock;

function emit(isConnected: boolean | null): void {
  connection?.({ isConnected, isInternetReachable: null } as NetInfoState);
}

beforeEach(() => {
  connection = undefined;
  unsubscribe = jest.fn();
  addEventListener.mockImplementation((l) => {
    connection = l;
    return unsubscribe;
  });
  appStateListeners = [];
  removeAppState = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, l) => {
    appStateListeners.push(l as (status: AppStateStatus) => void);
    return { remove: removeAppState } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  // Leave the two managers as every other suite expects them: online and in focus.
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  addEventListener.mockReset().mockReturnValue(jest.fn());
  jest.restoreAllMocks();
});

it('follows the connection: only "no connection" is offline', () => {
  connectQueryLifecycle();
  expect(onlineManager.isOnline()).toBe(true);
  emit(false);
  expect(onlineManager.isOnline()).toBe(false);
  // Not known yet counts as online, like the offline banner (src/lib/connection.ts).
  emit(null);
  expect(onlineManager.isOnline()).toBe(true);
  emit(false);
  emit(true);
  expect(onlineManager.isOnline()).toBe(true);
});

it('is in focus only while the app is active', () => {
  connectQueryLifecycle();
  appState('background');
  expect(focusManager.isFocused()).toBe(false);
  appState('inactive');
  expect(focusManager.isFocused()).toBe(false);
  appState('active');
  expect(focusManager.isFocused()).toBe(true);
});

it('replaces the listeners of an earlier call', () => {
  connectQueryLifecycle();
  connectQueryLifecycle();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  // Two AppState listeners went with the first call: the focus one, and the connection store's.
  expect(removeAppState).toHaveBeenCalledTimes(2);
});

it('createQueryClient connects it', () => {
  createQueryClient();
  expect(connection).toBeDefined();
  expect(appStateListeners.length).toBeGreaterThan(0);
});

// QueryClientProvider mounts the client, and only a mounted client listens to the two managers.
function mountedClient() {
  const client = createQueryClient();
  client.mount();
  return client;
}

it('a read that failed is fetched again when the connection comes back', async () => {
  const client = mountedClient();
  // An error the client never retries by itself, so only the reconnect can bring the data.
  const queryFn = jest
    .fn<Promise<string>, []>()
    .mockRejectedValueOnce(new ApiError('unauthorized', 'Not signed in'))
    .mockResolvedValue('lists');
  const observer = new QueryObserver(client, { queryKey: ['lists'], queryFn });
  const stop = observer.subscribe(() => {});

  await waitForStatus(observer, 'error');
  expect(queryFn).toHaveBeenCalledTimes(1);

  emit(false);
  emit(true);

  await waitForStatus(observer, 'success');
  expect(observer.getCurrentResult().data).toBe('lists');
  expect(queryFn).toHaveBeenCalledTimes(2);

  stop();
  client.clear();
  client.unmount();
});

it('a read started with no connection waits, then runs when it is back', async () => {
  const client = mountedClient();
  emit(false);
  const queryFn = jest.fn<Promise<string>, []>().mockResolvedValue('profile');
  const observer = new QueryObserver(client, { queryKey: ['profile'], queryFn });
  const stop = observer.subscribe(() => {});

  expect(observer.getCurrentResult().fetchStatus).toBe('paused');
  expect(queryFn).not.toHaveBeenCalled();

  emit(true);

  await waitForStatus(observer, 'success');
  expect(queryFn).toHaveBeenCalledTimes(1);

  stop();
  client.clear();
  client.unmount();
});

it('a save started with no connection runs at once and fails, it does not wait to be sent later', async () => {
  const client = mountedClient();
  emit(false);
  const offline = new ApiError('network', 'offline');
  const mutationFn = jest.fn<Promise<string>, []>().mockRejectedValue(offline);
  const observer = new MutationObserver(client, { mutationFn });

  await expect(observer.mutate()).rejects.toBe(offline);
  expect(mutationFn).toHaveBeenCalledTimes(1);
  expect(observer.getCurrentResult().isPaused).toBe(false);
  expect(observer.getCurrentResult().status).toBe('error');

  // Not held for the reconnect either: nothing runs it a second time.
  emit(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mutationFn).toHaveBeenCalledTimes(1);

  client.clear();
  client.unmount();
});

async function waitForStatus(
  observer: QueryObserver<string, Error, string, string, string[]>,
  status: 'error' | 'success',
): Promise<void> {
  for (let i = 0; i < 200 && observer.getCurrentResult().status !== status; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(observer.getCurrentResult().status).toBe(status);
}
