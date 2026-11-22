import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { MAINTENANCE_DEFAULT_BODY, MaintenanceNotice } from '../MaintenanceNotice';
import { UPDATE_BODY_NO_STORE, UPDATE_BODY_WITH_STORE, UpdateRequired } from '../UpdateRequired';
import { APP_STORE_ID, SUPPORT_EMAIL, appStoreUrl } from '@/lib/appStore';

/** The one ScrollView on screen centres its content when short and scrolls when the text outgrows the window. */
type Json = { props?: Record<string, unknown>; children?: unknown } | string | null;
/** The first node in the rendered tree that has a `contentContainerStyle`: the ScrollView. */
function findScroll(node: Json | Json[]): Record<string, unknown> | undefined {
  if (!node || typeof node === 'string') return undefined;
  if (Array.isArray(node)) return node.map(findScroll).find(Boolean);
  if (node.props?.contentContainerStyle !== undefined) return node.props;
  return findScroll(node.children as Json[] | null);
}
const expectScrollsCentred = () => {
  const scroll = findScroll(screen.toJSON() as Json);
  expect(scroll).toBeDefined();
  expect(StyleSheet.flatten(scroll!.contentContainerStyle as object)).toMatchObject({ flexGrow: 1, justifyContent: 'center' });
};

describe('MaintenanceNotice', () => {
  it('scrolls, so a long message at the largest text size is not clipped, and keeps its control', async () => {
    await render(<MaintenanceNotice message={'A long message about the maintenance. '.repeat(40)} onRetry={() => undefined} />);
    expectScrollsCentred();
    expect(screen.getByText(/A long message/)).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('shows the founders message when there is one', async () => {
    await render(<MaintenanceNotice message="Back at 6pm." onRetry={() => undefined} />);
    expect(screen.getByText("We'll be right back")).toBeTruthy();
    expect(screen.getByText('Back at 6pm.')).toBeTruthy();
    expect(screen.queryByText(MAINTENANCE_DEFAULT_BODY)).toBeNull();
  });

  it('shows the default line otherwise (null or blank)', async () => {
    const { rerender } = await render(<MaintenanceNotice message={null} onRetry={() => undefined} />);
    expect(screen.getByText(MAINTENANCE_DEFAULT_BODY)).toBeTruthy();
    await rerender(<MaintenanceNotice message="   " onRetry={() => undefined} />);
    expect(screen.getByText(MAINTENANCE_DEFAULT_BODY)).toBeTruthy();
  });

  it('Try again calls onRetry; it waits while checking', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(<MaintenanceNotice message={null} onRetry={onRetry} />);
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await rerender(<MaintenanceNotice message={null} onRetry={onRetry} checking />);
    await fireEvent.press(screen.getByLabelText('Checking'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is modal to VoiceOver', async () => {
    await render(<MaintenanceNotice message={null} onRetry={() => undefined} />);
    expect(screen.getByTestId('maintenance-notice').props.accessibilityViewIsModal).toBe(true);
  });
});

describe('UpdateRequired', () => {
  let open: jest.SpyInstance;
  beforeEach(() => {
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('scrolls, centred, with its controls and the version line', async () => {
    await render(<UpdateRequired version="1.2.3" build="45" appStoreId="123" supportEmail="a@b.co" />);
    expectScrollsCentred();
    expect(screen.getByText('Update Bevi')).toBeTruthy();
    expect(screen.getByLabelText('Update Bevi in the App Store')).toBeTruthy();
    expect(screen.getByLabelText('Contact us at a@b.co')).toBeTruthy();
    expect(screen.getByText('Version 1.2.3 build 45')).toBeTruthy();
  });

  it('ships the App Store id; the support address stays null until the founders supply it', () => {
    expect(APP_STORE_ID).toBe('6836079118');
    expect(SUPPORT_EMAIL).toBeNull();
  });

  it('null id and null address: no Update button, no contact line, copy points at TestFlight or the App Store', async () => {
    await render(<UpdateRequired version="1.2.3" build="45" appStoreId={null} supportEmail={null} />);
    expect(screen.getByText('Update Bevi')).toBeTruthy();
    expect(screen.getByText(UPDATE_BODY_NO_STORE)).toBeTruthy();
    expect(UPDATE_BODY_NO_STORE).toContain('TestFlight or the App Store');
    expect(screen.queryByLabelText('Update Bevi in the App Store')).toBeNull();
    expect(screen.queryByText(/Contact us/)).toBeNull();
    expect(screen.getByText('Version 1.2.3 build 45')).toBeTruthy();
  });

  it('the shipped defaults: Update opens the App Store page, no contact line', async () => {
    await render(<UpdateRequired />);
    expect(screen.getByText(UPDATE_BODY_WITH_STORE)).toBeTruthy();
    expect(screen.getByLabelText('Update Bevi in the App Store')).toBeTruthy();
    expect(screen.queryByText(/Contact us/)).toBeNull();
    expect(screen.queryByText(/Version/)).toBeNull();
  });

  it('with an id: Update opens the App Store page', async () => {
    await render(<UpdateRequired appStoreId="1234567890" supportEmail={null} />);
    expect(screen.getByText(UPDATE_BODY_WITH_STORE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Update Bevi in the App Store'));
    expect(open).toHaveBeenCalledWith(appStoreUrl('1234567890'));
    expect(appStoreUrl('1234567890')).toBe('https://apps.apple.com/app/id1234567890');
  });

  it('with an address: a contact line opens mail', async () => {
    await render(<UpdateRequired appStoreId={null} supportEmail="help@example.com" />);
    await fireEvent.press(screen.getByLabelText('Contact us at help@example.com'));
    expect(open).toHaveBeenCalledWith('mailto:help@example.com');
  });

  it('has no way past it: nothing but Update and Contact is pressable', async () => {
    await render(<UpdateRequired appStoreId={null} supportEmail={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
