import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ApiError, type Session } from '@bevi/shared';

import { api } from '@/api/client';
import { useAuthListener } from '@/api/hooks';
import { keys } from '@/api/keys';
import { controls } from '@/testing/fakeApi';

// BEV-27: what `useAuthListener` makes of a `getSession` that got no answer. The session it reports
// on mount and the events after it are covered in src/testing/fakeApi/__tests__/hooks.test.tsx.

const TESTER: Session = { userId: 'user-tester', handle: 'tester' };

const clients: QueryClient[] = [];

async function listen() {
  // gcTime: Infinity schedules no garbage-collection timers, so Jest can exit.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const sessions: (Session | null)[] = [];
  const unknowns: unknown[] = [];
  const hook = await renderHook(
    () =>
      useAuthListener(
        (s) => sessions.push(s),
        (e) => unknowns.push(e),
      ),
    { wrapper },
  );
  return { client, sessions, unknowns, askAgain: () => hook.result.current() };
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.restoreAllMocks();
});

it('a session check that got no answer is reported as unknown, never as signed out', async () => {
  controls.signInAs('tester');
  controls.failNext('network', 'getSession');
  const { client, sessions, unknowns } = await listen();
  await waitFor(() => expect(unknowns).toHaveLength(1));
  expect(unknowns[0]).toMatchObject({ code: 'network' });
  expect(sessions).toEqual([]);
  // Not written as "no session" either.
  expect(client.getQueryData(keys.session())).toBeUndefined();
});

it('asked again, it reports the session', async () => {
  controls.signInAs('tester');
  controls.failNext('network', 'getSession');
  const { client, sessions, unknowns, askAgain } = await listen();
  await waitFor(() => expect(unknowns).toHaveLength(1));

  await act(async () => askAgain());
  await waitFor(() => expect(sessions).toEqual([TESTER]));
  expect(unknowns).toHaveLength(1);
  expect(client.getQueryData(keys.session())).toEqual(TESTER);
});

it('asked again with still no answer, it is unknown again', async () => {
  controls.signInAs('tester');
  controls.failNext('network', 'getSession');
  controls.failNext('network', 'getSession');
  const { sessions, unknowns, askAgain } = await listen();
  await waitFor(() => expect(unknowns).toHaveLength(1));

  await act(async () => askAgain());
  await waitFor(() => expect(unknowns).toHaveLength(2));
  expect(sessions).toEqual([]);
});

it('a session check that fails for any other reason is still reported as signed out', async () => {
  controls.signInAs('tester');
  controls.failNext('unknown', 'getSession');
  const { sessions, unknowns } = await listen();
  await waitFor(() => expect(sessions).toEqual([null]));
  expect(unknowns).toEqual([]);
});

it('an auth event heard while an answer is on its way wins over the answer', async () => {
  controls.signInAs('tester');
  let reject!: (e: unknown) => void;
  const getSession = jest.spyOn(api, 'getSession').mockImplementationOnce(() => new Promise((_resolve, r) => (reject = r)));
  const { sessions, unknowns } = await listen();
  await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

  await act(async () => controls.signInAs('tester')); // the token refreshed: an event carrying the session
  await waitFor(() => expect(sessions).toEqual([TESTER]));
  const answered = getSession.mock.results[0]!.value as Promise<unknown>;
  await act(async () => {
    reject(new ApiError('network', 'late'));
    await answered.catch(() => {});
  });
  expect(unknowns).toEqual([]);
  expect(sessions).toEqual([TESTER]);
});
