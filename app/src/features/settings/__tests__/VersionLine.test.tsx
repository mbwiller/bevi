import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { crashNatively, crashReportingEnabled, sendTestError } from '@/lib/crashReporting';

import { VersionLine } from '../VersionLine';
import { VersionLine as VersionLineOnWeb } from '../VersionLine.web';

// Jest resolves as iOS, so `../VersionLine` is the native file; the web one is imported by name.
// The control that proves crash reporting end to end (DEVELOPMENT-MATT-IOS.md, IS-4). Whether a
// build reports crashes is lib/crashReporting.ts's answer, which has its own suite; here it is given.
jest.mock('@/lib/crashReporting', () => ({
  crashReportingEnabled: jest.fn(() => false),
  sendTestError: jest.fn(),
  crashNatively: jest.fn(),
}));

const enabled = crashReportingEnabled as jest.MockedFunction<typeof crashReportingEnabled>;
let alert: jest.SpyInstance;

/** The buttons of the most recent alert, by their text. */
function buttons(): Record<string, AlertButton> {
  const shown = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  return Object.fromEntries((shown ?? []).map((b) => [b.text, b]));
}

beforeEach(() => {
  jest.clearAllMocks();
  enabled.mockReturnValue(false);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => alert.mockRestore());

describe('on a build that does not report crashes', () => {
  it('is a line of text: nothing to press, nothing offered', async () => {
    await render(<VersionLine version="0.1.0" />);
    expect(screen.getByText('Bevi 0.1.0')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Bevi 0.1.0')).toBeNull();
    await fireEvent(screen.getByText('Bevi 0.1.0'), 'longPress');
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('on a build that reports crashes', () => {
  beforeEach(() => enabled.mockReturnValue(true));

  it('says what a long press does, and has a full-size target', async () => {
    await render(<VersionLine version="0.1.0" />);
    const line = screen.getByRole('button', { name: 'Bevi 0.1.0' });
    expect(line.props.accessibilityHint).toBe('Press and hold to test crash reporting');
    expect(line.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Test crash reporting' }]);
    expect(line).toHaveStyle({ minHeight: 44 });
  });

  it('a tap does nothing', async () => {
    await render(<VersionLine version="0.1.0" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Bevi 0.1.0' }));
    expect(alert).not.toHaveBeenCalled();
  });

  it('a long press asks first, and does nothing until one is chosen', async () => {
    await render(<VersionLine version="0.1.0" />);
    await fireEvent(screen.getByRole('button', { name: 'Bevi 0.1.0' }), 'longPress');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe('Test crash reporting');
    expect(alert.mock.calls[0]?.[1]).toContain('open it again so the report is sent');
    expect(Object.keys(buttons())).toEqual(['Send a test error', 'Crash Bevi now', 'Cancel']);
    expect(buttons()['Crash Bevi now']?.style).toBe('destructive');
    expect(buttons().Cancel?.style).toBe('cancel');
    expect(buttons().Cancel?.onPress).toBeUndefined();
    expect(sendTestError).not.toHaveBeenCalled();
    expect(crashNatively).not.toHaveBeenCalled();
  });

  it('VoiceOver reaches the same question through the action', async () => {
    await render(<VersionLine version="0.1.0" />);
    await fireEvent(screen.getByRole('button', { name: 'Bevi 0.1.0' }), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe('Test crash reporting');
  });

  it('"Send a test error" files one, says what to look for, and does not crash', async () => {
    await render(<VersionLine version="0.1.0" />);
    await fireEvent(screen.getByRole('button', { name: 'Bevi 0.1.0' }), 'longPress');
    buttons()['Send a test error']?.onPress?.();
    expect(sendTestError).toHaveBeenCalledTimes(1);
    expect(crashNatively).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1]?.[0]).toBe('Test error filed');
    expect(alert.mock.calls[1]?.[1]).toContain('Bevi crash reporting test');
  });

  it('"Crash Bevi now" crashes natively, and files no test error', async () => {
    await render(<VersionLine version="0.1.0" />);
    await fireEvent(screen.getByRole('button', { name: 'Bevi 0.1.0' }), 'longPress');
    buttons()['Crash Bevi now']?.onPress?.();
    expect(crashNatively).toHaveBeenCalledTimes(1);
    expect(sendTestError).not.toHaveBeenCalled();
  });
});

describe('the web file', () => {
  it('is only ever the line of text, and never asks whether crashes are reported', async () => {
    enabled.mockReturnValue(true);
    await render(<VersionLineOnWeb version="0.1.0" />);
    expect(screen.getByText('Bevi 0.1.0')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    await fireEvent(screen.getByText('Bevi 0.1.0'), 'longPress');
    expect(alert).not.toHaveBeenCalled();
    expect(enabled).not.toHaveBeenCalled();
  });

  it('draws the line as the native file does when nothing can be pressed', async () => {
    const web = await render(<VersionLineOnWeb version="0.1.0" />);
    const onWeb = web.toJSON();
    await web.unmount();
    const native = await render(<VersionLine version="0.1.0" />);
    expect(native.toJSON()).toEqual(onWeb);
  });
});
