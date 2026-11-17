// The Map tab's gate on the Find Bev camera test: an ordinary account sees the tab exactly as it
// ships; an internal reporter also gets the entry, which swaps in the spike and back.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapTab from '@/app/(tabs)/map/index';
import { controls } from '@/testing/fakeApi';

import { FIND_BEV_CAPTION } from '../../FindBevScreen';
import { SPIKE_ENTRY_LABEL } from '../MapTabWithSpike';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

const METRICS = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
let client: QueryClient;

async function renderMapTab() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <MapTab />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  // The gate query has answered and its re-render has landed, so an absence is real.
  await waitFor(() => expect(client.getQueryState(['bevi', 'canReportBug'])?.status).toBe('success'));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

it('shows an ordinary account the Map tab as it ships, with no way into the camera test', async () => {
  controls.setInternalReporter(false);
  await renderMapTab();
  expect(screen.getByText(FIND_BEV_CAPTION)).toBeTruthy();
  expect(screen.queryByRole('button', { name: SPIKE_ENTRY_LABEL })).toBeNull();
});

it('gives an internal reporter the entry, which opens the camera test and comes back', async () => {
  controls.setInternalReporter(true);
  await renderMapTab();
  expect(screen.getByText(FIND_BEV_CAPTION)).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: SPIKE_ENTRY_LABEL }));
  expect(screen.getByText('Find Bev spike (S1 / S2)')).toBeTruthy();
  expect(screen.queryByText(FIND_BEV_CAPTION)).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Back to Map' }));
  expect(screen.getByText(FIND_BEV_CAPTION)).toBeTruthy();
});
