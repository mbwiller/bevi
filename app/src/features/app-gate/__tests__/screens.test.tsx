import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { MAINTENANCE_DEFAULT_BODY, MaintenanceNotice } from '../MaintenanceNotice';
import { UPDATE_BODY_NO_STORE, UPDATE_BODY_WITH_STORE, UpdateRequired } from '../UpdateRequired';
import { APP_STORE_ID, SUPPORT_EMAIL, appStoreUrl } from '@/lib/appStore';

describe('MaintenanceNotice', () => {
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

  it('the shipped constants are null until the founders supply them', () => {
    expect(APP_STORE_ID).toBeNull();
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

  it('the shipped defaults (both null) behave the same', async () => {
    await render(<UpdateRequired />);
    expect(screen.getByText(UPDATE_BODY_NO_STORE)).toBeTruthy();
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
