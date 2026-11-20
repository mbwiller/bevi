import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/api/client';
import { controls } from '@/testing/fakeApi';
import { useSession } from '@/state/session';

import { useSessionBootstrap } from '../useSessionBootstrap';

// The launch check, when the connection returns. The connection itself is covered in
// src/lib/__tests__/connectionStore.test.ts; here it is a value the test sets.

let mockOnline = true;
jest.mock('@/lib/useOnline', () => ({ useOnline: () => mockOnline }));

const clients: QueryClient[] = [];

async function launch() {
  useSession.setState({ status: 'signedOut', profile: undefined, checked: false, devForced: false });
  // gcTime: Infinity schedules no garbage-collection timers, so Jest can exit.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return await renderHook(() => useSessionBootstrap(), { wrapper });
}

async function connection(online: boolean, hook: Awaited<ReturnType<typeof launch>>) {
  mockOnline = online;
  await act(async () => {
    await hook.rerender(undefined);
  });
}

beforeEach(() => {
  mockOnline = true;
  controls.setLatency(0);
  controls.resetToFixtures();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.restoreAllMocks();
});

it('offline on launch: the check runs again by itself when the connection returns', async () => {
  controls.signInAs('tester');
  controls.failNext('network', 'profile.getMe');
  mockOnline = false;
  const hook = await launch();
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(useSession.getState().checked).toBe(false);

  await connection(true, hook);
  await waitFor(() => expect(useSession.getState().status).toBe('ready'));
  expect(hook.result.current.error).toBeNull();
});

it('signed out by a check that got no answer: back in when the connection returns', async () => {
  // A backend that reports a failed request as `unauthorized` signs the app out while offline;
  // the auth client still holds the session.
  controls.signInAs('tester');
  controls.failNext('unauthorized', 'profile.getMe');
  mockOnline = false;
  const hook = await launch();
  await waitFor(() => expect(useSession.getState().checked).toBe(true));
  expect(useSession.getState().status).toBe('signedOut');

  await connection(true, hook);
  await waitFor(() => expect(useSession.getState().status).toBe('ready'));
});

it('asks nothing when nobody is signed in, or when the profile is already loaded', async () => {
  const getMe = jest.spyOn(api.profile, 'getMe');
  const signedOut = await launch();
  await waitFor(() => expect(useSession.getState().checked).toBe(true));
  await connection(false, signedOut);
  await connection(true, signedOut);
  expect(getMe).not.toHaveBeenCalled();
  await signedOut.unmount();

  controls.signInAs('tester');
  const ready = await launch();
  await waitFor(() => expect(useSession.getState().status).toBe('ready'));
  expect(getMe).toHaveBeenCalledTimes(1);
  await connection(false, ready);
  await connection(true, ready);
  expect(getMe).toHaveBeenCalledTimes(1);
});

it('after a real sign-out, the connection returning asks nothing', async () => {
  controls.signInAs('tester');
  const hook = await launch();
  await waitFor(() => expect(useSession.getState().status).toBe('ready'));
  await act(async () => {
    await api.signOut();
  });
  await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));

  const getMe = jest.spyOn(api.profile, 'getMe');
  await connection(false, hook);
  await connection(true, hook);
  expect(getMe).not.toHaveBeenCalled();
  expect(useSession.getState().status).toBe('signedOut');
});

// BEV-27: the launch check could not find out whether anyone is signed in. The session is still
// stored, but its access token has expired and the refresh got no answer, so `getSession` rejects
// with `network`. That is "not known", and must never be read as a sign-out.
describe('a session check that got no answer', () => {
  /** Launches with a stored session whose check fails `times` times, and waits for the launch error. */
  async function launchUnknown(times = 1) {
    controls.signInAs('tester');
    for (let i = 0; i < times; i++) controls.failNext('network', 'getSession');
    mockOnline = false;
    const hook = await launch();
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    return hook;
  }

  it('is the launch error, not a sign-out', async () => {
    const getMe = jest.spyOn(api.profile, 'getMe');
    const hook = await launchUnknown();
    expect(hook.result.current.error).toMatchObject({ code: 'network' });
    // Unchecked: the root layout is still showing the splash, with this error and Retry.
    expect(useSession.getState().checked).toBe(false);
    expect(getMe).not.toHaveBeenCalled();
  });

  it('Retry asks again, and signs in', async () => {
    const hook = await launchUnknown();
    await act(async () => hook.result.current.retry());
    await waitFor(() => expect(useSession.getState().status).toBe('ready'));
    expect(hook.result.current.error).toBeNull();
  });

  it('asks again by itself when the connection returns', async () => {
    const hook = await launchUnknown();
    await connection(true, hook);
    await waitFor(() => expect(useSession.getState().status).toBe('ready'));
    expect(hook.result.current.error).toBeNull();
  });

  it('still no answer when asked again: the error comes back, and nobody is signed out', async () => {
    const hook = await launchUnknown(2);
    const getSession = jest.spyOn(api, 'getSession');
    await act(async () => hook.result.current.retry());
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    await expect(getSession.mock.results[0]!.value).rejects.toMatchObject({ code: 'network' });
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(useSession.getState().checked).toBe(false);

    // The third answer is the session.
    await act(async () => hook.result.current.retry());
    await waitFor(() => expect(useSession.getState().status).toBe('ready'));
  });

  it('a session heard later (the token refreshed by itself) ends the error without Retry', async () => {
    const hook = await launchUnknown();
    await act(async () => controls.signInAs('tester')); // an auth event carrying the session
    await waitFor(() => expect(useSession.getState().status).toBe('ready'));
    expect(hook.result.current.error).toBeNull();
  });

  it('a sign-out heard later (the server refused the session) lands on sign in', async () => {
    const hook = await launchUnknown();
    await act(async () => {
      await api.signOut();
    });
    await waitFor(() => expect(useSession.getState().checked).toBe(true));
    expect(useSession.getState().status).toBe('signedOut');
    expect(hook.result.current.error).toBeNull();

    // And the connection returning asks nothing: there is no longer anything unknown.
    const getSession = jest.spyOn(api, 'getSession');
    await connection(true, hook);
    expect(getSession).not.toHaveBeenCalled();
  });
});

it('a session check that fails for any other reason still lands on sign in', async () => {
  controls.signInAs('tester');
  controls.failNext('unknown', 'getSession');
  const hook = await launch();
  await waitFor(() => expect(useSession.getState().checked).toBe(true));
  expect(useSession.getState().status).toBe('signedOut');
  expect(hook.result.current.error).toBeNull();
});
