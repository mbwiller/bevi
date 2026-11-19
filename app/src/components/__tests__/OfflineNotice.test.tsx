import NetInfo, { type NetInfoChangeHandler, type NetInfoState } from '@react-native-community/netinfo';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OfflineNoticeHost } from '../OfflineNotice';

// Jest resolves as iOS: the native hook (NetInfo, mocked in jest.setup.js) and the native provider.

const addEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;

let listener: NetInfoChangeHandler | undefined;

beforeEach(() => {
  listener = undefined;
  addEventListener.mockImplementation((l) => {
    listener = l;
    return jest.fn();
  });
});

afterEach(() => addEventListener.mockReset().mockReturnValue(jest.fn()));

const emit = (isConnected: boolean | null) =>
  act(async () => listener!({ isConnected, isInternetReachable: null } as NetInfoState));

async function renderHost() {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } }}>
      <OfflineNoticeHost>
        <Text>screen</Text>
      </OfflineNoticeHost>
    </SafeAreaProvider>,
  );
}

it('shows "You\'re offline" with no connection, and drops it when it is back', async () => {
  await renderHost();
  expect(screen.queryByText("You're offline")).toBeNull();

  await emit(false);
  expect(screen.getByText("You're offline")).toBeTruthy();
  const notice = screen.getByTestId('offline-notice');
  expect(notice.props.role).toBe('status');
  // It clears the status bar itself.
  expect(StyleSheet.flatten(notice.props.style).paddingTop).toBeGreaterThanOrEqual(59);
  expect(screen.getByText('screen')).toBeTruthy();

  await emit(true);
  expect(screen.queryByText("You're offline")).toBeNull();
  expect(screen.getByText('screen')).toBeTruthy();
});

it('does not show it while the connection is not known yet', async () => {
  await renderHost();
  await emit(null);
  expect(screen.queryByText("You're offline")).toBeNull();
});
