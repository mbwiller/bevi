import NetInfo, { type NetInfoChangeHandler, type NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook } from '@testing-library/react-native';

import { isOnline } from '@/lib/connection';

import { useOnline } from '../useOnline';

// Jest resolves as iOS, so this is the native hook (NetInfo, mocked in jest.setup.js); the web one
// is useOnline.web.ts.

const addEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;

let listener: NetInfoChangeHandler | undefined;
let unsubscribe: jest.Mock;

beforeEach(() => {
  listener = undefined;
  unsubscribe = jest.fn();
  addEventListener.mockImplementation((l) => {
    listener = l;
    return unsubscribe;
  });
});

afterEach(() => addEventListener.mockReset().mockReturnValue(jest.fn()));

function state(isConnected: boolean | null, isInternetReachable: boolean | null): NetInfoState {
  return { isConnected, isInternetReachable } as NetInfoState;
}

it('counts only a definite "no" as offline', () => {
  expect(isOnline(state(true, true))).toBe(true);
  expect(isOnline(state(false, false))).toBe(false);
  // Connected, but NetInfo's own probe (a Google URL) failed: still online, the API may be reachable.
  expect(isOnline(state(true, false))).toBe(true);
  expect(isOnline(state(false, null))).toBe(false);
  // Not known yet: online, so a slow first probe never flashes the offline banner.
  expect(isOnline(state(null, null))).toBe(true);
  expect(isOnline(state(true, null))).toBe(true);
});

it('starts online, then follows the listener', async () => {
  const { result } = await renderHook(() => useOnline());
  expect(result.current).toBe(true);
  expect(addEventListener).toHaveBeenCalledTimes(1);

  await act(async () => listener!(state(false, false)));
  expect(result.current).toBe(false);

  await act(async () => listener!(state(true, null)));
  expect(result.current).toBe(true);

  await act(async () => listener!(state(false, null)));
  expect(result.current).toBe(false);

  // Connected with a failed reachability probe is online.
  await act(async () => listener!(state(true, false)));
  expect(result.current).toBe(true);

  await act(async () => listener!(state(false, false)));
  expect(result.current).toBe(false);

  await act(async () => listener!(state(null, null)));
  expect(result.current).toBe(true);
});

it('unsubscribes on unmount', async () => {
  const { unmount } = await renderHook(() => useOnline());
  expect(unsubscribe).not.toHaveBeenCalled();
  await act(async () => unmount());
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
