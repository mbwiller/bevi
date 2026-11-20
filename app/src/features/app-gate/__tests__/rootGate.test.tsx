import path from 'path';

import { act, renderRouter, screen, waitFor, fireEvent } from 'expo-router/testing-library';
import { AppState } from 'react-native';

import { api } from '@/api/client';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { MIN_RECHECK_MS } from '../AppGate';
import { APP_CONFIG_MAINTENANCE_POLL_MS } from '@/api/hooks/feed';

// The root layout with the gate in it, against the FakeApi.

let mockVersion: string | null = '1.0.0';
jest.mock('../installedVersion', () => ({ installedVersion: () => mockVersion, installedBuild: () => '7' }));
// A tiny live connection: `setOnline` re-renders every user of useOnline, as the real store does.
jest.mock('@/lib/useOnline', () => {
  const { useSyncExternalStore } = require('react');
  const listeners = new Set<() => void>();
  const state = { online: true };
  return {
    useOnline: () => useSyncExternalStore((cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state.online),
    setOnline: (value: boolean) => { state.online = value; listeners.forEach((l) => l()); },
  };
});
const { setOnline } = jest.requireMock('@/lib/useOnline') as { setOnline: (value: boolean) => void };

const APP_DIR = path.resolve(__dirname, '../../../app');

async function launch(initialUrl = '/') {
  useSession.setState({ status: 'signedOut', profile: undefined, checked: false, devForced: false });
  const result = renderRouter(APP_DIR, { initialUrl });
  await result;
  return () => result.getPathname();
}

beforeEach(() => {
  mockVersion = '1.0.0';
  setOnline(true);
  controls.setLatency(0);
  controls.resetToFixtures();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the gate in the root layout', () => {
  it('open by default: signed out lands on sign in, no overlay', async () => {
    const path = await launch();
    await screen.findByLabelText('Username');
    expect(path()).toBe('/sign-in');
    expect(screen.queryByTestId('maintenance-notice')).toBeNull();
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it('does not hold the launch: the splash shows while the first read is in flight', async () => {
    controls.setLatency(50);
    await launch();
    expect(screen.getByLabelText('Loading Bevi')).toBeTruthy();
    expect(screen.queryByTestId('maintenance-notice')).toBeNull();
    await screen.findByLabelText('Username', {}, { timeout: 2000 });
  });

  it('maintenance on, signed out: overlay with the message, app mounted underneath', async () => {
    controls.setAppConfig({ maintenance: true, maintenanceMessage: 'Back at 6pm.' });
    await launch();
    await screen.findByTestId('maintenance-notice');
    expect(screen.getByText('Back at 6pm.')).toBeTruthy();
    // Still mounted underneath (hidden from VoiceOver by the overlay, hence includeHiddenElements).
    expect(screen.getByLabelText('Username', { includeHiddenElements: true })).toBeTruthy();
  });

  it('maintenance on, signed in: overlay over the feed, which stays mounted and is there when it lifts', async () => {
    controls.signInAs('tester');
    controls.setAppConfig({ maintenance: true });
    await launch();
    await screen.findByTestId('maintenance-notice');
    expect((await screen.findAllByText('Your feed', { includeHiddenElements: true })).length).toBeGreaterThan(0);
    controls.setAppConfig({ maintenance: false });
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.queryByTestId('maintenance-notice')).toBeNull());
    expect(screen.getAllByText('Your feed').length).toBeGreaterThan(0);
    expect(useSession.getState().status).toBe('ready');
  });

  it('the flag cleared: Try again lifts it without a relaunch', async () => {
    controls.setAppConfig({ maintenance: true });
    await launch();
    await screen.findByTestId('maintenance-notice');
    controls.setAppConfig({ maintenance: false });
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.queryByTestId('maintenance-notice')).toBeNull());
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });

  it('the flag cleared: it lifts by itself on the one-minute poll', async () => {
    jest.useFakeTimers();
    controls.setAppConfig({ maintenance: true });
    await launch();
    await screen.findByTestId('maintenance-notice');
    controls.setAppConfig({ maintenance: false });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(APP_CONFIG_MAINTENANCE_POLL_MS + 1);
    });
    await waitFor(() => expect(screen.queryByTestId('maintenance-notice')).toBeNull());
  });

  it('the flag cleared: it lifts when the app returns to the foreground', async () => {
    const handlers: ((status: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: 'change', handler: (status: never) => void) => {
      handlers.push(handler as (status: string) => void);
      return { remove: () => undefined };
    }) as typeof AppState.addEventListener);
    controls.setAppConfig({ maintenance: true });
    await launch();
    await screen.findByTestId('maintenance-notice');
    controls.setAppConfig({ maintenance: false });
    await act(async () => {
      handlers.forEach((h) => h('active'));
    });
    await waitFor(() => expect(screen.queryByTestId('maintenance-notice')).toBeNull());
  });

  it('the flag cleared: it lifts when the connection returns', async () => {
    controls.setAppConfig({ maintenance: true });
    await launch();
    await screen.findByTestId('maintenance-notice');
    await act(async () => setOnline(false));
    controls.setAppConfig({ maintenance: false });
    expect(screen.getByTestId('maintenance-notice')).toBeTruthy();
    await act(async () => setOnline(true));
    await waitFor(() => expect(screen.queryByTestId('maintenance-notice')).toBeNull());
  });

  it('minAppVersion above the installed one: the update screen replaces the app, no route reachable', async () => {
    controls.setAppConfig({ minAppVersion: '1.1.0' });
    const path = await launch();
    await screen.findByTestId('update-required');
    expect(screen.getByText('Update Bevi')).toBeTruthy();
    expect(screen.getByText('Version 1.0.0 build 7')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByTestId('maintenance-notice')).toBeNull();
    void path;
  });

  it('minAppVersion above the installed one, signed in: no feed', async () => {
    controls.signInAs('tester');
    controls.setAppConfig({ minAppVersion: '1.1.0' });
    await launch();
    await screen.findByTestId('update-required');
    expect(screen.queryByText('Your feed')).toBeNull();
  });

  it('minContractVersion above this bundle: the update screen', async () => {
    controls.setAppConfig({ minContractVersion: '999.0.0' });
    await launch();
    await screen.findByTestId('update-required');
  });

  it('no installed version (web): never told to update, still honours maintenance', async () => {
    mockVersion = null;
    controls.setAppConfig({ minAppVersion: '99.0.0', minContractVersion: '999.0.0' });
    await launch();
    await screen.findByLabelText('Username');
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it('maintenance wins over update', async () => {
    controls.setAppConfig({ maintenance: true, minAppVersion: '9.0.0' });
    await launch();
    await screen.findByTestId('maintenance-notice');
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it.each(['unknown', 'network'] as const)('a failed read (%s): the app renders normally', async (code) => {
    controls.setAppConfig({ maintenance: true });
    controls.failNext(code, 'meta.getAppConfig');
    await launch();
    await screen.findByLabelText('Username');
    expect(screen.queryByTestId('maintenance-notice')).toBeNull();
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it('a failed read is not retried in a burst: one request, the poll is the retry', async () => {
    const read = jest.spyOn(api.meta, 'getAppConfig');
    controls.failNext('network', 'meta.getAppConfig');
    await launch();
    await screen.findByLabelText('Username');
    // React Query's backed-off retries would land within these seconds; the poll is minutes away.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
