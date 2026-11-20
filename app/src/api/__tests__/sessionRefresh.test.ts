import { startAutoRefresh, stopAutoRefresh } from '@bevi/api';
import { AppState, type AppStateStatus } from 'react-native';

import { connectSessionRefresh } from '../sessionRefresh';
import { connectSessionRefresh as connectOnWeb } from '../sessionRefresh.web';

// Jest resolves as iOS, so `../sessionRefresh` is the native file; the web one is imported by name.
// `@bevi/api` is the real backend package (supabase-js): only its two refresh controls are needed.
jest.mock('@bevi/api', () => ({
  startAutoRefresh: jest.fn(async () => undefined),
  stopAutoRefresh: jest.fn(async () => undefined),
}));

const start = startAutoRefresh as jest.MockedFunction<typeof startAutoRefresh>;
const stop = stopAutoRefresh as jest.MockedFunction<typeof stopAutoRefresh>;

let listeners: ((status: AppStateStatus) => void)[];
let remove: jest.Mock;
const appState = (status: AppStateStatus) => listeners.forEach((l) => l(status));

function launchedAs(status: AppStateStatus): void {
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => status });
}

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
  listeners = [];
  remove = jest.fn();
  // React Native's jest setup already makes this a mock, and its calls outlive `restoreAllMocks`.
  jest.spyOn(AppState, 'addEventListener').mockClear().mockImplementation((_type, l) => {
    const listener = l as (status: AppStateStatus) => void;
    listeners.push(listener);
    remove.mockImplementationOnce(() => {
      listeners = listeners.filter((x) => x !== listener);
    });
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  launchedAs('active');
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('starts refreshing at once when the app is already in front', () => {
  connectSessionRefresh();
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
});

it('does not start when the app was launched in the background, and starts when it is opened', () => {
  launchedAs('background');
  connectSessionRefresh();
  expect(start).not.toHaveBeenCalled();
  appState('active');
  expect(start).toHaveBeenCalledTimes(1);
});

it('stops when the app leaves the front and starts again when it returns', () => {
  connectSessionRefresh();
  appState('inactive');
  expect(stop).toHaveBeenCalledTimes(1);
  appState('background');
  expect(stop).toHaveBeenCalledTimes(2);
  // The overnight case: this start is what refreshes a token that expired while backgrounded.
  appState('active');
  expect(start).toHaveBeenCalledTimes(2);
});

it('replaces the listener of an earlier call', () => {
  connectSessionRefresh();
  connectSessionRefresh();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(listeners).toHaveLength(1);
  // One live listener, so one stop for one change.
  appState('background');
  expect(stop).toHaveBeenCalledTimes(1);
});

it('does nothing on the web, where supabase-js follows the tab by itself', () => {
  connectOnWeb();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});
