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
