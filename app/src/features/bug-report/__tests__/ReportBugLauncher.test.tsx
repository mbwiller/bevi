import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Header } from '@/components/Header';
import { useSession } from '@/state/session';
import { controls } from '@/testing/fakeApi';

import { hidesLauncher, ReportBugHeaderAction, ReportBugLauncher } from '../ReportBugLauncher';

const mockPush = jest.fn();
const mockPathname = { current: '/feed' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  usePathname: () => mockPathname.current,
}));

let client: QueryClient;

function Providers({ children }: { children: ReactNode }) {
  return (
    // The fallback pill reads the safe-area inset, so it needs the provider the root layout gives it.
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** A screen's Header under the provider the root layout mounts. */
function renderHeader(active = true) {
  return render(
    <Providers>
      <ReportBugHeaderAction active={active}>
        <Header title="Feed" actions={[{ icon: 'user-plus', label: 'Find people', onPress: jest.fn() }]} />
      </ReportBugHeaderAction>
    </Providers>,
  );
}

/** The gate query has answered and its re-render has landed, so an absence is real. */
async function settled() {
  await waitFor(() => expect(client.getQueryState(['bevi', 'canReportBug'])?.status).toBe('success'));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
const buttonLabels = () => screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);

beforeEach(() => {
  controls.setLatency(0);
  controls.resetToFixtures();
  controls.signInAs('tester');
  mockPathname.current = '/feed';
  mockPush.mockClear();
  useSession.setState({ status: 'signedOut' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(() => client.clear());

describe('the Report a bug header action', () => {
  it('shows nothing extra for an ordinary account', async () => {
    controls.setInternalReporter(false);
    await renderHeader();
    // Give the gate query time to settle before concluding it is absent.
    await settled();
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
    expect(buttonLabels()).toEqual(['Find people']);
  });

  it('appears for an internal reporter, first in the actions', async () => {
    controls.setInternalReporter(true);
    await renderHeader();
    await screen.findByLabelText('Report a bug');
    expect(buttonLabels()).toEqual(['Report a bug', 'Find people']);
  });

  it('carries the current screen to the form', async () => {
    controls.setInternalReporter(true);
    mockPathname.current = '/bev/[id]';
    await renderHeader();
    await fireEvent.press(await screen.findByLabelText('Report a bug'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/report-bug', params: { from: '/bev/[id]' } });
  });

  it.each(['/report-bug', '/rank/abc-123', '/add/new', '/image/https%3A%2F%2Fx'])(
    'stays off %s: the reporter and the full-screen modals',
    async (pathname) => {
      controls.setInternalReporter(true);
      mockPathname.current = pathname;
      await renderHeader();
      await settled();
      expect(screen.queryByLabelText('Report a bug')).toBeNull();
      expect(buttonLabels()).toEqual(['Find people']);
    },
  );

  it('asks nothing and shows nothing before the session is signed in', async () => {
    controls.setInternalReporter(true);
    await renderHeader(false);
    expect(screen.getByLabelText('Find people')).toBeTruthy();
    expect(client.getQueryState(['bevi', 'canReportBug'])?.status ?? 'pending').toBe('pending');
    expect(client.getQueryState(['bevi', 'canReportBug'])?.fetchStatus ?? 'idle').toBe('idle');
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('hides only on the reporter and the modal routes', () => {
    expect(hidesLauncher('/feed')).toBe(false);
    expect(hidesLauncher('/bev/abc')).toBe(false);
    expect(hidesLauncher('/people')).toBe(false);
    expect(hidesLauncher('/report-bug')).toBe(true);
    expect(hidesLauncher('/rank/abc')).toBe(true);
    expect(hidesLauncher('/add/new')).toBe(true);
    expect(hidesLauncher('/image/x')).toBe(true);
    expect(hidesLauncher(undefined)).toBe(false);
  });
});

describe('the fallback pill (the not-found page, which has no Header)', () => {
  function renderPill() {
    return render(
      <Providers>
        <ReportBugLauncher />
      </Providers>,
    );
  }

  beforeEach(() => useSession.setState({ status: 'ready' }));

  it('shows for an internal reporter and carries the current screen', async () => {
    controls.setInternalReporter(true);
    mockPathname.current = '/no/such/page';
    await renderPill();
    await fireEvent.press(await screen.findByLabelText('Report a bug'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/report-bug', params: { from: '/no/such/page' } });
  });

  it('keeps a 44pt hit area under the 30pt pill', async () => {
    controls.setInternalReporter(true);
    await renderPill();
    await screen.findByLabelText('Report a bug');
    expect(screen.getByTestId('hit-target')).toBeTruthy();
  });

  it('shows nothing for an ordinary account', async () => {
    controls.setInternalReporter(false);
    await renderPill();
    await settled();
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });

  it('shows nothing when signed out', async () => {
    useSession.setState({ status: 'signedOut' });
    controls.setInternalReporter(true);
    await renderPill();
    expect(screen.queryByLabelText('Report a bug')).toBeNull();
  });
});
