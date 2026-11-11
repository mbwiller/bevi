import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/api/client';
import { useAuthListener, useSignOut } from '@/api/hooks';
import { DEFAULT_POINTS_SCOPE, usePointsScope } from '@/features/leaderboard/pointsScope';
import { ME, controls } from '@/testing/fakeApi';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs(ME.handle);
  usePointsScope.setState({ scope: DEFAULT_POINTS_SCOPE });
});

afterEach(() => client.clear());

describe('the Friends | Everyone choice', () => {
  it('starts on Friends and keeps a change', async () => {
    expect(usePointsScope.getState().scope).toBe('friends');
    await act(() => usePointsScope.getState().setScope('everyone'));
    expect(usePointsScope.getState().scope).toBe('everyone');
  });

  it('goes back to Friends on sign-out, so the next account on this tab opens there', async () => {
    await act(() => usePointsScope.getState().setScope('everyone'));
    const signOut = await renderHook(() => useSignOut(), { wrapper });
    await act(() => signOut.result.current.mutateAsync());
    expect(usePointsScope.getState().scope).toBe('friends');
  });

  it('goes back to Friends when the session ends from elsewhere (expiry, another tab)', async () => {
    const heard: unknown[] = [];
    await renderHook(() => useAuthListener((s) => heard.push(s)), { wrapper });
    await waitFor(() => expect(heard).toHaveLength(1));
    await act(() => usePointsScope.getState().setScope('everyone'));
    await act(() => api.signOut());
    await waitFor(() => expect(heard.at(-1)).toBeNull());
    expect(usePointsScope.getState().scope).toBe('friends');
  });
});
