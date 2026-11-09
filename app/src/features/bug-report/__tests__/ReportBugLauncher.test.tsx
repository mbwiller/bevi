import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { controls } from '@/testing/fakeApi';

import { ReportBugLauncher } from '../ReportBugLauncher';

const mockPush = jest.fn();
const mockPathname = { current: '/feed' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  usePathname: () => mockPathname.current,
}));

let client: QueryClient;

function renderLauncher() {
  return render(
    // The launcher reads the safe-area inset to clear the tab bar, so it needs
    // the provider the root layout gives it in the app.
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <QueryClientProvider client={client}>
        <ReportBugLauncher />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockPathname.current = '/feed';
  mockPush.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

describe('the Report a bug launcher', () => {
  it('shows nothing at all for an ordinary account', async () => {
    controls.setInternalReporter(false);
    await renderLauncher();
    // Give the gate query time to settle before concluding it is absent.
    await waitFor(() => expect(client.getQueryState(['bevi', 'canReportBug'])?.status).toBe('success'));
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('appears for an internal reporter and carries the current screen to the form', async () => {
    controls.setInternalReporter(true);
    mockPathname.current = '/bev/[id]';
    await renderLauncher();

    const button = await screen.findByLabelText('Report a bug');
    await fireEvent.press(button);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/report-bug', params: { from: '/bev/[id]' } });
  });

  it('does not sit on top of the reporter itself', async () => {
    controls.setInternalReporter(true);
    mockPathname.current = '/report-bug';
    await renderLauncher();
    await waitFor(() => expect(client.getQueryState(['bevi', 'canReportBug'])?.status).toBe('success'));
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('keeps a 44pt hit area under the 30pt pill', async () => {
    controls.setInternalReporter(true);
    await renderLauncher();
    await screen.findByLabelText('Report a bug');
    expect(screen.getByTestId('hit-target')).toBeTruthy();
  });
});
