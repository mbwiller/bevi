import NetInfo, { type NetInfoChangeHandler, type NetInfoState } from '@react-native-community/netinfo';

import {
  connectionOnline,
  PROBE_OFFLINE_MS,
  PROBE_ONLINE_MS,
  setConnectionProbe,
  subscribeConnection,
} from '../connectionStore';

// The native store: NetInfo (mocked in jest.setup.js), corrected by asking the backend while
// NetInfo says offline. Under jest there is no backend URL, so each test supplies the probe.

const addEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;

let netInfo: NetInfoChangeHandler | undefined;
let unsubscribeNetInfo: jest.Mock;
let stop: (() => void) | undefined;
let seen: boolean[];

const emit = (isConnected: boolean | null) => netInfo!({ isConnected, isInternetReachable: null } as NetInfoState);

/** Runs the timers due in `ms` and lets the probe's promise settle. */
async function advance(ms: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

function watch(probe: jest.Mock<Promise<boolean>, []> | null): void {
  setConnectionProbe(probe);
  stop = subscribeConnection((online) => seen.push(online));
}

beforeEach(() => {
  jest.useFakeTimers();
  netInfo = undefined;
  seen = [];
  unsubscribeNetInfo = jest.fn();
  addEventListener.mockImplementation((l) => {
    netInfo = l;
    return unsubscribeNetInfo;
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  setConnectionProbe(null);
  addEventListener.mockReset().mockReturnValue(jest.fn());
  jest.useRealTimers();
});

it('starts online and follows NetInfo: only "no connection" is offline', () => {
  watch(null);
  expect(connectionOnline()).toBe(true);
  emit(null);
  expect(connectionOnline()).toBe(true);
  emit(false);
  expect(connectionOnline()).toBe(false);
  emit(true);
  expect(connectionOnline()).toBe(true);
  expect(seen).toEqual([false, true]);
});

it('never asks the backend while NetInfo says online, or when there is no probe', async () => {
  const probe = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
  watch(probe);
  emit(true);
  await advance(PROBE_OFFLINE_MS * 10);
  expect(probe).not.toHaveBeenCalled();

  stop?.();
  watch(null);
  emit(false);
  await advance(PROBE_OFFLINE_MS * 10);
  expect(connectionOnline()).toBe(false);
});

it('comes back online by itself when NetInfo never reports the reconnect', async () => {
  // The iOS Simulator after the Mac's Wi-Fi returns: NetInfo stays on "no connection".
  const probe = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(false).mockResolvedValue(true);
  watch(probe);
  emit(false);
  expect(connectionOnline()).toBe(false);

  await advance(PROBE_OFFLINE_MS);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(connectionOnline()).toBe(false);

  await advance(PROBE_OFFLINE_MS);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(connectionOnline()).toBe(true);
  expect(seen).toEqual([false, true]);
});

it('keeps checking after that, more slowly, and goes offline again when the backend stops answering', async () => {
  const probe = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(true).mockResolvedValue(false);
  watch(probe);
  emit(false);
  await advance(PROBE_OFFLINE_MS);
  expect(connectionOnline()).toBe(true);

  // NetInfo cannot report this drop: it already says "no connection".
  await advance(PROBE_ONLINE_MS - 1);
  expect(probe).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(connectionOnline()).toBe(false);
  expect(seen).toEqual([false, true, false]);
});

it('a probe that throws counts as no answer', async () => {
  const probe = jest.fn<Promise<boolean>, []>().mockRejectedValue(new Error('no route'));
  watch(probe);
  emit(false);
  await advance(PROBE_OFFLINE_MS);
  expect(connectionOnline()).toBe(false);
  await advance(PROBE_OFFLINE_MS);
  expect(probe).toHaveBeenCalledTimes(2);
});

it('stops asking once NetInfo says online, and ignores an answer that was already on its way', async () => {
  let answer: (value: boolean) => void = () => {};
  const probe = jest.fn<Promise<boolean>, []>().mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
  watch(probe);
  emit(false);
  await advance(PROBE_OFFLINE_MS);
  expect(probe).toHaveBeenCalledTimes(1);

  emit(true);
  emit(false);
  // The old probe answers "no" after NetInfo spoke twice: it must not start a second chain.
  answer(false);
  await advance(PROBE_OFFLINE_MS - 1);
  expect(probe).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(probe).toHaveBeenCalledTimes(2);

  emit(true);
  await advance(PROBE_OFFLINE_MS * 10);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(connectionOnline()).toBe(true);
});

it('one NetInfo listener for every subscriber, removed with the last one', () => {
  setConnectionProbe(null);
  const first = subscribeConnection(() => {});
  const second = subscribeConnection(() => {});
  expect(addEventListener).toHaveBeenCalledTimes(1);
  emit(false);
  first();
  expect(unsubscribeNetInfo).not.toHaveBeenCalled();
  expect(connectionOnline()).toBe(false);
  second();
  expect(unsubscribeNetInfo).toHaveBeenCalledTimes(1);
  // Stopped: back to the starting belief, so the next subscriber does not inherit a stale "offline".
  expect(connectionOnline()).toBe(true);
});
